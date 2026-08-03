import { db } from './db.js';
import { computeStats, BADGE_THRESHOLDS, todayKey, addDays } from './stats.js';
import { checkHealth as checkOpenAI } from './openai.js';
import { activateSubscription } from './billing.js';

const PORT = process.env.PORT || 4000;

function count(sql, ...args) {
  const r = db.prepare(sql).get(...args);
  return r.c ? r.c : r.n ? r.n : 0;
}

// The admin AI: runs a set of diagnostic checks and writes a plain-language
// health report with suggested fixes. No external API — it inspects the app's
// own internals so it can verify the streak engine, data integrity, and uptime.
export async function runHealthCheck() {
  const checks = [];

  // 1. Database connectivity
  {
    const t0 = Date.now();
    try {
      db.prepare('SELECT 1 AS ok').get();
      checks.push({ name: 'Database', ok: true, detail: `Query OK in ${Date.now() - t0}ms` });
    } catch (e) {
      checks.push({ name: 'Database', ok: false, detail: String(e.message) });
    }
  }

  // 2. Table integrity — each record must point at a real owner
  {
    const orphans = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM checkins c LEFT JOIN habits h ON c.habit_id = h.id WHERE h.id IS NULL) +
                (SELECT COUNT(*) FROM urges u LEFT JOIN habits h ON u.habit_id = h.id WHERE h.id IS NULL) +
                (SELECT COUNT(*) FROM journals j LEFT JOIN habits h ON j.habit_id = h.id WHERE h.id IS NULL) +
                (SELECT COUNT(*) FROM badges b LEFT JOIN habits h ON b.habit_id = h.id WHERE h.id IS NULL) +
                (SELECT COUNT(*) FROM habits h LEFT JOIN users u ON h.user_id = u.id WHERE u.id IS NULL) AS n`
      )
      .get().n;
    checks.push({
      name: 'Data integrity',
      ok: orphans === 0,
      detail: orphans === 0 ? 'No orphaned records found' : `${orphans} orphaned record(s) point at missing habits/users`,
    });
  }

  // 3. Streak engine sanity (synthetic data, expected result)
  {
    const today = todayKey();
    const sample = [
      { date: today, status: 'clean' },
      { date: addDays(today, -1), status: 'clean' },
      { date: addDays(today, -2), status: 'slip' },
      { date: addDays(today, -3), status: 'clean' },
      { date: addDays(today, -4), status: 'clean' },
    ];
    const s = computeStats(sample, 10, 1);
    const ok = s.currentStreak === 2 && s.longestStreak === 2 && s.totalSlips === 1 && s.totalClean === 4;
    checks.push({
      name: 'Streak engine',
      ok,
      detail: ok
        ? `Correct: streak ${s.currentStreak}, longest ${s.longestStreak}`
        : `Mismatch: got streak ${s.currentStreak}, longest ${s.longestStreak} (expected 2/2)`,
    });
  }

  // 4. Badge thresholds integrity
  {
    const bad = count(`SELECT COUNT(*) AS c FROM badges WHERE threshold NOT IN (${BADGE_THRESHOLDS.join(',')})`);
    checks.push({
      name: 'Badges',
      ok: bad === 0,
      detail: bad === 0 ? 'All badge thresholds are valid' : `${bad} badge(s) have invalid thresholds`,
    });
  }

  // 5. Subscriptions — active but past renewal (would flag a missing renewal job)
  {
    const overdue = count(
      `SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active' AND renews_at IS NOT NULL AND renews_at < datetime('now')`
    );
    checks.push({
      name: 'Subscriptions',
      ok: overdue === 0,
      detail: overdue === 0 ? 'No overdue active subscriptions' : `${overdue} active subscription(s) past renewal date`,
    });
  }

  // 6. Recent errors
  {
    const recent = count(`SELECT COUNT(*) AS c FROM app_errors WHERE created_at > datetime('now', '-24 hours')`);
    checks.push({
      name: 'Errors (24h)',
      ok: recent === 0,
      detail: recent === 0 ? 'No errors logged in the last 24 hours' : `${recent} error(s) logged in the last 24 hours`,
    });
  }

  // 7. API self-check
  {
    const t0 = Date.now();
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(5000) });
      const ok = res.ok;
      const body = await res.json().catch(() => ({}));
      checks.push({
        name: 'API health endpoint',
        ok,
        detail: ok ? `Responded in ${Date.now() - t0}ms, uptime ${Math.round(body.uptime ?? 0)}s` : `HTTP ${res.status}`,
      });
    } catch {
      checks.push({ name: 'API health endpoint', ok: false, detail: 'Unreachable — is the server itself up?' });
    }
  }

  // 8. AI model health (OpenAI)
  {
    const ai = await checkOpenAI();
    checks.push({ name: 'AI model (OpenAI)', ok: ai.ok, detail: ai.detail });
  }

  const healthy = checks.every((c) => c.ok);
  const failing = checks.filter((c) => !c.ok);

  const summary = healthy
    ? 'All systems nominal. The database, streak engine, badges, subscriptions, error log and API are all healthy — nothing needs attention right now.'
    : `Found ${failing.length} thing${failing.length === 1 ? '' : 's'} needing attention. ${failing
        .map((f) => f.name)
        .join(', ')}.`;

  const suggestions = failing.map((f) => {
    switch (f.name) {
      case 'Database':
        return 'Restart the server and check disk space / DB file permissions in server/data.';
      case 'Data integrity':
        return 'Delete the orphaned records (or restore the last backup) — run a cleanup query on the affected tables.';
      case 'Streak engine':
        return 'Streak math regressed — review server/stats.js computeStats before shipping.';
      case 'Badges':
        return 'Invalid badge thresholds found — align them with the 7/14/30/60/90/180/365 milestone list.';
      case 'Subscriptions':
        return 'A renewal job isn\'t expiring overdue subscriptions — check billing/checkout flows.';
      case 'Errors (24h)':
        return 'Recent errors were logged — check the errors list below and the server console for stack traces.';
      case 'API health endpoint':
        return 'The API health route is unreachable — verify the server process and port.';
      default:
        return 'Investigate the failing check above.';
    }
  });

  return { healthy, checks, summary, suggestions };
}

export function registerAdminRoutes(app, { requireAuth, requireAdmin }) {
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), time: new Date().toISOString() });
  });

  app.get('/api/admin/status', requireAuth, requireAdmin, (req, res) => {
    const tables = ['users', 'habits', 'checkins', 'urges', 'journals', 'badges', 'subscriptions', 'app_errors'];
    const counts = {};
    for (const t of tables) counts[t] = count(`SELECT COUNT(*) AS c FROM ${t}`);
    const premium = count(`SELECT COUNT(*) AS c FROM subscriptions WHERE plan = 'premium' AND status = 'active'`);
    const errors24h = count(`SELECT COUNT(*) AS c FROM app_errors WHERE created_at > datetime('now', '-24 hours')`);
    const metaRows = {};
    for (const r of db.prepare("SELECT key, value FROM meta WHERE key IN ('nudges_last_run','nudges_last_sent','nudges_sent')").all()) {
      metaRows[r.key] = r.value;
    }
    const nowMs = Date.now();
    const age = (iso) => {
      const ms = iso ? Date.parse(iso) : 0;
      return Number.isFinite(ms) && ms > 0 ? Math.round((nowMs - ms) / 3600000) : null;
    };
    const runAge = age(metaRows.nudges_last_run);
    const subs = count('SELECT COUNT(*) AS c FROM push_subscriptions');
    res.json({
      uptime: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      counts,
      premiumUsers: premium,
      errors24h,
      notifications: {
        lastRun: metaRows.nudges_last_run || null,
        lastSent: metaRows.nudges_last_sent || null,
        sentTotal: Number(metaRows.nudges_sent || 0),
        subs,
        runAgeH: runAge,
        sentAgeH: age(metaRows.nudges_last_sent),
        healthy: runAge != null && runAge <= 27,
      },
    });
  });

  app.get('/api/admin/errors', requireAuth, requireAdmin, (req, res) => {
    const errors = db
      .prepare('SELECT id, message, url, created_at FROM app_errors ORDER BY id DESC LIMIT 50')
      .all();
    res.json({ errors });
  });

  app.post('/api/admin/ai-check', requireAuth, requireAdmin, async (req, res) => {
    try {
      res.json(await runHealthCheck());
    } catch (e) {
      res.status(500).json({ healthy: false, summary: String(e.message), checks: [], suggestions: [] });
    }
  });

  app.post('/api/admin/grant-premium', requireAuth, requireAdmin, async (req, res) => {
    const { userId, days = 30 } = req.body || {};
    const targetId = Number(userId);
    if (!targetId) return res.status(400).json({ error: 'userId is required.' });
    const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    activateSubscription(targetId);
    const sub = db.prepare('SELECT plan, status, renews_at FROM subscriptions WHERE user_id = ?').get(targetId);
    res.json({ ok: true, user: { id: target.id, email: target.email }, subscription: sub });
  });
}
