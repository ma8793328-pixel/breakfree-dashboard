import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, indexJournal, DATA_DIR } from './db.js';
import {
  registerAiRoutes,
} from './ai.js';
import { registerCommunityRoutes } from './community.js';
import { registerAdminRoutes } from './admin.js';
import { registerPushRoutes, notifyLowSleep, notifyUrgeTip, notifyMilestone, cleanupStaleSubscriptions, DEFAULT_PREFS, prefsFor, scheduleTriggerNudge, sweepTriggerNudges } from './push.js';
import { findNearby, geocodeArea, GENERIC_IDEAS } from './daysout.js';
import { evaluateUserEngagement, evaluateAllEngagement } from './engage.js';

// The "Day 3–7 wall": a high-support window where survival-mode messaging and
// extra nudges kick in. After day 7 the worst of acute withdrawal is behind.
function wallInfo(stats) {
  const day = stats?.currentStreak || 0;
  return { active: day >= 3 && day <= 7, day };
}

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
    const payload = jwt.verify(token, JWT_SECRET);
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(payload.id);
    if (!existing) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = payload;
    // Fire-and-forget: re-engagement cascade + Sunday digest (parity with the
    // worker). Cheap because it short-circuits when the user checked in today.
    void evaluateUserEngagement(payload.id).catch(() => {});
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

function getHabitForUser(habitId, userId) {
  return db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(habitId, userId);
}

function getStatsForHabit(habit) {
  const checkins = db.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').all(habit.id);
  return computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
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

function parseTriggerTimes(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function habitPayload(habit) {
  const stats = getStatsForHabit(habit);
  return {
    id: habit.id,
    name: habit.name,
    startDate: habit.start_date,
    dailyCost: habit.daily_cost,
    costUnit: habit.cost_unit,
    dailyTime: habit.daily_time,
    unitsPerDay: habit.units_per_day,
    triggerTimes: parseTriggerTimes(habit.trigger_times),
    reason: habit.reason,
    relapsePlan: habit.relapse_plan,
    shieldTokens: habit.shield_tokens || 0,
    createdAt: habit.created_at,
    stats,
    wall: wallInfo(stats),
    badges: getBadges(habit.id),
  };
}

// ---------- Legal (Terms & Privacy) ----------

const TERMS_TEXT = `BreakFree Terms of Service

1. Eligibility
You must be 18 or older to create an account and use BreakFree.

2. Not medical advice
BreakFree is a self-help tool. It is not a substitute for professional medical, psychological, or addiction treatment. If you are in crisis, contact a healthcare provider or emergency services.

3. Your account
You are responsible for keeping your login details secure. You may delete your account at any time from Settings.

4. User content
You retain ownership of the data you create (check-ins, journals, etc.). BreakFree does not claim any rights over your content.

5. Acceptable use
Do not use the service to harm yourself or others, or to share harmful or illegal content. Community posts are moderated.

6. Limitation of liability
BreakFree is provided "as is" without warranties. We are not liable for any loss or damage arising from use of the service.

7. Changes
We may update these terms occasionally. Continued use after changes constitutes acceptance.

8. Contact
support@breakfree.app`;

const PRIVACY_TEXT = `BreakFree Privacy Policy

What we collect
- Account: email address, password hash (bcrypt), account creation date.
- Habit data: habit names, start dates, check-in status (clean/slip), daily wellness ratings (energy, sleep, mood), urges, journal entries, health samples (steps, sleep hours, resting heart rate).
- Community: posts, comments, reactions (if you choose to participate).
- Technical: error logs, push subscription tokens (stored locally on your device), basic usage metrics.

How we store it
All data is stored in a local SQLite (D1) database on our server. Daily encrypted backups are retained for 14 days for disaster recovery. We do not use third-party cloud storage.

What we don't do
- We do not sell your data.
- We do not share your data with advertisers or analytics companies.
- We do not use third-party AI APIs. The AI coach runs partly on your device and partly on our server; your data stays within BreakFree.

Your controls
- Export: download everything in Settings (JSON export).
- Delete: permanently delete your account and all data in Settings.
- Privacy settings: control notification preferences in Settings.

Children
BreakFree is not intended for users under 18. We do not knowingly collect data from minors.

Contact
support@breakfree.app`;

app.get('/legal/terms', (req, res) => {
  res.json({ text: TERMS_TEXT });
});

app.get('/legal/privacy', (req, res) => {
  res.json({ text: PRIVACY_TEXT });
});

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

// ---------- Habits ----------

app.get('/api/habits', requireAuth, (req, res) => {
  const habits = db
    .prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at, id')
    .all(req.user.id);
  res.json({ habits: habits.map(habitPayload) });
});

app.post('/api/habits', requireAuth, (req, res) => {
  const { name, startDate, dailyCost, costUnit, dailyTime, unitsPerDay, triggerTimes, reason, relapsePlan } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Habit name is required.' });
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ error: 'A valid start date is required.' });
  }

  const info = db
    .prepare(
      'INSERT INTO habits (user_id, name, start_date, daily_cost, cost_unit, daily_time, units_per_day, trigger_times, reason, relapse_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      req.user.id,
      String(name).trim(),
      startDate,
      dailyCost && dailyCost > 0 ? dailyCost : null,
      costUnit || 'day',
      dailyTime && dailyTime > 0 ? dailyTime : null,
      unitsPerDay && unitsPerDay > 0 ? unitsPerDay : null,
      Array.isArray(triggerTimes) && triggerTimes.length > 0 ? JSON.stringify(triggerTimes) : null,
      reason && String(reason).trim() ? String(reason).trim() : null,
      relapsePlan && String(relapsePlan).trim() ? String(relapsePlan).trim() : null
    );
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ habit: habitPayload(habit) });
});

app.patch('/api/habits/:id', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { name, dailyCost, costUnit, dailyTime, unitsPerDay, triggerTimes, reason, relapsePlan } = req.body || {};
  db.prepare(
    'UPDATE habits SET name = ?, daily_cost = ?, cost_unit = ?, daily_time = ?, units_per_day = ?, trigger_times = ?, reason = ?, relapse_plan = ? WHERE id = ?'
  ).run(
    name != null ? String(name).trim() : habit.name,
    dailyCost != null && dailyCost > 0 ? dailyCost : habit.daily_cost,
    costUnit != null ? costUnit : habit.cost_unit,
    dailyTime != null && dailyTime > 0 ? dailyTime : habit.daily_time,
    unitsPerDay != null && unitsPerDay > 0 ? unitsPerDay : habit.units_per_day,
    Array.isArray(triggerTimes) && triggerTimes.length > 0
      ? JSON.stringify(triggerTimes)
      : Array.isArray(triggerTimes)
        ? null
        : habit.trigger_times,
    reason != null ? (String(reason).trim() || null) : habit.reason,
    relapsePlan != null ? (String(relapsePlan).trim() || null) : habit.relapse_plan,
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
    .prepare('SELECT date, status, note, forgiven FROM checkins WHERE habit_id = ? ORDER BY date DESC')
    .all(habit.id);
  const urges = db
    .prepare('SELECT id, logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC')
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
     ON CONFLICT (habit_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, forgiven = 0`
  ).run(habit.id, key, status, note ? String(note).trim() : null);

  let newBadge = null;
  let newShields = 0;
  if (status === 'clean') {
    const stats = getStatsForHabit(habit);
    const earned = awardBadges(habit.id, stats.currentStreak);
    if (earned.length > 0) newBadge = earned[earned.length - 1];
    const blocks = Math.floor(stats.totalClean / 7);
    const prevBlocks = Math.floor((stats.totalClean - 1) / 7);
    if (blocks > prevBlocks) {
      newShields = blocks - prevBlocks;
      db.prepare('UPDATE habits SET shield_tokens = shield_tokens + ? WHERE id = ?').run(newShields, habit.id);
    }
  }
  const updated = db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id);
  res.json({ habit: habitPayload(updated), newBadge, newShields });
  if (newBadge) notifyMilestone(req.user.id, habit.id, newBadge.threshold).catch(() => {});
});

// Mark a slip as forgiven (keeps the streak alive) or undo that.
app.post('/api/habits/:id/forgive', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { date, forgiven } = req.body || {};
  const key = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
  const row = db.prepare('SELECT id, status FROM checkins WHERE habit_id = ? AND date = ?').get(habit.id, key);
  if (!row) return res.status(404).json({ error: 'No check-in exists for that date.' });
  if (row.status !== 'slip') return res.status(400).json({ error: 'Only slips can be forgiven.' });
  db.prepare('UPDATE checkins SET forgiven = ? WHERE id = ?').run(forgiven ? 1 : 0, row.id);
  const updated = db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id);
  res.json({ habit: habitPayload(updated) });
});

app.post('/api/habits/:id/shield', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  if ((habit.shield_tokens || 0) < 1) {
    return res.status(400).json({ error: 'No shield tokens available. Keep going to earn more!' });
  }
  const key = todayKey();
  const existing = db.prepare('SELECT id, status FROM checkins WHERE habit_id = ? AND date = ?').get(habit.id, key);
  if (existing && existing.status === 'slip') {
    db.prepare('UPDATE checkins SET status = ?, forgiven = 1 WHERE id = ?').run('clean', existing.id);
  } else {
    db.prepare(
      `INSERT INTO checkins (habit_id, date, status, note, forgiven) VALUES (?, ?, 'clean', NULL, 1)
       ON CONFLICT (habit_id, date) DO UPDATE SET status = 'clean', forgiven = 1`
    ).run(habit.id, key);
  }
  db.prepare('UPDATE habits SET shield_tokens = shield_tokens - 1 WHERE id = ?').run(habit.id);
  const updated = db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id);
  const stats = getStatsForHabit(updated);
  const earned = awardBadges(habit.id, stats.currentStreak);
  let newBadge = null;
  if (earned.length > 0) newBadge = earned[earned.length - 1];
  res.json({ habit: habitPayload(updated), newBadge });
  if (newBadge) notifyMilestone(req.user.id, habit.id, newBadge.threshold).catch(() => {});
});

// ---------- Urges ----------

app.get('/api/habits/:id/urges', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const urges = db
    .prepare('SELECT id, logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC')
    .all(habit.id);
  res.json({ urges });
});

app.post('/api/habits/:id/urges', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.params.id), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const { intensity, trigger, triggerType, action, resisted, loggedAt } = req.body || {};
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
    return res.status(400).json({ error: 'Intensity must be between 1 and 5.' });
  }
  const info = db
    .prepare(
      'INSERT INTO urges (habit_id, logged_at, intensity, trigger, trigger_type, action, resisted) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      habit.id,
      loggedAt || new Date().toISOString(),
      intensity,
      trigger ? String(trigger).trim() : null,
      triggerType ? String(triggerType).trim() : null,
      action ? String(action).trim() : null,
      resisted ? 1 : 0
    );
  const urge = db.prepare('SELECT id, logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE id = ?').get(info.lastInsertRowid);
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

app.get('/api/days-out', requireAuth, async (req, res) => {
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

app.get('/api/days-out/ideas', requireAuth, (req, res) => {
  res.json({ ideas: GENERIC_IDEAS });
});

// ---------- AI routes ----------

registerAiRoutes(app, { requireAuth, habitForUser: getHabitForUser });

// ---------- Community ----------

registerCommunityRoutes(app, { requireAuth, requireAdmin, habitForUser: getHabitForUser });

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
  if (req.body?.reminderTime === null || req.body?.reminderTime === '') {
    prefs.reminderTime = null;
  } else if (typeof req.body?.reminderTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.reminderTime)) {
    prefs.reminderTime = req.body.reminderTime;
  } else if (req.body?.reminderTime != null) {
    return res.status(400).json({ error: 'Reminder time must be in 24-hour HH:MM format.' });
  }
  db.prepare('UPDATE users SET notification_prefs = ? WHERE id = ?').run(JSON.stringify(prefs), req.user.id);
  res.json({ prefs });
});

app.post('/api/push/schedule-trigger', requireAuth, (req, res) => {
  const { habitId, bucketLabel, bucketStartHour } = req.body || {};
  if (!habitId || !bucketLabel || bucketStartHour == null) {
    return res.status(400).json({ error: 'habitId, bucketLabel and bucketStartHour are required.' });
  }
  const habit = getHabitForUser(Number(habitId), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  if (!userPrefs(req.user.id).triggerNudges) {
    return res.json({ ok: true, skipped: 'disabled' });
  }
  const user = db.prepare('SELECT id, timezone FROM users WHERE id = ?').get(req.user.id);
  scheduleTriggerNudge(req.user.id, Number(habitId), String(bucketLabel), Number(bucketStartHour), user.timezone).catch(() => {});
  res.json({ ok: true });
});

// ---------- Health tracking (manual entry) ----------

function healthSample(row) {
  return row
    ? { date: row.date, steps: row.steps, sleepHours: row.sleep_hours, restingHr: row.resting_hr, notes: row.notes }
    : null;
}

app.get('/api/health', requireAuth, (req, res) => {
  const habitId = Number(req.query.habitId);
  const days = Math.min(Number(req.query.days) || 30, 90);
  if (!habitId) return res.status(400).json({ error: 'habitId is required.' });
  const habit = getHabitForUser(habitId, req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const since = addDays(todayKey(), -(days - 1));
  const samples = db
    .prepare('SELECT date, steps, sleep_hours, resting_hr, notes FROM health_samples WHERE habit_id = ? AND date >= ? ORDER BY date ASC')
    .all(habitId, since);
  res.json({ samples: samples.map(healthSample) });
});

app.post('/api/health', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.body?.habitId), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const key = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date) ? req.body.date : todayKey();
  const steps = req.body?.steps == null || req.body.steps === '' ? null : Number(req.body.steps);
  const sleepH = req.body?.sleepHours == null || req.body.sleepHours === '' ? null : Number(req.body.sleepHours);
  const hr = req.body?.restingHr == null || req.body.restingHr === '' ? null : Number(req.body.restingHr);
  if (steps != null && (!Number.isFinite(steps) || steps < 0 || steps > 200000)) return res.status(400).json({ error: 'Steps must be between 0 and 200,000.' });
  if (sleepH != null && (!Number.isFinite(sleepH) || sleepH < 0 || sleepH > 24)) return res.status(400).json({ error: 'Sleep hours must be between 0 and 24.' });
  if (hr != null && (!Number.isInteger(hr) || hr < 30 || hr > 220)) return res.status(400).json({ error: 'Resting heart rate must be a whole number between 30 and 220.' });
  db.prepare(
    `INSERT INTO health_samples (habit_id, date, steps, sleep_hours, resting_hr, notes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       steps = excluded.steps, sleep_hours = excluded.sleep_hours, resting_hr = excluded.resting_hr, notes = excluded.notes,
       updated_at = datetime('now')`
  ).run(habit.id, key, steps, sleepH, hr, req.body?.notes ? String(req.body.notes).trim() : null);
  const row = db.prepare('SELECT date, steps, sleep_hours, resting_hr, notes FROM health_samples WHERE habit_id = ? AND date = ?').get(habit.id, key);
  res.json({ sample: healthSample(row) });
});

// ---------- Milestone sharing (landing-page social proof counter) ----------

app.post('/api/shares', requireAuth, (req, res) => {
  const habit = getHabitForUser(Number(req.body?.habitId), req.user.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  const d = Math.min(Math.max(Number(req.body?.days) || 0, 0), 3650);
  db.prepare('INSERT INTO milestone_shares (user_id, habit_id, days) VALUES (?, ?, ?)').run(req.user.id, habit.id, d);
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM milestone_shares').get().n);
  res.json({ ok: true, total });
});

app.get('/api/shares/total', (req, res) => {
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM milestone_shares').get().n);
  res.json({ total });
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
    .prepare('SELECT date, status, note, forgiven FROM checkins WHERE habit_id = ? ORDER BY date ASC')
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
    res.write(`${csvRow(c.date, 'checkin', c.status, `${c.note || ''}${c.forgiven ? ' (forgiven)' : ''}`)}\r\n`);
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

// ---------- Full account export (GDPR) ----------

app.get('/api/me/export', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, role, username, timezone, buddy_opt_in FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const subscription = db.prepare('SELECT plan, status, started_at, renews_at FROM subscriptions WHERE user_id = ?').get(req.user.id) || null;
  const habitsRows = db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY id').all(req.user.id);
  const habits = habitsRows.map((h) => ({
    name: h.name,
    startDate: h.start_date,
    dailyCost: h.daily_cost,
    costUnit: h.cost_unit,
    dailyTime: h.daily_time,
    unitsPerDay: h.units_per_day,
    triggerTimes: parseTriggerTimes(h.trigger_times),
    reason: h.reason,
    relapsePlan: h.relapse_plan,
    checkins: db.prepare('SELECT date, status, note, forgiven FROM checkins WHERE habit_id = ? ORDER BY date').all(h.id),
    urges: db.prepare('SELECT logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at').all(h.id),
    journals: db.prepare('SELECT date, content FROM journals WHERE habit_id = ? ORDER BY date').all(h.id),
    dailyCheckins: db.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date').all(h.id),
    badges: db.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').all(h.id),
  }));
  const posts = db.prepare('SELECT id, content, habit_name, streak, badge, created_at FROM community_posts WHERE user_id = ? ORDER BY id').all(req.user.id);
  const comments = db.prepare('SELECT id, post_id, content, created_at FROM community_comments WHERE user_id = ? ORDER BY id').all(req.user.id);
  const reactions = db.prepare('SELECT post_id, emoji, created_at FROM community_reactions WHERE user_id = ? ORDER BY post_id').all(req.user.id);
  const follows = db.prepare('SELECT following_id, created_at FROM community_follows WHERE follower_id = ? ORDER BY following_id').all(req.user.id);
  const pushSubs = db.prepare('SELECT endpoint, last_seen FROM push_subscriptions WHERE user_id = ? ORDER BY id').all(req.user.id);
  res.json({
    exportedAt: new Date().toISOString(),
    profile: user,
    subscription,
    habits,
    community: { posts, comments, reactions, follows },
    pushSubscriptions: pushSubs,
  });
});

// ---------- Account deletion (GDPR) ----------

app.delete('/api/me', requireAuth, (req, res) => {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
  if (!exists) return res.status(404).json({ error: 'User not found.' });
  const journalIds = db
    .prepare('SELECT j.id FROM journals j JOIN habits h ON h.id = j.habit_id WHERE h.user_id = ?')
    .all(req.user.id);
  for (const j of journalIds) {
    db.prepare('DELETE FROM journals_fts WHERE rowid = ?').run(j.id);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
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

// Re-engagement cascade + weekly digest sweep (parity with the worker cron).
setInterval(() => {
  void evaluateAllEngagement().catch((e) => console.error('engagement sweep failed:', e.message));
}, 30 * 60 * 1000).unref();

setInterval(() => {
  void sweepTriggerNudges().catch((e) => console.error('trigger nudge sweep failed:', e.message));
}, 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`BreakFree server running on http://localhost:${PORT}`);
});
