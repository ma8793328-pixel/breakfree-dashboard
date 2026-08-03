import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const TRIGGER_TYPES = [
  { value: 'stress', label: '😫 Stress' },
  { value: 'boredom', label: '😴 Boredom' },
  { value: 'social', label: '🎉 Social' },
  { value: 'emotional', label: '🌧️ Emotional' },
  { value: 'place', label: '📍 Place / routine' },
  { value: 'habit', label: '🍺 Around the habit' },
  { value: 'other', label: '🗒️ Other' },
];

const ACTIONS = [
  { value: 'waited', label: '💪 Waited it out' },
  { value: 'scene', label: '🚶 Changed the scene' },
  { value: 'breathed', label: '🧘 Breathed / grounded' },
  { value: 'talked', label: '🗣️ Talked to someone' },
  { value: 'distracted', label: '🎮 Distracted myself' },
  { value: 'gave-in', label: '⚠️ Gave in' },
];

export default function UrgeModal({ habitId, onClose, onSaved }) {
  const { token } = useAuth();
  const [intensity, setIntensity] = useState(3);
  const [triggerType, setTriggerType] = useState('');
  const [triggerNote, setTriggerNote] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/habits/${habitId}/urges`, {
        method: 'POST',
        token,
        body: {
          intensity,
          triggerType: triggerType || null,
          trigger: triggerNote.trim() || null,
          action: action || null,
          resisted: action !== 'gave-in',
        },
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h3>Log an urge</h3>
        <p className="sub">Noticing the urge is a win — it means you're paying attention.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label>How strong was it?</label>
            <div className="intensity">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  className={intensity === n ? 'selected' : ''}
                  onClick={() => setIntensity(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>What triggered it?</label>
            <div className="chip-row">
              {TRIGGER_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  className={`chip${triggerType === t.value ? ' active' : ''}`}
                  onClick={() => setTriggerType(triggerType === t.value ? '' : t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="u-trigger-note">Anything else about it? (optional)</label>
            <input
              id="u-trigger-note"
              placeholder="Where were you? What was happening?"
              value={triggerNote}
              onChange={(e) => setTriggerNote(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label>What did you do?</label>
            <div className="chip-row">
              {ACTIONS.map((a) => (
                <button
                  type="button"
                  key={a.value}
                  className={`chip${action === a.value ? ' active' : ''}`}
                  onClick={() => setAction(action === a.value ? '' : a.value)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="hint">
              {action === 'gave-in'
                ? 'A slip is a data point, not a verdict. Logging it honestly is strength.'
                : action
                  ? 'Every resisted urge weakens the next one. 💪'
                  : 'Picking this helps your coach spot what actually works for you.'}
            </p>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-block mt" type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save urge'}
          </button>
        </form>
      </div>
    </div>
  );
}
