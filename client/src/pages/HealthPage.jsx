import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { localDate, fetchHealthSamples, saveHealthSample } from '../api.js';

const FIELDS = [
  { key: 'steps', label: 'Steps', type: 'number', min: 0, max: 200000, placeholder: 'e.g. 8400', suffix: 'steps' },
  { key: 'sleepHours', label: 'Sleep', type: 'number', step: '0.5', min: 0, max: 24, placeholder: 'e.g. 7.5', suffix: 'hours' },
  { key: 'restingHr', label: 'Resting HR', type: 'number', min: 30, max: 220, placeholder: 'e.g. 62', suffix: 'bpm' },
];

const QUICK_PRESETS = [
  { label: '8k steps', key: 'steps', value: 8000 },
  { label: '7.5h sleep', key: 'sleepHours', value: 7.5 },
  { label: '62 bpm', key: 'restingHr', value: 62 },
];

function fmtDate(key) {
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function StepsChart({ samples }) {
  const last = (samples || []).slice(-14);
  if (last.length === 0) return null;
  const max = Math.max(...last.map((s) => s.steps || 0), 1);
  const W = 320;
  const H = 120;
  const PAD_X = 8;
  const barW = (W - PAD_X * 2) / last.length;
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Steps over the last two weeks">
        {[0, 0.5, 1].map((v) => (
          <line
            key={v}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={H - v * (H - 14)}
            y2={H - v * (H - 14)}
            stroke="rgba(245,245,241,0.08)"
            strokeWidth="1"
          />
        ))}
        {last.map((s, i) => {
          const h = Math.max(((s.steps || 0) / max) * (H - 14), 2);
          return (
            <rect
              key={s.date}
              x={PAD_X + i * barW + barW * 0.18}
              y={H - 2 - h}
              width={barW * 0.64}
              height={h}
              rx="3"
              fill={s.steps ? 'var(--accent)' : 'rgba(255,255,255,0.06)'}
            />
          );
        })}
      </svg>
    </div>
  );
}

function LineChart({ samples, key, color, label, unit, min, max }) {
  const last = (samples || []).slice(-14).filter((s) => s[key] != null);
  if (last.length === 0) return null;
  const W = 320;
  const H = 120;
  const PAD_X = 8;
  const PAD_Y = 10;
  const vals = last.map((s) => s[key]);
  const lo = min != null ? min : Math.min(...vals);
  const hi = max != null ? max : Math.max(...vals);
  const range = hi - lo || 1;
  const x = (i) => PAD_X + (i / Math.max(last.length - 1, 1)) * (W - PAD_X * 2);
  const y = (v) => H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);
  const points = last.map((s, i) => `${x(i)},${y(s[key])}`).join(' ');
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} over the last two weeks`}>
        {[0, 0.5, 1].map((v) => (
          <line
            key={v}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_Y + v * (H - PAD_Y * 2)}
            y2={PAD_Y + v * (H - PAD_Y * 2)}
            stroke="rgba(245,245,241,0.08)"
            strokeWidth="1"
          />
        ))}
        <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {last.map((s, i) => (
          <circle key={s.date} cx={x(i)} cy={y(s[key])} r="4" fill={color} />
        ))}
      </svg>
      <p className="muted tiny" style={{ marginTop: 4, textAlign: 'center' }}>
        {label}: {vals[vals.length - 1]}{unit} (latest)
      </p>
    </div>
  );
}

export default function HealthPage() {
  const { token } = useAuth();
  const { active } = useHabits();
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ date: localDate(), steps: '', sleepHours: '', restingHr: '', notes: '' });

  useEffect(() => {
    if (!active?.id || !token) return;
    let cancelled = false;
    setLoading(true);
    fetchHealthSamples(active.id, token)
      .then((d) => {
        if (!cancelled) setSamples(d.samples || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id, token]);

  const averages = useMemo(() => {
    const days = samples.filter((s) => s.date <= localDate());
    if (days.length === 0) return null;
    const step = days.filter((s) => s.steps != null).map((s) => s.steps);
    const sleep = days.filter((s) => s.sleepHours != null).map((s) => s.sleepHours);
    const hr = days.filter((s) => s.restingHr != null).map((s) => s.restingHr);
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return {
      steps: avg(step),
      sleep: avg(sleep),
      hr: avg(hr),
      n: days.length,
    };
  }, [samples]);

  function applyPreset(preset) {
    setForm((f) => ({ ...f, [preset.key]: String(preset.value) }));
  }

  async function onSave(e) {
    e.preventDefault();
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const clean = {};
      for (const f of FIELDS) if (form[f.key] !== '' && form[f.key] != null) clean[f.key] = Number(form[f.key]);
      clean.date = form.date;
      if (form.notes.trim()) clean.notes = form.notes.trim();
      await saveHealthSample(active.id, clean, token);
      const d = await fetchHealthSamples(active.id, token);
      setSamples(d.samples || []);
      setForm((f) => ({ ...f, steps: '', sleepHours: '', restingHr: '', notes: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!active) {
    return (
      <Layout>
        <div className="empty-state">
          <div className="icon">🩺</div>
          <div className="title">No habits yet</div>
          <p>Create a habit to start tracking your health.</p>
        </div>
      </Layout>
    );
  }

  const recent = (samples || []).slice(-14);

  return (
    <Layout>
      <h1 className="page-title">Health</h1>
      <p className="page-sub">For {active.name} — optional, quick, and manual.</p>

      <div className="card">
        <p className="card-title">📋 Log today</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {QUICK_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="chip"
              onClick={() => applyPreset(p)}
              aria-label={`Quick add ${p.label}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form onSubmit={onSave}>
          <div className="field">
            <label htmlFor="health-date">Date</label>
            <input
              id="health-date"
              type="date"
              value={form.date}
              max={localDate()}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`health-${f.key}`}>{f.label} ({f.suffix})</label>
              <input
                id={`health-${f.key}`}
                type={f.type}
                inputMode="decimal"
                step={f.step || '1'}
                min={f.min}
                max={f.max}
                placeholder={f.placeholder}
                value={form[f.key]}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="field">
            <label htmlFor="health-notes">Note (optional)</label>
            <input
              id="health-notes"
              type="text"
              maxLength={140}
              placeholder="e.g. slept badly, headache all day"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-block mt" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save entry'}
          </button>
        </form>
      </div>

      {averages && (
        <div className="metric-grid">
          {averages.steps != null && (
            <div className="metric">
              <div className="value">{Math.round(averages.steps).toLocaleString()}</div>
              <div className="label">avg steps/day</div>
            </div>
          )}
          {averages.sleep != null && (
            <div className="metric">
              <div className="value">{averages.sleep.toFixed(1)} h</div>
              <div className="label">avg sleep</div>
            </div>
          )}
          {averages.hr != null && (
            <div className="metric">
              <div className="value">{Math.round(averages.hr)}</div>
              <div className="label">avg resting HR</div>
            </div>
          )}
          <div className="metric">
            <div className="value">{averages.n}</div>
            <div className="label">days logged</div>
          </div>
        </div>
      )}

      <div className="card">
        <p className="card-title">📈 Last two weeks</p>
        {loading ? (
          <div className="loading-screen" style={{ minHeight: '16vh' }}>
            <div className="spinner" />
          </div>
        ) : recent.length === 0 ? (
          <p className="muted small">No entries yet — log your first day above.</p>
        ) : (
          <>
            <StepsChart samples={recent} />
            <LineChart samples={recent} key="sleepHours" color="var(--sage)" label="Sleep" unit=" h" min={0} max={12} />
            <LineChart samples={recent} key="restingHr" color="var(--accent-strong)" label="Resting HR" unit=" bpm" min={40} max={100} />
            <div className="list" style={{ gap: 4, marginTop: 10 }}>
              {[...recent].reverse().map((s) => (
                <div className="toggle-row" key={s.date} style={{ padding: '7px 0' }}>
                  <span className="meta">{fmtDate(s.date)}</span>
                  <strong className="small">
                    {s.steps != null ? `${s.steps.toLocaleString()} steps` : '—'}
                    {s.sleepHours != null ? ` · ${s.sleepHours} h` : ''}
                    {s.restingHr != null ? ` · ${s.restingHr} bpm` : ''}
                  </strong>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
