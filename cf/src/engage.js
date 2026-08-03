// Re-engagement cascade + weekly Sunday digest.
//
// Runs opportunistically on authenticated requests (fire-and-forget via
// waitUntil) and from the scheduled handler. Every send is de-duplicated in
// engagement_events so nothing fires twice. Email is only sent when the user
// has opted in (emailOptIn); push is the fallback channel.

import { todayKey, addDays } from './stats.js';
import { sendPush } from './push.js';
import { sendEmail } from './mail.js';

const DAY_MS = 86400000;

export function diffDays(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((da - db) / DAY_MS);
}

export function isoWeek(today) {
  const d = new Date(`${today}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = d.getTime();
  d.setUTCMonth(0, 1);
  if (d.getUTCDay() !== 4) d.setUTCMonth(0, 1 + ((4 - d.getUTCDay()) + 7) % 7);
  const week = 1 + Math.round((firstThursday - d.getTime()) / (7 * DAY_MS));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Local weekday (0=Sunday..6) from the user's stored timezone, UTC fallback.
function localWeekday(tz) {
  try {
    if (tz) {
      const m = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tz);
      if (m) {
        const offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) + (Number(m[3] || 0) / 60));
        return (new Date().getUTCDay() + offset / 24 + 7) % 7;
      }
    }
    if (tz) {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
        .format(new Date())
        .toLowerCase()
        .startsWith('sun') ? 0 : 1;
    }
  } catch { /* fall through */ }
  return new Date().getUTCDay();
}

export async function prefsForUser(env, userId) {
  const user = await env.DB.prepare('SELECT notification_prefs FROM users WHERE id = ?').bind(userId).first();
  const base = { emailOptIn: false, digestOptIn: true, reEngageOptIn: true };
  if (user?.notification_prefs) {
    try { Object.assign(base, JSON.parse(user.notification_prefs)); } catch { /* keep defaults */ }
  }
  return base;
}

async function userRow(env, userId) {
  return env.DB.prepare('SELECT email, timezone, notification_prefs FROM users WHERE id = ?').bind(userId).first();
}

async function userSubs(env, userId) {
  return (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(userId).all()).results;
}

async function sendPushAll(env, subs, payloadObj) {
  let ok = 0;
  const stale = [];
  for (const s of subs) {
    try {
      await sendPush(env, s, payloadObj);
      ok += 1;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.endpoint);
    }
  }
  for (const endpoint of stale) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  }
  return ok;
}

async function hasEvent(env, userId, kind) {
  const row = await env.DB.prepare('SELECT id FROM engagement_events WHERE user_id = ? AND kind = ?').bind(userId, kind).first();
  return !!row;
}

async function markEvent(env, userId, kind) {
  await env.DB.prepare('INSERT OR IGNORE INTO engagement_events (user_id, kind) VALUES (?, ?)').bind(userId, kind).run();
}

// ---------- Cascade ----------

const CASCADE = [
  {
    kind: 'cascade_1',
    at: 1,
    push: (h) => ({
      title: 'BreakFree',
      body: `One quiet day from you on "${h.name}". A 10-second check-in keeps the streak alive. 🌿`,
      habitId: h.id,
      url: '/app?action=checkin',
    }),
  },
  {
    kind: 'cascade_2',
    at: 2,
    push: (h) => ({
      title: 'BreakFree',
      body: `We miss you. Your streak is safe — come log today and keep it moving. 💪`,
      habitId: h.id,
      url: '/app?action=checkin',
    }),
  },
  {
    kind: 'cascade_3',
    at: 3,
    email: true,
    push: (h) => ({
      title: 'BreakFree',
      body: `It's been a few days on "${h.name}". Remember why you started — one clean day gets you back on track.`,
      habitId: h.id,
      url: '/app?action=checkin',
    }),
  },
  {
    kind: 'cascade_7',
    at: 7,
    push: () => ({
      title: 'Your quit buddy is wondering',
      body: `Your quit buddy hasn't heard from you in a week — say hi in Community. 🫶`,
      habitId: null,
      url: '/app/community',
    }),
  },
];

async function sendCascadeEmail(env, user, habit, missed) {
  const reason = habit.reason ? `You told us why you're doing this: "${habit.reason}".` : '';
  const plan = habit.relapse_plan ? `And your plan for a rough moment is: "${habit.relapse_plan}".` : '';
  return sendEmail(env, {
    to: user.email,
    subject: `It's been a few days — we're still here for you`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17171A">
        <p style="font-size:18px;line-height:1.5">Hey,</p>
        <p style="font-size:16px;line-height:1.6">It's been a few days since your last check-in on <strong>${habit.name}</strong>. No pressure and no guilt — this is just us checking that you're okay.</p>
        <p style="font-size:16px;line-height:1.6">${reason ? `${reason} ` : ''}${plan ? `${plan} ` : ''}Your streak is safe, and one clean day is all it takes to be back on track.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="https://breakfree.breakfree-app.workers.dev/app?action=checkin" style="background:#E50914;color:#fff;padding:14px 26px;border-radius:14px;text-decoration:none;font-weight:bold">Check in now</a>
        </p>
        <p style="font-size:13px;color:#666">You can turn off these emails anytime in Settings → Notifications. We only email you for the things you ask for.</p>
      </div>`,
  });
}

// ---------- Digest ----------

async function buildDigest(env, habit, today) {
  const weekAgo = addDays(today, -7);
  const cleanRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE habit_id = ? AND date > ? AND status = 'clean'").bind(habit.id, weekAgo).first();
  const clean = Number(cleanRow?.n || 0);
  const urges = (await env.DB.prepare('SELECT trigger_type FROM urges WHERE habit_id = ? AND logged_at > ?').bind(habit.id, `${weekAgo}T00:00:00`).all()).results;
  if (clean === 0 && urges.length === 0) return null;

  const counts = {};
  for (const u of urges) {
    const t = u.trigger_type || 'other';
    counts[t] = (counts[t] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const topLabel = {
    stress: 'stress', boredom: 'boredom', social: 'social situations',
    emotional: 'tough emotions', place: 'place or routine', habit: 'around the habit', other: 'other',
  }[top?.[0]] || null;
  const moneySaved = +(clean * (Number(habit.daily_cost) || 0)).toFixed(2);
  const moneyLine = moneySaved > 0 ? ` · £${moneySaved} saved this week` : '';

  return { clean, urges: urges.length, topLabel, topCount: top?.[1] || 0, moneySaved, weekAgo, habitName: habit.name };
}

// ---------- Main evaluation ----------

export async function evaluateUserEngagement(env, userId) {
  const user = await userRow(env, userId);
  if (!user) return { cascade: 0, digest: false };
  const prefs = { emailOptIn: false, digestOptIn: true, reEngageOptIn: true };
  if (user.notification_prefs) {
    try { Object.assign(prefs, JSON.parse(user.notification_prefs)); } catch { /* defaults */ }
  }
  const habits = (await env.DB.prepare('SELECT id, name, reason, relapse_plan, daily_cost FROM habits WHERE user_id = ?').bind(userId).all()).results;
  if (!habits.length) return { cascade: 0, digest: false };

  const today = todayKey();

  // Latest check-in across all habits (the "main" habit to talk about).
  let lastDate = null;
  let mainHabit = null;
  for (const h of habits) {
    const row = await env.DB.prepare('SELECT MAX(date) AS last_date FROM checkins WHERE habit_id = ?').bind(h.id).first();
    if (row?.last_date && (!lastDate || row.last_date > lastDate)) {
      lastDate = row.last_date;
      mainHabit = h;
    }
  }
  if (!mainHabit) mainHabit = habits[0];

  let cascade = 0;
  const missed = lastDate ? diffDays(today, lastDate) : 0;

  if (prefs.reEngageOptIn !== false && missed >= 1) {
    const subs = await userSubs(env, userId);
    for (const step of CASCADE) {
      if (missed < step.at) continue;
      const kind = step.kind;
      if (await hasEvent(env, userId, kind)) continue;
      if (step.email) {
        if (prefs.emailOptIn) {
          try {
            await sendCascadeEmail(env, user, mainHabit, missed);
            await markEvent(env, userId, kind);
            cascade += 1;
          } catch (e) {
            console.error('cascade_3 email failed:', e.message);
          }
        } else if (subs.length > 0) {
          const ok = await sendPushAll(env, subs, step.push(mainHabit));
          if (ok > 0) {
            await markEvent(env, userId, kind);
            cascade += 1;
          }
        }
      } else {
        if (subs.length > 0) {
          const ok = await sendPushAll(env, subs, step.push(mainHabit));
          if (ok > 0) {
            await markEvent(env, userId, kind);
            cascade += 1;
          }
        }
      }
    }
  }

  // Weekly Sunday digest.
  let digest = false;
  if (prefs.digestOptIn !== false && localWeekday(user.timezone) === 0) {
    const kind = `digest_${today}`;
    if (!(await hasEvent(env, userId, kind))) {
      const summary = await buildDigest(env, mainHabit, today);
      if (summary) {
        const subs = await userSubs(env, userId);
        const pushLine = `${summary.clean} clean days this week${moneyLine(summary)} · ${summary.urges} urge${summary.urges === 1 ? '' : 's'} logged${summary.topLabel ? ` · top trigger: ${summary.topLabel}` : ''}. See your full summary.`;
        let delivered = false;
        if (subs.length > 0) {
          const ok = await sendPushAll(env, subs, {
            title: 'Your Sunday summary',
            body: pushLine,
            habitId: mainHabit.id,
            url: '/app/stats',
          });
          delivered = ok > 0;
        }
        if (prefs.emailOptIn) {
          try {
            await sendDigestEmail(env, user, summary);
            delivered = true;
          } catch (e) {
            console.error('digest email failed:', e.message);
          }
        }
        if (delivered) {
          await markEvent(env, userId, kind);
          digest = true;
        }
      }
    }
  }

  return { cascade, digest };
}

function moneyLine(summary) {
  return summary.moneySaved > 0 ? `, £${summary.moneySaved} saved` : '';
}

async function sendDigestEmail(env, user, summary) {
  return sendEmail(env, {
    to: user.email,
    subject: `Your Sunday summary for ${summary.habitName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17171A">
        <p style="font-size:18px;line-height:1.5">Your week on <strong>${summary.habitName}</strong></p>
        <ul style="font-size:16px;line-height:1.8;padding-left:20px">
          <li>${summary.clean} clean day${summary.clean === 1 ? '' : 's'} this week${moneyLine(summary)}</li>
          <li>${summary.urges} urge${summary.urges === 1 ? '' : 's'} logged${summary.topLabel ? ` — your top trigger: ${summary.topLabel}` : ''}</li>
        </ul>
        <p style="font-size:16px;line-height:1.6">Every day you show up quietly rewires a habit. The trend is what matters, not the perfect streak.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="https://breakfree.breakfree-app.workers.dev/app/stats" style="background:#E50914;color:#fff;padding:14px 26px;border-radius:14px;text-decoration:none;font-weight:bold">Open your stats</a>
        </p>
        <p style="font-size:13px;color:#666">Weekly summary, straight from your own data. Turn it off in Settings → Notifications.</p>
      </div>`,
  });
}

export async function evaluateAllEngagement(env) {
  const rows = (await env.DB.prepare('SELECT DISTINCT user_id FROM habits').all()).results;
  let cascade = 0;
  let digest = 0;
  for (const r of rows) {
    try {
      const res = await evaluateUserEngagement(env, r.user_id);
      cascade += res.cascade;
      digest += res.digest ? 1 : 0;
    } catch (e) {
      console.error('engagement failed for user', r.user_id, e.message);
    }
  }
  return { cascade, digest };
}
