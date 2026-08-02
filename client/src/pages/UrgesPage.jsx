import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useHabitDetail } from '../useHabitDetail.js';
import { useSubscription } from '../subscription.jsx';
import { api } from '../api.js';
import UrgeModal from '../components/UrgeModal.jsx';
import { urgeInsight } from '../aiCoach.js';

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function UrgesPage() {
  const { token } = useAuth();
  const { active } = useHabits();
  const { detail, loading, reload } = useHabitDetail(active?.id, token);
  const { premium } = useSubscription();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [deep, setDeep] = useState(null);
  const [deepLoading, setDeepLoading] = useState(false);

  const insights = useMemo(() => {
    if (!active || !detail) return null;
    return urgeInsight(detail.urges, {
      habitName: active.name,
      streak: active.stats?.currentStreak ?? 0,
    });
  }, [active, detail]);

  useEffect(() => {
    if (!premium || !active) return;
    let cancelled = false;
    setDeepLoading(true);
    api('/ai/urge-insights', { method: 'POST', token, body: { habitId: active.id } })
      .then((data) => {
        if (!cancelled) setDeep(data.insight);
      })
      .catch(() => {
        /* premium check happens via UI state */
      })
      .finally(() => {
        if (!cancelled) setDeepLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [premium, active, token]);

  if (!active) {
    return (
      <Layout>
        <div className="empty-state">
          <div className="icon">🔥</div>
          <div className="title">No habits yet</div>
          <p>Create a habit to start tracking urges.</p>
        </div>
      </Layout>
    );
  }

  const urges = detail?.urges || [];

  return (
    <Layout>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Urges</h1>
          <p className="page-sub">For {active.name}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
          + Log urge
        </button>
      </div>

      {!loading && insights && (
        <div className="insight-card">
          <div className="head">🧠 {insights.headline}</div>
          <div className="insight-list">
            {insights.bullets.map((b, i) => (
              <div className="insight-item" key={i}>
                <div className="label">{b.label}</div>
                <div className="text">{b.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {premium ? (
        <div className="card">
          <p className="card-title">👑 Deeper analysis</p>
          {deepLoading && !deep ? (
            <div className="loading-screen" style={{ minHeight: '12vh' }}>
              <div className="spinner" />
            </div>
          ) : deep ? (
            <div className="insight-list">
              {deep.bullets.map((b, i) => (
                <div className="insight-item" key={i}>
                  <div className="label">{b.label}</div>
                  <div className="text">{b.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">Log a few urges to unlock deeper analysis.</p>
          )}
        </div>
      ) : (
        <button className="btn btn-ghost btn-block" onClick={() => navigate('/app/premium')}>
          👑 Unlock deeper urge analysis
        </button>
      )}

      {loading ? (
        <div className="loading-screen" style={{ minHeight: '40vh' }}>
          <div className="spinner" />
        </div>
      ) : urges.length === 0 ? (
        <div className="card empty-state">
          <div className="icon">🧠</div>
          <div className="title">No urges logged yet</div>
          <p>Next time one hits, log it. Awareness is the first crack in the habit.</p>
        </div>
      ) : (
        <div className="list">
          {urges.map((u) => (
            <div className="list-item" key={u.id}>
              <div style={{ textAlign: 'center', minWidth: 40 }}>
                <div style={{ fontSize: 22 }}>{"🔥".repeat(Math.min(u.intensity, 5))}</div>
                <div className="small muted">{u.intensity}/5</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{u.trigger || 'No trigger noted'}</div>
                <div className="meta">
                  {formatTime(u.logged_at)} · {u.resisted ? 'Resisted 💪' : 'Gave in'}
                </div>
              </div>
              <span className={`badge-pill ${u.resisted ? 'ok' : 'no'}`}>{u.resisted ? 'Resisted' : 'Gave in'}</span>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <UrgeModal habitId={active.id} onClose={() => setShowModal(false)} onSaved={reload} />
      )}
    </Layout>
  );
}
