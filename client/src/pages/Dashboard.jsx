import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { useSubscription } from '../subscription.jsx';
import { api, localDate } from '../api.js';
import { MILESTONES, pickQuote } from '../data.js';
import UrgeModal from '../components/UrgeModal.jsx';
import Celebration from '../components/Celebration.jsx';
import Badge from '../components/Badge.jsx';
import { usePushNotifications } from '../usePushNotifications.js';
import { queueOffline, flushOfflineQueue } from '../offline.js';

function ScalePicker({ label, value, onChange, lowEnd = 'Low', highEnd = 'High' }) {
  const ids = [1, 2, 3, 4, 5];
  return (
    <div
      className="scale-chips"
      role="radiogroup"
      aria-label={`${label}, from ${lowEnd} to ${highEnd}`}
      onKeyDown={(e) => {
        const i = ids.indexOf(value);
        let next = null;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = ids[Math.max(0, i - 1)];
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = ids[Math.min(4, i + 1)];
        else if (e.key === 'Home') next = 1;
        else if (e.key === 'End') next = 5;
        if (next != null) {
          e.preventDefault();
          onChange(next);
        }
      }}
    >
      {ids.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={`${label}: ${v} of 5, ${v === 1 ? lowEnd : v === 5 ? highEnd : ''}`}
          className={`scale-chip${value === v ? ' active' : ''}`}
          tabIndex={value === v ? 0 : -1}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { token, user, logout } = useAuth();
  const { habits, active, loading, refresh, select, upsertHabit } = useHabits();
  const { premium } = useSubscription();
  const { supported: pushSupported, status: pushStatus, error: pushError } = usePushNotifications(token);
  const navigate = useNavigate();

  const [flow, setFlow] = useState(null);
  const [slipNote, setSlipNote] = useState('');
  const [showUrge, setShowUrge] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [overrideToday, setOverrideToday] = useState(false);
  const [lastJournal, setLastJournal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [wellness, setWellness] = useState(null);
  const [wellnessEdit, setWellnessEdit] = useState(false);
  const [wellnessForm, setWellnessForm] = useState({ energy: 3, sleep: 3, mood: 3 });
  const [wellnessBusy, setWellnessBusy] = useState(false);
  const [offlineNote, setOfflineNote] = useState(null);

  const todayClean = active?.stats?.todayStatus === 'clean';
  const todaySlip = active?.stats?.todayStatus === 'slip';
  const streak = active?.stats?.currentStreak || 0;
  const nextMilestone = MILESTONES.find((m) => m.days > streak);
  const nextPct = nextMilestone ? Math.min(100, Math.round((streak / nextMilestone.days) * 100)) : 100;
  const earnedBadges = active?.badges || [];

  useEffect(() => {
    if (!loading && habits.length === 0) navigate('/onboarding', { replace: true });
  }, [loading, habits, navigate]);

  useEffect(() => {
    if (!active || !token) return;
    let cancelled = false;
    api(`/habits/${active.id}/journals`, { token })
      .then((data) => {
        if (!cancelled && data.journals?.length > 0) setLastJournal(data.journals[0]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, token]);

  const quote = useMemo(() => (streak > 0 ? pickQuote(streak) : null), [streak]);

  useEffect(() => {
    if (!active || !token) return;
    let cancelled = false;
    api(`/habits/${active.id}/daily-checkin?date=${localDate()}`, { token })
      .then((data) => {
        if (cancelled) return;
        if (data.checkin) {
          setWellness(data.checkin);
          setWellnessForm({ energy: data.checkin.energy, sleep: data.checkin.sleep, mood: data.checkin.mood });
          setWellnessEdit(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, token]);

  useEffect(() => {
    if (!token) return;
    flushOfflineQueue(token).then((flushed) => {
      if (flushed) {
        setOfflineNote(null);
        refresh();
      }
    });
    const onOnline = () => {
      flushOfflineQueue(token).then((flushed) => {
        if (flushed) {
          setOfflineNote(null);
          refresh();
        }
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function saveWellness() {
    if (!active || wellnessBusy) return;
    setWellnessBusy(true);
    setError(null);
    try {
      const data = await api(`/habits/${active.id}/daily-checkin`, {
        method: 'POST',
        token,
        body: { ...wellnessForm, date: localDate() },
      });
      setWellness(data.checkin);
      setWellnessForm({ energy: data.checkin.energy, sleep: data.checkin.sleep, mood: data.checkin.mood });
      setWellnessEdit(false);
    } catch (err) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        queueOffline({
          path: `/habits/${active.id}/daily-checkin`,
          method: 'POST',
          body: { ...wellnessForm, date: localDate() },
        });
        setWellness({ ...wellnessForm, date: localDate() });
        setWellnessEdit(false);
        setOfflineNote('Saved on this device — will sync when you\'re back online.');
      } else {
        setError(err.message);
      }
    } finally {
      setWellnessBusy(false);
    }
  }

  async function handleClean() {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/habits/${active.id}/checkin`, {
        method: 'POST',
        token,
        body: { status: 'clean', date: localDate() },
      });
      upsertHabit(res.habit);
      refresh();
      setFlow({ kind: 'clean', quote: pickQuote(res.habit.stats.currentStreak), badge: res.newBadge });
    } catch (err) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        queueOffline({ path: `/habits/${active.id}/checkin`, method: 'POST', body: { status: 'clean', date: localDate() } });
        setOfflineNote('Checked in — will sync when you\'re back online.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSlip() {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/habits/${active.id}/checkin`, {
        method: 'POST',
        token,
        body: { status: 'slip', note: slipNote.trim() || null, date: localDate() },
      });
      upsertHabit(res.habit);
      refresh();
      setFlow({ kind: 'slip' });
    } catch (err) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        queueOffline({
          path: `/habits/${active.id}/checkin`,
          method: 'POST',
          body: { status: 'slip', note: slipNote.trim() || null, date: localDate() },
        });
        setOfflineNote('Logged — will sync when you\'re back online.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function closeFlow() {
    setFlow(null);
    setSlipNote('');
  }

  async function getRecoveryPlan() {
    if (!active || recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      const data = await api('/premium/recovery-plan', {
        method: 'POST',
        token,
        body: { habitId: active.id },
      });
      setRecovery(data.plan);
    } catch (e) {
      setError(e.message);
    } finally {
      setRecoveryBusy(false);
    }
  }

  if (loading || !active) {
    return (
      <Layout>
        <div className="loading-screen" style={{ minHeight: '60vh' }}>
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <Layout>
      <section className="hero">
        <div className="hero-kicker">
          {greeting}, {user?.email?.split('@')[0]}
          {premium && <span className="badge-pill premium" style={{ marginLeft: 8 }}>👑 Premium</span>}
        </div>
        <h1 className="hero-title">{active.name}</h1>
        <p className="hero-sub">One day at a time. Today counts.</p>
        <div className="hero-row">
          {!premium && (
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/premium')}>
              👑 Premium
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/days-out')}>
            🌳 Days out
          </button>
          <div className="menu-wrap">
            <button className="menu-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
              {user?.email?.slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu-dropdown">
                  <div className="menu-head">{user?.email}</div>
                  <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/premium'); }}>
                    👑 Premium
                  </button>
                  <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/days-out'); }}>
                    🌳 Days out
                  </button>
                  <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/report'); }}>
                    📊 Monthly report
                  </button>
                  <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/habits'); }}>
                    🔥 Habits
                  </button>
                  <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/settings'); }}>
                    🔔 Notifications
                  </button>
                  {user?.role === 'admin' && (
                    <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/admin'); }}>
                      🛠️ Admin
                    </button>
                  )}
                  <div className="divider" />
                  <button className="menu-item" onClick={logout}>
                    🚪 Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {habits.length > 1 && (
        <div className="habit-pills">
          {habits.map((h) => (
            <button
              key={h.id}
              className={`habit-pill${h.id === active.id ? ' active' : ''}`}
              onClick={() => select(h.id)}
            >
              {h.name}
            </button>
          ))}
        </div>
      )}

      <div className="streak-card">
        <div className="streak-number">{streak}</div>
        <div className="streak-label">{streak === 1 ? 'day clean' : 'days clean'}</div>
        <p className="streak-sub">
          {active.stats.totalDays === 0
            ? 'Your journey starts today.'
            : `${active.stats.totalClean} clean days total · started ${new Date(active.startDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
        </p>
      </div>

      <div className="card wellness-card">
        <div className="wellness-head">
          <div>
            <p className="card-title" style={{ margin: 0 }}>🌗 Daily check-in</p>
            <p className="muted small" style={{ marginTop: 2 }}>
              {wellness && !wellnessEdit
                ? 'Saved for today — your coach will reference it.'
                : 'Energy, rest and mood help your coach tailor its advice.'}
            </p>
          </div>
          <div className="wellness-actions">
            {pushSupported && pushStatus === 'granted' && (
              <span className="badge-pill" title="Low-sleep notifications are on">🔔 On</span>
            )}
            {pushSupported && pushStatus === 'denied' && (
              <span className="badge-pill" title="Notifications are blocked in your browser">🔔 Off</span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/settings')}>
              🔔 Notifications
            </button>
            {wellness && !wellnessEdit && (
              <button className="btn btn-ghost btn-sm" onClick={() => setWellnessEdit(true)}>
                ✏️ Edit
              </button>
            )}
          </div>
        </div>
        {pushError && <p className="error-text">{pushError}</p>}
        {offlineNote && <p className="muted small" style={{ marginTop: 8, color: 'var(--accent)' }}>📴 {offlineNote}</p>}

        {wellness && !wellnessEdit ? (
          <div className="wellness-summary">
            {[
              { key: 'energy', label: 'Energy' },
              { key: 'sleep', label: 'Sleep' },
              { key: 'mood', label: 'Mood' },
            ].map((r) => (
              <div key={r.key} className="wellness-row">
                <span className="wellness-label">{r.label}</span>
                <div className="scale-chips" role="list" aria-label={`${r.label}: ${wellness[r.key]} of 5`}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <span
                      key={v}
                      role="listitem"
                      aria-hidden="true"
                      className={`scale-chip static${wellness[r.key] === v ? ' active' : ''}`}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {[
              { key: 'energy', label: 'Energy', lowEnd: 'Low', highEnd: 'High' },
              { key: 'sleep', label: 'Sleep', lowEnd: 'Poor', highEnd: 'Excellent' },
              { key: 'mood', label: 'Mood', lowEnd: 'Low', highEnd: 'High' },
            ].map((r) => (
              <div key={r.key} className="wellness-row">
                <div className="wellness-scale">
                  <span className="wellness-label">{r.label}</span>
                  <span className="wellness-end muted small">{r.lowEnd}</span>
                </div>
                <ScalePicker
                  label={r.label}
                  lowEnd={r.lowEnd}
                  highEnd={r.highEnd}
                  value={wellnessForm[r.key]}
                  onChange={(v) => setWellnessForm((f) => ({ ...f, [r.key]: v }))}
                />
              </div>
            ))}
            <button
              className="btn btn-primary btn-block mt"
              onClick={saveWellness}
              disabled={wellnessBusy}
            >
              {wellnessBusy ? 'Saving...' : wellness ? 'Update check-in' : 'Save check-in'}
            </button>
            {error && <p className="error-text">{error}</p>}
          </>
        )}
      </div>

      {todayClean && !overrideToday ? (
        <div className="card" style={{ borderColor: 'rgba(168,192,154,0.4)', background: 'linear-gradient(160deg,#272B26,#232623)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 30 }}>🌿</span>
            <div>
              <p className="card-title" style={{ margin: 0, color: 'var(--sage)' }}>Checked in — nice one.</p>
              <p className="muted small" style={{ marginTop: 2 }}>
                You showed up for yourself today. Rest easy.
              </p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm mt" onClick={() => setOverrideToday(true)}>
            ✏️ Change today's check-in
          </button>
        </div>
      ) : todaySlip && !overrideToday ? (
        <div className="card" style={{ borderColor: 'rgba(217,142,106,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 30 }}>🌅</span>
            <div>
              <p className="card-title" style={{ margin: 0, color: 'var(--slip)' }}>Today was hard. That's okay.</p>
              <p className="muted small" style={{ marginTop: 2 }}>
                Tomorrow is a fresh start. You're still here — that counts.
              </p>
            </div>
          </div>
          <div className="row mt">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={premium ? getRecoveryPlan : () => navigate('/app/premium')} disabled={recoveryBusy}>
              {recoveryBusy ? 'Building your plan...' : premium ? '🗺️ 3-day recovery plan' : '👑 Unlock recovery plans'}
            </button>
            <button className="btn btn-ghost" onClick={() => setOverrideToday(true)}>
              ✏️ Change
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="card-title">How did today go?</p>
          <p className="muted small" style={{ marginBottom: 14 }}>
            Checking in is the small act that keeps the whole thing alive.
          </p>
          <div className="checkin-row">
            <button className="btn btn-primary" onClick={handleClean} disabled={busy}>
              🌿 I stayed clean
            </button>
            <button className="btn btn-slip" onClick={() => setFlow({ kind: 'slipNote' })} disabled={busy}>
              I had a setback
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      <div className="card" style={{ borderColor: 'rgba(229,9,20,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <p className="card-title" style={{ margin: 0 }}>Feeling an urge?</p>
            <p className="muted small" style={{ marginTop: 2 }}>
              Log it now — awareness is half the battle.
            </p>
          </div>
        </div>
        <button className="btn btn-primary btn-block mt" onClick={() => setShowUrge(true)}>
          ⚡ Log an urge
        </button>
      </div>

      {active.stats.moneySaved > 0 || active.stats.timeSaved > 0 ? (
        <div className="metric-grid">
          {active.stats.moneySaved > 0 && (
            <div className="metric">
              <div className="value">${active.stats.moneySaved.toLocaleString()}</div>
              <div className="label">saved this streak</div>
            </div>
          )}
          {active.stats.timeSaved > 0 && (
            <div className="metric">
              <div className="value">{active.stats.timeSaved} h</div>
              <div className="label">won back this streak</div>
            </div>
          )}
        </div>
      ) : null}

      {quote && <div className="quote">“{quote.text}”<span className="source">{quote.source}</span></div>}

      {lastJournal && (
        <button
          className="journal-snippet"
          onClick={() => navigate('/app/journal')}
          aria-label="Open your journal"
        >
          <span className="journal-snippet-icon">📔</span>
          <span className="journal-snippet-body">
            <span className="journal-snippet-date">
              From your journal · {new Date(lastJournal.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
            <span className="journal-snippet-text">“{lastJournal.content.slice(0, 110)}{lastJournal.content.length > 110 ? '…' : ''}”</span>
          </span>
        </button>
      )}

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 30 }}>📊</span>
        <div style={{ flex: 1 }}>
          <p className="card-title" style={{ margin: 0 }}>Monthly report</p>
          <p className="muted small" style={{ marginTop: 2 }}>
            {premium
              ? 'Streaks, savings and patterns — unpacked for you.'
              : 'A Premium look at how your month really went.'}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/report')}>
          {premium ? 'Open' : 'Unlock'}
        </button>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 30 }}>✨</span>
        <div style={{ flex: 1 }}>
          <p className="card-title" style={{ margin: 0 }}>Your coach is here</p>
          <p className="muted small" style={{ marginTop: 2 }}>
            {premium
              ? 'Reads your streaks, urges and journal — always on your side.'
              : 'A Premium companion that knows your journey.'}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/app/coach')}>
          {premium ? 'Chat' : 'Unlock'}
        </button>
      </div>

      <div className="card">
        <p className="card-title">Milestones</p>
        {nextMilestone ? (
          <div className="milestone-progress">
            <div className="milestone-row">
              <span>{nextMilestone.icon} {nextMilestone.label}</span>
              <span className="muted small">{streak}/{nextMilestone.days} days</span>
            </div>
            <div className="limit-bar">
              <div className="limit-fill" style={{ width: `${nextPct}%` }} />
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              {nextMilestone.days - streak > 0
                ? `${nextMilestone.days - streak} more ${nextMilestone.days - streak === 1 ? 'day' : 'days'} to ${nextMilestone.label}`
                : 'Almost there — keep going!'}
            </p>
          </div>
        ) : (
          <p className="muted small">Every milestone reached. 🎉 Now you're building a life, not a streak.</p>
        )}
        <div className="badge-row" style={{ marginTop: 14 }}>
          {MILESTONES.map((m) => (
            <Badge
              key={m.days}
              threshold={m.days}
              earned={earnedBadges.some((b) => b.threshold === m.days)}
            />
          ))}
        </div>
      </div>

      {flow?.kind === 'slipNote' && (
        <div className="modal-backdrop" onClick={closeFlow}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeFlow} aria-label="Close">✕</button>
            <h3>No judgement here</h3>
            <p className="sub">
              Want to note what happened? It helps you spot patterns — and it stays private.
            </p>
            <textarea
              value={slipNote}
              onChange={(e) => setSlipNote(e.target.value)}
              placeholder="What triggered it? How were you feeling?"
              maxLength={300}
              style={{ width: '100%', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: 14, fontFamily: 'var(--font-body)', fontSize: 15, minHeight: 110, resize: 'vertical' }}
            />
            <div className="row mt">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={closeFlow}>
                Skip
              </button>
              <button className="btn btn-slip" style={{ flex: 2 }} onClick={handleSlip} disabled={busy}>
                {busy ? 'Saving...' : 'Log the setback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {flow?.kind === 'clean' && (
        <Celebration kind="clean" quote={flow.quote} badge={flow.badge} onClose={closeFlow} />
      )}
      {flow?.kind === 'slip' && <Celebration kind="slip" onClose={closeFlow} />}

      {showUrge && <UrgeModal habitId={active.id} onClose={() => setShowUrge(false)} onSaved={refresh} />}

      {recovery && (
        <div className="modal-backdrop" onClick={() => setRecovery(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setRecovery(null)} aria-label="Close">✕</button>
            <h3>{recovery.title}</h3>
            <p className="sub">{recovery.intro}</p>
            <div className="list">
              {recovery.days.map((d) => (
                <div className="card" key={d.day} style={{ padding: 16 }}>
                  <p className="card-title" style={{ color: 'var(--accent)', marginBottom: 8 }}>{d.day}</p>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {d.actions.map((a, i) => (
                      <li key={i} className="small" style={{ color: 'var(--cream)' }}>{a}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <button className="btn btn-primary btn-block mt" onClick={() => setRecovery(null)}>
              I've got this
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
