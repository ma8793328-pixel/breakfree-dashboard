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

const TREND_DAYS = [7, 14, 30];

export function urgeTrend(urges, days = 14, today = todayKey()) {
  const span = TREND_DAYS.includes(Number(days)) ? Number(days) : 14;
  const start = addDays(today, -(span - 1));
  const byDay = new Map();
  for (const u of urges || []) {
    const date = String(u.logged_at || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < start) continue;
    const rec = byDay.get(date) || { date, count: 0, intensitySum: 0, resisted: 0 };
    rec.count += 1;
    rec.intensitySum += Number(u.intensity) || 0;
    if (u.resisted) rec.resisted += 1;
    byDay.set(date, rec);
  }
  const series = [...byDay.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      date: r.date,
      count: r.count,
      avgIntensity: +(r.intensitySum / r.count).toFixed(1),
      resistedCount: r.resisted,
    }));

  let changePct = null;
  if (series.length >= 2) {
    const mid = Math.ceil(series.length / 2);
    const firstAvg = series.slice(0, mid).reduce((s, p) => s + p.count, 0) / mid;
    const lastAvg = series.slice(mid).reduce((s, p) => s + p.count, 0) / Math.max(series.length - mid, 1);
    if (firstAvg > 0) changePct = +(((firstAvg - lastAvg) / firstAvg) * 100).toFixed(1);
  }

  let trend = null;
  if (series.length >= 2) {
    const n = series.length;
    const meanX = (n - 1) / 2;
    const meanY = series.reduce((s, p) => s + p.count, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (series[i].count - meanY);
      den += (i - meanX) * (i - meanX);
    }
    const slope = den === 0 ? 0 : num / den;
    if (slope < -0.1) trend = 'improving';
    else if (slope > 0.1) trend = 'worsening';
    else trend = 'stable';
  }

  return { days: span, changePct, trend, series };
}
