// BreakFree on Cloudflare Workers — single Hono app + D1.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { computeStats, BADGE_THRESHOLDS, todayKey, dateKey, addDays } from './stats.js';
import { hashPassword, verifyPassword, signToken, verifyToken, randomHex } from './auth.js';
import { registerAiRoutes } from './ai.js';
import { buildReport, buildRecoveryPlan } from './premium.js';
import { sendPush, loadOrCreateVapid } from './push.js';
import { createCheckout, retrieveSession, cancelStripeSubscription, verifyWebhookSignature } from './stripe.js';
import { findNearby, geocodeArea, GENERIC_IDEAS } from './daysout.js';
import { evaluateUserEngagement, evaluateAllEngagement } from './engage.js';
import { checkHealth as checkOpenAI } from './openai.js';
import { sendEmail } from './mail.js';

// The "Day 3–7 wall": a high-support window where survival-mode messaging and
// extra nudges kick in. After day 7 the worst of acute withdrawal is behind.
function wallInfo(stats) {
  const day = stats?.currentStreak || 0;
  return { active: day >= 3 && day <= 7, day };
}

const PRICE_CENTS = 499;
const FREE_HABIT_LIMIT = 1;
const BILLING_DAYS = 30;

const app = new Hono();
app.use('/api/*', cors());

// Security headers on every response.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=()');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.breakfree-app.workers.dev https://breakfree.breakfree-app.workers.dev; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
});

// Set auth cookie from login/signup responses.
app.use('/api/auth*', async (c, next) => {
  await next();
  const setCookie = c.res.headers.get('Set-Cookie');
  if (setCookie && setCookie.includes('bf_auth=')) {
    c.res.headers.append('Set-Cookie', setCookie);
  }
});

function userOf(c) {
  return c.get('user') || null;
}

// ---------- auth middleware ----------
app.use('/api/*', async (c, next) => {
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const user = await verifyToken(token, c.env.JWT_SECRET);
    if (user) {
      // Re-check the account still exists so deleted accounts lose access
      // immediately rather than when their token expires.
      const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user.id).first();
      if (existing) {
        c.set('user', user);
        // Fire-and-forget: re-engagement cascade + Sunday digest. Cheap because
        // it short-circuits when the user checked in today (and is de-duped).
        c.executionCtx.waitUntil(evaluateUserEngagement(c.env, user.id).catch(() => {}));
      }
    }
  }
  await next();
});

async function habitOf(env, habitId, userId) {
  return env.DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').bind(Number(habitId), userId).first();
}

async function trackEvent(env, eventType, userId, habitId, variant, detail) {
  try {
    await env.DB.prepare('INSERT INTO app_events (event_type, user_id, habit_id, variant, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(eventType, userId || null, habitId || null, variant || null, detail || null).run();
  } catch {
    // never let analytics break the main flow
  }
}

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return dateKey(d);
}

async function habitPayload(env, habit) {
  const checkins = (await env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results;
  const stats = computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
  const badges = (await env.DB.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').bind(habit.id).all()).results;
  const ws = weekStart(todayKey());
  const thisWeekJournal = await env.DB.prepare('SELECT count FROM journal_badges WHERE habit_id = ? AND week_start = ?').bind(habit.id, ws).first();
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
    stats,
    wall: wallInfo(stats),
    badges,
    journalWeekCount: thisWeekJournal?.count || 0,
    journalWeekBadgeEarned: (thisWeekJournal?.count || 0) >= 3,
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
    const prefs = { dailyReminder: true, urgeTips: true, milestones: true, triggerNudges: true };
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

// In-memory rate limiter: key → [timestamps]. Cleans up old entries on each call.
const RATE_LIMITS = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 2;

function rateLimit(key) {
  const now = Date.now();
  const entries = RATE_LIMITS.get(key) || [];
  const recent = entries.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return false;
  recent.push(now);
  RATE_LIMITS.set(key, recent);
  return true;
}

// Global rate limit on all auth endpoints: 2 requests/minute per IP (testing).
app.use('/api/auth*', async (c, next) => {
  const ip = c.req.raw.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = rateLimit(`auth:${ip}`);
  console.log(`[rate limit] auth:${ip} allowed=${allowed} path=${c.req.url}`);
  if (!allowed) return c.json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
  await next();
});

function parseTriggerTimes(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function dateFromStr(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
}

// ---------- health ----------
app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

// ---------- legal ----------
const TERMS_TEXT = `BreakFree Terms of Service

1. Acceptance of terms
BreakFree is a personal habit and productivity tracking tool. By creating an account you agree to these terms.

2. Eligible users
You must be 13 or older to use this service. You are responsible for maintaining the confidentiality of your account.

3. Acceptable use
You may use this service for lawful personal purposes only. Do not attempt to abuse, interfere with or disrupt the service.

4. Health disclaimer
BreakFree is a companion, not a substitute for professional medical, mental health or addiction treatment. If you are in immediate danger call your local emergency number.

5. Limitation of liability
The service is provided "as is" without warranties. BreakFree is not liable for any indirect or consequential loss arising from your use of the service.

6. Changes
These terms may be updated from time to time. Continued use after changes means you accept the updated terms.`;

const PRIVACY_TEXT = `BreakFree Privacy Policy

1. What we collect
We collect only the data necessary to run your account: email, hashed password, habit data, check-ins, journals, urges and basic usage metrics.

2. How we use it
Your data is used solely to provide the BreakFree service — habit tracking, coaching insights, reminders and reports.

3. Data sharing
We do not sell or share your personal information with third parties except where required by law or to operate the service (e.g. push notification providers).

4. Security
Data is stored securely and transmitted over HTTPS only. You can request a full export or permanent deletion of your account from Settings.

5. Cookies and local storage
The app uses local storage for offline drafts and UI preferences. No advertising cookies are used.

6. Contact
For privacy questions contact: privacy@breakfree.app`;

app.get('/legal/terms', (c) => new Response(TERMS_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
app.get('/legal/privacy', (c) => new Response(PRIVACY_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
app.get('/terms', (c) => c.redirect('/legal/terms'));
app.get('/privacy', (c) => c.redirect('/legal/privacy'));

// ---------- auth ----------
app.post('/api/auth/signup', async (c) => {
  const ip = c.req.raw.headers.get('CF-Connecting-IP') || 'unknown';
  if (!rateLimit(`signup:${ip}`)) return c.json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Please enter a valid email address.' }, 400);
  if (!password || password.length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400);
  if (!/[A-Z]/.test(password)) return c.json({ error: 'Password must include at least one uppercase letter.' }, 400);
  if (!/[0-9]/.test(password)) return c.json({ error: 'Password must include at least one number.' }, 400);
  if (!/[^A-Za-z0-9]/.test(password)) return c.json({ error: 'Password must include at least one symbol (!@#$%^&*).' }, 400);
  const em = String(email).toLowerCase().trim();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(em).first();
  if (existing) return c.json({ error: 'An account with that email already exists.' }, 409);
  const hash = await hashPassword(password);
  const info = await c.env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(em, hash).run();
  const user = { id: Number(info.meta.last_row_id), email: em, role: 'user' };
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, renews_at)
     VALUES (?, 'premium', 'trial', datetime('now'), datetime('now', '+7 days'))
     ON CONFLICT(user_id) DO NOTHING`
  ).bind(user.id).run();
  const token = await signToken(user, c.env.JWT_SECRET);
  try {
    const cfTz = c.req.raw.cf?.timezone || c.req.cf?.timezone;
    if (cfTz) await c.env.DB.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(String(cfTz).slice(0, 64), user.id).run();
  } catch (e) {
    console.error('timezone inference failed:', e.message);
  }
  c.header('Set-Cookie', `bf_auth=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 365}; Path=/`);
  return c.json({ token, user: publicUser(user), expiresIn: 60 * 60 * 24 * 365 }, 201);
});

app.post('/api/auth/login', async (c) => {
  const ip = c.req.raw.headers.get('CF-Connecting-IP') || 'unknown';
  if (!rateLimit(`login:${ip}`)) return c.json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
  const { email, password, rememberMe } = await c.req.json().catch(() => ({}));
  if (!email || !password) return c.json({ error: 'Email and password are required.' }, 400);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(String(email).toLowerCase()).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) return c.json({ error: 'Invalid email or password.' }, 401);
  const expiresSec = rememberMe ? 60 * 60 * 24 * 7 : 60 * 60;
  const token = await signToken(user, c.env.JWT_SECRET, expiresSec);
  c.header('Set-Cookie', `bf_auth=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${expiresSec}; Path=/`);
  return c.json({ token, user: publicUser(user), expiresIn: expiresSec });
});

app.post('/api/auth/logout', async (c) => {
  c.header('Set-Cookie', 'bf_auth=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/');
  return c.json({ message: 'Logged out.' });
});

app.post('/api/auth/forgot-password', async (c) => {
  const { email } = await c.req.json().catch(() => ({}));
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Please enter a valid email address.' }, 400);
  const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(String(email).toLowerCase().trim()).first();
  if (user) {
    const token = randomHex(32);
    const expiresAt = Date.now() + 60 * 60 * 1000;
    await c.env.DB.prepare('INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)').bind(user.email, token, expiresAt).run();
    const origin = new URL(c.req.url).origin;
    const resetUrl = `${origin}/reset-password?token=${token}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17171A">
      <p style="font-size:18px;line-height:1.5">Hey,</p>
      <p style="font-size:16px;line-height:1.6">We received a request to reset your BreakFree password. Click the button below to choose a new one. This link expires in 1 hour.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${resetUrl}" style="background:#E50914;color:#fff;padding:14px 26px;border-radius:14px;text-decoration:none;font-weight:bold">Reset password</a>
      </p>
      <p style="font-size:13px;color:#666">If you didn&apos;t request this, you can safely ignore this email. Your password won&apos;t change.</p>
    </div>`;
    sendEmail(c.env, { to: user.email, subject: 'Reset your BreakFree password', html }).catch((e) => console.error('reset email failed:', e.message));
  }
  return c.json({ message: 'If this email exists, a reset link was sent.' }, 200);
});

app.post('/api/auth/reset-password', async (c) => {
  const { token, newPassword } = await c.req.json().catch(() => ({}));
  if (!token || !newPassword) return c.json({ error: 'Token and new password are required.' }, 400);
  if (newPassword.length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400);
  if (!/[A-Z]/.test(newPassword)) return c.json({ error: 'Password must include at least one uppercase letter.' }, 400);
  if (!/[0-9]/.test(newPassword)) return c.json({ error: 'Password must include at least one number.' }, 400);
  if (!/[^A-Za-z0-9]/.test(newPassword)) return c.json({ error: 'Password must include at least one symbol (!@#$%^&*).' }, 400);
  const record = await c.env.DB.prepare('SELECT id, email, expires_at, used FROM password_reset_tokens WHERE token = ?').bind(token).first();
  if (!record || record.used || record.expires_at < Date.now()) return c.json({ error: 'Invalid or expired token.' }, 400);
  const hash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind(hash, record.email).run();
  await c.env.DB.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').bind(record.id).run();
  return c.json({ message: 'Password reset successfully.' }, 200);
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
  const active = row?.plan === 'premium' && row?.status === 'active';
  return c.json({
    subscription: {
      plan: row?.plan || 'free',
      status: row?.status || 'free',
      active,
      trial: false,
      habitLimit: Infinity,
      startedAt: row?.started_at || null,
      renewsAt: row?.renews_at || null,
    },
    price: PRICE_CENTS,
  });
});

app.post('/api/subscription/checkout', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  await activateSubscription(c.env, u.id);
  const sub = await c.env.DB.prepare('SELECT plan, status, renews_at FROM subscriptions WHERE user_id = ?').bind(u.id).first();
  return c.json({ alreadyPremium: true, subscription: sub });
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
  const { name, startDate, dailyCost, costUnit, dailyTime, unitsPerDay, triggerTimes, reason, relapsePlan } = await c.req.json().catch(() => ({}));
  if (!name || !String(name).trim()) return c.json({ error: 'Habit name is required.' }, 400);
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return c.json({ error: 'A valid start date is required.' }, 400);
  const info = await c.env.DB.prepare(
    'INSERT INTO habits (user_id, name, start_date, daily_cost, cost_unit, daily_time, units_per_day, trigger_times, reason, relapse_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    u.id,
    String(name).trim(),
    startDate,
    dailyCost && dailyCost > 0 ? dailyCost : null,
    costUnit || 'day',
    dailyTime && dailyTime > 0 ? dailyTime : null,
    unitsPerDay && unitsPerDay > 0 ? unitsPerDay : null,
    Array.isArray(triggerTimes) && triggerTimes.length > 0 ? JSON.stringify(triggerTimes) : null,
    reason && String(reason).trim() ? String(reason).trim() : null,
    relapsePlan && String(relapsePlan).trim() ? String(relapsePlan).trim() : null
  ).run();
  const habit = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(Number(info.meta.last_row_id)).first();
  return c.json({ habit: await habitPayload(c.env, habit) }, 201);
});

app.get('/api/habits/:id', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const checkins = (await c.env.DB.prepare('SELECT date, status, note, forgiven FROM checkins WHERE habit_id = ? ORDER BY date DESC').bind(habit.id).all()).results;
  const urges = (await c.env.DB.prepare('SELECT id, logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC').bind(habit.id).all()).results;
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
  await c.env.DB.prepare(
    'UPDATE habits SET name = ?, daily_cost = ?, cost_unit = ?, daily_time = ?, units_per_day = ?, trigger_times = ?, reason = ?, relapse_plan = ? WHERE id = ?'
  ).bind(
    body.name != null ? String(body.name).trim() : habit.name,
    body.dailyCost != null && body.dailyCost > 0 ? body.dailyCost : habit.daily_cost,
    body.costUnit != null ? body.costUnit : habit.cost_unit,
    body.dailyTime != null && body.dailyTime > 0 ? body.dailyTime : habit.daily_time,
    body.unitsPerDay != null && body.unitsPerDay > 0 ? body.unitsPerDay : habit.units_per_day,
    Array.isArray(body.triggerTimes) && body.triggerTimes.length > 0
      ? JSON.stringify(body.triggerTimes)
      : Array.isArray(body.triggerTimes)
        ? null
        : habit.trigger_times,
    body.reason != null ? (String(body.reason).trim() || null) : habit.reason,
    body.relapsePlan != null ? (String(body.relapsePlan).trim() || null) : habit.relapse_plan,
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
     ON CONFLICT(habit_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, forgiven = 0`
  ).bind(habit.id, key, status, note ? String(note).trim() : null).run();
  let newBadge = null;
  let newShields = 0;
  if (status === 'clean') {
    const checkins = (await c.env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results;
    const stats = computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
    const earned = await awardBadges(c.env.DB, habit.id, stats.currentStreak);
    if (earned.length > 0) newBadge = earned[earned.length - 1];
    const blocks = Math.floor(stats.totalClean / 7);
    const prevBlocks = Math.floor((stats.totalClean - 1) / 7);
    if (blocks > prevBlocks) {
      newShields = blocks - prevBlocks;
      await c.env.DB.prepare('UPDATE habits SET shield_tokens = shield_tokens + ? WHERE id = ?').bind(newShields, habit.id).run();
    }
  }
  if (newBadge) void maybeNotify(c, u.id, habit.id, 'milestones', { title: 'BreakFree', body: `${newBadge.threshold} days clean — milestone reached. Look how far you've come. 🎉`, habitId: habit.id });
  const updated = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(habit.id).first();
  return c.json({ habit: await habitPayload(c.env, updated), newBadge, newShields });
});

// Forgiveness: keep a slip from breaking the current streak (grace day). The
// slip still counts as a slip — this just means it isn't a verdict.
app.post('/api/habits/:id/forgive', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const { date, forgiven } = await c.req.json().catch(() => ({}));
  const key = dateFromStr(date);
  const row = await c.env.DB.prepare('SELECT status FROM checkins WHERE habit_id = ? AND date = ?').bind(habit.id, key).first();
  if (!row) return c.json({ error: 'No check-in on that date.' }, 404);
  await c.env.DB.prepare('UPDATE checkins SET forgiven = ? WHERE habit_id = ? AND date = ?').bind(forgiven ? 1 : 0, habit.id, key).run();
  const updated = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(habit.id).first();
  return c.json({ habit: await habitPayload(c.env, updated) });
});

// Spend one shield token to turn today's slip into a forgiven clean day.
app.post('/api/habits/:id/shield', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  if ((habit.shield_tokens || 0) < 1) return c.json({ error: 'No shield tokens available. Keep going to earn more!' }, 400);
  const key = todayKey();
  const existing = await c.env.DB.prepare('SELECT id, status FROM checkins WHERE habit_id = ? AND date = ?').bind(habit.id, key).first();
  if (existing && existing.status === 'slip') {
    await c.env.DB.prepare('UPDATE checkins SET status = ?, forgiven = 1 WHERE id = ?').bind('clean', existing.id).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO checkins (habit_id, date, status, forgiven) VALUES (?, ?, 'clean', 1)
       ON CONFLICT(habit_id, date) DO UPDATE SET status = 'clean', forgiven = 1`
    ).bind(habit.id, key).run();
  }
  await c.env.DB.prepare('UPDATE habits SET shield_tokens = shield_tokens - 1 WHERE id = ?').bind(habit.id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(habit.id).first();
  let newBadge = null;
  const checkins = (await c.env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results;
  const stats = computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
  const earned = await awardBadges(c.env.DB, habit.id, stats.currentStreak);
  if (earned.length > 0) newBadge = earned[earned.length - 1];
  if (newBadge) void maybeNotify(c, u.id, habit.id, 'milestones', { title: 'BreakFree', body: `${newBadge.threshold} days clean — milestone reached. Look how far you've come. 🎉`, habitId: habit.id });
  return c.json({ habit: await habitPayload(c.env, updated), newBadge });
});

// ---------- urges ----------
app.get('/api/habits/:id/urges', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const urges = (await c.env.DB.prepare('SELECT id, logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC').bind(habit.id).all()).results;
  return c.json({ urges });
});

app.post('/api/habits/:id/urges', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const habit = await habitOf(c.env, c.req.param('id'), u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const { intensity, trigger, triggerType, action, resisted, loggedAt } = await c.req.json().catch(() => ({}));
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) return c.json({ error: 'Intensity must be between 1 and 5.' }, 400);
  const info = await c.env.DB.prepare('INSERT INTO urges (habit_id, logged_at, intensity, trigger, trigger_type, action, resisted) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
    habit.id, loggedAt || new Date().toISOString(), intensity, trigger ? String(trigger).trim() : null, triggerType ? String(triggerType).trim() : null, action ? String(action).trim() : null, resisted ? 1 : 0
  ).run();
  const urge = await c.env.DB.prepare('SELECT id, logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE id = ?').bind(Number(info.meta.last_row_id)).first();
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
  void trackEvent(c.env, 'journal_saved', u.id, habit.id, null, `entry length=${entry.content.length}`);
  const ws = weekStart(key);
  const existing = await c.env.DB.prepare('SELECT id, count FROM journal_badges WHERE habit_id = ? AND week_start = ?').bind(habit.id, ws).first();
  const newCount = (existing?.count || 0) + 1;
  await c.env.DB.prepare('INSERT INTO journal_badges (habit_id, week_start, count) VALUES (?, ?, ?) ON CONFLICT(habit_id, week_start) DO UPDATE SET count = excluded.count').bind(habit.id, ws, newCount).run();
  if (newCount === 3 && !existing) {
    void trackEvent(c.env, 'journal_badge_earned', u.id, habit.id, null, '3 entries in week');
  }
  return c.json({ entry, journalWeekCount: newCount }, 201);
});

// ---------- days out ----------
app.get('/api/days-out*', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
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
const DEFAULT_PREFS = { dailyReminder: true, urgeTips: true, milestones: true, triggerNudges: true, reminderTime: null, emailOptIn: false, digestOptIn: true, reEngageOptIn: true };

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function prefsFor(c, userId) {
  const user = await c.env.DB.prepare('SELECT notification_prefs FROM users WHERE id = ?').bind(userId).first();
  const base = { ...DEFAULT_PREFS };
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
  for (const key of Object.keys(DEFAULT_PREFS)) {
    if (typeof body[key] === 'boolean') prefs[key] = body[key];
  }
  if (body.reminderTime === null || body.reminderTime === '') {
    prefs.reminderTime = null;
  } else if (typeof body.reminderTime === 'string' && VALID_TIME.test(body.reminderTime)) {
    prefs.reminderTime = body.reminderTime;
  } else if (body.reminderTime != null) {
    return c.json({ error: 'Reminder time must be in 24-hour HH:MM format.' }, 400);
  }
  await c.env.DB.prepare('UPDATE users SET notification_prefs = ? WHERE id = ?').bind(JSON.stringify(prefs), u.id).run();
  return c.json({ prefs });
});

// ---------- health tracking (manual entry) ----------
app.get('/api/health', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const q = new URL(c.req.url).searchParams;
  const habitId = Number(q.get('habitId'));
  const days = Math.min(Number(q.get('days')) || 30, 90);
  if (!habitId) return c.json({ error: 'habitId is required.' }, 400);
  const habit = await habitOf(c.env, habitId, u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const since = addDays(todayKey(), -(days - 1));
  const samples = (await c.env.DB.prepare(
    'SELECT date, steps, sleep_hours, resting_hr, notes FROM health_samples WHERE habit_id = ? AND date >= ? ORDER BY date ASC'
  ).bind(habitId, since).all()).results;
  return c.json({ samples });
});

app.post('/api/health', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const habit = await habitOf(c.env, body.habitId, u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const key = dateFromStr(body.date);
  const steps = body.steps == null || body.steps === '' ? null : Number(body.steps);
  const sleepH = body.sleepHours == null || body.sleepHours === '' ? null : Number(body.sleepHours);
  const hr = body.restingHr == null || body.restingHr === '' ? null : Number(body.restingHr);
  if (steps != null && (!Number.isFinite(steps) || steps < 0 || steps > 200000)) return c.json({ error: 'Steps must be between 0 and 200,000.' }, 400);
  if (sleepH != null && (!Number.isFinite(sleepH) || sleepH < 0 || sleepH > 24)) return c.json({ error: 'Sleep hours must be between 0 and 24.' }, 400);
  if (hr != null && (!Number.isInteger(hr) || hr < 30 || hr > 220)) return c.json({ error: 'Resting heart rate must be a whole number between 30 and 220.' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO health_samples (habit_id, date, steps, sleep_hours, resting_hr, notes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       steps = excluded.steps, sleep_hours = excluded.sleep_hours, resting_hr = excluded.resting_hr, notes = excluded.notes,
       updated_at = datetime('now')`
  ).bind(habit.id, key, steps, sleepH, hr, body.notes ? String(body.notes).trim() : null).run();
  const row = (await c.env.DB.prepare(
    'SELECT date, steps, sleep_hours, resting_hr, notes FROM health_samples WHERE habit_id = ? AND date = ?'
  ).bind(habit.id, key).all()).results[0];
  return c.json({ sample: row });
});

// ---------- milestone sharing (landing-page social proof counter) ----------
app.post('/api/shares', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { habitId, days } = await c.req.json().catch(() => ({}));
  const habit = await habitOf(c.env, habitId, u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const d = Math.min(Math.max(Number(days) || 0, 0), 3650);
  await c.env.DB.prepare('INSERT INTO milestone_shares (user_id, habit_id, days) VALUES (?, ?, ?)').bind(u.id, habit.id, d).run();
  const total = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM milestone_shares').first()).n);
  return c.json({ ok: true, total });
});

app.get('/api/shares/total', async (c) => {
  const total = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM milestone_shares').first()).n);
  return c.json({ total });
});

// ---------- community ----------
const COMMUNITY_EMOJIS = ['💪', '🎉', '🔥', '❤️', '🫶'];
const NAME_ADJ = ['Brave', 'Calm', 'Clever', 'Cosmic', 'Courageous', 'Dawn', 'Fierce', 'Gentle', 'Golden', 'Hopeful', 'Kind', 'Lucky', 'Mellow', 'Mighty', 'Mindful', 'Peaceful', 'Radiant', 'Resilient', 'Serene', 'Shining', 'Silent', 'Sincere', 'Steady', 'Strong', 'Sunny', 'Swift', 'Tender', 'True', 'Warm', 'Wise'];
const NAME_NOUN = ['Bear', 'Breeze', 'Canyon', 'Cedar', 'Dove', 'Eagle', 'Fern', 'Fox', 'Harbor', 'Journey', 'Lark', 'Lotus', 'Meadow', 'Oak', 'Otter', 'Pine', 'River', 'Rose', 'Skylark', 'Spring', 'Star', 'Stone', 'Sunrise', 'Thistle', 'Valley', 'Wave', 'Willow', 'Wren'];

function randomUsername() {
  const a = NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)];
  const n = NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)];
  return `${a}${n}${Math.floor(10 + Math.random() * 90)}`;
}

function validUsername(u) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(u || '');
}

async function ensureUsername(env, userId) {
  const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first();
  if (user?.username) return user.username;
  for (let i = 0; i < 6; i++) {
    const name = randomUsername();
    try {
      const r = await env.DB.prepare('UPDATE users SET username = ? WHERE id = ? AND username IS NULL').bind(name, userId).run();
      if (r.meta?.changes) return name;
    } catch { /* name collision — try again */ }
  }
  return 'Anonymous';
}

async function communityPosts(env, userId, feed, limit, offset) {
  const following = feed === 'following';
  const blocked = (await env.DB.prepare(
    `SELECT blocked_id FROM community_blocks WHERE blocker_id = ?
     UNION
     SELECT blocker_id FROM community_blocks WHERE blocked_id = ?`
  ).bind(userId, userId).all()).results;
  const blockedIds = blocked.map((b) => b.blocked_id);
  const blockedIn = blockedIds.length > 0 ? `p.user_id NOT IN (${blockedIds.map(() => '?').join(',')})` : '1=1';
  let rows;
  if (following) {
    rows = (await env.DB.prepare(
      `SELECT p.id, p.user_id, p.content, p.habit_name, p.streak, p.badge, p.created_at,
              COALESCE(u.username, 'Anonymous') AS author_username,
              (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comment_count
       FROM community_posts p JOIN users u ON u.id = p.user_id
       WHERE (p.user_id IN (SELECT following_id FROM community_follows WHERE follower_id = ?) OR p.user_id = ?)
         AND ${blockedIn}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
    ).bind(userId, userId, ...blockedIds, limit, offset).all()).results;
  } else {
    rows = (await env.DB.prepare(
      `SELECT p.id, p.user_id, p.content, p.habit_name, p.streak, p.badge, p.created_at,
              COALESCE(u.username, 'Anonymous') AS author_username,
              (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comment_count
       FROM community_posts p JOIN users u ON u.id = p.user_id
       WHERE ${blockedIn}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
    ).bind(...blockedIds, limit, offset).all()).results;
  }
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const inClause = ids.map(() => '?').join(',');
  const reactionRows = (await env.DB.prepare(
    `SELECT post_id, emoji, COUNT(*) AS n FROM community_reactions WHERE post_id IN (${inClause}) GROUP BY post_id, emoji`
  ).bind(...ids).all()).results;
  const myReactions = (await env.DB.prepare(
    `SELECT post_id, emoji FROM community_reactions WHERE user_id = ? AND post_id IN (${inClause})`
  ).bind(userId, ...ids).all()).results;
  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const authorIn = authorIds.map(() => '?').join(',');
  const follows = (await env.DB.prepare(
    `SELECT following_id FROM community_follows WHERE follower_id = ? AND following_id IN (${authorIn})`
  ).bind(userId, ...authorIds).all()).results;
  const reactionsByPost = {};
  for (const r of reactionRows) {
    (reactionsByPost[r.post_id] = reactionsByPost[r.post_id] || {})[r.emoji] = Number(r.n);
  }
  const myByPost = Object.fromEntries(myReactions.map((r) => [r.post_id, r.emoji]));
  const followSet = new Set(follows.map((f) => f.following_id));
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    content: r.content,
    habitName: r.habit_name,
    streak: r.streak,
    badge: r.badge,
    createdAt: r.created_at,
    author: r.author_username,
    reactions: reactionsByPost[r.id] || {},
    myReaction: myByPost[r.id] || null,
    commentCount: Number(r.comment_count || 0),
    following: followSet.has(r.user_id),
  }));
}

app.get('/api/community/me', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  return c.json({ username: await ensureUsername(c.env, u.id) });
});

app.put('/api/community/username', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { username } = await c.req.json().catch(() => ({}));
  const name = String(username || '').trim();
  if (!validUsername(name)) return c.json({ error: 'Pick 3–20 letters, numbers or underscores.' }, 400);
  const taken = await c.env.DB.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').bind(name).first();
  if (taken) return c.json({ error: 'That name is taken — try another.' }, 409);
  await c.env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(name, u.id).run();
  return c.json({ username: name });
});

app.get('/api/community/posts', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const q = new URL(c.req.url).searchParams;
  const feed = q.get('feed') === 'following' ? 'following' : 'global';
  const limit = Math.min(Number(q.get('limit')) || 50, 100);
  const offset = Math.max(Number(q.get('offset')) || 0, 0);
  return c.json({ posts: await communityPosts(c.env, u.id, feed, limit, offset) });
});

app.post('/api/community/posts', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  await ensureUsername(c.env, u.id);
  const { content, habitId } = await c.req.json().catch(() => ({}));
  let text = String(content || '').trim();
  let habitName = null;
  let streak = null;
  let badge = null;
  if (habitId) {
    const habit = await habitOf(c.env, habitId, u.id);
    if (!habit) return c.json({ error: 'Habit not found.' }, 404);
    const checkins = (await c.env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results;
    const stats = computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
    habitName = habit.name;
    streak = stats.currentStreak;
    if (!text) {
      text = streak > 0
        ? `Hit a ${streak}-day clean streak with ${habit.name}. One day at a time.`
        : `Starting over with ${habit.name}. Day one, here we go.`;
    }
  }
  if (!text) return c.json({ error: 'Write something to share.' }, 400);
  if (text.length > 280) return c.json({ error: 'Keep it under 280 characters.' }, 400);
  const info = await c.env.DB.prepare(
    'INSERT INTO community_posts (user_id, content, habit_name, streak, badge) VALUES (?, ?, ?, ?, ?)'
  ).bind(u.id, text.slice(0, 280), habitName, streak, badge).run();
  return c.json({ ok: true, postId: Number(info.meta.last_row_id) }, 201);
});

app.delete('/api/community/posts/:id', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const post = await c.env.DB.prepare('SELECT * FROM community_posts WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!post) return c.json({ error: 'Post not found.' }, 404);
  if (post.user_id !== u.id && u.role !== 'admin') return c.json({ error: 'Not allowed.' }, 403);
  await c.env.DB.prepare('DELETE FROM community_posts WHERE id = ?').bind(post.id).run();
  return c.json({ ok: true });
});

app.post('/api/community/posts/:id/reactions', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const post = await c.env.DB.prepare('SELECT id FROM community_posts WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!post) return c.json({ error: 'Post not found.' }, 404);
  const { emoji } = await c.req.json().catch(() => ({}));
  if (!COMMUNITY_EMOJIS.includes(emoji)) return c.json({ error: 'Unsupported reaction.' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO community_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)
     ON CONFLICT(post_id, user_id) DO UPDATE SET emoji = excluded.emoji`
  ).bind(post.id, u.id, emoji).run();
  return c.json({ ok: true, emoji });
});

app.delete('/api/community/posts/:id/reactions', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  await c.env.DB.prepare('DELETE FROM community_reactions WHERE post_id = ? AND user_id = ?').bind(Number(c.req.param('id')), u.id).run();
  return c.json({ ok: true });
});

app.get('/api/community/posts/:id/comments', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const post = await c.env.DB.prepare('SELECT id FROM community_posts WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!post) return c.json({ error: 'Post not found.' }, 404);
  const blocked = (await c.env.DB.prepare(
    `SELECT blocked_id FROM community_blocks WHERE blocker_id = ?
     UNION
     SELECT blocker_id FROM community_blocks WHERE blocked_id = ?`
  ).bind(u.id, u.id).all()).results;
  const blockedIds = blocked.map((b) => b.blocked_id);
  const blockedIn = blockedIds.length > 0 ? `AND cm.user_id NOT IN (${blockedIds.map(() => '?').join(',')})` : '';
  const comments = (await c.env.DB.prepare(
    `SELECT cm.id, cm.content, cm.created_at, COALESCE(u.username, 'Anonymous') AS author, cm.user_id
     FROM community_comments cm JOIN users u ON u.id = cm.user_id
     WHERE cm.post_id = ? ${blockedIn} ORDER BY cm.created_at, cm.id`
  ).bind(post.id, ...blockedIds).all()).results;
  return c.json({ comments });
});

app.post('/api/community/posts/:id/comments', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  await ensureUsername(c.env, u.id);
  const post = await c.env.DB.prepare('SELECT id FROM community_posts WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!post) return c.json({ error: 'Post not found.' }, 404);
  const { content } = await c.req.json().catch(() => ({}));
  const text = String(content || '').trim();
  if (!text) return c.json({ error: 'Write a comment.' }, 400);
  if (text.length > 280) return c.json({ error: 'Keep it under 280 characters.' }, 400);
  const info = await c.env.DB.prepare('INSERT INTO community_comments (post_id, user_id, content) VALUES (?, ?, ?)').bind(post.id, u.id, text.slice(0, 280)).run();
  const comment = await c.env.DB.prepare(
    `SELECT cm.id, cm.content, cm.created_at, COALESCE(u.username, 'Anonymous') AS author, cm.user_id
     FROM community_comments cm JOIN users u ON u.id = cm.user_id WHERE cm.id = ?`
  ).bind(Number(info.meta.last_row_id)).first();
  return c.json({ comment }, 201);
});

app.post('/api/community/follow', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { userId } = await c.req.json().catch(() => ({}));
  const target = Number(userId);
  if (!Number.isInteger(target) || target === u.id) return c.json({ error: 'Invalid user.' }, 400);
  await c.env.DB.prepare('INSERT OR IGNORE INTO community_follows (follower_id, following_id) VALUES (?, ?)').bind(u.id, target).run();
  return c.json({ ok: true, following: true });
});

app.post('/api/community/unfollow', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { userId } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('DELETE FROM community_follows WHERE follower_id = ? AND following_id = ?').bind(u.id, Number(userId)).run();
  return c.json({ ok: true, following: false });
});

// ---------- moderation ----------
app.post('/api/community/report', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { postId, commentId, reason } = await c.req.json().catch(() => ({}));
  const targetId = postId ? Number(postId) : commentId ? Number(commentId) : null;
  if (!targetId) return c.json({ error: 'Nothing to report.' }, 400);
  const reasonText = String(reason || '').trim().slice(0, 100);
  const allowed = ['Spam', 'Harassment', 'Self-harm', 'Inappropriate', 'Other'];
  if (!allowed.includes(reasonText)) return c.json({ error: 'Choose a reason.' }, 400);
  if (postId) {
    const post = await c.env.DB.prepare('SELECT id FROM community_posts WHERE id = ?').bind(targetId).first();
    if (!post) return c.json({ error: 'Post not found.' }, 404);
  } else {
    const comment = await c.env.DB.prepare('SELECT id FROM community_comments WHERE id = ?').bind(targetId).first();
    if (!comment) return c.json({ error: 'Comment not found.' }, 404);
  }
  const prior = await c.env.DB.prepare(
    `SELECT id FROM community_reports
     WHERE reporter_id = ? AND post_id IS ? AND comment_id IS ? AND status = 'open'`
  ).bind(u.id, postId ? targetId : null, commentId ? targetId : null).first();
  if (prior) return c.json({ ok: true, already: true });
  await c.env.DB.prepare(
    `INSERT INTO community_reports (reporter_id, post_id, comment_id, reason) VALUES (?, ?, ?, ?)`
  ).bind(u.id, postId ? targetId : null, commentId ? targetId : null, reasonText).run();
  return c.json({ ok: true }, 201);
});

app.post('/api/community/block', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { userId } = await c.req.json().catch(() => ({}));
  const target = Number(userId);
  if (!Number.isInteger(target) || target === u.id) return c.json({ error: 'Invalid user.' }, 400);
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(target).first();
  if (!exists) return c.json({ error: 'User not found.' }, 404);
  await c.env.DB.prepare('INSERT OR IGNORE INTO community_blocks (blocker_id, blocked_id) VALUES (?, ?)').bind(u.id, target).run();
  await c.env.DB.prepare('DELETE FROM community_follows WHERE follower_id = ? AND following_id = ?').bind(u.id, target).run();
  return c.json({ ok: true }, 201);
});

app.get('/api/community/moderation', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const reports = (await c.env.DB.prepare(
    `SELECT r.id, r.reason, r.status, r.action, r.created_at,
            reporter.id AS reporter_id, COALESCE(reporter.username, 'Anonymous') AS reporter,
            COALESCE(author.id, '') AS author_id, COALESCE(author.username, '') AS author,
            r.post_id, r.comment_id,
            COALESCE(p.content, '') AS post_content,
            COALESCE(cm.content, '') AS comment_content,
            p.created_at AS post_created_at
     FROM community_reports r
     JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN community_posts p ON p.id = r.post_id
     LEFT JOIN community_comments cm ON cm.id = r.comment_id
     LEFT JOIN users author ON author.id = COALESCE(p.user_id, cm.user_id)
     ORDER BY (r.status = 'open') DESC, r.id DESC`
  ).all()).results;
  return c.json({ reports });
});

app.post('/api/community/moderation/:id', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const report = await c.env.DB.prepare('SELECT * FROM community_reports WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!report) return c.json({ error: 'Report not found.' }, 404);
  const { action } = await c.req.json().catch(() => ({}));
  if (!['dismiss', 'remove', 'block'].includes(action)) return c.json({ error: 'Action must be dismiss, remove or block.' }, 400);
  if (action === 'dismiss') {
    await c.env.DB.prepare(
      "UPDATE community_reports SET status = 'resolved', action = 'dismiss', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?"
    ).bind(u.id, report.id).run();
    const remainingOpen = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM community_reports WHERE status = 'open'").first())?.n || 0);
    void sendWebhookAlert(c.env, 'report_resolved', { reportId: report.id, action: 'dismiss', remainingOpen });
    return c.json({ ok: true, action });
  }
  if (action === 'remove') {
    if (report.post_id) {
      await c.env.DB.prepare('DELETE FROM community_posts WHERE id = ?').bind(report.post_id).run();
    } else if (report.comment_id) {
      await c.env.DB.prepare('DELETE FROM community_comments WHERE id = ?').bind(report.comment_id).run();
    } else {
      return c.json({ error: 'Report has no target.' }, 400);
    }
    await c.env.DB.prepare(
      "UPDATE community_reports SET status = 'resolved', action = 'remove', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?"
    ).bind(u.id, report.id).run();
    const remainingOpen = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM community_reports WHERE status = 'open'").first())?.n || 0);
    void sendWebhookAlert(c.env, 'report_resolved', { reportId: report.id, action: 'remove', remainingOpen });
    return c.json({ ok: true, action });
  }
  const targetUserId = report.post_id
    ? (await c.env.DB.prepare('SELECT user_id FROM community_posts WHERE id = ?').bind(report.post_id).first())?.user_id
    : report.comment_id
      ? (await c.env.DB.prepare('SELECT user_id FROM community_comments WHERE id = ?').bind(report.comment_id).first())?.user_id
      : null;
  if (targetUserId) {
    const blockers = (await c.env.DB.prepare("SELECT id FROM users WHERE role != 'admin' AND id != ?").bind(targetUserId).all()).results;
    for (const blocker of blockers) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO community_blocks (blocker_id, blocked_id) VALUES (?, ?)').bind(blocker.id, targetUserId).run();
    }
    await c.env.DB.prepare('DELETE FROM community_posts WHERE user_id = ?').bind(targetUserId).run();
    await c.env.DB.prepare('DELETE FROM community_comments WHERE user_id = ?').bind(targetUserId).run();
  }
  await c.env.DB.prepare(
    "UPDATE community_reports SET status = 'resolved', action = 'block', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?"
  ).bind(u.id, report.id).run();
  const remainingOpen = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM community_reports WHERE status = 'open'").first())?.n || 0);
  void sendWebhookAlert(c.env, 'report_resolved', { reportId: report.id, action: 'block', remainingOpen });
  return c.json({ ok: true, action });
});

// ---------- quit buddies ----------
function normalizeHabitName(n) {
  return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Opt in/out of finding a quit buddy.
app.put('/api/community/buddies', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { optedIn } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('UPDATE users SET buddy_opt_in = ? WHERE id = ?').bind(optedIn ? 1 : 0, u.id).run();
  return c.json({ optedIn: !!optedIn });
});

// People who started a similar habit (or started around the same time) and
// opted in to being found. Sorted with closest matches first.
app.get('/api/community/buddies', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const me = await c.env.DB.prepare('SELECT buddy_opt_in FROM users WHERE id = ?').bind(u.id).first();
  const optedIn = Number(me?.buddy_opt_in || 0) === 1;
  const myHabits = (await c.env.DB.prepare('SELECT name, start_date FROM habits WHERE user_id = ? ORDER BY start_date').bind(u.id).all()).results;
  const myPrimary = myHabits[0] || null;
  if (!myPrimary) return c.json({ optedIn, buddies: [] });
  const myName = normalizeHabitName(myPrimary.name);
  const myStart = myPrimary.start_date;

  const candidates = (await c.env.DB.prepare(
    'SELECT id, username FROM users WHERE buddy_opt_in = 1 AND id != ? AND username IS NOT NULL'
  ).bind(u.id).all()).results;

  const buddies = [];
  for (const cand of candidates) {
    const ch = (await c.env.DB.prepare(
      'SELECT name, start_date, id FROM habits WHERE user_id = ? ORDER BY ABS(julianday(start_date) - julianday(?)) LIMIT 1'
    ).bind(cand.id, myStart).all()).results[0];
    if (!ch) continue;
    const sameName = normalizeHabitName(ch.name) === myName;
    const daysDiff = Math.abs(Math.round((new Date(ch.start_date) - new Date(myStart)) / 86400000));
    const startClose = daysDiff <= 21;
    const match = sameName && startClose ? 'both' : sameName ? 'habit' : startClose ? 'start' : null;
    if (!match) continue;
    const checkins = (await c.env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(ch.id).all()).results;
    const stats = computeStats(checkins, 0, 0, 0);
    const following = await c.env.DB.prepare('SELECT 1 FROM community_follows WHERE follower_id = ? AND following_id = ?').bind(u.id, cand.id).first();
    buddies.push({
      userId: cand.id,
      username: cand.username,
      habitName: ch.name,
      startDate: ch.start_date,
      daysDiff,
      match,
      streak: stats.currentStreak,
      following: !!following,
    });
  }
  const rank = { both: 0, habit: 1, start: 2 };
  buddies.sort((a, b) => rank[a.match] - rank[b.match]);
  return c.json({ optedIn, buddies });
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
  const { endpoint, keys, timezone } = await c.req.json().catch(() => ({}));
  if (!endpoint || !keys?.p256dh || !keys?.auth) return c.json({ error: 'endpoint and keys are required.' }, 400);
  const existingSub = await c.env.DB.prepare('SELECT id FROM push_subscriptions WHERE user_id = ?').bind(u.id).first();
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, last_seen) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, last_seen = datetime('now')`
  ).bind(u.id, String(endpoint), String(keys.p256dh), String(keys.auth)).run();
  if (timezone) await c.env.DB.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(String(timezone).slice(0, 64), u.id).run();
  void trackEvent(c.env, existingSub ? 'push_resubscribed' : 'push_subscribed', u.id, null, null, existingSub ? 'user re-subscribed' : 'first subscription');
  return c.json({ ok: true });
});

app.post('/api/push/tz', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { timezone } = await c.req.json().catch(() => ({}));
  if (!timezone) return c.json({ error: 'timezone is required.' }, 400);
  await c.env.DB.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(String(timezone).slice(0, 64), u.id).run();
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

// ---------- full account export (GDPR) ----------
app.get('/api/me/export', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const user = await c.env.DB.prepare('SELECT id, email, role, username, timezone, buddy_opt_in FROM users WHERE id = ?').bind(u.id).first();
  if (!user) return c.json({ error: 'User not found.' }, 404);
  const subscription = (await c.env.DB.prepare('SELECT plan, status, started_at, renews_at FROM subscriptions WHERE user_id = ?').bind(u.id).first()) || null;
  const habitsRows = (await c.env.DB.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY id').bind(u.id).all()).results;
  const habits = [];
  for (const h of habitsRows) {
    const [checkins, urges, journals, dailyCheckins, badges] = await Promise.all([
      c.env.DB.prepare('SELECT date, status, note, forgiven FROM checkins WHERE habit_id = ? ORDER BY date').bind(h.id).all(),
      c.env.DB.prepare('SELECT logged_at, intensity, trigger, trigger_type, action, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at').bind(h.id).all(),
      c.env.DB.prepare('SELECT date, content FROM journals WHERE habit_id = ? ORDER BY date').bind(h.id).all(),
      c.env.DB.prepare('SELECT date, energy, sleep, mood FROM daily_checkins WHERE habit_id = ? ORDER BY date').bind(h.id).all(),
      c.env.DB.prepare('SELECT threshold, earned_date FROM badges WHERE habit_id = ? ORDER BY threshold').bind(h.id).all(),
    ]);
    habits.push({
      name: h.name,
      startDate: h.start_date,
      dailyCost: h.daily_cost,
      costUnit: h.cost_unit,
      dailyTime: h.daily_time,
      unitsPerDay: h.units_per_day,
      triggerTimes: parseTriggerTimes(h.trigger_times),
      reason: h.reason,
      relapsePlan: h.relapse_plan,
      checkins: checkins.results,
      urges: urges.results,
      journals: journals.results,
      dailyCheckins: dailyCheckins.results,
      badges: badges.results,
    });
  }
  const [posts, comments, reactions, follows, pushSubs] = await Promise.all([
    c.env.DB.prepare('SELECT id, content, habit_name, streak, badge, created_at FROM community_posts WHERE user_id = ? ORDER BY id').bind(u.id).all(),
    c.env.DB.prepare('SELECT id, post_id, content, created_at FROM community_comments WHERE user_id = ? ORDER BY id').bind(u.id).all(),
    c.env.DB.prepare('SELECT post_id, emoji, created_at FROM community_reactions WHERE user_id = ? ORDER BY post_id').bind(u.id).all(),
    c.env.DB.prepare('SELECT following_id, created_at FROM community_follows WHERE follower_id = ? ORDER BY following_id').bind(u.id).all(),
    c.env.DB.prepare('SELECT endpoint, last_seen FROM push_subscriptions WHERE user_id = ? ORDER BY id').bind(u.id).all(),
  ]);
  return c.json({
    exportedAt: new Date().toISOString(),
    profile: user,
    subscription,
    habits,
    community: {
      posts: posts.results,
      comments: comments.results,
      reactions: reactions.results,
      follows: follows.results,
    },
    pushSubscriptions: pushSubs.results,
  });
});

// ---------- account deletion (GDPR) ----------
app.delete('/api/me', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(u.id).first();
  if (!exists) return c.json({ error: 'User not found.' }, 404);
  // journals_fts has no FK to cascade — remove those rows explicitly first.
  const journalIds = (await c.env.DB.prepare(
    'SELECT j.id FROM journals j JOIN habits h ON h.id = j.habit_id WHERE h.user_id = ?'
  ).bind(u.id).all()).results;
  for (const j of journalIds) {
    await c.env.DB.prepare('DELETE FROM journals_fts WHERE rowid = ?').bind(j.id).run();
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id).run();
  return c.json({ ok: true });
});

// ---------- reports ----------
app.post('/api/premium/report', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const { habitId, month } = await c.req.json().catch(() => ({}));
  const habit = await habitOf(c.env, habitId, u.id);
  if (!habit) return c.json({ error: 'Habit not found.' }, 404);
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : todayKey().slice(0, 7);
  return c.json({ report: await buildReport(c.env, habit, m) });
});

app.post('/api/premium/recovery-plan', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
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
  const trials = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE plan = 'premium' AND status = 'trial'").first();
  const errors24h = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_errors WHERE created_at > datetime('now', '-24 hours')").first();
  const metaRows = {};
  for (const r of (await c.env.DB.prepare("SELECT key, value FROM meta WHERE key IN ('nudges_last_run','nudges_last_sent','nudges_sent')").all()).results) {
    metaRows[r.key] = r.value;
  }
  const nowMs = Date.now();
  const age = (iso) => {
    const ms = iso ? Date.parse(iso) : 0;
    return Number.isFinite(ms) && ms > 0 ? Math.round((nowMs - ms) / 3600000) : null;
  };
  const subsCount = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first())?.n || 0);
  const uptime = Math.round((Date.now() - c.env.STARTED_AT) / 1000) || 0;
  const runAge = age(metaRows.nudges_last_run);
  const nudgeHealthy = runAge != null && runAge <= 27;
  const today = new Date().toISOString().slice(0, 10);
  const todayCheckins = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM checkins WHERE date = ?').bind(today).first())?.n || 0);
  const todayUrges = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM urges WHERE date(logged_at) = ?').bind(today).first())?.n || 0);
  const yesterday = addDays(todayKey(), -1);
  const streakRiskUsers = (await c.env.DB.prepare(
    `SELECT u.id, u.email, h.name AS habit, h.start_date, COALESCE(c.streak_days, 0) AS streak_days
     FROM habits h
     JOIN users u ON u.id = h.user_id
     LEFT JOIN (
       SELECT habit_id, COUNT(*) AS streak_days
       FROM checkins
       WHERE status = 'clean' AND date >= ?
       GROUP BY habit_id
     ) c ON c.habit_id = h.id
     WHERE NOT EXISTS (SELECT 1 FROM checkins c2 WHERE c2.habit_id = h.id AND c2.date IN (?, ?))
     LIMIT 10`
  ).bind(addDays(today, -3), today, yesterday).all()).results;
  const journalToday = Number((await c.env.DB.prepare('SELECT COUNT(DISTINCT habit_id) AS n FROM journals WHERE date = ?').bind(today).first())?.n || 0);
  const cleanToday = Number((await c.env.DB.prepare('SELECT COUNT(DISTINCT habit_id) AS n FROM checkins WHERE date = ? AND status = ?').bind(today, 'clean').first())?.n || 0);
  const journalCorrelation = journalToday > 0 && cleanToday > 0 ? `${Math.round((journalToday / Math.max(1, cleanToday)) * 100)}% of today's clean check-ins also have a journal entry` : 'Not enough data yet';
  const communityPosts = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM community_posts').first())?.n || 0);
  const communityComments = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM community_comments').first())?.n || 0);
  const openReports = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM community_reports WHERE status = 'open'").first())?.n || 0);
  const resolvedReports = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM community_reports WHERE status = 'resolved'").first())?.n || 0);
  if (openReports > 0) {
    void sendWebhookAlert(c.env, 'open_reports', { count: openReports });
  }
  const errorTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(todayKey(), -i);
    const dayLabel = new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const count = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM app_errors WHERE date(created_at) = ?').bind(d).first())?.n || 0);
    errorTrend.push({ date: d, label: dayLabel, count });
  }
  const todayErrors = errorTrend[errorTrend.length - 1]?.count || 0;
  const avgErrors = errorTrend.length > 0 ? Math.round(errorTrend.reduce((s, t) => s + t.count, 0) / errorTrend.length) : 0;
  if (todayErrors >= 3 && avgErrors > 0 && todayErrors >= avgErrors * 3) {
    void sendWebhookAlert(c.env, 'error_spike', { todayErrors, avgErrors, multiplier: Math.round(todayErrors / avgErrors) });
  } else if (todayErrors >= 5 && avgErrors === 0) {
    void sendWebhookAlert(c.env, 'error_spike', { todayErrors, avgErrors: 0, multiplier: todayErrors });
  }
  const notifications = {
    lastRun: metaRows.nudges_last_run || null,
    lastSent: metaRows.nudges_last_sent || null,
    sentTotal: Number(metaRows.nudges_sent || 0),
    subs: subsCount,
    runAgeH: runAge,
    sentAgeH: age(metaRows.nudges_last_sent),
    healthy: nudgeHealthy,
  };
  const serverHealthy = nudgeHealthy && errors24h === 0;
  return c.json({
    uptime,
    startedAt: new Date(Date.now() - uptime * 1000).toISOString(),
    counts,
    premiumUsers: Number(premium?.n || 0),
    trialUsers: Number(trials?.n || 0),
    errors24h: Number(errors24h || 0),
    notifications,
    today: { checkins: todayCheckins, urges: todayUrges },
    community: { posts: communityPosts, comments: communityComments, openReports, resolvedReports },
    server: { healthy: serverHealthy, status: serverHealthy ? 'healthy' : 'degraded' },
    insights: {
      streakRisk: streakRiskUsers.length > 0 ? streakRiskUsers : null,
      streakRiskCount: streakRiskUsers.length,
      journalCorrelation,
    },
    errorTrend,
  });
});

app.get('/api/admin/errors', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const errors = (await c.env.DB.prepare('SELECT id, message, url, created_at FROM app_errors ORDER BY id DESC LIMIT 50').all()).results;
  const groups = new Map();
  for (const e of errors) {
    const key = e.message || 'Unknown';
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastAt = e.created_at;
    } else {
      groups.set(key, { message: key, url: e.url, count: 1, lastAt: e.created_at });
    }
  }
  return c.json({ errors, groups: [...groups.values()].sort((a, b) => b.count - a.count) });
});

app.post('/api/admin/clear-errors', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const olderThan = body.olderThan ? ` AND created_at < datetime('now', '-${Math.max(1, Number(body.olderThan) || 24)} hours')` : '';
  const res = await c.env.DB.prepare(`DELETE FROM app_errors WHERE 1=1${olderThan}`).run();
  if (res.changes > 0) {
    await c.env.DB.prepare('INSERT INTO admin_audit_log (admin_id, action, detail) VALUES (?, ?, ?)').bind(u.id, 'clear_errors', `Deleted ${res.changes} error(s)${olderThan ? ' older than ' + body.olderThan + 'h' : ''}`);
    const recentOpen = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM community_reports WHERE status = 'open'").first())?.n || 0);
    void sendWebhookAlert(c.env, 'errors_cleared', { deleted: res.changes, errors24h, openReports: recentOpen });
  }
  return c.json({ deleted: res.changes });
});

app.post('/api/admin/trigger-nudges', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const targetUserId = body.userId ? Number(body.userId) : null;
  if (targetUserId) {
    const user = await c.env.DB.prepare('SELECT id, notification_prefs, timezone FROM users WHERE id = ?').bind(targetUserId).first();
    if (!user) return c.json({ error: 'User not found.' }, 404);
    const habits = (await c.env.DB.prepare('SELECT id, name, trigger_times FROM habits WHERE user_id = ?').bind(targetUserId).all()).results;
    if (!habits.length) return c.json({ error: 'User has no habits to nudge about.' }, 400);
    const subs = (await c.env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(targetUserId).all()).results;
    if (!subs.length) return c.json({ error: 'User has no push subscriptions.' }, 400);
    const prefs = { ...DEFAULT_PREFS };
    if (user.notification_prefs) Object.assign(prefs, JSON.parse(user.notification_prefs));
    const best = habits[0];
    const stats = computeStats((await c.env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(best.id).all()).results, 0, 0, Number(best.units_per_day) || 0);
    const streakBit = stats.currentStreak > 0 ? ` You're ${stats.currentStreak} days in.` : '';
    const body_text = `Hey, it's been a while. Your habit "${best.name}" needs you.${streakBit} Open the app and check in now. 💪`;
    let sent = 0;
    for (const s of subs) {
      try {
        await sendPush(c.env, s, { title: 'BreakFree check-in', body: body_text, habitId: best.id, url: '/app?action=checkin' });
        sent += 1;
      } catch {
        // skip stale subscriptions
      }
    }
    await c.env.DB.prepare('INSERT INTO admin_audit_log (admin_id, action, detail) VALUES (?, ?, ?)').bind(u.id, 'trigger_nudge', `Sent ${sent} nudge(s) to user ${targetUserId} (${user.id})`);
    return c.json({ ok: true, sent, user: targetUserId });
  }
  const subs = (await c.env.DB.prepare('SELECT p.user_id, u.notification_prefs, u.timezone FROM push_subscriptions p JOIN users u ON u.id = p.user_id').all()).results;
  const seen = new Set();
  let totalSent = 0;
  for (const sub of subs) {
    if (seen.has(sub.user_id)) continue;
    seen.add(sub.user_id);
    const habits = (await c.env.DB.prepare('SELECT id, name FROM habits WHERE user_id = ?').bind(sub.user_id).all()).results;
    if (!habits.length) continue;
    const userSubs = (await c.env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(sub.user_id).all()).results;
    const prefs = { ...DEFAULT_PREFS };
    if (sub.notification_prefs) Object.assign(prefs, JSON.parse(sub.notification_prefs));
    if (prefs.dailyReminder === false) continue;
    const best = habits[0];
    const body_text = 'Hey, it\'s time for your check-in. One day at a time — you\'ve got this. 💪';
    let sent = 0;
    for (const s of userSubs) {
      try {
        await sendPush(c.env, s, { title: 'BreakFree check-in', body: body_text, habitId: best.id, url: '/app?action=checkin' });
        sent += 1;
      } catch {
        // skip
      }
    }
    totalSent += sent;
  }
  await c.env.DB.prepare('INSERT INTO admin_audit_log (admin_id, action, detail) VALUES (?, ?, ?)').bind(u.id, 'trigger_nudge', `Broadcast nudge to ${seen.size} user(s), ${totalSent} push(es) sent`);
  return c.json({ ok: true, users: seen.size, totalSent });
});

app.get('/api/admin/audit-log', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20));
  const rows = (await c.env.DB.prepare('SELECT al.id, al.action, al.detail, al.created_at, u.email AS admin_email FROM admin_audit_log al LEFT JOIN users u ON u.id = al.admin_id ORDER BY al.id DESC LIMIT ?').bind(limit).all()).results;
  return c.json({ entries: rows });
});

app.get('/api/admin/webhooks', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const rows = (await c.env.DB.prepare('SELECT id, url, label, events, active, created_at FROM admin_webhooks ORDER BY id DESC').all()).results;
  return c.json({ webhooks: rows });
});

app.post('/api/admin/webhooks', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const url = (body.url || '').trim();
  const label = (body.label || '').trim();
  const events = (body.events || 'server_degraded,open_reports').trim();
  if (!url || !/^https?:\/\//i.test(url)) return c.json({ error: 'A valid webhook URL is required (http:// or https://).' }, 400);
  const res = await c.env.DB.prepare('INSERT INTO admin_webhooks (url, label, events, active) VALUES (?, ?, ?, 1)').bind(url, label || 'Webhook', events).run();
  await c.env.DB.prepare('INSERT INTO admin_audit_log (admin_id, action, detail) VALUES (?, ?, ?)').bind(u.id, 'webhook_create', `Created webhook id=${res.meta.last_row_id} url=${url}`);
  return c.json({ ok: true, id: res.meta.last_row_id });
});

app.post('/api/admin/webhooks/:id/toggle', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT id, active FROM admin_webhooks WHERE id = ?').bind(id).first();
  if (!row) return c.json({ error: 'Webhook not found.' }, 404);
  const next = row.active ? 0 : 1;
  await c.env.DB.prepare('UPDATE admin_webhooks SET active = ? WHERE id = ?').bind(next, id);
  await c.env.DB.prepare('INSERT INTO admin_audit_log (admin_id, action, detail) VALUES (?, ?, ?)').bind(u.id, 'webhook_toggle', `Toggled webhook id=${id} active=${next}`);
  return c.json({ ok: true, active: next });
});

app.delete('/api/admin/webhooks/:id', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare('DELETE FROM admin_webhooks WHERE id = ?').bind(id).run();
  if (res.changes === 0) return c.json({ error: 'Webhook not found.' }, 404);
  await c.env.DB.prepare('INSERT INTO admin_audit_log (admin_id, action, detail) VALUES (?, ?, ?)').bind(u.id, 'webhook_delete', `Deleted webhook id=${id}`);
  return c.json({ ok: true });
});

app.get('/api/admin/metrics', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const since = c.req.query('since') || '7 days ago';
  const pushShown = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_events WHERE event_type = 'push_prompt_shown' AND created_at > datetime(?, 'localtime')").bind(since).first())?.n || 0);
  const pushDismissed = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_events WHERE event_type = 'push_prompt_dismissed' AND created_at > datetime(?, 'localtime')").bind(since).first())?.n || 0);
  const pushEnabled = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_events WHERE event_type = 'push_prompt_enabled' AND created_at > datetime(?, 'localtime')").bind(since).first())?.n || 0);
  const journalShown = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_events WHERE event_type = 'journal_prompt_shown' AND created_at > datetime(?, 'localtime')").bind(since).first())?.n || 0);
  const journalClicked = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_events WHERE event_type = 'journal_prompt_clicked' AND created_at > datetime(?, 'localtime')").bind(since).first())?.n || 0);
  const journalBadges = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM journal_badges WHERE earned_date > datetime(?, 'localtime')").bind(since).first())?.n || 0);
  const variantCounts = (await c.env.DB.prepare(`SELECT variant, COUNT(*) AS n FROM app_events WHERE event_type IN ('push_prompt_shown','push_prompt_dismissed','push_prompt_enabled') AND created_at > datetime(?, 'localtime') GROUP BY variant`).bind(since).all()).results;
  const variants = {};
  for (const v of variantCounts) { if (v.variant) variants[v.variant] = Number(v.n || 0); }
  const totalSubs = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first())?.n || 0);
  return c.json({
    since,
    push: { shown: pushShown, dismissed: pushDismissed, enabled: pushEnabled, optInRate: pushShown > 0 ? Math.round((pushEnabled / pushShown) * 100) : 0 },
    journal: { shown: journalShown, clicked: journalClicked, conversionRate: journalShown > 0 ? Math.round((journalClicked / journalShown) * 100) : 0, badgesEarned: journalBadges },
    totalPushSubs: totalSubs,
    abTest: variants,
  });
});

async function sendWebhookAlert(env, event, payload) {
  try {
    const rows = (await env.DB.prepare('SELECT id, url, events FROM admin_webhooks WHERE active = 1').all()).results;
    for (const w of rows) {
      const events = (w.events || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!events.includes(event)) continue;
      try {
        await fetch(w.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `[BreakFree ${event}] ${JSON.stringify(payload)}` }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        // swallow per-webhook failures — alerting must not break the request
      }
    }
  } catch {
    // ignore webhook dispatch errors
  }
}

app.post('/api/analytics/push', async (c) => {
  try {
    const u = userOf(c);
    const body = await c.req.json().catch(() => ({}));
    const event = (body.event || 'unknown').trim();
    const variant = (body.variant || '').trim() || null;
    if (u) await trackEvent(c.env, event, u.id, null, variant, null);
    else await trackEvent(c.env, event, null, null, variant, 'anonymous');
  } catch {
    // never block the user on analytics failures
  }
  return c.json({ ok: true });
});

app.post('/api/analytics/engagement', async (c) => {
  try {
    const u = userOf(c);
    const body = await c.req.json().catch(() => ({}));
    const event = (body.event || 'unknown').trim();
    if (u) await trackEvent(c.env, event, u.id, null, null, null);
    else await trackEvent(c.env, event, null, null, null, 'anonymous');
  } catch {
    // never block the user on analytics failures
  }
  return c.json({ ok: true });
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
  const today = todayKey();
  const sample = [
    { date: today, status: 'clean' },
    { date: addDays(today, -1), status: 'clean' },
    { date: addDays(today, -2), status: 'slip' },
    { date: addDays(today, -3), status: 'clean' },
    { date: addDays(today, -4), status: 'clean' },
  ];
  const s = computeStats(sample, 10, 1);
  const streakOk = s.currentStreak === 2 && s.longestStreak === 2 && s.totalSlips === 1 && s.totalClean === 4;
  checks.push({ name: 'Streak engine', ok: streakOk, detail: streakOk ? 'Correct: streak 2, longest 2' : `Mismatch: streak ${s.currentStreak}` });
  const aiCheck = await checkOpenAI(c.env);
  checks.push({ name: 'AI model (OpenAI)', ok: aiCheck.ok, detail: aiCheck.detail });
  const healthy = checks.every((x) => x.ok);
  if (!healthy) {
    const failed = checks.filter((x) => !x.ok).map((x) => x.name).join(', ');
    void sendWebhookAlert(c.env, 'ai_check_failed', { failedChecks: failed, summary: 'AI health check failed' });
  }
  return c.json({ healthy, checks, summary: healthy ? 'All checks passed.' : 'Some checks failed.', suggestions: [] });
});

app.post('/api/admin/grant-premium', async (c) => {
  const u = userOf(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  if (u.role !== 'admin') return c.json({ error: 'Admin access required.' }, 403);
  const { userId, days = 30 } = await c.req.json().catch(() => ({}));
  const targetId = Number(userId);
  if (!targetId) return c.json({ error: 'userId is required.' }, 400);
  const target = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'User not found.' }, 404);
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, renews_at)
     VALUES (?, 'premium', 'active', datetime('now'), datetime('now', ?))
     ON CONFLICT(user_id) DO UPDATE SET
       plan = 'premium',
       status = 'active',
       started_at = datetime('now'),
       renews_at = datetime('now', ?)`
  ).bind(targetId, `+${days} days`, `+${days} days`).run();
  const sub = await c.env.DB.prepare('SELECT plan, status, renews_at FROM subscriptions WHERE user_id = ?').bind(targetId).first();
  return c.json({ ok: true, user: { id: target.id, email: target.email }, subscription: sub });
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

// ---------- scheduled nudges (proactive push) ----------
// Trigger-window buckets: hour is the LOCAL hour a nudge should fire for that window.
const TRIGGER_BUCKETS = [
  { name: 'Morning', hour: 9 },
  { name: 'Midday', hour: 12 },
  { name: 'Afternoon', hour: 15 },
  { name: 'Evening', hour: 19 },
  { name: 'Late night', hour: 22 },
];

// Resolve the user's current local hour from either an IANA zone name (set by the
// client or IP inference) or a fixed "UTC±H" offset (backfilled best-guess).
function localHour(tz) {
  try {
    if (tz) {
      const m = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tz);
      if (m) {
        const offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) + (Number(m[3] || 0) / 60));
        return (new Date().getUTCHours() + offset + 48) % 24;
      }
    }
    if (tz) {
      const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date());
      const n = parseInt(s, 10);
      if (Number.isFinite(n)) return n === 24 ? 0 : n;
    }
  } catch {
    /* fall through */
  }
  return new Date().getUTCHours();
}

async function sendScheduledNudges(env) {
  const users = (
    await env.DB.prepare(
      'SELECT DISTINCT p.user_id AS user_id, u.notification_prefs, u.timezone FROM push_subscriptions p JOIN users u ON u.id = p.user_id'
    ).all()
  ).results;
  const utcHour = new Date().getUTCHours();
  const nowBucket = TRIGGER_BUCKETS.find((b) => b.hour === utcHour);
  let sent = 0;
  for (const user of users) {
    try {
      const prefs = { ...DEFAULT_PREFS };
      if (user.notification_prefs) Object.assign(prefs, JSON.parse(user.notification_prefs));
      const habits = (
        await env.DB.prepare('SELECT id, name, units_per_day, trigger_times FROM habits WHERE user_id = ?').bind(user.user_id).all()
      ).results;
      if (!habits.length) continue;
      const subs = (
        await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(user.user_id).all()
      ).results;

      const sendAll = async (payload) => {
        let ok = 0;
        const stale = [];
        for (const s of subs) {
          try {
            await sendPush(env, s, payload);
            ok += 1;
          } catch (e) {
            if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.endpoint);
          }
        }
        for (const endpoint of stale) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
        }
        return ok;
      };

      const lh = localHour(user.timezone);
      const today = todayKey();

      // Daily reminder in the user's morning window. A preferred reminderTime
      // (HH:MM, set in onboarding/settings) pins it to a specific local hour;
      // otherwise it fires anytime in the 7–10 local morning window.
      const rtHour = prefs.reminderTime ? Number(String(prefs.reminderTime).slice(0, 2)) : null;
      const reminderDue = rtHour != null && Number.isFinite(rtHour)
        ? lh === rtHour
        : lh >= 7 && lh <= 10;
      if (prefs.dailyReminder !== false && reminderDue) {
        const last = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(`daily_push_${user.user_id}`).first();
        if (String(last?.value || '') !== today) {
          const best = habits[0];
          const stats = computeStats(
            (await env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(best.id).all()).results,
            0,
            0,
            Number(best.units_per_day) || 0
          );
          const body =
            stats.currentStreak > 0
              ? `Day ${stats.currentStreak} on "${best.name}". One day at a time — you've got this. 💪`
              : 'Start the day with your "why". Reaffirm it now and stay one step ahead of the urges.';
          const ok = await sendAll({ title: 'BreakFree', body, habitId: best.id, url: '/app?action=checkin' });
          if (ok > 0) {
            await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
              .bind(`daily_push_${user.user_id}`, today)
              .run();
            sent += 1;
          }
        }
      }

      // Trigger-window nudge: fires during a bucket hour that matches the habit's trigger_times.
      if (prefs.triggerNudges !== false && nowBucket) {
        for (const habit of habits) {
          const times = parseTriggerTimes(habit.trigger_times);
          if (!times.includes(nowBucket.name)) continue;
          // Don't nag people who already engaged with this habit today.
          const checkinToday = await env.DB.prepare('SELECT id FROM checkins WHERE habit_id = ? AND date = ?').bind(habit.id, today).first();
          if (checkinToday) continue;
          const urgeToday = await env.DB.prepare('SELECT id FROM urges WHERE habit_id = ? AND logged_at LIKE ?').bind(habit.id, `${today}%`).first();
          if (urgeToday) continue;
          const dedupe = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(`trigger_push_${user.user_id}_${nowBucket.name}_${today}`).first();
          if (dedupe) continue;
          const stats = computeStats(
            (await env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results,
            0,
            0,
            Number(habit.units_per_day) || 0
          );
          const streakBit = stats.currentStreak > 0 ? ` You're ${stats.currentStreak} days in.` : '';
          const body = `It's your usual trigger window (${nowBucket.name}) for "${habit.name}".${streakBit} Log how you're feeling, then ride it out. 💪`;
          const ok = await sendAll({ title: 'Time to check in', body, habitId: habit.id, url: '/app?action=checkin' });
          if (ok > 0) {
            await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
              .bind(`trigger_push_${user.user_id}_${nowBucket.name}_${today}`, '1')
              .run();
            sent += 1;
          }
        }
      }

      if (prefs.milestones !== false) {
        for (const habit of habits) {
          const stats = computeStats(
            (await env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').bind(habit.id).all()).results,
            0,
            0,
            Number(habit.units_per_day) || 0
          );
          if (!BADGE_THRESHOLDS.includes(stats.currentStreak)) continue;
          const badge = await env.DB.prepare('SELECT id FROM badges WHERE habit_id = ? AND threshold = ?').bind(habit.id, stats.currentStreak).first();
          if (badge) continue;
          const ok = await sendAll({
            title: 'Milestone reached',
            body: `${stats.currentStreak} days clean on "${habit.name}" — look how far you've come. 🎉`,
            habitId: habit.id,
          });
          if (ok > 0) {
            await env.DB.prepare('INSERT INTO badges (habit_id, threshold, earned_date) VALUES (?, ?, ?) ON CONFLICT(habit_id, threshold) DO NOTHING')
              .bind(habit.id, stats.currentStreak, todayKey())
              .run();
            sent += 1;
          }
        }
      }
    } catch (e) {
      console.error('scheduled nudge failed for user', user.user_id, e.message);
    }
  }
  // Health tracking: lets the admin dashboard tell a working cron from a dead one.
  try {
    const nowStr = new Date().toISOString();
    if (sent > 0) {
      await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER)')
        .bind('nudges_sent', String(sent)).run();
      await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind('nudges_last_sent', nowStr).run();
    }
    await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('nudges_last_run', nowStr).run();
  } catch (e) {
    console.error('nudge health tracking failed:', e.message);
  }
  return sent;
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
  // Proactive push: daily reminder + missed milestone nudge, gated on prefs.
  async scheduled(event, env, ctx) {
    try {
      const sent = await sendScheduledNudges(env);
      const eng = await evaluateAllEngagement(env);
      console.log(`scheduled nudges: ${sent} sent; engagement: ${eng.cascade} cascade, ${eng.digest} digest`);
    } catch (e) {
      console.error('scheduled nudges failed:', e.message);
    }
  },
};