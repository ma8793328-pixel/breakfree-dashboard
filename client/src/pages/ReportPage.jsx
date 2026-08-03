import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { api } from '../api.js';

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function ReportPage() {
  const { token } = useAuth();
  const { active } = useHabits();
  const navigate = useNavigate();

  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api('/report', { method: 'POST', token, body: { habitId: active.id, month } })
      .then((data) => {
        if (!cancelled) setReport(data.report);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, month, token]);

  function shift(delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(monthKey(d));
  }

  if (!active) {
    return (
      <Layout>
        <div className="empty-state">
          <div className="icon">📊</div>
          <div className="title">No habits yet</div>
          <p>Create a habit to view your monthly report.</p>
        </div>
      </Layout>
    );
  }

  const s = report?.stats;

  return (
    <Layout>
      <h1 className="page-title">Monthly report</h1>
      <p className="page-sub">For {active.name}</p>

      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>← Previous</button>
        <span style={{ fontWeight: 800, fontFamily: 'var(--font-head)' }}>{monthLabel(month)}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(1)}>Next →</button>
      </div>

      {loading && !report ? (
        <div className="loading-screen" style={{ minHeight: '40vh' }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="card empty-state">
          <div className="icon">🌧️</div>
          <div className="title">Couldn't load the report</div>
          <p>{error}</p>
          <button className="btn btn-ghost mt" onClick={() => setMonth(monthKey(new Date()))}>
            Back to this month
          </button>
        </div>
      ) : report ? (
        <>
          <div className="report-hero">
            <div className="report-eyebrow">Your month · {monthLabel(month)}</div>
            <div className="report-headline">{report.headline}</div>
            <p className="report-summary">{report.summary}</p>
          </div>

          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="metric">
              <div className="value">{s.cleanPct}%</div>
              <div className="label">days clean</div>
            </div>
            <div className="metric">
              <div className="value">{s.longestRun}</div>
              <div className="label">best streak</div>
            </div>
            <div className="metric">
              <div className="value">{s.slipDays}</div>
              <div className="label">slips</div>
            </div>
            {s.moneySaved > 0 && (
              <div className="metric">
                <div className="value">${s.moneySaved.toLocaleString()}</div>
                <div className="label">saved</div>
              </div>
            )}
            {s.timeSaved > 0 && (
              <div className="metric">
                <div className="value">{s.timeSaved}h</div>
                <div className="label">time back</div>
              </div>
            )}
            {s.urgeCount > 0 && (
              <div className="metric">
                <div className="value">{s.resistedPct}%</div>
                <div className="label">urges resisted</div>
              </div>
            )}
          </div>

          <div className="card">
            <p className="card-title">🧠 What it means</p>
            <div className="insight-list">
              {report.patterns.map((p, i) => (
                <div className="insight-item" key={i}>
                  <div className="text">{p}</div>
                </div>
              ))}
            </div>
          </div>

          {s.peakPeriod && (
            <div className="reflection-card">
              <div className="head">⏰ Peak window</div>
              <div className="text">
                Urges clustered in the {s.peakPeriod}. Have a small ritual ready in that window.
              </div>
            </div>
          )}
        </>
      ) : null}
    </Layout>
  );
}
