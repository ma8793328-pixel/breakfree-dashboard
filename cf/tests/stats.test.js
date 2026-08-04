import { describe, it, expect, vi, afterEach } from 'vitest';
import { dateKey, todayKey, addDays, computeStats, BADGE_THRESHOLDS, urgeTrend } from '../src/stats.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('date helpers', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    expect(dateKey(new Date(2026, 7, 4))).toBe('2026-08-04');
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('todayKey returns today in local time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4));
    expect(todayKey()).toBe('2026-08-04');
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-08-04', 1)).toBe('2026-08-05');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-08-04', -4)).toBe('2026-07-31');
  });
});

describe('BADGE_THRESHOLDS', () => {
  it('is the day-based threshold ladder', () => {
    expect(BADGE_THRESHOLDS).toEqual([7, 14, 30, 60, 90, 180, 365]);
  });
});

describe('computeStats', () => {
  it('computes current and longest streak from clean days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4)); // today 2026-08-04
    const checkins = [
      { date: '2026-08-04', status: 'clean' },
      { date: '2026-08-03', status: 'clean' },
      { date: '2026-08-02', status: 'clean' },
    ];
    const s = computeStats(checkins, 5, 0.5, 20);
    expect(s.currentStreak).toBe(3);
    expect(s.longestStreak).toBe(3);
    expect(s.totalClean).toBe(3);
    expect(s.totalSlips).toBe(0);
    expect(s.moneySaved).toBe(15);
    expect(s.timeSaved).toBe(1.5);
    expect(s.unitsAvoided).toBe(60);
  });

  it('breaks the streak on an unforgiven slip', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4));
    const checkins = [
      { date: '2026-08-04', status: 'clean' },
      { date: '2026-08-03', status: 'slip' },
      { date: '2026-08-02', status: 'clean' },
      { date: '2026-08-01', status: 'clean' },
    ];
    const s = computeStats(checkins, 0, 0, 0);
    expect(s.currentStreak).toBe(1);
    expect(s.longestStreak).toBe(2);
    expect(s.totalSlips).toBe(1);
  });

  it('treats a forgiven slip as clean for streaks but still a slip in totals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4));
    const checkins = [
      { date: '2026-08-04', status: 'clean' },
      { date: '2026-08-03', status: 'slip', forgiven: true },
      { date: '2026-08-02', status: 'clean' },
    ];
    const s = computeStats(checkins, 0, 0, 0);
    expect(s.currentStreak).toBe(3);
    expect(s.totalSlips).toBe(1);
    expect(s.forgivenSlips).toBe(1);
    expect(s.totalClean).toBe(2);
  });

  it('counts recentClean across the last 14 calendar days only', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4));
    const old = { date: '2026-07-01', status: 'clean' };
    const recent = { date: '2026-08-04', status: 'clean' };
    const s = computeStats([old, recent], 0, 0, 0);
    expect(s.recentClean).toBe(1);
  });
});

describe('urgeTrend', () => {
  it('defaults to a 14-day window and clamps invalid days', () => {
    expect(urgeTrend([], undefined, '2026-08-06').days).toBe(14);
    expect(urgeTrend([], 99, '2026-08-06').days).toBe(14);
    expect(urgeTrend([], '30', '2026-08-06').days).toBe(30);
    expect(urgeTrend([], 7, '2026-08-06').days).toBe(7);
  });

  it('groups only days with at least one urge, in ascending order', () => {
    const urges = [
      { logged_at: '2026-08-03T09:00:00Z', intensity: 2, resisted: 1 },
      { logged_at: '2026-08-01T10:00:00Z', intensity: 4, resisted: 1 },
      { logged_at: '2026-08-03T12:00:00Z', intensity: 3, resisted: 0 },
    ];
    const r = urgeTrend(urges, 14, '2026-08-06');
    expect(r.series.map((p) => p.date)).toEqual(['2026-08-01', '2026-08-03']);
    expect(r.series[0].count).toBe(1);
    expect(r.series[1].count).toBe(2);
    expect(r.series[1].avgIntensity).toBe(2.5);
    expect(r.series[1].resistedCount).toBe(1);
  });

  it('excludes urges outside the window and invalid dates', () => {
    const urges = [
      { logged_at: '2026-07-01T10:00:00Z', intensity: 1, resisted: 1 },
      { logged_at: 'not-a-date', intensity: 1, resisted: 1 },
      { logged_at: '2026-08-05T10:00:00Z', intensity: 1, resisted: 1 },
    ];
    const r = urgeTrend(urges, 7, '2026-08-06');
    expect(r.series).toHaveLength(1);
    expect(r.series[0].date).toBe('2026-08-05');
  });

  it('returns null changePct and trend for fewer than two days of data', () => {
    const r = urgeTrend([{ logged_at: '2026-08-05T10:00:00Z', intensity: 1, resisted: 1 }], 14, '2026-08-06');
    expect(r.changePct).toBeNull();
    expect(r.trend).toBeNull();
    expect(r.series).toHaveLength(1);
  });

  it('reports positive changePct when the last half has fewer urges than the first', () => {
    const urges = [
      { logged_at: '2026-08-01T10:00:00Z', intensity: 1, resisted: 1 },
      { logged_at: '2026-08-01T12:00:00Z', intensity: 1, resisted: 1 },
      { logged_at: '2026-08-03T10:00:00Z', intensity: 1, resisted: 1 },
      { logged_at: '2026-08-05T10:00:00Z', intensity: 1, resisted: 1 },
      { logged_at: '2026-08-06T10:00:00Z', intensity: 1, resisted: 1 },
    ];
    const r = urgeTrend(urges, 14, '2026-08-06');
    expect(r.changePct).toBeGreaterThan(0);
    expect(r.trend).toBe('improving');
  });

  it('classifies a rising slope as worsening', () => {
    const urges = [];
    const counts = [1, 1, 2, 2, 3, 4];
    counts.forEach((n, day) => {
      for (let i = 0; i < n; i++) {
        urges.push({ logged_at: `2026-08-0${day + 1}T10:${i}0:00Z`, intensity: 1, resisted: 1 });
      }
    });
    const r = urgeTrend(urges, 14, '2026-08-06');
    expect(r.trend).toBe('worsening');
  });

  it('classifies a flat series as stable', () => {
    const urges = [1, 2, 3, 4].map((day) => ({
      logged_at: `2026-08-0${day}T10:00:00Z`,
      intensity: 1,
      resisted: 1,
    }));
    const r = urgeTrend(urges, 14, '2026-08-06');
    expect(r.trend).toBe('stable');
  });
});
