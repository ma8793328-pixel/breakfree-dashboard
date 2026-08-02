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

export function isPremium(userId) {
  const row = planRow(userId);
  return row.plan === 'premium' && row.status === 'active';
}

export function publicSubscription(userId) {
  const row = planRow(userId);
  const active = row.plan === 'premium' && row.status === 'active';
  return {
    plan: row.plan,
    status: row.status,
    active,
    habitLimit: active ? Infinity : FREE_HABIT_LIMIT,
    startedAt: row.started_at,
    renewsAt: row.renews_at,
  };
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
  db.prepare(
    'INSERT INTO subscriptions (user_id, plan, status, started_at, renews_at) VALUES (?, ?, ?, datetime(\'now\'), datetime(\'now\', ?)) ON CONFLICT(user_id) DO UPDATE SET plan = ?, status = ?, started_at = datetime(\'now\'), renews_at = datetime(\'now\', ?)'
  ).run(userId, 'premium', 'active', `+${BILLING_DAYS} days`, 'premium', 'active', `+${BILLING_DAYS} days`);
  return { ok: true };
}

export function cancelSubscription(userId) {
  db.prepare(
    "UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND plan = 'premium'"
  ).run(userId);
}

function cryptoRandomId() {
  return randomUUID();
}
