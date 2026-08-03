// Re-engagement cascade + weekly Sunday digest (Node parity of cf/src/engage.js).
// Uses the local better-sqlite3 db and the exported push helper; every send is
// de-duplicated in engagement_events. Email requires user consent (emailOptIn).

import { db } from './db.js';
import { todayKey, addDays } from './stats.js';
import { sendPushToUser } from './push.js';
import { sendEmail } from './mail.js';

const DAY_MS = 86400000;

export function diffDays(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db2 = Date.parse(`${b}T00:00:00Z`);
  return Math.round((da - db2) / DAY_MS);
}

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

function prefsForUser(userId) {
  const user = db.prepare('SELECT notification_prefs FROM users WHERE id = ?').get(userId);
  const base = { emailOptIn: false, digestOptIn: true, reEngageOptIn: true };
  if (user?.notification_prefs) {
    try { Object.assign(base, JSON.parse(user.notification_prefs)); } catch { /* keep defaults */ }
  }
  return base;
}

function hasEvent(userId, kind) {
  return !!db.prepare('SELECT id FROM engagement_events WHERE user_id = ? AND kind = ?').get(userId, kind);
}

function markEvent(userId, kind) {
  db.prepare('INSERT OR IGNORE INTO engagement_events (user_id, kind) VALUES (?, ?)').run(userId, kind);
}

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
    push: () => ({
      title: 'BreakFree',
      body: `We miss you. Your streak is safe — come log today and keep it moving. 💪`,
      habitId: null,
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

function sendCascadeEmail(user, habit) {
  const reason = habit.reason ? `You told us why you're doing this: "${habit.reason}".` : '';
  const plan = habit.relapse_plan ? `And your plan for a rough moment is: "${habit.relapse_plan}".` : '';
  return sendEmail({
    to: user.email,
    subject: `It's been a few days — we're still here for you`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17171A">
        <p style="font-size:18px;line-height:1.5">Hey,</p>
        <p style="font-size:16px;line-height:1.6">It's been a few days since your last check-in on <strong>${habit.name}</strong>. No pressure and no guilt — this is just us checking that you're okay.</p>
        <p style="font-size:16px;line-height:1.6">${reason ? `${reason} ` : ''}${plan ? `${plan} ` : ''}Your streak is safe, and one clean day is all it takes to be back on track.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="/app?action=checkin" style="background:#E50914;color:#fff;padding:14px 26px;border-radius:14px;text-decoration:none;font-weight:bold">Check in now</a>
        </p>
        <p style="font-size:13px;color:#666">You can turn off these emails anytime in Settings → Notifications.</p>
      </div>`,
  });
}

function buildDigest(habit, today) {
  const weekAgo = addDays(today, -7);
  const clean = db.prepare("SELECT COUNT(*) AS n FROM checkins WHERE habit_id = ? AND date > ? AND status = 'clean'").get(habit.id, weekAgo).n;
  const urges = db.prepare('SELECT trigger_type FROM urges WHERE habit_id = ? AND logged_at > ?').all(habit.id, `${weekAgo}T00:00:00`);
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
  return { clean, urges: urges.length, topLabel, topCount: top?.[1] || 0, moneySaved, weekAgo, habitName: habit.name };
}

function moneyLine(summary) {
  return summary.moneySaved > 0 ? `, £${summary.moneySaved} saved` : '';
}

function sendDigestEmail(user, summary) {
  return sendEmail({
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
          <a href="/app/stats" style="background:#E50914;color:#fff;padding:14px 26px;border-radius:14px;text-decoration:none;font-weight:bold">Open your stats</a>
        </p>
        <p style="font-size:13px;color:#666">Weekly summary, straight from your own data. Turn it off in Settings → Notifications.</p>
      </div>`,
  });
}

export async function evaluateUserEngagement(userId) {
  const user = db.prepare('SELECT id, email, timezone, notification_prefs FROM users WHERE id = ?').get(userId);
  if (!user) return { cascade: 0, digest: false };
  const prefs = prefsForUser(userId);
  const habits = db.prepare('SELECT id, name, reason, relapse_plan, daily_cost FROM habits WHERE user_id = ?').all(userId);
  if (!habits.length) return { cascade: 0, digest: false };

  const today = todayKey();
  let lastDate = null;
  let mainHabit = null;
  for (const h of habits) {
    const row = db.prepare('SELECT MAX(date) AS last_date FROM checkins WHERE habit_id = ?').get(h.id);
    if (row?.last_date && (!lastDate || row.last_date > lastDate)) {
      lastDate = row.last_date;
      mainHabit = h;
    }
  }
  if (!mainHabit) mainHabit = habits[0];

  let cascade = 0;
  const missed = lastDate ? diffDays(today, lastDate) : 0;

  if (prefs.reEngageOptIn !== false && missed >= 1) {
    for (const step of CASCADE) {
      if (missed < step.at) continue;
      const kind = step.kind;
      if (hasEvent(userId, kind)) continue;
      if (step.email) {
        if (prefs.emailOptIn) {
          try {
            await sendCascadeEmail(user, mainHabit);
            markEvent(userId, kind);
            cascade += 1;
          } catch (e) {
            console.error('cascade_3 email failed:', e.message);
          }
        } else {
          const ok = await sendPushToUser(userId, step.push(mainHabit));
          if (ok > 0) {
            markEvent(userId, kind);
            cascade += 1;
          }
        }
      } else {
        const ok = await sendPushToUser(userId, step.push(mainHabit));
        if (ok > 0) {
          markEvent(userId, kind);
          cascade += 1;
        }
      }
    }
  }

  let digest = false;
  if (prefs.digestOptIn !== false && localWeekday(user.timezone) === 0) {
    const kind = `digest_${today}`;
    if (!hasEvent(userId, kind)) {
      const summary = buildDigest(mainHabit, today);
      if (summary) {
        const pushLine = `${summary.clean} clean days this week${moneyLine(summary)} · ${summary.urges} urge${summary.urges === 1 ? '' : 's'} logged${summary.topLabel ? ` · top trigger: ${summary.topLabel}` : ''}. See your full summary.`;
        let delivered = false;
        const ok = await sendPushToUser(userId, {
          title: 'Your Sunday summary',
          body: pushLine,
          habitId: mainHabit.id,
          url: '/app/stats',
        });
        if (ok > 0) delivered = true;
        if (prefs.emailOptIn) {
          try {
            await sendDigestEmail(user, summary);
            delivered = true;
          } catch (e) {
            console.error('digest email failed:', e.message);
          }
        }
        if (delivered) {
          markEvent(userId, kind);
          digest = true;
        }
      }
    }
  }

  return { cascade, digest };
}

export async function evaluateAllEngagement() {
  const rows = db.prepare('SELECT DISTINCT user_id FROM habits').all();
  let cascade = 0;
  let digest = 0;
  for (const r of rows) {
    try {
      const res = await evaluateUserEngagement(r.user_id);
      cascade += res.cascade;
      digest += res.digest ? 1 : 0;
    } catch (e) {
      console.error('engagement failed for user', r.user_id, e.message);
    }
  }
  return { cascade, digest };
}
