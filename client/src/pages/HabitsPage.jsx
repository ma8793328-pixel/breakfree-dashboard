import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useSubscription } from '../subscription.jsx';
import { api } from '../api.js';
import HabitForm from '../components/HabitForm.jsx';

export default function HabitsPage() {
  const { token } = useAuth();
  const { habits, active, refresh, select, removeHabit } = useHabits();
  const { sub, premium } = useSubscription();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const limit = sub?.habitLimit === Infinity ? null : sub?.habitLimit ?? 1;
  const atLimit = limit != null && habits.length >= limit;

  function formatStart(key) {
    return new Date(key + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function onDelete(habit) {
    setBusy(true);
    try {
      await api(`/habits/${habit.id}`, { method: 'DELETE', token });
      removeHabit(habit.id);
      await refresh();
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  }

  function handleAddClick() {
    if (atLimit) {
      navigate('/app/premium');
      return;
    }
    setAdding(true);
  }

  return (
    <Layout>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Habits</h1>
          <p className="page-sub">Each one is its own journey.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleAddClick}>
          {atLimit ? '👑 Upgrade' : '+ New habit'}
        </button>
      </div>

      {!premium && (
        <div className="card" style={{ background: 'var(--accent-soft)', borderColor: 'rgba(245,166,35,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 26 }}>👑</span>
            <div style={{ flex: 1 }}>
              <p className="card-title" style={{ margin: 0, color: 'var(--accent)' }}>Free plan</p>
              <p className="muted small" style={{ marginTop: 2 }}>
                {habits.length}/{limit} habit{limit > 1 ? 's' : ''} used. Go Premium for unlimited habits.
              </p>
              <div className="limit-bar">
                <div className="limit-fill" style={{ width: `${Math.min(100, (habits.length / limit) * 100)}%` }} />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/app/premium')}>
              Upgrade
            </button>
          </div>
        </div>
      )}

      {habits.length === 0 ? (
        <div className="card empty-state">
          <div className="icon">🔥</div>
          <div className="title">No habits yet</div>
          <p>Create your first habit to get started.</p>
          <button className="btn btn-primary mt" onClick={() => navigate('/onboarding')}>
            Start your journey
          </button>
        </div>
      ) : (
        <div className="list">
          {habits.map((h) => (
            <div className="list-item" key={h.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{h.name}</div>
                  <div className="meta">
                    Since {formatStart(h.startDate)} · {h.stats.totalDays} days · streak {h.stats.currentStreak}
                  </div>
                </div>
                {h.id === active?.id && (
                  <span className="badge-pill ok">Active</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => { select(h.id); navigate('/app'); }}>
                  View
                </button>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setEditing(h)}>
                  Edit
                </button>
              <button
                className="btn btn-slip btn-sm"
                style={{ flex: 1 }}
                onClick={() => setConfirmDelete(h)}
                disabled={busy}
              >
                Delete
              </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <div className="modal-backdrop" onClick={() => { setAdding(false); setEditing(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => { setAdding(false); setEditing(null); }}
              aria-label="Close"
            >
              ✕
            </button>
            <h3>{editing ? 'Edit habit' : 'New habit'}</h3>
            <p className="sub">{editing ? 'Adjust the details of your journey.' : 'What would you like to break free from?'}</p>
            <HabitForm
              habit={editing}
              onSaved={() => { setAdding(false); setEditing(null); refresh(); }}
              onCancel={() => { setAdding(false); setEditing(null); }}
            />
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete “{confirmDelete.name}”?</h3>
            <p className="sub">
              This permanently removes its streaks, check-ins, urges, journal entries and badges. This can't be undone.
            </p>
            <div className="row mt">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(null)} disabled={busy}>
                Keep it
              </button>
              <button className="btn btn-slip" style={{ flex: 1 }} onClick={() => onDelete(confirmDelete)} disabled={busy}>
                {busy ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
