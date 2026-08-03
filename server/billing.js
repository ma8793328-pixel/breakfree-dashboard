import { randomUUID } from 'node:crypto';
import { db } from './db.js';

// Plan constants
export const PRICE_CENTS = 499; // $4.99/mo
export const FREE_HABIT_LIMIT = 1;
export const TRIAL_DAYS = 7;
export const BILLING_DAYS = 30;

export function planRow(userId) {
  return (
    db
      .prepare('SELECT plan, status, started_at, renews_at FROM subscriptions WHERE user_id = ?')
      .get(userId) || { plan: 'free', status: 'free', started_at: null, renews_at: null }
  );
}

export function isPremium(userId, user) {
  if (user && user.role === 'admin') return true;
  const row = planRow(userId);
  if (row.plan !== 'premium') return false;
  if (row.status === 'active') return true;
  if (row.status === 'trial') {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return Boolean(row.renews_at && row.renews_at > now);
  }
  return false;
}

export function publicSubscription(userId) {
  const row = planRow(userId);
  const active = isPremium(userId);
  return {
    plan: row.plan,
    status: row.status,
    active,
    trial: row.status === 'trial' && active,
    habitLimit: active ? Infinity : FREE_HABIT_LIMIT,
    startedAt: row.started_at,
    renewsAt: row.renews_at,
  };
}

// Grant a one-time free trial to a brand-new account. Never touches an
// already-active or already-trialling subscription.
export function startTrial(userId) {
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, renews_at)
     VALUES (?, 'premium', 'trial', datetime('now'), datetime('now', ?))
     ON CONFLICT(user_id) DO UPDATE SET
       plan = 'premium',
       status = 'trial',
       started_at = datetime('now'),
       renews_at = datetime('now', ?)
     WHERE status = 'free' OR status = 'cancelled' OR plan = 'free'`
  ).run(userId, `+${TRIAL_DAYS} days`, `+${TRIAL_DAYS} days`);
}

export function createCheckoutSession(userId) {
  const sessionId = cryptoRandomId();
  const token = cryptoRandomId();
  db.prepare(
    'INSERT OR REPLACE INTO checkout_sessions (id, user_id, price_cents, status, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).run(sessionId, userId, PRICE_CENTS, 'pending');
  return { id: sessionId, token, priceCents: PRICE_CENTS, currency: 'usd' };
}

export function completeCheckout(userId, sessionId) {
  if (!sessionId || !String(sessionId).trim()) {
    return { ok: false, error: 'Missing session ID.' };
  }
  const session = db
    .prepare('SELECT * FROM checkout_sessions WHERE id = ? AND user_id = ?')
    .get(String(sessionId).trim(), userId);
  if (!session) return { ok: false, error: 'Checkout session not found.' };
  if (session.status !== 'pending') return { ok: false, error: 'Checkout session is not pending.' };

  db.prepare('UPDATE checkout_sessions SET status = ?, completed_at = datetime(\'now\') WHERE id = ?').run(
    'completed',
    session.id
  );
  activateSubscription(userId);
  return { ok: true };
}

// Grant Premium and record the Stripe customer/subscription for later cancel.
export function activateSubscription(userId, stripe = {}) {
  const customerId = stripe.customer || null;
  const subId = stripe.subscription || null;
  db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, renews_at, stripe_customer_id, stripe_subscription_id)
     VALUES (?, 'premium', 'active', datetime('now'), datetime('now', ?), ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       plan = 'premium',
       status = 'active',
       started_at = datetime('now'),
       renews_at = datetime('now', ?),
       stripe_customer_id = coalesce(?, stripe_customer_id),
       stripe_subscription_id = coalesce(?, stripe_subscription_id)`
  ).run(userId, `+${BILLING_DAYS} days`, customerId, subId, `+${BILLING_DAYS} days`, customerId, subId);
}

export function cancelSubscription(userId) {
  db.prepare(
    "UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND plan = 'premium'"
  ).run(userId);
}

function cryptoRandomId() {
  return randomUUID();
}
