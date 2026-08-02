import { useState } from 'react';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useHabitDetail } from '../useHabitDetail.js';
import Badge from '../components/Badge.jsx';
import TrendChart from '../chartUtil.jsx';
import { correlationInsights } from '../aiCoach.js';
import { MILESTONES } from '../data.js';

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

  const lowest = ['sleep', 'energy', 'mood'].sort((a, b) => avgs[a] - avgs[b])[0];
  const focus = {
    sleep: 'let\u2019s focus on rest next week — an earlier wind-down beats more willpower.',
    energy: 'next week, try protecting your energy: water, real food, and a short walk.',
    mood: 'next week, let\u2019s lean into the mood boosters that actually work for you.',
  }[lowest];

  const insights = correlationInsights({ dailyCheckins: week, urges: urges || [] });

  return { avgs, trend, n, weekUrges, weekClean, focus, insights };
}

export default function StatsPage() {
  const { token } = useAuth();
  const { active } = useHabits();
  const { detail, loading } = useHabitDetail(active?.id, token);

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
        {s.moneySaved > 0 && (
          <div className="metric">
            <div className="value">${s.moneySaved.toLocaleString()}</div>
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
              <strong>{digest.weekUrges}</strong>
            </div>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">clean days this week</span>
              <strong>{digest.weekClean}</strong>
            </div>
          </div>
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
