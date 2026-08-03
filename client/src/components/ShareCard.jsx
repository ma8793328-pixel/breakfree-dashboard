import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { recordShare, fetchShareTotal } from '../api.js';
import { MILESTONES } from '../data.js';

export default function ShareCard({ habitId, habitName, days, moneySaved, onClose }) {
  const { token } = useAuth();
  const [shared, setShared] = useState(false);
  const [total, setTotal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const meta = MILESTONES.find((m) => m.days === days) || { icon: '🏆', label: `${days} Days`, tier: '#888888' };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    fetchShareTotal()
      .then((d) => setTotal(d.total))
      .catch(() => {});
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  async function onShare() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await recordShare(habitId, days, token);
      setTotal(d.total);
      setShared(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="celebration" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="share-card" style={{ '--tier': meta.tier }}>
          <div className="share-card-head">
            <span className="share-card-logo">🔥 BreakFree</span>
            <span className="share-card-badge">{meta.icon}</span>
          </div>
          <div className="share-card-days">
            <span className="share-card-num">{days}</span>
            <span className="share-card-unit">days clean</span>
          </div>
          <p className="share-card-name">“{habitName}” — my day {days} is done.</p>
          {moneySaved > 0 && (
            <p className="share-card-saved">
              <strong>£{moneySaved.toLocaleString()}</strong> saved along the way
            </p>
          )}
          <div className="share-card-foot">breakfree.app</div>
        </div>

        {shared ? (
          <p className="share-done" role="status">
            ✓ Shared — {total != null ? `${total.toLocaleString()} milestones reached` : 'thank you'}.
          </p>
        ) : (
          <>
            <button className="btn btn-primary btn-block" onClick={onShare} disabled={busy}>
              {busy ? 'Sharing...' : '📣 Share this card'}
            </button>
            {error && <p className="error-text">{error}</p>}
            <p className="muted small" style={{ marginTop: 8, textAlign: 'center' }}>
              {total != null
                ? `${total.toLocaleString()} milestone${total === 1 ? '' : 's'} reached by the community`
                : 'Sharing is optional — it just adds to a community counter.'}
            </p>
          </>
        )}
        <button className="btn btn-ghost btn-block mt" onClick={onClose}>
          {shared ? 'Done' : 'Not right now'}
        </button>
      </div>
    </div>
  );
}
