// Web Push notifications — VAPID keys are generated once and persisted so
// restarts don't invalidate existing browser subscriptions.
import webpush from 'web-push';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAPID_FILE = process.env.VAPID_FILE || path.join(DATA_DIR, 'vapid.json');
const VAPID_SUBJECT = 'mailto:coach@breakfree.app';

export const DEFAULT_PREFS = { dailyReminder: true, urgeTips: true, milestones: true };

export function prefsFor(user) {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(user?.notification_prefs || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function userPrefs(userId) {
  const user = db.prepare('SELECT notification_prefs FROM users WHERE id = ?').get(userId);
  return prefsFor(user);
}

export function loadVapidKeys() {
  // Env vars win (see .env.example) — used for production deploys.
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic || envPrivate) {
    if (!envPublic || !envPrivate) {
      throw new Error(
        'Both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in server/.env (found only one). Generate a pair with `npx web-push generate-vapid-keys`.'
      );
    }
    const pub = Buffer.from(envPublic.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const priv = Buffer.from(envPrivate.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (pub.length !== 65 || priv.length !== 32) {
      throw new Error(
        'VAPID keys in server/.env are invalid (public key must decode to 65 bytes, private to 32). Generate a pair with `npx web-push generate-vapid-keys`, or remove the VAPID_* lines to use the keys persisted in server/data/vapid.json.'
      );
    }
    return { publicKey: envPublic.trim(), privateKey: envPrivate.trim() };
  }
  if (existsSync(VAPID_FILE)) {
    const saved = JSON.parse(readFileSync(VAPID_FILE, 'utf8'));
    return saved;
  }
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(path.dirname(VAPID_FILE), { recursive: true });
  writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf8');
  return keys;
}

export function registerPushRoutes(app, { requireAuth }) {
  const vapid = loadVapidKeys();
  webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

  app.get('/api/push/vapid', (req, res) => {
    res.json({ publicKey: vapid.publicKey });
  });

  app.post('/api/push/subscribe', requireAuth, (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'endpoint and keys are required.' });
    }
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         last_seen = datetime('now')`
    ).run(req.user.id, String(endpoint), String(keys.p256dh), String(keys.auth));
    res.json({ ok: true });
  });

  app.delete('/api/push/subscribe', requireAuth, (req, res) => {
    const { endpoint } = req.body || {};
    if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    res.json({ ok: true });
  });

  app.post('/api/push/test', requireAuth, async (req, res) => {
    const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(req.user.id);
    let sent = 0;
    let failed = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: 'BreakFree', body: 'Test notification — low-sleep alerts are armed.', habitId: null })
        );
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    res.json({ ok: true, sent, failed, total: subs.length });
  });
}

// Fire-and-forget: called after a daily check-in saves a low sleep score.
export async function notifyLowSleep(userId, habitId, sleepScore) {
  if (!sleepScore || sleepScore >= 3) return;
  if (!userPrefs(userId).dailyReminder) return;
  await sendToUser(userId, {
    title: 'BreakFree',
    body: `Rough sleep (${sleepScore}/5)? Take it easy today — your resistance might be lower.`,
    habitId,
  });
}

// Fire-and-forget: a quick coping tip after an urge is logged.
export async function notifyUrgeTip(userId, habitId) {
  if (!userPrefs(userId).urgeTips) return;
  await sendToUser(userId, {
    title: 'BreakFree',
    body: `Urge logged. Pause 10 minutes and change your scene — it usually fades.`,
    habitId,
  });
}

// Fire-and-forget: celebrate a freshly earned milestone badge.
export async function notifyMilestone(userId, habitId, threshold) {
  if (!userPrefs(userId).milestones) return;
  await sendToUser(userId, {
    title: 'BreakFree',
    body: `${threshold} days clean — milestone reached. Look how far you've come. 🎉`,
    habitId,
  });
}

async function sendToUser(userId, payloadObj) {
  const subs = db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId);
  if (subs.length === 0) return;
  const payload = JSON.stringify(payloadObj);
  const stale = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) stale.push(s.endpoint);
    }
  }
  for (const endpoint of stale) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
}

// Sweep subscriptions that haven't been seen in 90 days (devices abandoned
// or browsers that silently dropped them). Run on boot and periodically.
export function cleanupStaleSubscriptions() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const removed = db
    .prepare(
      `DELETE FROM push_subscriptions
       WHERE (last_seen IS NOT NULL AND last_seen < ?)
          OR (last_seen IS NULL AND created_at < ?)`
    )
    .run(cutoff, cutoff);
  if (removed.changes > 0) {
    console.log(`Cleaned up ${removed.changes} stale push subscription${removed.changes === 1 ? '' : 's'}.`);
  }
  return removed.changes;
}
