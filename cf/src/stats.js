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

export function computeStats(checkins, dailyCost, dailyTime) {
  const status = new Map();
  for (const c of checkins) status.set(c.date, c.status);

  const today = todayKey();
  const yesterday = addDays(today, -1);

  let currentStreak = 0;
  let cursor = status.get(today) === 'clean'
    ? today
    : status.get(yesterday) === 'clean'
      ? yesterday
      : null;
  while (cursor) {
    if (status.get(cursor) === 'clean') {
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
      if (status.get(d) === 'clean') {
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
  for (const s of status.values()) {
    if (s === 'clean') totalClean += 1;
    else totalSlips += 1;
  }

  const todayStatus = status.get(today) || null;

  return {
    currentStreak,
    longestStreak,
    totalDays: totalClean + totalSlips,
    totalClean,
    totalSlips,
    moneySaved: dailyCost ? +(currentStreak * dailyCost).toFixed(2) : 0,
    timeSaved: dailyTime ? +(currentStreak * dailyTime).toFixed(1) : 0,
    todayStatus,
  };
}
