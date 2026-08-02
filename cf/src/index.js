// BreakFree on Cloudflare Workers — single Hono app + D1.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { computeStats, BADGE_THRESHOLDS, todayKey, dateKey } from './stats.js';
import { hashPassword, verifyPassword, signToken, verifyToken, randomHex } from './auth.js';
import { registerAiRoutes } from './ai.js';
import { buildReport, buildRecoveryPlan } from './premium.js';
import { sendPush, loadOrCreateVapid } from './push.js';
import { createCheckout, retrieveSession, cancelStripeSubscription, verifyWebhookSignature } from './stripe.js';
import { findNearby, geocodeArea, GENERIC_IDEAS } from './daysout.js';

const PRICE_CENTS = 499;
const FREE_HABIT_LIMIT = 1;
const BILLING_DAYS = 30;

const app = new Hono();
app.use('/api/*', cors());

function userOf(c) {
  return c.get('user') || null;
}

// ---------- auth middleware ----------
app.use('/api/*', async (c, next) => {
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const user = await verifyToken(token, c.env.JWT_SECRET);
    if (user) c.set('user', user);
  }
  await next();
});

async function isPremium(env, userId) {
  const row = await env.DB.prepare('SELECT plan, status FROM subscriptions WHERE user_id = ?').bind(userId).first();
  return !!row && row.plan === 'premium' && row.status === 'active';
}

async function habitOf(env, habitId, userId) {
  return env.DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(habitId), userId).first();
}

async function habitPayload(env, habit) {
  const checkins = (await env.DB.prepare('SELECT date, status FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results;
  const stats = computeStats(checkins, habit.daily_cost, habit.daily_time);
  const badges = (await env.DB.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').bind(habit.id).all()).results;
  return {
    id: habit.id,
    name: habit.name,
    startDate: habit.start_date,
    dailyCost: habit.daily_cost,
    costUnit: habit.cost_unit,
    dailyTime: habit.daily_time,
    stats,
    badges,
  };
}

async function awardBadges(db, habitId, streak) {
  const earned = [];
  const today = todayKey();
  for (const t of BADGE_THRESHOLDS) {
    if (streak < t) continue;
    const res = await db.prepare(
      'INSERT INTO badges (habit_id, threshold, earned_date) VALUES (?, ?, ?) ON CONFLICT(habit_id, threshold) DO NOTHING'
    ).bind(habitId, t, today).run();
    if (res.meta?.changes && res.meta.changes > 0) earned.push({ threshold: t, earnedDate: today });
  }
  return earned;
}

// Fire-and-forget nudge, gated on the user's notification preferences.
async function maybeNotify(ctx, userId, habitId, prefKey, payload) {
  try {
    const prefs = { dailyReminder: true, urgeTips: true, milestones: true };
    const user = await ctx.env.DB.prepare('SELECT notification_prefs FROM users WHERE id = ?').bind(userId).first();
    if (user?.notification_prefs) Object.assign(prefs, JSON.parse(user.notification_prefs));
    if (!prefs[prefKey]) return;
    const subs = (await ctx.env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(userId).all()).results;
    const stale = [];
    for (const s of subs) {
      try {
        await sendPush(ctx.env, s, payload);
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.endpoint);
      }
    }
    for (const endpoint of stale) {
      await ctx.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
    }
  } catch (e) {
    console.error('maybeNotify failed:', e.message);
  }
}

function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role };
}

function dateFromStr(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
}

// ---------- health ----------
app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

// ---------- auth ----------
app.post('/api/auth/signup', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Please enter a valid email address.' }, 400);
  if (!password || password.length < 6) return c.json({ error: 'Password must be at least 6 characters.' }, 400);
  const em = String(email).toLowerCase();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(em).first();
  if (existing) return c.json({ error: 'An account with that email already exists.' }, 409);
  const hash = await hashPassword(password);
  const info = await c.env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(em, hash).run();
  const user = { id: Number(info.meta.last_row_id), email: em, role: 'user' };
  const token = await signToken(user, c.env.JWT_SECRET);
  return c.json({ token, user: publicUser(user) }, 201);
});

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !password) return c.json({ error: 'Email and password are required.' }, 400);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(String(email).toLowerCase()).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) return c.json({ error: 'Incorrect email or password.' }, 401);
  const token = await signToken(user, c.env.JWT_SECRET);
  return c.json({ token, user: publicUser(user) });
});

app.get('/api/auth/me', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
  if (!user) return c.json({ error: 'User not found.' }, 404);
  return c.json({ user: publicUser(user) });
});

// ---------- subscription (Stripe checkout, with simulated fallback) ----------
async function activateSubscription(env, userId, stripe) {
  const customerId = stripe?.customer || null;
  const subId = stripe?.subscription || null;
  await env.DB.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, renews_at, stripe_customer_id, stripe_subscription_id)
     VALUES (?, 'premium', 'active', datetime('now'), datetime('now', ?), ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET plan = 'premium', status = 'active', started_at = datetime('now'), renews_at = datetime('now', ?), stripe_customer_id = coalesce(?, stripe_customer_id), stripe_subscription_id = coalesce(?, stripe_subscription_id)`
  ).bind(userId, `+${BILLING_DAYS} days`, customerId, subId, `+${BILLING_DAYS} days`, customerId, subId).run();
}

function stripeConfigured(env) {
  return Boolean(env.STRIPE_SECRET_KEY);
}

app.get('/api/subscription', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const row = await c.env.DB.prepare('SELECT plan, status, started_at, renews_at FROM subscriptions WHERE user_id = ?').bind(u.id).first();
  const active = !!row && row.plan === 'premium' && row.status === 'active';
  return c.json({
    subscription: {
      plan: row?.plan || 'free',
      status: row?.status || 'free',
      active,
      habitLimit: active ? Infinity : FREE_HABIT_LIMIT,
      startedAt: row?.started_at || null,
      renewsAt: row?.renews_at || null,
    },
    price: PRICE_CENTS,
  });
});

app.post('/api/subscription/checkout', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (await isPremium(c.env, u.id)) return c.json({ alreadyPremium: true, sessionId: null, priceCents: PRICE_CENTS });
  if (stripeConfigured(c.env)) {
    try {
      const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(u.id).first();
      const origin = new URL(c.req.url).origin;
      const session = await createCheckout(c.env, { userId: u.id, email: user?.email, origin });
      return c.json({ session: { ...session, mode: 'stripe' } });
    } catch (e) {
      return c.json({ error: String(e.message || 'Stripe checkout unavailable.') }, 502);
    }
  }
  // Simulated fallback (no STRIPE_SECRET_KEY configured).
  const sessionId = randomHex(16);
  await c.env.DB.prepare('INSERT INTO checkout_sessions (id, user_id, price_cents, status) VALUES (?, ?, ?, ?)').bind(sessionId, u.id, PRICE_CENTS, 'pending').run();
  return c.json({ session: { id: sessionId, priceCents: PRICE_CENTS, currency: 'usd', mode: 'demo' } });
});

app.post('/api/subscription/complete', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { sessionId } = await c.req.json().catch(() => ({}));
  if (!sessionId || !String(sessionId).trim()) return c.json({ error: 'Missing session ID.' }, 400);

  if (stripeConfigured(c.env)) {
    // Verify the payment actually completed on Stripe before granting Premium.
    try {
      const s = await retrieveSession(c.env, String(sessionId));
      if (s.payment_status !== 'paid') return c.json({ error: 'Payment has not completed yet.' }, 400);
      if (s.client_reference_id !== String(u.id)) return c.json({ error: 'Session does not match this account.' }, 403);
      await activateSubscription(c.env, u.id, s);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e.message || 'Could not verify the payment.') }, 502);
    }
  }

  const session = await c.env.DB.prepare('SELECT * FROM checkout_sessions WHERE id = ? AND user_id = ?').bind(String(sessionId), u.id).first();
  if (!session) return c.json({ error: 'Checkout session not found.' }, 400);
  if (session.status !== 'pending') return c.json({ error: 'Checkout session is not pending.' }, 400);
  await c.env.DB.prepare("UPDATE checkout_sessions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").bind(session.id).run();
  await activateSubscription(c.env, u.id, null);
  return c.json({ ok: true });
});

app.post('/api/subscription/cancel', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (stripeConfigured(c.env)) {
    const row = await c.env.DB.prepare('SELECT stripe_subscription_id FROM subscriptions WHERE user_id = ? AND plan = ? AND status = ?').bind(u.id, 'premium', 'active').first();
    if (row?.stripe_subscription_id) await cancelStripeSubscription(c.env, row.stripe_subscription_id);
  }
  await c.env.DB.prepare("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND plan = 'premium'").bind(u.id).run();
  return c.json({ ok: true });
});

// Stripe webhook: activate on checkout completion, downgrade on cancel.
app.post('/api/stripe/webhook', async (c) => {
  const rawBody = await c.req.text();
  const sig = c.req.header('stripe-signature');
  const okSig = await verifyWebhookSignature(c.env, rawBody, sig);
  if (!okSig) return c.json({ error: 'Invalid signature.' }, 400);
  const event = JSON.parse(rawBody);
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = Number(s.client_reference_id);
      if (userId && s.payment_status === 'paid') {
        await activateSubscription(c.env, userId, { customer: s.customer, subscription: s.subscription });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      if (sub?.metadata?.user_id) {
        const uid = Number(sub.metadata.user_id);
        await c.env.DB.prepare("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ?").bind(uid).run();
      } else {
        await c.env.DB.prepare('UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?').bind('cancelled', sub.id).run();
      }
    }
  } catch (e) {
    console.error('webhook handler failed:', e.message);
  }
  return c.json({ received: true });
});

// ---------- habits ----------
app.get('/api/habits', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habits = (await c.env.DB.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY id').bind(u.id).all()).results;
  const out = [];
  for (const h of habits) out.push(await habitPayload(c.env, h));
  return c.json({ habits: out });
});

app.post('/api/habits', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { name, startDate, dailyCost, costUnit, dailyTime } = await c.req.json().catch(() => ({}));
  if (!name || !String(name).trim()) return c.json({ error: 'Habit name is required.' }, 400);
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return c.json({ error: 'A valid start date is required.' }, 400);
  if (!(await isPremium(c.env, u.id))) {
    const existing = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM habits WHERE user_id = ?').bind(u.id).first();
    if ((existing?.n || 0) >= FREE_HABIT_LIMIT) return c.json({ error: `The free plan includes ${FREE_HABIT_LIMIT} habit. Upgrade to add more.`, code: 'PLAN_LIMIT' }, 402);
  }
  const info = await c.env.DB.prepare(
    'INSERT INTO habits (user_id, name, start_date, daily_cost, cost_unit, daily_time) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(u.id, String(name).trim(), startDate, dailyCost && dailyCost > 0 ? dailyCost : null, costUnit || 'day', dailyTime && dailyTime > 0 ? dailyTime : null).run();
  const habit = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(Number(info.meta.last_row_id)).first();
  return c.json({ habit: await habitPayload(c.env, habit) }, 201);
});

app.get('/api/habits/:id', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const checkins = (await c.env.DB.prepare('SELECT date, status, note FROM checkins WHERE habit_id = ? ORDER BY date DESC').bind(habit.id).all()).results;
  const urges = (await c.env.DB.prepare('SELECT id, logged_at, intensity, trigger, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC').bind(habit.id).all()).results;
  const journals = (await c.env.DB.prepare('SELECT id, date, content FROM journals WHERE habit_id = ? ORDER BY date DESC, id DESC').bind(habit.id).all()).results;
  const dailyCheckin = (await c.env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?').bind(habit.id, todayKey()).all()).results[0] || null;
  const dailyCheckins = (await c.env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date DESC LIMIT 14').bind(habit.id).all()).results.reverse();
  const badges = (await c.env.DB.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').bind(habit.id).all()).results;
  return c.json({ habit: await habitPayload(c.env, habit), checkins, urges, journals, badges, dailyCheckin, dailyCheckins });
});

app.patch('/api/habits/:id', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('UPDATE habits SET name = ?, daily_cost = ?, cost_unit = ?, daily_time = ? WHERE id = ?').bind(
    body.name != null ? String(body.name).trim() : habit.name,
    body.dailyCost != null && body.dailyCost > 0 ? body.dailyCost : habit.daily_cost,
    body.costUnit != null ? body.costUnit : habit.cost_unit,
    body.dailyTime != null && body.dailyTime > 0 ? body.dailyTime : habit.daily_time,
    habit.id
  ).run();
  const updated = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(habit.id).first();
  return c.json({ habit: await habitPayload(c.env, updated) });
});

app.delete('/api/habits/:id', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  await c.env.DB.prepare('DELETE FROM habits WHERE id = ?').bind(habit.id).run();
  return c.json({ ok: true });
});

// ---------- daily wellness check-in ----------
app.get('/api/habits/:id/daily-checkin', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const q = new URL(c.req.url).searchParams;
  const date = dateFromStr(q.get('date') || '');
  const row = (await c.env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?').bind(habit.id, date).all()).results[0] || null;
  return c.json({ checkin: row });
});

app.post('/api/habits/:id/daily-checkin', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const { date, energy, sleep, mood } = await c.req.json().catch(() => ({}));
  const e = Number(energy), s = Number(sleep), m = Number(mood);
  for (const [label, v] of [['energy', e], ['sleep', s], ['mood', m]]) {
    if (!Number.isInteger(v) || v < 1 || v > 5) return c.json({ error: `${label} must be a whole number between 1 and 5.` }, 400);
  }
  const key = dateFromStr(date);
  await c.env.DB.prepare(
    `INSERT INTO daily_checkins (habit_id, date, energy, sleep, mood) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET energy = excluded.energy, sleep = excluded.sleep, mood = excluded.mood`
  ).bind(habit.id, key, e, s, m).run();
  if (s < 3) void maybeNotify(c, u.id, habit.id, 'dailyReminder', { title: 'BreakFree', body: `Rough sleep (${s}/5)? Take it easy today — your resistance might be lower.`, habitId: habit.id });
  const row = (await c.env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? AND date = ?').bind(habit.id, key).all()).results[0];
  return c.json({ checkin: row });
});

// ---------- check-ins ----------
app.post('/api/habits/:id/checkin', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const { status, note, date } = await c.req.json().catch(() => ({}));
  if (status !== 'clean' && status !== 'slip') return c.json({ error: 'Status must be "clean" or "slip".' }, 400);
  const key = dateFromStr(date);
  await c.env.DB.prepare(
    `INSERT INTO checkins (habit_id, date, status, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET status = excluded.status, note = excluded.note`
  ).bind(habit.id, key, status, note ? String(note).trim() : null).run();
  let newBadge = null;
  if (status === 'clean') {
    const checkins = (await c.env.DB.prepare('SELECT date, status FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results;
    const stats = computeStats(checkins, habit.daily_cost, habit.daily_time);
    const earned = await awardBadges(c.env, habit.id, stats.currentStreak);
    if (earned.length > 0) newBadge = earned[earned.length - 1];
  }
  if (newBadge) void maybeNotify(c, u.id, habit.id, 'milestones', { title: 'BreakFree', body: `${newBadge.threshold} days clean — milestone reached. Look how far you've come. 🎉`, habitId: habit.id });
  const updated = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(habit.id).first();
  return c.json({ habit: await habitPayload(c.env, updated), newBadge });
});

// ---------- urges ----------
app.get('/api/habits/:id/urges', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const urges = (await c.env.DB.prepare('SELECT id, logged_at, intensity, trigger, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC').bind(habit.id).all()).results;
  return c.json({ urges });
});

app.post('/api/habits/:id/urges', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const { intensity, trigger, resisted, loggedAt } = await c.req.json().catch(() => ({}));
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) return c.json({ error: 'Intensity must be between 1 and 5.' }, 400);
  const info = await c.env.DB.prepare('INSERT INTO urges (habit_id, logged_at, intensity, trigger, resisted) VALUES (?, ?, ?, ?, ?)').bind(
    habit.id, loggedAt || new Date().toISOString(), intensity, trigger ? String(trigger).trim() : null, resisted ? 1 : 0
  ).run();
  const urge = await c.env.DB.prepare('SELECT id, logged_at, intensity, trigger, resisted FROM urges WHERE id = ?').bind(Number(info.meta.last_row_id)).first();
  void maybeNotify(c, u.id, habit.id, 'urgeTips', { title: 'BreakFree', body: `Urge logged. Pause 10 minutes and change your scene — it usually fades.`, habitId: habit.id });
  return c.json({ urge }, 201);
});

// ---------- journal ----------
app.get('/api/habits/:id/journals', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const journals = (await c.env.DB.prepare('SELECT id, date, content FROM journals WHERE habit_id = ? ORDER BY date DESC, id DESC').bind(habit.id).all()).results;
  return c.json({ journals });
});

app.post('/api/habits/:id/journals', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const { content, date } = await c.req.json().catch(() => ({}));
  if (!content || !String(content).trim()) return c.json({ error: 'Journal entry cannot be empty.' }, 400);
  const key = dateFromStr(date);
  const info = await c.env.DB.prepare('INSERT INTO journals (habit_id, date, content) VALUES (?, ?, ?)').bind(habit.id, key, String(content).trim()).run();
  const entry = await c.env.DB.prepare('SELECT id, date, content FROM journals WHERE id = ?').bind(Number(info.meta.last_row_id)).first();
  try {
    await c.env.DB.prepare('DELETE FROM journals_fts WHERE rowid = ?').bind(entry.id).run();
    await c.env.DB.prepare('INSERT INTO journals_fts (rowid, content) VALUES (?, ?)').bind(entry.id, entry.content).run();
  } catch (e) {
    console.error('FTS failed:', e.message);
  }
  return c.json({ entry }, 201);
});

// ---------- days out (premium) ----------
app.get('/api/days-out*', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (!(await isPremium(c.env, u.id))) return c.json({ error: 'This is a Premium feature.', code: 'PREMIUM_REQUIRED' }, 402);
  if (c.req.path.endsWith('/ideas')) return c.json({ ideas: GENERIC_IDEAS });
  const q = new URL(c.req.url).searchParams;
  const lat = q.get('lat');
  const lon = q.get('lon');
  const area = q.get('area');
  const radius = Number(q.get('radius')) || 10000;
  try {
    if (lat && lon) return c.json(await findNearby(lat, lon, radius));
    if (area && String(area).trim()) {
      const geo = await geocodeArea(String(area).trim());
      const result = await findNearby(geo.lat, geo.lon, radius, geo.displayName);
      return c.json({ ...result, area: geo.displayName });
    }
    return c.json({ error: 'Provide lat/lon or an area.' }, 400);
  } catch (e) {
    return c.json({ error: String(e.message), ideas: GENERIC_IDEAS }, 502);
  }
});

// ---------- settings ----------
async function prefsFor(c, userId) {
  const user = await c.env.DB.prepare('SELECT notification_prefs FROM users WHERE id = ?').bind(userId).first();
  const base = { dailyReminder: true, urgeTips: true, milestones: true };
  if (user?.notification_prefs) {
    try {
      Object.assign(base, JSON.parse(user.notification_prefs));
    } catch { /* keep defaults */ }
  }
  return base;
}

app.get('/api/settings/notifications', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  return c.json({ prefs: await prefsFor(c, u.id) });
});

app.put('/api/settings/notifications', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const prefs = await prefsFor(c, u.id);
  for (const key of ['dailyReminder', 'urgeTips', 'milestones']) {
    if (typeof body[key] === 'boolean') prefs[key] = body[key];
  }
  await c.env.DB.prepare('UPDATE users SET notification_prefs = ? WHERE id = ?').bind(JSON.stringify(prefs), u.id).run();
  return c.json({ prefs });
});

// ---------- push ----------
app.get('/api/push/vapid', async (c) => {
  try {
    const vapid = await loadOrCreateVapid(c.env);
    return c.json({ publicKey: vapid.publicKey });
  } catch (e) {
    return c.json({ error: String(e.message) }, 500);
  }
});

app.post('/api/push/subscribe', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { endpoint, keys } = await c.req.json().catch(() => ({}));
  if (!endpoint || !keys?.p256dh || !keys?.auth) return c.json({ error: 'endpoint and keys are required.' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, last_seen) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, last_seen = datetime('now')`
  ).bind(u.id, String(endpoint), String(keys.p256dh), String(keys.auth)).run();
  return c.json({ ok: true });
});

app.delete('/api/push/subscribe', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { endpoint } = await c.req.json().catch(() => ({}));
  if (endpoint) await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(String(endpoint)).run();
  return c.json({ ok: true });
});

app.post('/api/push/test', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const subs = (await c.env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(u.id).all()).results;
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await sendPush(c.env, s, { title: 'BreakFree', body: 'Test notification — low-sleep alerts are armed.', habitId: null });
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return c.json({ ok: true, sent, failed, total: subs.length });
});

// ---------- client error log ----------
app.post('/api/errors', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { message, stack, url } = await c.req.json().catch(() => ({}));
  const msg = String(message || '').trim();
  if (!msg) return c.json({ error: 'message is required.' }, 400);
  // 1-minute dedupe to stop error loops flooding the table.
  const dup = await c.env.DB.prepare("SELECT id FROM app_errors WHERE message = ? AND created_at >= datetime('now', '-1 minute')").bind(msg).first();
  if (!dup) await c.env.DB.prepare('INSERT INTO app_errors (message, stack, url) VALUES (?, ?, ?)').bind(msg.slice(0, 500), String(stack || '').slice(0, 2000), String(url || '').slice(0, 500)).run();
  return c.json({ ok: true });
});

// ---------- data export (CSV) ----------
function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/habits/:id/export', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const checkins = (await c.env.DB.prepare('SELECT date, status, note FROM checkins WHERE habit_id = ? ORDER BY date ASC').bind(habit.id).all()).results;
  const daily = (await c.env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date ASC').bind(habit.id).all()).results;
  const urges = (await c.env.DB.prepare('SELECT logged_at, intensity, trigger, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at ASC').bind(habit.id).all()).results;
  const journals = (await c.env.DB.prepare('SELECT date, content FROM journals WHERE habit_id = ? ORDER BY date ASC').bind(habit.id).all()).results;

  const rows = [
    `BreakFree export — ${habit.name} (started ${habit.start_date})`,
    `Generated ${new Date().toISOString()}`,
    '',
    'date,type,value,details',
  ];
  for (const c2 of checkins) rows.push([c2.date, 'checkin', c2.status, c2.note].map(csvField).join(','));
  for (const d of daily) rows.push([d.date, 'wellness', `energy ${d.energy}/5 · sleep ${d.sleep}/5 · mood ${d.mood}/5`, ''].map(csvField).join(','));
  for (const u2 of urges) rows.push([String(u2.logged_at).slice(0, 10), 'urge', `intensity ${u2.intensity}/5`, `${u2.trigger || ''}${u2.resisted ? '' : ' (not resisted)'}`].map(csvField).join(','));
  for (const j of journals) rows.push([j.date, 'journal', '', j.content].map(csvField).join(','));

  return c.text(rows.join('\r\n'), 200, { 'Content-Type': 'text/csv; charset=utf-8' });
});

// ---------- premium routes ----------
app.post('/api/premium/report', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (!(await isPremium(c.env, u.id))) return c.json({ error: 'This is a Premium feature.', code: 'PREMIUM_REQUIRED' }, 402);
  const { habitId, month } = await c.req.json().catch(() => ({}));
  const habit = await habitOf(c.env, habitId, u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : todayKey().slice(0, 7);
  return c.json({ report: await buildReport(c.env, habit, m) });
});

app.post('/api/premium/recovery-plan', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (!(await isPremium(c.env, u.id))) return c.json({ error: 'This is a Premium feature.', code: 'PREMIUM_REQUIRED' }, 402);
  const { habitId } = await c.req.json().catch(() => ({}));
  const habit = await habitOf(c.env, habitId, u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  return c.json({ plan: await buildRecoveryPlan(c.env, habit) });
});

// ---------- admin ----------
async function countsFor(env) {
  const tables = ['users', 'habits', 'checkins', 'urges', 'journals', 'badges', 'subscriptions', 'app_errors'];
  const counts = {};
  for (const t of tables) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
    counts[t] = Number(row?.n || 0);
  }
  return counts;
}

app.get('/api/admin/status', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const counts = await countsFor(c.env);
  const premium = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE plan = 'premium' AND status = 'active'").first();
  const errors24h = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_errors WHERE created_at > datetime('now', '-24 hours')").first();
  return c.json({
    uptime: Math.round((Date.now() - c.env.STARTED_AT) / 1000) || 0,
    counts,
    premiumUsers: Number(premium?.n || 0),
    errors24h: Number(errors24h?.n || 0),
  });
});

app.get('/api/admin/errors', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const errors = (await c.env.DB.prepare('SELECT id, message, url, created_at FROM app_errors ORDER BY id DESC LIMIT 50').all()).results;
  return c.json({ errors });
});

app.post('/api/admin/ai-check', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const checks = [];
  const t0 = Date.now();
  try {
    await c.env.DB.prepare('SELECT 1').first();
    checks.push({ name: 'Database', ok: true, detail: `Query OK in ${Date.now() - t0}ms` });
  } catch (e) {
    checks.push({ name: 'Database', ok: false, detail: String(e.message) });
  }
  const counts = await countsFor(c.env);
  checks.push({ name: 'Data integrity', ok: true, detail: `${counts.users} users, ${counts.habits} habits` });
  const sample = [
    { date: '2026-08-01', status: 'clean' },
    { date: '2026-07-31', status: 'clean' },
    { date: '2026-07-30', status: 'slip' },
    { date: '2026-07-29', status: 'clean' },
    { date: '2026-07-28', status: 'clean' },
  ];
  const s = computeStats(sample, 10, 1);
  const streakOk = s.currentStreak === 2 && s.longestStreak === 2 && s.totalSlips === 1 && s.totalClean === 4;
  checks.push({ name: 'Streak engine', ok: streakOk, detail: streakOk ? 'Correct: streak 2, longest 2' : `Mismatch: streak ${s.currentStreak}` });
  const healthy = checks.every((x) => x.ok);
  return c.json({ healthy, checks, summary: healthy ? 'All checks passed.' : 'Some checks failed.', suggestions: [] });
});

// ---------- AI (registered separately, shares env) ----------
registerAiRoutes(app, { env: (c) => c.env, userOf });

// Non-API GET: serve the SPA (index.html) for client-side routes like /app.
// Workers Assets handles this via the ASSETS binding fallback.
app.get('*', async (c) => {
  if (c.req.method === 'GET' && !c.req.path.startsWith('/api/')) {
    if (c.env.ASSETS) {
      const res = await c.env.ASSETS.fetch(new Request(c.req.url));
      if (res.status !== 404) return res;
    }
    // Fallback for unknown deep links when the workspace has no matching file.
  }
  return c.json({ error: 'Not found.' }, 404);
});

async function ensureAdmin(env) {
  const em = String(env.ADMIN_EMAIL || 'admin@breakfree.app').toLowerCase();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(em).first();
  if (existing) {
    if (existing.role !== 'admin') await env.DB.prepare('UPDATE users SET role = ? WHERE email = ?').bind('admin', em).run();
    return;
  }
  const hash = await hashPassword(env.ADMIN_PASSWORD || 'admin12345');
  await env.DB.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').bind(em, hash, 'admin').run();
}

// Entry handler: ensures the admin account exists, then runs the app.
export default {
  async fetch(request, env, ctx) {
    env.STARTED_AT = env.STARTED_AT || Date.now();
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        await ensureAdmin(env); // lazily bootstraps the admin account
      } catch (e) {
        console.error('ensureAdmin failed:', e.message);
      }
    }
    return app.fetch(request, env, ctx);
  },
};