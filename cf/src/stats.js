export const BADGE_THRESHOLDS = [7, 14, 30, 60, 90, 180, 365];

export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey() {
  return dateKey(new Date());
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return dateKey(dt);
}

export function computeStats(checkins, dailyCost, dailyTime, unitsPerDay) {
  const status = new Map();
  const forgiven = new Set();
  for (const c of checkins) {
    status.set(c.date, c.status);
    if (c.forgiven) forgiven.add(c.date);
  }

  // A forgiven slip still happened (it counts as a slip) but doesn't break the
  // streak — a grace day, not a verdict.
  const isClean = (date) => {
    const s = status.get(date);
    if (s === 'clean') return true;
    if (s === 'slip' && forgiven.has(date)) return true;
    return false;
  };

  const today = todayKey();
  const yesterday = addDays(today, -1);

  let currentStreak = 0;
  let cursor = isClean(today) ? today : isClean(yesterday) ? yesterday : null;
  while (cursor) {
    if (isClean(cursor)) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }

  let longestStreak = 0;
  if (status.size > 0) {
    const keys = [...status.keys()].sort();
    const first = keys[0];
    const last = keys[keys.length - 1];
    let run = 0;
    let d = first;
    while (d <= last) {
      if (isClean(d)) {
        run += 1;
        if (run > longestStreak) longestStreak = run;
      } else {
        run = 0;
      }
      d = addDays(d, 1);
    }
  }

  let totalClean = 0;
  let totalSlips = 0;
  let forgivenSlips = 0;
  for (const [date, s] of status.entries()) {
    if (s === 'clean') totalClean += 1;
    else {
      totalSlips += 1;
      if (forgiven.has(date)) forgivenSlips += 1;
    }
  }

  // Rolling window: effective clean days out of the last 14 calendar days.
  let recentClean = 0;
  for (let i = 0; i < 14; i++) {
    if (isClean(addDays(today, -i))) recentClean += 1;
  }

  const todayStatus = status.get(today) || null;
  const todayForgiven = forgiven.has(today);

  return {
    currentStreak,
    longestStreak,
    totalDays: totalClean + totalSlips,
    totalClean,
    totalSlips,
    forgivenSlips,
    recentClean,
    moneySaved: dailyCost ? +(currentStreak * dailyCost).toFixed(2) : 0,
    timeSaved: dailyTime ? +(currentStreak * dailyTime).toFixed(1) : 0,
    unitsAvoided: unitsPerDay && unitsPerDay > 0 ? Math.round(unitsPerDay * totalClean) : 0,
    todayStatus,
    todayForgiven,
  };
}
