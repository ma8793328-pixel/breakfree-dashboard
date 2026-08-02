import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, indexJournal, DATA_DIR } from './db.js';
import { BADGE_THRESHOLDS, computeStats, todayKey } from './stats.js';
import {
  PRICE_CENTS,
  FREE_HABIT_LIMIT,
  isPremium,
  createCheckoutSession,
  completeCheckout,
  cancelSubscription,
  publicSubscription,
} from './billing.js';
import { registerAiRoutes } from './ai.js';
import { registerAdminRoutes } from './admin.js';
import { registerPremiumRoutes } from './premium.js';
import { registerPushRoutes, notifyLowSleep, notifyUrgeTip, notifyMilestone, cleanupStaleSubscriptions, DEFAULT_PREFS, prefsFor } from './push.js';
import { findNearby, geocodeArea, GENERIC_IDEAS } from './daysout.js';

// Load server/.env if present (PORT, JWT_SECRET, ADMIN_*, VAPID_*). Missing
// file is fine — everything has local defaults or persisted fallbacks.
try {
  process.loadEnvFile();
} catch {
  /* no .env — using defaults */
}

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'breakfree-dev-secret-change-me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@breakfree.app').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Auth helpers ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, createdAt: user.created_at };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

function requirePremium(req, res, next) {
  if (!isPremium(req.user.id)) {
    return res.status(402).json({ error: 'This is a Premium feature.', code: 'PREMIUM_REQUIRED' });
  }
  next();
}

function getHabitForUser(habitId, userId) {
  return db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(habitId, userId);
}

function getStatsForHabit(habit) {
  const checkins = db.prepare('SELECT date, status FROM checkins WHERE habit_id = ?').all(habit.id);
  return computeStats(checkins, habit.daily_cost, habit.daily_time);
}

function getBadges(habitId) {
  return db.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').all(habitId);
}

function awardBadges(habitId, currentStreak) {
  const earned = [];
  const insert = db.prepare(
    'INSERT OR IGNORE INTO badges (habit_id, threshold, earned_date) VALUES (?, ?, ?)'
  );
  const today = todayKey();
  for (const t of BADGE_THRESHOLDS) {
    if (currentStreak >= t) {
      const res = insert.run(habitId, t, today);
      if (res.changes > 0) earned.push({ threshold: t, earnedDate: today });
    }
  }
  return earned;
}

function habitPayload(habit) {
  return {
    id: habit.id,
    name: habit.name,
    startDate: habit.start_date,
    dailyCost: habit.daily_cost,
    costUnit: habit.cost_unit,
    dailyTime: habit.daily_time,
    createdAt: habit.created_at,
    stats: getStatsForHabit(habit),
    badges: getBadges(habit.id),
  };
}

// ---------- Auth ----------

app.post('/api/auth/signup', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(String(email).toLowerCase(), hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

// ---------- Subscription (simulated checkout, Stripe-ready) ----------

app.get('/api/subscription', requireAuth, (req, res) => {
  res.json({ subscription: publicSubscription(req.user.id), price: PRICE_CENTS });
});

app.post('/api/subscription/checkout', requireAuth, (req, res) => {
  if (isPremium(req.user.id)) {
    return res.json({ alreadyPremium: true, subscription: publicSubscription(req.user.id) });
  }
  res.json({ session: createCheckoutSession(req.user.id) });
});

app.post('/api/subscription/complete', requireAuth, (req, res) => {
  const { sessionId } = req.body || {};
  const result = completeCheckout(req.user.id, sessionId);
  if (!result.ok) return res.status(400).json({ error: result.error || 'Payment not completed.' });
  res.json({ subscription: publicSubscription(req.user.id) });
});

app.post('/api/subscription/cancel', requireAuth, (req, res) => {
  cancelSubscription(req.user.id);
  res.json({ subscription: publicSubscription(req.user.id) });
});

// ---------- Habits ----------

app.get('/api/habits', requireAuth, (req, res) => {
  const habits = db
    .prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at, id')
    .all(req.user.id);
  res.json({ habits: habits.map(habitPayload) });
});

app.post('/api/habits', requireAuth, (req, res) => {
  const { name, startDate, dailyCost, costUnit, dailyTime } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Habit name is required.' });
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ error: 'A valid start date is required.' });
  }

  if (!isPremium(req.user.id)) {
    const owned = db.prepare('SELECT COUNT(*) AS c FROM habits WHERE user_id = ?').get(req.user.id).c;
    if (owned >= FREE_HABIT_LIMIT) {
      return res.status(402).json({
        error: `The free plan includes ${FREE_HABIT_LIMIT} habit. Upgrade to add more.`,
        code: 'PLAN_LIMIT',
      });
    }
  }

  const info = db
    .prepare(
      'INSERT INTO habits (user_id, name, start_date, daily_cost, cost_unit, daily_time) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      req.user.id,
      String(name).trim(),
      startDate,
      dailyCost && dailyCost > 0 ? dailyCost : null,
      costUnit || 'day',
      dailyTime && dailyTime > 0 ? dailyTime : null
    );
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ habit: habitPayload(habit) });
});

app.patch('/api/habits/:id', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { name, dailyCost, costUnit, dailyTime } = req.body || {};
  db.prepare('UPDATE habits SET name = ?, daily_cost = ?, cost_unit = ?, daily_time = ? WHERE id = ?').run(
    name != null ? String(name).trim() : habit.name,
    dailyCost != null && dailyCost > 0 ? dailyCost : habit.daily_cost,
    costUnit != null ? costUnit : habit.cost_unit,
    dailyTime != null && dailyTime > 0 ? dailyTime : habit.daily_time,
    habit.id
  );
  const updated = db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id);
  res.json({ habit: habitPayload(updated) });
});

app.delete('/api/habits/:id', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  db.prepare('DELETE FROM habits WHERE id = ?').run(habit.id);
  res.json({ ok: true });
});

app.get('/api/habits/:id', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const checkins = db
    .prepare('SELECT date, status, note FROM checkins WHERE habit_id = ? ORDER BY date DESC')
    .all(habit.id);
  const urges = db
    .prepare('SELECT id, logged_at, intensity, trigger, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC')
    .all(habit.id);
  const journals = db
    .prepare('SELECT id, date, content FROM journals WHERE habit_id = ? ORDER BY date DESC, id DESC')
    .all(habit.id);
  const dailyCheckin = db
    .prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?')
    .get(habit.id, todayKey());
  const dailyCheckins = db
    .prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date DESC LIMIT 14')
    .all(habit.id)
    .reverse();
  res.json({
    habit: habitPayload(habit),
    checkins,
    urges,
    journals,
    badges: getBadges(habit.id),
    dailyCheckin: dailyCheckin || null,
    dailyCheckins,
  });
});

// ---------- Daily wellness check-in ----------

app.get('/api/habits/:id/daily-checkin', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : todayKey();
  const row = db
    .prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?')
    .get(habit.id, date);
  res.json({ checkin: row || null });
});

app.post('/api/habits/:id/daily-checkin', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { date, energy, sleep, mood } = req.body || {};
  const e = Number(energy);
  const s = Number(sleep);
  const m = Number(mood);
  for (const [label, v] of [['energy', e], ['sleep', s], ['mood', m]]) {
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      return res.status(400).json({ error: `${label} must be a whole number between 1 and 5.` });
    }
  }
  const key = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
  db.prepare(
    `INSERT INTO daily_checkins (habit_id, date, energy, sleep, mood) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (habit_id, date) DO UPDATE SET
       energy = excluded.energy,
       sleep = excluded.sleep,
       mood = excluded.mood,
       updated_at = datetime('now')`
  ).run(habit.id, key, e, s, m);
  if (s < 3) notifyLowSleep(req.user.id, habit.id, s).catch(() => {});
  const row = db
    .prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?')
    .get(habit.id, key);
  res.json({ checkin: row });
});

// ---------- Check-ins ----------

app.post('/api/habits/:id/checkin', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { status, note, date } = req.body || {};
  if (status !== 'clean' && status !== 'slip') {
    return res.status(400).json({ error: 'Status must be "clean" or "slip".' });
  }
  const key = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
  db.prepare(
    `INSERT INTO checkins (habit_id, date, status, note) VALUES (?, ?, ?, ?)
     ON CONFLICT (habit_id, date) DO UPDATE SET status = excluded.status, note = excluded.note`
  ).run(habit.id, key, status, note ? String(note).trim() : null);

  let newBadge = null;
  if (status === 'clean') {
    const stats = getStatsForHabit(habit);
    const earned = awardBadges(habit.id, stats.currentStreak);
    if (earned.length > 0) newBadge = earned[earned.length - 1];
  }
  const updated = db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id);
  res.json({ habit: habitPayload(updated), newBadge });
  if (newBadge) notifyMilestone(req.user.id, habit.id, newBadge.threshold).catch(() => {});
});

// ---------- Urges ----------

app.get('/api/habits/:id/urges', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const urges = db
    .prepare('SELECT id, logged_at, intensity, trigger, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC')
    .all(habit.id);
  res.json({ urges });
});

app.post('/api/habits/:id/urges', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { intensity, trigger, resisted, loggedAt } = req.body || {};
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
    return res.status(400).json({ error: 'Intensity must be between 1 and 5.' });
  }
  const info = db
    .prepare(
      'INSERT INTO urges (habit_id, logged_at, intensity, trigger, resisted) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      habit.id,
      loggedAt || new Date().toISOString(),
      intensity,
      trigger ? String(trigger).trim() : null,
      resisted ? 1 : 0
    );
  const urge = db.prepare('SELECT id, logged_at, intensity, trigger, resisted FROM urges WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ urge });
  notifyUrgeTip(req.user.id, habit.id).catch(() => {});
});

// ---------- Journal ----------

app.get('/api/habits/:id/journals', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const journals = db
    .prepare('SELECT id, date, content FROM journals WHERE habit_id = ? ORDER BY date DESC, id DESC')
    .all(habit.id);
  res.json({ journals });
});

app.post('/api/habits/:id/journals', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { content, date } = req.body || {};
  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: 'Journal entry cannot be empty.' });
  }
  const key = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
  const info = db
    .prepare('INSERT INTO journals (habit_id, date, content) VALUES (?, ?, ?)')
    .run(habit.id, key, String(content).trim());
  const entry = db.prepare('SELECT id, date, content FROM journals WHERE id = ?').get(info.lastInsertRowid);
  indexJournal(entry.id, entry.content);
  res.status(201).json({ entry });
});

// ---------- Days out (Premium) ----------

app.get('/api/days-out', requireAuth, requirePremium, async (req, res) => {
  const { lat, lon, area, radius } = req.query;
  try {
    if (lat && lon) {
      const result = await findNearby(lat, lon, radius || 10000);
      return res.json(result);
    }
    if (area && String(area).trim()) {
      const geo = await geocodeArea(String(area).trim());
      const result = await findNearby(geo.lat, geo.lon, radius || 10000, geo.displayName);
      return res.json({ ...result, area: geo.displayName });
    }
    res.status(400).json({ error: 'Provide lat/lon or an area.' });
  } catch (e) {
    res.status(502).json({ error: e.message, ideas: GENERIC_IDEAS });
  }
});

app.get('/api/days-out/ideas', requireAuth, requirePremium, (req, res) => {
  res.json({ ideas: GENERIC_IDEAS });
});

// ---------- AI routes ----------

registerAiRoutes(app, { requireAuth, requirePremium, habitForUser: getHabitForUser });

// ---------- Premium features ----------

registerPremiumRoutes(app, { requireAuth, requirePremium, habitForUser: getHabitForUser });

// ---------- Admin routes ----------

registerAdminRoutes(app, { requireAuth, requireAdmin });

// ---------- Notification settings ----------

app.get('/api/settings/notifications', requireAuth, (req, res) => {
  const user = db.prepare('SELECT notification_prefs FROM users WHERE id = ?').get(req.user.id);
  res.json({ prefs: prefsFor(user) });
});

app.put('/api/settings/notifications', requireAuth, (req, res) => {
  const user = db.prepare('SELECT notification_prefs FROM users WHERE id = ?').get(req.user.id);
  const prefs = prefsFor(user);
  for (const key of Object.keys(DEFAULT_PREFS)) {
    if (typeof req.body?.[key] === 'boolean') prefs[key] = req.body[key];
  }
  db.prepare('UPDATE users SET notification_prefs = ? WHERE id = ?').run(JSON.stringify(prefs), req.user.id);
  res.json({ prefs });
});

// ---------- Client-side error reporting ----------

// Lightweight Sentry replacement: browser errors land in app_errors and show
// up in the Admin dashboard. The 1-minute dedupe stops error loops flooding
// the table.
app.post('/api/errors', requireAuth, (req, res) => {
  const { message, stack, url, kind } = req.body || {};
  const msg = String(message || '').trim();
  if (!msg) return res.status(400).json({ error: 'message is required.' });
  const dup = db
    .prepare("SELECT id FROM app_errors WHERE message = ? AND created_at >= datetime('now', '-1 minute')")
    .get(msg);
  if (!dup) {
    try {
      db.prepare('INSERT INTO app_errors (message, stack, url) VALUES (?, ?, ?)').run(
        msg.slice(0, 500),
        String(stack || '').slice(0, 2000),
        String(url || '').slice(0, 500)
      );
    } catch (e) {
      console.error('Failed to log client error:', e.message);
    }
  }
  res.json({ ok: true, kind: String(kind || '') });
});

// ---------- Push notifications ----------

registerPushRoutes(app, { requireAuth });

// ---------- Production static hosting ----------

// If the client build exists, serve it from this server so the whole app
// runs as one process (http://<machine-ip>:4000). API routes take priority;
// everything else falls through to the SPA. The Vite dev server remains the
// option during development (it proxies /api to this server anyway).
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(SERVER_DIR, '..', 'client', 'dist');
if (existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
  console.log(`Serving client build from ${CLIENT_DIST}`);
}

// ---------- Error handling ----------

app.use((err, req, res, _next) => {
  // Client-induced errors (malformed JSON etc.) are noise, not server faults.
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed request body.' });
  }
  console.error(err);
  try {
    db.prepare('INSERT INTO app_errors (message, stack, url) VALUES (?, ?, ?)').run(
      String(err && err.message ? err.message : err),
      String(err && err.stack ? err.stack : ''),
      req.originalUrl || ''
    );
  } catch (logErr) {
    console.error('Failed to log error:', logErr);
  }
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// ---------- Data export ----------

function csvField(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(...cols) {
  return cols.map(csvField).join(',');
}

app.get('/api/habits/:id/export', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const checkins = db
    .prepare('SELECT date, status, note FROM checkins WHERE habit_id = ? ORDER BY date ASC')
    .all(habit.id);
  const daily = db
    .prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date ASC')
    .all(habit.id);
  const urges = db
    .prepare('SELECT logged_at, intensity, trigger, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at ASC')
    .all(habit.id);
  const journals = db
    .prepare('SELECT date, content FROM journals WHERE habit_id = ? ORDER BY date ASC')
    .all(habit.id);

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="breakfree_export_${habit.id}_${date}.csv"`);

  // Stream rows as they're produced instead of buffering the whole file.
  res.write(`BreakFree export — ${csvField(habit.name)} (started ${habit.start_date})\r\n`);
  res.write(`Generated ${new Date().toISOString()}\r\n`);
  res.write('\r\n');
  res.write(`${csvRow('date', 'type', 'value', 'details')}\r\n`);
  for (const c of checkins) {
    res.write(`${csvRow(c.date, 'checkin', c.status, c.note)}\r\n`);
  }
  for (const d of daily) {
    res.write(`${csvRow(d.date, 'wellness', `energy ${d.energy}/5 · sleep ${d.sleep}/5 · mood ${d.mood}/5`, '')}\r\n`);
  }
  for (const u of urges) {
    res.write(`${csvRow(String(u.logged_at).slice(0, 10), 'urge', `intensity ${u.intensity}/5`, `${u.trigger || ''}${u.resisted ? '' : ' (not resisted)'}`)}\r\n`);
  }
  for (const j of journals) {
    res.write(`${csvRow(j.date, 'journal', '', j.content)}\r\n`);
  }
  res.end();
});

// ---------- Admin seed ----------

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (existing) {
    db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', ADMIN_EMAIL);
    return;
  }
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(
    ADMIN_EMAIL,
    hashPassword(ADMIN_PASSWORD),
    'admin'
  );
  console.log(`Admin account ready: ${ADMIN_EMAIL} (password from ADMIN_PASSWORD env, default "admin12345" — change it!)`);
}

// ---------- Backup (SQLite, daily) ----------

// VACUUM INTO produces a consistent snapshot of the whole database file.
// Keeps the newest 14 daily copies in data/backups/. Runs on boot and every
// 24 hours after that. This replaces the need for Postgres-style backups —
// the database is a single local file.
function backupDatabase() {
  const dir = path.join(DATA_DIR, 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(dir, `breakfree-${stamp}.db`);
  try {
    // VACUUM INTO refuses to overwrite — refresh the daily snapshot instead.
    try {
      unlinkSync(dest);
    } catch {
      /* no previous snapshot today */
    }
    db.exec(`VACUUM INTO '${dest}'`);
    console.log(`Database backup written: ${dest}`);
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
  // Prune even if the snapshot failed — old copies are safe to drop.
  try {
    const keep = readdirSync(dir)
      .filter((f) => /^breakfree-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .reverse()
      .slice(14);
    for (const old of keep) {
      try {
        unlinkSync(path.join(dir, old));
      } catch {
        /* best-effort prune */
      }
    }
  } catch (e) {
    console.error('Backup prune failed:', e.message);
  }
}

seedAdmin();

backupDatabase();
setInterval(backupDatabase, 24 * 60 * 60 * 1000).unref();

cleanupStaleSubscriptions();
setInterval(cleanupStaleSubscriptions, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`BreakFree server running on http://localhost:${PORT}`);
});
