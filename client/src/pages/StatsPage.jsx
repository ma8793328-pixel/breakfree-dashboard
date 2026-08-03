import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useHabitDetail } from '../useHabitDetail.js';
import Badge from '../components/Badge.jsx';
import TrendChart from '../chartUtil.jsx';
import { correlationInsights } from '../aiCoach.js';
import { MILESTONES, recoveryTimeline, unitLabel } from '../data.js';

function timeBucket(hour) {
  if (hour >= 5 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 14) return 'Midday';
  if (hour >= 14 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

const BUCKET_LABELS = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Night'];
const BUCKET_HOURS = { Morning: 5, Midday: 11, Afternoon: 14, Evening: 17, Night: 21 };

function formatTimeLabel(hour) {
  if (hour === 5) return '5 am';
  if (hour === 11) return '11 am';
  if (hour === 14) return '2 pm';
  if (hour === 17) return '5 pm';
  if (hour === 21) return '9 pm';
  return `${hour}:00`;
}

function urgeHeatmapData(urges) {
  const counts = {};
  for (const u of urges || []) {
    const d = new Date(u.logged_at);
    const b = timeBucket(d.getHours());
    counts[b] = (counts[b] || 0) + 1;
  }
  return BUCKET_LABELS.map((label) => ({ label, count: counts[label] || 0 }));
}

function TriggerHeatmap({ urges }) {
  const data = urgeHeatmapData(urges);
  const max = Math.max(...data.map((d) => d.count), 1);
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);

  return (
    <>
      <p className="card-title">🔥 Urge heatmap</p>
      <p className="muted small" style={{ marginBottom: 14 }}>
        When do urges hit hardest? Based on your logged history.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((d) => {
          const pct = Math.round((d.count / max) * 100);
          const isPeak = d === peak && d.count >= 2;
          return (
            <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="meta" style={{ width: 72, textAlign: 'right', flexShrink: 0 }}>
                {formatTimeLabel(BUCKET_HOURS[d.label])}
              </span>
              <div style={{ flex: 1, height: 28, background: 'var(--bg-soft)', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: isPeak
                      ? 'linear-gradient(90deg, var(--accent), var(--accent-strong))'
                      : 'var(--border)',
                    borderRadius: 8,
                    transition: 'width 0.4s ease',
                    minWidth: d.count > 0 ? 24 : 0,
                  }}
                />
                <span
                  className="small"
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: isPeak ? 'var(--cream)' : 'var(--muted)',
                    fontWeight: isPeak ? 600 : 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d.label}
                  {isPeak && ' · peak'}
                </span>
              </div>
              <span className="meta" style={{ width: 20, textAlign: 'right' }}>{d.count}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

const STRIPE_SAGE = '#A8C09A';
const STRIPE_SLIP = '#C97B63';
const STRIPE_MUTED = 'rgba(255,255,255,0.08)';
const STRIPE_MUTED_2 = '#85858C';

function dayKey(d) {
  return new Date(d + 'T00:00:00');
}

function StreakChart({ checkins }) {
  if (!checkins || checkins.length === 0) {
    return <p className="muted small">No streak data yet.</p>;
  }

  const sorted = [...checkins].sort((a, b) => a.date.localeCompare(b.date));
  let streak = 0;
  const pts = sorted.map((c) => {
    if (c.status === 'clean') streak++;
    else streak = 0;
    return { date: c.date, streak };
  });

  const maxStreak = Math.max(...pts.map((p) => p.streak), 1);
  const W = 320;
  const H = 120;
  const PAD_X = 8;
  const PAD_Y = 16;

  const step = pts.length > 1 ? (W - PAD_X * 2) / (pts.length - 1) : 0;
  const points = pts
    .map((p, i) => {
      const x = PAD_X + i * step;
      const y = PAD_Y + (H - PAD_Y * 2) * (1 - p.streak / maxStreak);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Streak history">
        {[1, 2, 3, 4, 5].map((v) => {
          const y = PAD_Y + (H - PAD_Y * 2) * (1 - (v / 5) * (maxStreak > 0 ? 1 : 0));
          return (
            <line
              key={v}
              x1={PAD_X}
              x2={W - PAD_X}
              y1={y}
              y2={y}
              stroke={STRIPE_MUTED}
              strokeWidth="1"
            />
          );
        })}
        <polyline points={points} fill="none" stroke="#E50914" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={PAD_X + i * step}
            cy={PAD_Y + (H - PAD_Y * 2) * (1 - p.streak / maxStreak)}
            r="3"
            fill="#0B0B0D"
            stroke={p.streak > 0 ? '#E50914' : STRIPE_MUTED_2}
            strokeWidth="1.5"
          />
        ))}
      </svg>
      <div className="muted small" style={{ marginTop: 6 }}>
        {pts.length > 0 && `Longest run in period: ${maxStreak} day${maxStreak !== 1 ? 's' : ''}`}
      </div>
    </div>
  );
}

function UrgeFrequencyChart({ urges }) {
  if (!urges || urges.length === 0) {
    return <p className="muted small">No urges logged yet.</p>;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const counts = {};
  for (const d of days) counts[d] = 0;
  for (const u of urges) {
    const d = String(u.logged_at || '').slice(0, 10);
    if (counts[d] !== undefined) counts[d]++;
  }

  const vals = Object.values(counts);
  const maxVal = Math.max(...vals, 1);

  const W = 320;
  const H = 120;
  const PAD_X = 6;
  const PAD_Y = 12;
  const barGap = 2;
  const n = days.length;
  const barW = (W - PAD_X * 2 - barGap * (n - 1)) / n;

  const dayLabels = days.map((d) => {
    const dt = dayKey(d);
    return dt.toLocaleDateString(undefined, { weekday: 'short' }).charAt(0);
  });

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Urge frequency last 14 days">
        {[1, 2, 3, 4, 5].map((v) => (
          <line
            key={v}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_Y + (H - PAD_Y * 2) * (1 - (v / 5) * (maxVal > 0 ? 1 : 0))}
            y2={PAD_Y + (H - PAD_Y * 2) * (1 - (v / 5) * (maxVal > 0 ? 1 : 0))}
            stroke={STRIPE_MUTED}
            strokeWidth="1"
          />
        ))}
        {days.map((d, i) => {
          const h = maxVal > 0 ? (counts[d] / maxVal) * (H - PAD_Y * 2) : 0;
          const x = PAD_X + i * (barW + barGap);
          const y = H - PAD_Y - h;
          const isToday = d === today.toISOString().slice(0, 10);
          return (
            <g key={d}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx="3"
                fill={isToday ? '#E50914' : '#9B59B6'}
                opacity={counts[d] === 0 ? 0.35 : 0.85}
              />
              {i % 2 === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - 2}
                  textAnchor="middle"
                  fill={STRIPE_MUTED_2}
                  fontSize="8"
                  fontFamily="system-ui"
                >
                  {dayLabels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="muted small" style={{ marginTop: 6 }}>
        Total urges in period: {vals.reduce((a, b) => a + b, 0)}
      </div>
    </div>
  );
}

function HeatmapCalendar({ checkins }) {
  if (!checkins || checkins.length === 0) {
    return <p className="muted small">No check-in history yet.</p>;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const statusMap = {};
  for (const c of checkins) {
    statusMap[c.date] = c.status;
  }

  const COLORS = {
    clean: STRIPE_SAGE,
    slip: STRIPE_SLIP,
    none: '#2A2A2E',
  };

  const CELL = 30;
  const GAP = 4;

  const cols = 7;
  const rows = Math.ceil(days.length / 7);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} style={{ width: CELL, textAlign: 'center', fontSize: 10, color: STRIPE_MUTED_2, fontWeight: 700 }}>
            {d}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${cols * (CELL + GAP)} ${rows * (CELL + GAP)}`} role="img" aria-label="30-day heatmap calendar">
        {days.map((d, i) => {
          const col = i % 7;
          const row = Math.floor(i / 7);
          const x = col * (CELL + GAP);
          const y = row * (CELL + GAP);
          const status = statusMap[d] || 'none';
          const isToday = d === today.toISOString().slice(0, 10);
          return (
            <rect
              key={d}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx="4"
              fill={COLORS[status]}
              stroke={isToday ? '#FFFFFF' : 'transparent'}
              strokeWidth={isToday ? 1.5 : 0}
            />
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Clean', color: COLORS.clean },
          { label: 'Slip', color: COLORS.slip },
          { label: 'No data', color: COLORS.none },
        ].map((item) => (
          <span key={item.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: STRIPE_MUTED_2 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: item.color, display: 'inline-block' }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatDate(key) {
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekDigest(checkins, urges, active) {
  const week = (checkins || []).slice(-7);
  if (week.length === 0) return null;
  const sums = { energy: 0, sleep: 0, mood: 0 };
  for (const c of week) {
    sums.energy += c.energy;
    sums.sleep += c.sleep;
    sums.mood += c.mood;
  }
  const n = week.length;
  const avgs = {
    energy: sums.energy / n,
    sleep: sums.sleep / n,
    mood: sums.mood / n,
  };

  const prev = (checkins || []).slice(-14, -7);
  const trend = {};
  for (const k of ['energy', 'sleep', 'mood']) {
    if (prev.length >= 3) {
      const pa = prev.reduce((s, c) => s + c[k], 0) / prev.length;
      const d = avgs[k] - pa;
      trend[k] = d >= 0.3 ? '↑' : d <= -0.3 ? '↓' : '→';
    } else {
      trend[k] = null;
    }
  }

  const weekStart = week[0].date;
  const weekUrges = (urges || []).filter((u) => String(u.logged_at || '').slice(0, 10) >= weekStart).length;
  const weekClean = (active?.checkins || []).filter((c) => c.date >= weekStart && c.status === 'clean').length;

  const prevStart = prev[0]?.date;
  const lastWeekClean =
    prevStart && weekStart
      ? (active?.checkins || []).filter((c) => c.date >= prevStart && c.date < weekStart && c.status === 'clean').length
      : null;
  const cleanDiff = lastWeekClean == null ? null : weekClean - lastWeekClean;
  const urgeDiff =
    prevStart && weekStart
      ? weekUrges - (urges || []).filter((u) => {
          const d = String(u.logged_at || '').slice(0, 10);
          return d >= prevStart && d < weekStart;
        }).length
      : null;

  const lowest = ['sleep', 'energy', 'mood'].sort((a, b) => avgs[a] - avgs[b])[0];
  const focus = {
    sleep: 'let\u2019s focus on rest next week — an earlier wind-down beats more willpower.',
    energy: 'next week, try protecting your energy: water, real food, and a short walk.',
    mood: 'next week, let\u2019s lean into the mood boosters that actually work for you.',
  }[lowest];

  const insights = correlationInsights({ dailyCheckins: week, urges: urges || [] });

  return { avgs, trend, n, weekUrges, weekClean, lastWeekClean, cleanDiff, urgeDiff, focus, insights };
}

export default function StatsPage() {
  const { token } = useAuth();
  const { active } = useHabits();
  const { detail, loading } = useHabitDetail(active?.id, token);
  const navigate = useNavigate();

  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(null);

  async function handleExport() {
    if (!active || exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/habits/${active.id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `breakfree_export_${active.id}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExportBusy(false);
    }
  }

  if (!active) {
    return (
      <Layout>
        <div className="empty-state">
          <div className="icon">📊</div>
          <div className="title">No habits yet</div>
          <p>Create a habit to see your progress.</p>
        </div>
      </Layout>
    );
  }

  const s = active.stats;
  const badges = detail?.badges || [];
  const checkins = detail?.checkins || [];
  const dailyCheckins = detail?.dailyCheckins || [];
  const digest = weekDigest(dailyCheckins, detail?.urges, { checkins });
  const next = MILESTONES.find((m) => m.days > s.currentStreak);
  const progress = next ? Math.min(100, Math.round((s.currentStreak / next.days) * 100)) : 100;

  return (
    <Layout>
      <h1 className="page-title">Progress</h1>
      <p className="page-sub">For {active.name}</p>

      <div className="metric-grid">
        <div className="metric">
          <div className="value">{s.totalDays}</div>
          <div className="label">days attempted</div>
        </div>
        <div className="metric">
          <div className="value">{s.currentStreak}</div>
          <div className="label">current streak</div>
        </div>
        <div className="metric">
          <div className="value">{s.longestStreak}</div>
          <div className="label">longest streak</div>
        </div>
        <div className="metric">
          <div className="value" style={{ color: 'var(--slip)' }}>{s.totalSlips}</div>
          <div className="label">slips (no shame)</div>
        </div>
        <div className="metric">
          <div className="value">{s.recentClean}/14</div>
          <div className="label">clean, last 14 days</div>
        </div>
        {s.forgivenSlips > 0 && (
          <div className="metric">
            <div className="value">💚 {s.forgivenSlips}</div>
            <div className="label">forgiven</div>
          </div>
        )}
        {s.unitsAvoided > 0 && (
          <div className="metric">
            <div className="value">{s.unitsAvoided.toLocaleString()}</div>
            <div className="label">{unitLabel(active.name)} avoided</div>
          </div>
        )}
        {s.moneySaved > 0 && (
          <div className="metric">
            <div className="value">£{s.moneySaved.toLocaleString()}</div>
            <div className="label">money saved</div>
          </div>
        )}
        {s.timeSaved > 0 && (
          <div className="metric">
            <div className="value">{s.timeSaved} h</div>
            <div className="label">time won back</div>
          </div>
        )}
      </div>

      <div className="card">
        <p className="card-title">❤️‍🩹 Your body right now</p>
        {(() => {
          const timeline = recoveryTimeline(active.name);
          const days = s.totalClean;
          const earned = timeline.filter((m) => days >= m.days);
          const next = timeline.find((m) => days < m.days);
          const wallDay = active.wall?.active ? active.wall.day : null;
          return (
            <>
              {wallDay && (
                <p className="wall-note">
                  🧱 Day {wallDay} of the wall — survival stretch. Keep checking in; this is where it counts.
                </p>
              )}
              {earned.length > 0 && (
                <p className="muted small" style={{ marginBottom: 10 }}>
                  {days} {days === 1 ? 'day' : 'days'} clean. Here's what your body has already done for you:
                </p>
              )}
              <div className="recovery-list">
                {timeline.map((m) => {
                  const done = days >= m.days;
                  const isNext = next && m.days === next.days;
                  const isWallDay = wallDay != null && m.days === wallDay;
                  return (
                    <div key={m.label} className={`recovery-item${done ? ' done' : ''}${isNext ? ' next' : ''}${isWallDay ? ' wall' : ''}`}>
                      <span className="recovery-mark">{isWallDay ? '🧱' : done ? '✓' : isNext ? '→' : '·'}</span>
                      <div style={{ flex: 1 }}>
                        <div className="recovery-label">{m.label}{isNext ? ' — next up' : ''}</div>
                        <div className="small muted">{m.text}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>

      <div className="card">
        <p className="card-title">Milestones</p>
        <div className="badge-row">
          {MILESTONES.map((m) => (
            <Badge key={m.days} threshold={m.days} earned={badges.some((b) => b.threshold === m.days)} />
          ))}
        </div>
        {next && (
          <div style={{ marginTop: 16 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              {s.currentStreak} / {next.days} days to {next.label}
            </div>
            <div style={{ height: 8, background: 'var(--bg-soft)', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
                  borderRadius: 99,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <p className="card-title">🌗 7-day wellness trend</p>
        {loading ? (
          <div className="loading-screen" style={{ minHeight: '20vh' }}>
            <div className="spinner" />
          </div>
        ) : (
          <TrendChart data={dailyCheckins} />
        )}
      </div>

      <div className="card">
        <TriggerHeatmap urges={detail?.urges} />
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 30 }}>🩺</span>
        <div style={{ flex: 1 }}>
          <p className="card-title" style={{ margin: 0 }}>Health & wellness</p>
          <p className="muted small" style={{ marginTop: 2 }}>
            Log steps, sleep and resting heart rate — and watch your body heal.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/health')}>
          Open
        </button>
      </div>

      {digest && (
        <div className="card">
          <p className="card-title">🗓️ This week</p>
          <div className="list" style={{ gap: 6 }}>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">current streak</span>
              <strong>{s.currentStreak} days</strong>
            </div>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">urges logged this week</span>
              <strong>
                {digest.weekUrges}
                {digest.urgeDiff != null && digest.urgeDiff !== 0 && (
                  <span className={`trend-arrow ${digest.urgeDiff > 0 ? 'down' : 'up'}`}>
                    {digest.urgeDiff > 0 ? '↑' : '↓'}
                  </span>
                )}
              </strong>
            </div>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">clean days this week</span>
              <strong>
                {digest.weekClean}
                {digest.cleanDiff != null && digest.cleanDiff !== 0 && (
                  <span className={`trend-arrow ${digest.cleanDiff > 0 ? 'up' : 'down'}`}>
                    {digest.cleanDiff > 0 ? '+' : ''}
                    {digest.cleanDiff}
                  </span>
                )}
              </strong>
            </div>
          </div>
          {digest.lastWeekClean != null && (
            <p className="muted small" style={{ marginTop: 6 }}>
              {digest.cleanDiff == null || digest.cleanDiff === 0
                ? 'Same clean count as last week'
                : digest.cleanDiff > 0
                  ? `+${digest.cleanDiff} more clean day${digest.cleanDiff === 1 ? '' : 's'} than last week (${digest.lastWeekClean})`
                  : `${Math.abs(digest.cleanDiff)} fewer clean day${digest.cleanDiff === -1 ? '' : 's'} than last week (${digest.lastWeekClean})`}{' '}
              — this week vs last.
            </p>
          )}
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 8 }}>
            {['energy', 'sleep', 'mood'].map((k) => (
              <div className="metric" key={k}>
                <div className="value">
                  {digest.avgs[k].toFixed(1)}
                  {digest.trend[k] && (
                    <span className={`trend-arrow ${digest.trend[k] === '↓' ? 'down' : digest.trend[k] === '↑' ? 'up' : ''}`}>
                      {digest.trend[k]}
                    </span>
                  )}
                </div>
                <div className="label">avg {k}</div>
              </div>
            ))}
          </div>
          {digest.insights.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {digest.insights.map((i) => (
                <p key={i} className="small" style={{ color: 'var(--cream)', marginBottom: 4 }}>
                  🔍 {i}
                </p>
              ))}
            </div>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>
            {digest.n} check-in{digest.n === 1 ? '' : 's'} this week — {digest.focus}
          </p>
        </div>
      )}

      <div className="card">
        <p className="card-title">📥 Your data</p>
        <p className="muted small" style={{ marginBottom: 12 }}>
          Download your full history (check-ins, wellness, urges, journal) as a CSV — for your records or to share with a doctor.
        </p>
        <button className="btn btn-ghost" onClick={handleExport} disabled={exportBusy || !active}>
          {exportBusy ? 'Preparing...' : '📥 Download data (CSV)'}
        </button>
        {exportError && <p className="error-text">{exportError}</p>}
      </div>

      <div className="card">
        <p className="card-title">🔥 Streak history</p>
        {loading ? (
          <div className="loading-screen" style={{ minHeight: '20vh' }}>
            <div className="spinner" />
          </div>
        ) : (
          <StreakChart checkins={detail?.checkins} />
        )}
      </div>

      <div className="card">
        <p className="card-title">📊 Urge frequency</p>
        <p className="muted small" style={{ marginBottom: 12 }}>Urges logged per day — last 14 days</p>
        <UrgeFrequencyChart urges={detail?.urges} />
      </div>

      <div className="card">
        <p className="card-title">📅 30-day overview</p>
        <p className="muted small" style={{ marginBottom: 12 }}>Green = clean, red = slip, gray = no data</p>
        <HeatmapCalendar checkins={detail?.checkins} />
      </div>

      <div className="card">
        <p className="card-title">Recent check-ins</p>
        {loading ? (
          <div className="loading-screen" style={{ minHeight: '20vh' }}>
            <div className="spinner" />
          </div>
        ) : checkins.length === 0 ? (
          <p className="muted small">No check-ins yet.</p>
        ) : (
          <div className="list">
            {checkins.slice(0, 30).map((c) => (
              <div className="list-item" key={c.date}>
                <span style={{ fontSize: 18 }}>{c.status === 'clean' ? '🌿' : '🌅'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.status === 'clean' ? 'Clean' : 'Slip'}</div>
                  {c.note && <div className="small muted">{c.note}</div>}
                </div>
                <span className="meta">{formatDate(c.date)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
