import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function UrgeModal({ habitId, onClose, onSaved }) {
  const { token } = useAuth();
  const [intensity, setIntensity] = useState(3);
  const [trigger, setTrigger] = useState('');
  const [resisted, setResisted] = useState(true);
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
        body: { intensity, trigger, resisted },
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
            <label htmlFor="u-trigger">What triggered it? (optional)</label>
            <input
              id="u-trigger"
              placeholder="Stress, boredom, a certain place..."
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="toggle-label">Did you resist it?</div>
              <div className="small muted">Every resisted urge weakens the habit.</div>
            </div>
            <button type="button" className={`toggle${resisted ? ' on' : ''}`} onClick={() => setResisted((v) => !v)} />
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
