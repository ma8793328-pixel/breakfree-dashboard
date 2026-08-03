import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { api, localDate, forgiveCheckin, spendShieldToken } from '../api.js';
import { MILESTONES, pickQuote, unitLabel } from '../data.js';
import { dailyCoachNote, wallMessage, SURVIVAL_NOTE } from '../aiCoach.js';
import UrgeModal from '../components/UrgeModal.jsx';
import UrgeQuickPanel from '../components/UrgeQuickPanel.jsx';
import Celebration from '../components/Celebration.jsx';
import ShareCard from '../components/ShareCard.jsx';
import Badge from '../components/Badge.jsx';
import { usePushNotifications, scheduleTriggerNudges } from '../usePushNotifications.js';
import { queueOffline, flushOfflineQueue } from '../offline.js';

function RatingRow({ label, value, onChange, accentColor, lowEnd = 'Low', highEnd = 'High' }) {
  const ids = [1, 2, 3, 4, 5];
  const getFeedback = () => {
    const tips = {
      Energy: ["Low energy", "Warming up", "Steady", "Energised", "Full power"],
      Sleep: ["Poor rest", "Tired", "Okay rest", "Good sleep", "Great rest!"],
      Mood: ["Low", "Flat", "Neutral", "Positive", "Feeling great!"]
    };
    return tips[label]?.[value - 1] || '';
  };

  return (
    <div
      className="rating-row"
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
      <div className="rating-header">
        <span className="rating-label">{label}</span>
        <span className="rating-value" style={{ color: accentColor }}>{value}/5</span>
      </div>
      <div className="rating-controls">
        <span className="scale-label">{lowEnd}</span>
        <div className="rating-buttons">
          {ids.map((score) => (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={value === score}
              aria-label={`${label}: ${score} of 5`}
              className={`rating-btn${value >= score ? ' active' : ''}`}
              tabIndex={value === score ? 0 : -1}
              style={{
                borderColor: value >= score ? accentColor : undefined,
                backgroundColor: value >= score ? accentColor : undefined,
                boxShadow: value >= score ? `0 0 10px ${accentColor}40` : undefined
              }}
              onClick={() => onChange(score)}
            />
          ))}
        </div>
        <span className="scale-label">{highEnd}</span>
      </div>
      <span className="rating-feedback" style={{ color: accentColor }}>{getFeedback()}</span>
    </div>
  );
}

export default function Dashboard() {
  const { token, user, logout } = useAuth();
  const { habits, active, loading, refresh, select, upsertHabit } = useHabits();
  const { supported: pushSupported, status: pushStatus, error: pushError, subscribe } = usePushNotifications(token);
  const navigate = useNavigate();

  const [flow, setFlow] = useState(null);
  const [slipNote, setSlipNote] = useState('');
  const [slipTrigger, setSlipTrigger] = useState('');
  const [slipResetDone, setSlipResetDone] = useState(false);
  const [showUrge, setShowUrge] = useState(false);
  const [showUrgeQuick, setShowUrgeQuick] = useState(false);
  const [showFabTooltip, setShowFabTooltip] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [overrideToday, setOverrideToday] = useState(false);
  const [lastJournal, setLastJournal] = useState(null);
  const [todayUrgeCount, setTodayUrgeCount] = useState(0);
  const [urgePeak, setUrgePeak] = useState(null);
  const [totalUrges, setTotalUrges] = useState(0);
  const shieldTokens = active?.shieldTokens || 0;
  const [totalResisted, setTotalResisted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [wellness, setWellness] = useState(null);
  const [wellnessEdit, setWellnessEdit] = useState(false);
  const [wellnessForm, setWellnessForm] = useState({ energy: 3, sleep: 3, mood: 3 });
  const [wellnessBusy, setWellnessBusy] = useState(false);
  const [offlineNote, setOfflineNote] = useState(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const wellnessRef = useRef(null);
  const [welcomeHabit, setWelcomeHabit] = useState(null);
  const [pushOptInDismissed, setPushOptInDismissed] = useState(() => {
    try { return localStorage.getItem('bf_push_optin_dismissed') === '1'; } catch { return false; }
  });
  const pushVariant = (() => {
    try {
      const stored = localStorage.getItem('bf_push_variant');
      if (stored === 'urgency' || stored === 'benefit') return stored;
      const v = Math.random() < 0.5 ? 'urgency' : 'benefit';
      localStorage.setItem('bf_push_variant', v);
      return v;
    } catch { return 'urgency'; }
  })();

  useEffect(() => {
    const loc = window.location;
    if (loc.state?.welcome) {
      setWelcomeHabit(loc.state.welcome);
      window.history.replaceState(null, '');
    }
  }, []);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem('bf_fab_tooltip_dismissed');
      if (!dismissed && active?.id) {
        const t = setTimeout(() => setShowFabTooltip(true), 1200);
        return () => clearTimeout(t);
      }
    } catch { /* ignore */ }
  }, [active?.id]);

  const CHECKIN_DRAFT_KEY = 'bf_checkin_draft';

  function readCheckinDraft() {
    try {
      const raw = localStorage.getItem(CHECKIN_DRAFT_KEY);
      const draft = raw ? JSON.parse(raw) : null;
      if (draft && typeof draft.energy === 'number' && typeof draft.sleep === 'number' && typeof draft.mood === 'number') {
        return draft;
      }
    } catch {
      // ignore corrupt data
    }
    return null;
  }

  function writeCheckinDraft(form) {
    try {
      localStorage.setItem(CHECKIN_DRAFT_KEY, JSON.stringify(form));
    } catch {
      // storage full or blocked
    }
  }

  function clearCheckinDraft() {
    try {
      localStorage.removeItem(CHECKIN_DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      flushOfflineQueue(token).then((flushed) => {
        if (flushed) {
          setOfflineNote(null);
          refresh();
        }
      });
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [token, refresh]);

  useEffect(() => {
    if (pushStatus === 'granted' && !urgePeak && active?.id && token) {
      api(`/habits/${active.id}/urges`, { token })
        .then((data) => scheduleTriggerNudges(data.urges || [], token, active.id))
        .then((result) => { if (result) setUrgePeak(result); })
        .catch(() => {});
    }
  }, [pushStatus, urgePeak, active?.id, token]);

  // Deep link from push notifications: /app?action=checkin lands on the check-in card.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('action') !== 'checkin') return;
    const t = setTimeout(() => {
      wellnessRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      wellnessRef.current?.classList.add('flash-focus');
    }, 350);
    const clean = setTimeout(() => {
      window.history.replaceState(null, '', window.location.pathname);
    }, 1600);
    return () => {
      clearTimeout(t);
      clearTimeout(clean);
    };
  }, [active?.id]);

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
    if (pushSupported && pushStatus !== 'granted' && !pushOptInDismissed) {
      api('/analytics/push', { method: 'POST', body: { event: 'push_prompt_shown', variant: pushVariant } }).catch(() => {});
    }
    if (active.journalWeekCount != null && active.journalWeekCount < 3 && streak >= 3) {
      api('/analytics/engagement', { method: 'POST', body: { event: 'journal_prompt_shown' } }).catch(() => {});
    }
    api(`/habits/${active.id}/journals`, { token })
      .then((data) => {
        if (!cancelled) {
          if (data.journals?.length > 0) setLastJournal(data.journals[0]);
          const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
          const weekKey = weekAgo.toISOString().slice(0, 10);
          setJournalWeekCount((data.journals || []).filter((j) => j.date >= weekKey).length);
        }
      })
      .catch(() => {});
    api(`/habits/${active.id}/urges`, { token })
      .then((data) => {
        if (!cancelled) {
          const t = localDate();
          const allUrges = data.urges || [];
          setTotalUrges(allUrges.length);
          setTotalResisted(allUrges.filter((u) => u.resisted).length);
          setTodayUrgeCount(allUrges.filter((u) => String(u.logged_at || '').slice(0, 10) === t).length);
          scheduleTriggerNudges(allUrges, token, active.id).then((result) => {
            if (result) setUrgePeak(result);
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, token]);

  const quote = useMemo(() => (streak > 0 ? pickQuote(streak) : null), [streak]);
  const coachNote = useMemo(
    () =>
      dailyCoachNote({
        streak,
        totalSlips: active?.stats?.totalSlips ?? 0,
        dailyCheckin: wellness,
        todayUrges: todayUrgeCount,
        reason: active?.reason || null,
      }),
    [streak, active?.stats?.totalSlips, active?.reason, wellness, todayUrgeCount]
  );

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
        } else {
          const draft = readCheckinDraft();
          if (draft) setWellnessForm(draft);
        }
      })
      .catch(() => {
        const draft = readCheckinDraft();
        if (draft) setWellnessForm(draft);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, token]);

  useEffect(() => {
    writeCheckinDraft(wellnessForm);
  }, [wellnessForm]);

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
      clearCheckinDraft();
    } catch (err) {
      if (!navigator.onLine) {
        queueOffline({
          path: `/habits/${active.id}/daily-checkin`,
          method: 'POST',
          body: { ...wellnessForm, date: localDate() },
        });
        setWellness({ ...wellnessForm, date: localDate() });
        setWellnessEdit(false);
        clearCheckinDraft();
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
        body: { status: 'slip', note: slipNote.trim() || null, trigger: slipTrigger || null, date: localDate() },
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

  async function handleForgive(forgiven) {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await forgiveCheckin(active.id, localDate(), forgiven, token);
      upsertHabit(res.habit);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleShield() {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await spendShieldToken(active.id, token);
      upsertHabit(res.habit);
      refresh();
      closeFlow();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function closeFlow() {
    setFlow(null);
    setSlipNote('');
    setSlipTrigger('');
    setSlipResetDone(false);
  }

  async function shareMilestone() {
    setFlow((f) => ({ ...f, kind: 'share' }));
  }

  async function getRecoveryPlan() {
    if (!active || recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      const data = await api('/recovery-plan', {
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
      {!isOnline && (
        <div style={{
          padding: '10px 16px',
          background: 'rgba(217,142,106,0.12)',
          border: '1px solid rgba(217,142,106,0.3)',
          borderRadius: 12,
          marginBottom: 16,
          textAlign: 'center',
          color: 'var(--cream)',
          fontSize: 14,
        }}>
          📴 You're offline — check-ins and journal entries will sync when you reconnect.
        </div>
      )}
      {pushSupported && pushStatus !== 'granted' && !pushOptInDismissed && (
        <div className="card" style={{ borderColor: 'rgba(168,192,154,0.35)', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🔔</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, margin: 0, fontSize: 15 }}>
                {pushVariant === 'urgency'
                  ? 'Don\'t miss your nudge window'
                  : 'Stay on track with gentle nudges'}
              </p>
              <p className="muted small" style={{ marginTop: 2 }}>
                {pushVariant === 'urgency'
                  ? 'Your trigger window is coming up. Enable notifications so we can reach you in time.'
                  : 'Enable notifications to get reminders during your trigger windows and milestone celebrations.'}
              </p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={async () => { const ok = await subscribe?.(); if (ok) { setPushOptInDismissed(true); try { localStorage.setItem('bf_push_optin_dismissed', '1'); } catch {} api('/analytics/push', { method: 'POST', body: { event: 'push_prompt_enabled', variant: pushVariant } }).catch(() => {}); } }}>
              Enable
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPushOptInDismissed(true); try { localStorage.setItem('bf_push_optin_dismissed', '1'); api('/analytics/push', { method: 'POST', body: { event: 'push_prompt_dismissed', variant: pushVariant } }).catch(() => {}); } catch {} }} style={{ color: 'var(--muted-2)' }}>
              Later
            </button>
          </div>
        </div>
      )}
      <section className="hero">
        <div className="hero-kicker">
          {greeting}, {user?.email?.split('@')[0]}
        </div>
        <h1 className="hero-title">{active.name}</h1>
        <p className="hero-sub">One day at a time. Today counts.</p>
        <div className="hero-row">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/days-out')}>
            📍 Change of scene
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
                  <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/days-out'); }}>
                    📍 Change of scene
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
                  <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/app/help'); }}>
                    🆘 Get help
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

      {urgePeak && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: 'rgba(217,142,106,0.08)', border: '1px solid rgba(217,142,106,0.25)', borderRadius: 16 }}>
          <span style={{ fontSize: 28 }}>🎯</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 600, margin: 0 }}>Your urge peak is around {urgePeak.label}. Stay ready.</p>
            <p className="muted small" style={{ marginTop: 1 }}>We'll nudge you ahead of that window.</p>
          </div>
        </div>
      )}

      {welcomeHabit && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(229,9,20,0.18), rgba(229,9,20,0.04))',
          border: '1px solid rgba(229,9,20,0.4)',
          borderRadius: 20,
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          animation: 'fade-in 0.35s ease',
        }}>
          <span style={{ fontSize: 32 }}>🎉</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, margin: 0, color: 'var(--cream)' }}>
              Welcome, {welcomeHabit} warrior.
            </p>
            <p className="muted small" style={{ marginTop: 2 }}>
              Your plan is locked in. Every day you show up counts.
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setWelcomeHabit(null)}
            aria-label="Dismiss"
            style={{ flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="streak-card">
        <div className="streak-number">{streak}</div>
        <div className="streak-label">{streak === 1 ? 'day clean' : 'days clean'}</div>
        {streak === 0 && (
          <p className="streak-encourage">
            Day 0 is the hardest day. You're already here — that takes courage. 💪
          </p>
        )}
        {shieldTokens > 0 && (
          <p className="streak-sub" style={{ marginTop: streak === 0 ? 8 : 2 }}>
            🛡️ {shieldTokens} streak {shieldTokens === 1 ? 'token' : 'tokens'} — protects your streak
          </p>
        )}
        <p className="streak-sub">
          {active.stats.totalDays === 0
            ? 'Your journey starts today.'
            : `${active.stats.totalClean} clean days total · ${active.stats.recentClean}/14 clean in the last two weeks`}
        </p>
        {active.stats.forgivenSlips > 0 && (
          <p className="streak-sub" style={{ marginTop: 2 }}>
            💚 {active.stats.forgivenSlips} {active.stats.forgivenSlips === 1 ? 'slip' : 'slips'} forgiven — you kept going
          </p>
        )}
      </div>

      {active.wall?.active && (
        <div className="wall-banner">
          <div className="wall-banner-head">
            <span className="wall-banner-title">🧱 Day {active.wall.day} — inside the Wall</span>
            <span className="badge-pill">Survival mode</span>
          </div>
          <p className="wall-banner-text">{wallMessage(active.wall.day) || SURVIVAL_NOTE}</p>
          <p className="wall-banner-sub">
            Check in twice today and log every urge. This is the window where streaks are won.
          </p>
        </div>
      )}

      {coachNote && (
        <div className="card coach-note-card">
          <div className="coach-note-head">
            <span className="post-avatar" style={{ width: 28, height: 28, fontSize: 14 }}>🧑‍🏫</span>
            <div>
              <p className="card-title" style={{ margin: 0 }}>Daily coach note</p>
              <p className="muted tiny" style={{ marginTop: 1 }}>
                From your check-ins, urges and streak
              </p>
            </div>
          </div>
          <p className="coach-note-text">{coachNote}</p>
        </div>
      )}

      <div className="card wellness-card" ref={wellnessRef}>
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
              { key: 'energy', label: 'Energy', accent: '#ef4444' },
              { key: 'sleep', label: 'Sleep', accent: '#3b82f6' },
              { key: 'mood', label: 'Mood', accent: '#10b981' },
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
                      style={wellness[r.key] === v ? { background: r.accent, borderColor: r.accent } : undefined}
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
              { key: 'energy', label: 'Energy', accent: '#ef4444', lowEnd: 'Low', highEnd: 'High' },
              { key: 'sleep', label: 'Sleep', accent: '#3b82f6', lowEnd: 'Poor', highEnd: 'Excellent' },
              { key: 'mood', label: 'Mood', accent: '#10b981', lowEnd: 'Low', highEnd: 'High' },
            ].map((r) => (
              <RatingRow
                key={r.key}
                label={r.label}
                value={wellnessForm[r.key]}
                onChange={(v) => setWellnessForm((f) => ({ ...f, [r.key]: v }))}
                accentColor={r.accent}
                lowEnd={r.lowEnd}
                highEnd={r.highEnd}
              />
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
                {active.stats.todayForgiven
                  ? 'You forgave this one — your streak is still alive.'
                  : "Tomorrow is a fresh start. You're still here — that counts."}
              </p>
            </div>
          </div>
          {!active.stats.todayForgiven && (
            <button
              className="btn btn-ghost btn-sm mt"
              onClick={() => handleForgive(true)}
              disabled={busy}
              title="Count this slip as a forgiven grace day — it won't break your streak"
            >
              💚 This slip doesn't break my streak
            </button>
          )}
          {active.relapsePlan && (
            <div className="card mt" style={{ padding: 14, background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
              <p className="card-title" style={{ margin: 0 }}>📜 Your plan for this moment</p>
              <p style={{ fontSize: 15, lineHeight: 1.5, margin: '8px 0 0' }}>{active.relapsePlan}</p>
            </div>
          )}
          <div className="row mt">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={getRecoveryPlan} disabled={recoveryBusy}>
              {recoveryBusy ? 'Building your plan...' : '🗺️ 3-day recovery plan'}
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
        <button className="btn btn-primary btn-block mt" onClick={() => setShowUrgeQuick(true)}>
          ⚡ Log an urge
        </button>
      </div>

      <div className="card help-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 30 }}>🆘</span>
          <div style={{ flex: 1 }}>
            <p className="card-title" style={{ margin: 0 }}>Get help right now</p>
            <p className="muted small" style={{ marginTop: 2 }}>
              Urge hitting hard? Call a support line, breathe through it, or find local resources.
            </p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm mt" onClick={() => navigate('/app/help')}>
          Open help
        </button>
      </div>

      <button
        className="fab"
        onClick={() => { setShowFabTooltip(false); try { localStorage.setItem('bf_fab_tooltip_dismissed', '1'); } catch {} api('/analytics/engagement', { method: 'POST', body: { event: 'fab_opened' } }).catch(() => {}); setShowUrgeQuick(true); }}
        aria-label="Urge quick actions"
        title="Need help with an urge?"
      >
        ⚡
      </button>
      <button
        className="fab fab-exit"
        onClick={() => window.open('https://www.google.com', '_blank')}
        aria-label="Quick exit — opens a neutral page"
        title="Quick exit"
      >
        🚪
      </button>

      {showFabTooltip && (
        <div
          onClick={() => { setShowFabTooltip(false); try { localStorage.setItem('bf_fab_tooltip_dismissed', '1'); } catch {} }}
          style={{
            position: 'fixed',
            bottom: 90,
            right: 20,
            maxWidth: 260,
            background: 'var(--bg-soft)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '14px 16px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            zIndex: 9999,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--cream)',
          }}
        >
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>⚡ Need help right now?</p>
          <p className="muted small" style={{ margin: 0 }}>
            Tap the red button anytime for breathing exercises, thought reframes, or a quick urge log.
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted-2)' }}>Tap to dismiss</p>
        </div>
      )}

      {active.stats.moneySaved > 0 || active.stats.timeSaved > 0 || active.stats.unitsAvoided > 0 || totalResisted > 0 ? (
        <div className="metric-grid">
          {totalResisted > 0 && (
            <div className="metric">
              <div className="value">{totalResisted.toLocaleString()}</div>
              <div className="label">urges resisted</div>
            </div>
          )}
          {active.stats.unitsAvoided > 0 && (
            <div className="metric">
              <div className="value">{active.stats.unitsAvoided.toLocaleString()}</div>
              <div className="label">{unitLabel(active.name)} avoided</div>
            </div>
          )}
          {active.stats.moneySaved > 0 && (
            <div className="metric">
              <div className="value">£{active.stats.moneySaved.toLocaleString()}</div>
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

      {active.reason && (
        <div className="card">
          <p className="card-title">🕯️ Why you're doing this</p>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: 0 }}>{active.reason}</p>
        </div>
      )}

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
            Streaks, savings and patterns — unpacked for you.
          </p>
          {active.stats.moneySaved > 0 && (
            <p className="report-preview">
              £{active.stats.moneySaved.toLocaleString()} saved · {active.stats.unitsAvoided} {unitLabel(active.name).toLowerCase()} avoided this streak
            </p>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/report')}>
          Open
        </button>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 30 }}>✨</span>
        <div style={{ flex: 1 }}>
          <p className="card-title" style={{ margin: 0 }}>Your coach is here</p>
          <p className="muted small" style={{ marginTop: 2 }}>
            Reads your streaks, urges and journal — always on your side.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/app/coach')}>
          Chat
        </button>
      </div>

      {active.journalWeekCount != null && active.journalWeekCount < 3 && streak >= 3 && (
        <div className="card" style={{ borderColor: 'rgba(168,192,154,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>📝</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, margin: 0, fontSize: 15 }}>Journal 3× this week</p>
              <p className="muted small" style={{ marginTop: 2 }}>
                {(active.journalWeekCount || 0) === 0
                  ? 'No journal entries yet this week. Writing for 2 minutes helps you spot patterns and stay grounded.'
                  : `${active.journalWeekCount} this week — one more and you hit your goal.`}
              </p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { navigate('/app/journal'); api('/analytics/engagement', { method: 'POST', body: { event: 'journal_prompt_clicked' } }).catch(() => {}); }}>
              Write now
            </button>
          </div>
        </div>
      )}

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
          {active.journalWeekBadgeEarned && (
            <div className="badge earned" style={{ '--tier': '#A8C09A' }} title="Journal 3× this week">
              <div className="medal" style={{ fontSize: 20 }}>📝</div>
              <div className="days">Reflector</div>
            </div>
          )}
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
            <div className="field">
              <label>What triggered it?</label>
              <div className="chip-row">
                {[
                  { value: 'stress', label: '😫 Stress' },
                  { value: 'boredom', label: '😴 Boredom' },
                  { value: 'social', label: '🎉 Social' },
                  { value: 'emotional', label: '🌧️ Emotional' },
                  { value: 'place', label: '📍 Place / routine' },
                  { value: 'habit', label: '🍺 Around the habit' },
                  { value: 'other', label: '🗒️ Other' },
                ].map((t) => (
                  <button
                    type="button"
                    key={t.value}
                    className={`chip${slipTrigger === t.value ? ' active' : ''}`}
                    onClick={() => setSlipTrigger(slipTrigger === t.value ? '' : t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {!slipResetDone && (
              <button
                className="btn btn-ghost btn-block mt"
                type="button"
                onClick={() => {
                  setSlipResetDone(true);
                  navigate('/app/help');
                }}
                style={{ borderColor: 'rgba(168,192,154,0.35)', color: 'var(--sage)' }}
              >
                🧘 Try the 5-minute reset first
              </button>
            )}
            <textarea
              value={slipNote}
              onChange={(e) => setSlipNote(e.target.value)}
              placeholder="What triggered it? How were you feeling?"
              maxLength={300}
              style={{ width: '100%', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: 14, fontFamily: 'var(--font-body)', fontSize: 15, minHeight: 110, resize: 'vertical' }}
            />
            {shieldTokens > 0 && (
              <button
                className="btn btn-ghost btn-block mt"
                onClick={handleShield}
                disabled={busy}
                title="Spend one token to convert this slip into a forgiven grace day — your streak stays alive."
              >
                🛡️ Use a streak token ({shieldTokens}) — keep your streak
              </button>
            )}
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
        <Celebration
          kind="clean"
          quote={flow.quote}
          badge={flow.badge}
          onClose={closeFlow}
          onShare={flow.badge ? shareMilestone : undefined}
        />
      )}
      {flow?.kind === 'slip' && <Celebration kind="slip" onClose={closeFlow} />}
      {flow?.kind === 'share' && flow.badge && (
        <ShareCard
          habitId={active.id}
          habitName={active.name}
          days={flow.badge.threshold}
          moneySaved={active.stats.moneySaved}
          onClose={closeFlow}
        />
      )}

      {showUrgeQuick && <UrgeQuickPanel habitId={active.id} onClose={() => setShowUrgeQuick(false)} />}
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





