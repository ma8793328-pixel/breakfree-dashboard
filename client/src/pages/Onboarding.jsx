import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { usePushNotifications } from '../usePushNotifications.js';

const TRIGGER_BUCKETS = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Late night'];

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { habits, loading, refresh } = useHabits();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [unitsPerDay, setUnitsPerDay] = useState('');
  const [reason, setReason] = useState('');
  const [triggerTimes, setTriggerTimes] = useState([]);
  const [relapsePlan, setRelapsePlan] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState('forward');
  const [showCelebration, setShowCelebration] = useState(false);
  const [animKey, setAnimKey] = useState(0);

  const stepRef = useRef(null);

  useEffect(() => {
    if (!loading && habits.length > 0) navigate('/app', { replace: true });
  }, [loading, habits, navigate]);

  useEffect(() => {
    if (stepRef.current) {
      stepRef.current.classList.remove('step-enter-forward', 'step-enter-back');
      void stepRef.current.offsetWidth;
      stepRef.current.classList.add(direction === 'forward' ? 'step-enter-forward' : 'step-enter-back');
    }
    setAnimKey((k) => k + 1);
  }, [step, direction]);

  function goNext() {
    setDirection('forward');
    setStep((s) => s + 1);
  }

  function goBack() {
    setDirection('back');
    setStep((s) => s - 1);
  }

  function toggleTrigger(t) {
    setTriggerTimes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  async function createHabit() {
    setError(null);
    setBusy(true);
    try {
      await api('/habits', {
        method: 'POST',
        token,
        body: {
          name: name.trim(),
          startDate: todayStr(),
          unitsPerDay: unitsPerDay ? parseFloat(unitsPerDay) : null,
          reason: reason.trim() || null,
          triggerTimes,
          relapsePlan: relapsePlan.trim() || null,
        },
      });
      await api('/settings/notifications', {
        method: 'PUT',
        token,
        body: { reminderTime: reminderTime || null },
      });
      await refresh();
      setShowCelebration(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function handleCelebrationClose() {
    setShowCelebration(false);
    setBusy(false);
    navigate('/app', { replace: true });
  }

  const canNextStep0 = name.trim().length > 0;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
          <div className="logo-row">
            <img src="/logo.png" alt="BreakFree" className="logo-badge" />
            <span className="logo-text">BreakFree</span>
          </div>

        <div className="onboard-steps" aria-label="Progress">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`onboard-step${step === i ? ' active' : ''}${step > i ? ' done' : ''}`}
            />
          ))}
        </div>

        {showCelebration && (
          <div className="celebration" onClick={handleCelebrationClose}>
            <div className="panel" onClick={(e) => e.stopPropagation()}>
              <div className="big-icon">🎉</div>
              <h2>Welcome to BreakFree!</h2>
              <p className="desc">
                Your plan for <strong>{name.trim()}</strong> is locked in. Every day you show up is a win. Let&apos;s do this.
              </p>
              <button className="btn btn-primary btn-block" onClick={handleCelebrationClose}>
                Let&apos;s go
              </button>
            </div>
          </div>
        )}

        <div
          key={animKey}
          ref={stepRef}
          className="onboard-step-panel"
        >
          {step === 0 && (
            <div className="card">
              <h3 style={{ marginBottom: 4 }}>What are you breaking free from?</h3>
              <p className="muted small" style={{ marginBottom: 16 }}>
                Be specific — &quot;smoking cigarettes&quot; works better than &quot;bad habits&quot;
              </p>
              <div className="field">
                <label htmlFor="ob-name">The habit</label>
                <input
                  id="ob-name"
                  placeholder="e.g. Smoking, scrolling, late-night snacking..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="ob-units">How many times per day?</label>
                <div className="row">
                  <input
                    id="ob-units"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 10"
                    value={unitsPerDay}
                    onChange={(e) => setUnitsPerDay(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span className="muted" style={{ alignSelf: 'center' }}>per day</span>
                </div>
                <p className="hint">We&apos;ll count every one you avoid — it adds up fast.</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="card">
              <h3 style={{ marginBottom: 4 }}>Why this matters</h3>
              <p className="muted small" style={{ marginBottom: 16 }}>
                Understanding your triggers is the first step to outsmarting them
              </p>
              <div className="field">
                <label htmlFor="ob-why">Your reason</label>
                <textarea
                  id="ob-why"
                  placeholder="The life you're building — health, money, energy, the people you love..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                  style={{
                    width: '100%',
                    minHeight: 140,
                    background: 'var(--bg-soft)',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    color: 'var(--cream)',
                    padding: 14,
                    fontFamily: 'var(--font-body)',
                    fontSize: 15,
                    resize: 'vertical',
                  }}
                />
              </div>
              <p className="hint" style={{ marginBottom: 10, marginTop: -6 }}>
                One honest sentence. This becomes your anchor on the hard days.
              </p>
              <label className="field-label-inline" style={{ marginBottom: 8 }}>
                When do urges usually hit?
              </label>
              <div className="chip-row">
                {TRIGGER_BUCKETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip${triggerTimes.includes(t) ? ' active' : ''}`}
                    onClick={() => toggleTrigger(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="hint">Choose as many as you like — skip it if you&apos;re not sure.</p>
            </div>
          )}

          {step === 2 && (
            <div className="card">
              <div
                className="coach-bubble"
                style={{
                  background: 'var(--bg-soft)',
                  border: '1px solid var(--border)',
                  borderRadius: 18,
                  padding: '14px 16px',
                  marginBottom: 18,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 22, flexShrink: 0 }}>🧑‍🏫</span>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--cream)' }}>
                  Hey — I&apos;m your coach. I&apos;ll be here whenever you need me.
                  Let&apos;s get you set up.
                </p>
              </div>

              <h3 style={{ marginBottom: 4 }}>Your first plan</h3>

              <div className="field">
                <label htmlFor="ob-relapse">
                  Write a short plan for when an urge hits. What will you do instead?
                </label>
                <textarea
                  id="ob-relapse"
                  placeholder="e.g. I won't spiral. I'll step away for 10 minutes, log an honest check-in, and keep my streak going tomorrow. One slip isn't the end."
                  value={relapsePlan}
                  onChange={(e) => setRelapsePlan(e.target.value)}
                  maxLength={400}
                  style={{
                    width: '100%',
                    minHeight: 110,
                    background: 'var(--bg-soft)',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    color: 'var(--cream)',
                    padding: 14,
                    fontFamily: 'var(--font-body)',
                    fontSize: 15,
                    resize: 'vertical',
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="ob-reminder">Daily reminder time (optional)</label>
                <input
                  id="ob-reminder"
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                />
                <p className="hint">We&apos;ll nudge you every day around then. Leave blank for the default morning window.</p>
              </div>
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="row mt">
          {step > 0 && (
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={goBack}>
              Back
            </button>
          )}
          {step < 2 ? (
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={step === 0 && !canNextStep0}
              onClick={goNext}
            >
              Next
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ flex: 2 }}
              disabled={busy}
              onClick={createHabit}
            >
              {busy ? 'Starting...' : '🔥 Start my journey'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
