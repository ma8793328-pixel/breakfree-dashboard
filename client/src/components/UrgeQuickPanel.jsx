import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const MODES = [
  { id: 'breathe', emoji: '⚡', label: 'I need to calm down', sub: '2-minute breathing' },
  { id: 'reframe', emoji: '🧠', label: "I'm stuck in my head", sub: 'Challenge the urge' },
  { id: 'shift', emoji: '🌍', label: 'I need to move', sub: '5-minute reset tasks' },
  { id: 'log', emoji: '📝', label: 'Just logging it', sub: 'Record the trigger' },
];

const BREATH_STEPS = [
  { text: 'Breathe in slowly through your nose...', duration: 4000 },
  { text: 'Hold gently...', duration: 4000 },
  { text: 'Breathe out through your mouth...', duration: 4000 },
  { text: 'Hold gently...', duration: 4000 },
];

const SHIFT_TASKS = [
  'Do 10 push-ups or 20 jumping jacks',
  'Walk outside for 5 minutes',
  'Put on a song and dance it out',
  'Drink a glass of water slowly',
  'Step outside for fresh air',
  'Do a quick stretch routine',
  'Call or text a friend',
  'Tidy one small area (desk, kitchen counter)',
];

const REFRAME_QUESTIONS = [
  'What is the urge telling me I need right now?',
  'Is that true, or is it just a craving?',
  'What is one thing I could do instead that would still meet that need?',
  'If I wait 10 minutes, will this feel as strong?',
];

export default function UrgeQuickPanel({ habitId, onClose }) {
  const { token } = useAuth();
  const [mode, setMode] = useState(null);
  const [breathStep, setBreathStep] = useState(0);
  const [breathActive, setBreathActive] = useState(false);
  const [reframe, setReframe] = useState({ qIndex: 0, answer: '', done: false });
  const [shiftPicked, setShiftPicked] = useState(null);
  const [logNote, setLogNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function startBreath() {
    setBreathActive(true);
    setBreathStep(0);
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setBreathStep(i % BREATH_STEPS.length);
      if (i >= 11) {
        clearInterval(iv);
        setBreathActive(false);
      }
    }, 4000);
  }

  async function saveLog() {
    if (!logNote.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/habits/${habitId}/urges`, {
        method: 'POST',
        token,
        body: {
          intensity: 3,
          trigger: logNote.trim(),
          triggerType: 'other',
          action: 'waited',
          resisted: true,
        },
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!mode) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          <h3 style={{ margin: '0 0 4px' }}>What do you need right now?</h3>
          <p className="sub" style={{ margin: '0 0 18px' }}>Pick the mode that matches how you feel.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                className="urge-mode-btn"
                onClick={() => setMode(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 14,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-soft)',
                  color: 'var(--cream)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ fontSize: 22 }}>{m.emoji}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{m.label}</div>
                  <div className="muted small">{m.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'breathe') {
    const step = BREATH_STEPS[breathStep % BREATH_STEPS.length];
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, textAlign: 'center' }}>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          <h3 style={{ margin: '0 0 16px' }}>⚡ Pause & Breathe</h3>
          {!breathActive ? (
            <>
              <p className="sub" style={{ marginBottom: 18 }}>
                Follow the prompt for 2 minutes. You’ve got this.
              </p>
              <button className="btn btn-primary btn-block" onClick={startBreath}>
                Start breathing
              </button>
            </>
          ) : (
            <>
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(229,9,20,0.25), transparent)',
                  margin: '0 auto 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 48,
                  animation: 'pulse 4s ease-in-out infinite',
                }}
              >
                🫁
              </div>
              <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.5, margin: '0 0 18px' }}>{step.text}</p>
              <p className="muted small">Stay with it — each breath is a small win.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'reframe') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          <h3 style={{ margin: '0 0 4px' }}>🧠 Reframe the Thought</h3>
          <p className="sub" style={{ margin: '0 0 14px' }}>
            The urge is telling you a story. Question it.
          </p>
          {!reframe.done ? (
            <>
              <div style={{ background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{REFRAME_QUESTIONS[reframe.qIndex]}</p>
              </div>
              <textarea
                value={reframe.answer}
                onChange={(e) => setReframe((r) => ({ ...r, answer: e.target.value }))}
                placeholder="Write your answer here..."
                maxLength={300}
                style={{ width: '100%', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: 14, fontFamily: 'var(--font-body)', fontSize: 15, minHeight: 100, resize: 'vertical' }}
              />
              <div className="row mt" style={{ gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setReframe((r) => ({ ...r, qIndex: Math.max(0, r.qIndex - 1) }))} disabled={reframe.qIndex === 0}>
                  Back
                </button>
                {reframe.qIndex < REFRAME_QUESTIONS.length - 1 ? (
                  <button className="btn btn-primary" onClick={() => setReframe((r) => ({ ...r, qIndex: r.qIndex + 1 }))}>
                    Next question
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => setReframe((r) => ({ ...r, done: true }))}>
                    I see it clearly now
                  </button>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: 40, margin: '0 0 10px' }}>🧠</p>
              <p style={{ fontWeight: 700, margin: '0 0 6px' }}>You just proved the urge wrong.</p>
              <p className="muted small">
                The craving is not a command. You get to choose what happens next.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'shift') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          <h3 style={{ margin: '0 0 4px' }}>🌍 Shift Focus</h3>
          <p className="sub" style={{ margin: '0 0 14px' }}>
            Pick one thing and do it for 5 minutes. Movement changes everything.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SHIFT_TASKS.map((task, i) => (
              <button
                key={i}
                className="urge-mode-btn"
                onClick={() => setShiftPicked(task)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: shiftPicked === task ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: shiftPicked === task ? 'rgba(229,9,20,0.08)' : 'var(--bg-soft)',
                  color: 'var(--cream)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ fontSize: 18 }}>{shiftPicked === task ? '✅' : '○'}</span>
                <span style={{ fontSize: 14, fontWeight: shiftPicked === task ? 700 : 400 }}>{task}</span>
              </button>
            ))}
          </div>
          {shiftPicked && (
            <div style={{ marginTop: 14, padding: 14, background: 'rgba(168,192,154,0.08)', border: '1px solid rgba(168,192,154,0.25)', borderRadius: 14 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 14 }}>Your move:</p>
              <p style={{ margin: 0, fontSize: 15 }}>{shiftPicked}</p>
              <p className="muted small" style={{ marginTop: 6 }}>Start now. Even 2 minutes breaks the loop.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'log') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          <h3 style={{ margin: '0 0 4px' }}>📝 Log the urge</h3>
          <p className="sub" style={{ margin: '0 0 14px' }}>
            What triggered it? One line is enough.
          </p>
          {!saved ? (
            <>
              <textarea
                value={logNote}
                onChange={(e) => setLogNote(e.target.value)}
                placeholder="Stress? Boredom? A person or place?"
                maxLength={200}
                style={{ width: '100%', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: 14, fontFamily: 'var(--font-body)', fontSize: 15, minHeight: 100, resize: 'vertical' }}
              />
              {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
              <button
                className="btn btn-primary btn-block mt"
                onClick={saveLog}
                disabled={busy || !logNote.trim()}
              >
                {busy ? 'Saving...' : 'Save entry'}
              </button>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: 40, margin: '0 0 10px' }}>✅</p>
              <p style={{ fontWeight: 700, margin: '0 0 6px' }}>Logged.</p>
              <p className="muted small">
                Awareness is half the battle. You just proved you're stronger than the urge.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
