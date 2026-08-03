// Premium features for Workers: monthly report + recovery plan (D1-backed).

import { todayKey } from './stats.js';

function pick(arr, seed = 0) {
  return arr[Math.abs(seed) % arr.length];
}

function mode(values) {
  const counts = new Map();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return bestN > 0 ? { value: best, n: bestN } : null;
}

function hourBucket(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  return h < 5 ? 'early hours (12am–5am)'
    : h < 9 ? 'morning (5am–9am)'
      : h < 12 ? 'late morning (9am–12pm)'
        : h < 15 ? 'midday (12pm–3pm)'
          : h < 18 ? 'afternoon (3pm–6pm)'
            : h < 21 ? 'evening (6pm–9pm)'
              : 'night (9pm–12am)';
}

export async function buildReport(env, habit, month) {
  const prefix = `${month}-`;
  const checkins = (await env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ? AND date LIKE ? ORDER BY date').bind(habit.id, `${prefix}%`).all()).results;
  const urges = (await env.DB.prepare('SELECT intensity, trigger, resisted, logged_at FROM urges WHERE habit_id = ? AND logged_at LIKE ?').bind(habit.id, `${prefix}%`).all()).results;
  const jc = await env.DB.prepare('SELECT COUNT(*) AS c FROM journals WHERE habit_id = ? AND date LIKE ?').bind(habit.id, `${prefix}%`).first();
  const journalCount = jc?.c || 0;

  const clean = checkins.filter((c) => c.status === 'clean');
  const slips = checkins.filter((c) => c.status === 'slip');
  const totalDays = checkins.length;
  const cleanPct = totalDays ? Math.round((clean.length / totalDays) * 100) : 0;

  let longestRun = 0;
  let run = 0;
  let prev = null;
  for (const c of checkins) {
    if (c.status === 'clean') {
      run += 1;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
    prev = c.date;
  }
  const currentStreak = run > 0 && prev === checkins[checkins.length - 1]?.date ? run : 0;

  const moneySaved = habit.daily_cost ? +(clean.length * habit.daily_cost).toFixed(2) : 0;
  const timeSaved = habit.daily_time ? +(clean.length * habit.daily_time).toFixed(1) : 0;

  const resisted = urges.filter((u) => u.resisted).length;
  const resistedPct = urges.length ? Math.round((resisted / urges.length) * 100) : null;
  const avgIntensity = urges.length
    ? +(urges.reduce((s, u) => s + u.intensity, 0) / urges.length).toFixed(1)
    : null;

  const peak = {};
  for (const u of urges) {
    const b = hourBucket(u.logged_at);
    peak[b] = (peak[b] || 0) + 1;
  }
  const peakPeriod = Object.entries(peak).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const triggers = urges.map((u) => u.trigger).filter(Boolean);
  const topTrigger = mode(triggers);

  const headline =
    cleanPct >= 90
      ? pick(['A month to be proud of', 'Nearly flawless — look at you', 'You dominated this month'])
      : cleanPct >= 70
        ? pick(['Solid, steady progress', 'A strong month with room to grow', 'You held the line'])
        : cleanPct >= 40
          ? pick(['A month of honest work', 'Ups and downs, but you kept showing up', 'Progress is still progress'])
          : pick(['A hard month — and you stayed', 'Every comeback starts here', 'The month taught you a lot']);

  const summaryParts = [
    `This month you logged ${totalDays} ${totalDays === 1 ? 'day' : 'days'} — ${clean.length} clean and ${slips.length} ${slips.length === 1 ? 'slip' : 'slips'} (${cleanPct}% clean).`,
  ];
  if (longestRun >= 5) summaryParts.push(`Your best run was ${longestRun} clean ${longestRun === 1 ? 'day' : 'days'} in a row — proof of what's possible.`);
  if (moneySaved > 0) summaryParts.push(`That saved you about £${moneySaved.toLocaleString()} in habit costs.`);
  if (timeSaved > 0) summaryParts.push(`And won back roughly ${timeSaved} hours.`);
  if (urges.length) summaryParts.push(`You logged ${urges.length} urges and resisted ${resistedPct}% of them.`);
  if (journalCount) summaryParts.push(`You wrote ${journalCount} journal ${journalCount === 1 ? 'entry' : 'entries'} — good thinking fuel.`);

  const patterns = [];
  if (topTrigger) patterns.push(`"${topTrigger.value}" was your most frequent trigger (${topTrigger.n}×). Plan a small ritual for when it appears — even a 10-minute delay changes the game.`);
  if (peakPeriod) patterns.push(`Urges clustered in the ${peakPeriod}. Keep a ready distraction in that window — a walk, water, or a call to a friend.`);
  if (avgIntensity != null) patterns.push(avgIntensity >= 3.5
    ? `Average urge intensity was ${avgIntensity}/5 — on the intense side. Catching them early matters most.`
    : `Average urge intensity was ${avgIntensity}/5 — manageable if you notice them before they build.`);
  if (slips.length === 0 && totalDays > 0) patterns.push(`Zero slips this month. Whatever you're doing now — routine, environment, support — it's working.`);
  if (slips.length > 0) patterns.push(`You slipped ${slips.length} ${slips.length === 1 ? 'time' : 'times'}. Each one is intel: look back at those days in your journal to find the pattern.`);
  if (!patterns.length) patterns.push('Not enough data yet — keep checking in daily and next month\'s report will have real insight.');

  return {
    month,
    headline,
    summary: summaryParts.join(' '),
    stats: {
      totalDays,
      cleanDays: clean.length,
      slipDays: slips.length,
      cleanPct,
      currentStreak,
      longestRun,
      moneySaved,
      timeSaved,
      urgeCount: urges.length,
      resistedPct,
      avgIntensity,
      peakPeriod,
      topTrigger: topTrigger?.value || null,
      journalCount,
    },
    patterns,
  };
}

export async function buildRecoveryPlan(env, habit) {
  const checkins = (await env.DB.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ? ORDER BY date DESC LIMIT 14').bind(habit.id).all()).results;
  const recentSlip = checkins.find((c) => c.status === 'slip')?.date || null;
  const urges = (await env.DB.prepare('SELECT trigger, resisted FROM urges WHERE habit_id = ? ORDER BY logged_at DESC LIMIT 20').bind(habit.id).all()).results;
  const topTrigger = mode(urges.map((u) => u.trigger));
  const t = topTrigger ? ` Watch especially for "${topTrigger.value}" — it's your most common trigger.` : '';

  return {
    title: 'Back on track, gently',
    intro: `A slip is a data point, not a verdict. Here's a simple 3-day plan to rebuild momentum${recentSlip ? ` after ${recentSlip}` : ''}.${t}`,
    days: [
      {
        day: 'Day 1 — Reset',
        actions: [
          'Start the morning with a 5-minute check-in: what are you glad you did yesterday?',
          'Remove one easy temptation from your environment (move it, delete it, hide it).',
          'Commit to one small clean win — even a single clean evening counts.',
          'Write 3 lines in your journal about what the slip taught you.',
        ],
      },
      {
        day: 'Day 2 — Protect',
        actions: [
          'Scan your day for the moment the urge usually hits, and pre-plan a replacement (walk, shower, call).',
          'Tell one person your plan for today — accountability softens the urge.',
          'Log any urge the moment you feel it, even if you resist.',
        ],
      },
      {
        day: 'Day 3 — Rebuild',
        actions: [
          'Move your body for 20 minutes — endorphins are your ally.',
          'Review your streak history: you have clean days to build on, not lose.',
          'Plan tomorrow\'s first win before bed so the day starts decisively.',
        ],
      },
    ],
  };
}