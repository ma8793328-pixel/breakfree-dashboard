import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { recordShare, fetchShareTotal } from '../api.js';
import { MILESTONES, SKILL_BADGES } from '../data.js';

export default function ShareCard({ habitId, habitName, days, moneySaved, onClose, skill }) {
  const { token } = useAuth();
  const [shared, setShared] = useState(false);
  const [total, setTotal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isSkill = !!skill;
  const meta = isSkill
    ? SKILL_BADGES.find((s) => s.id === skill) || { icon: '⭐', label: skill, tier: '#888888' }
    : MILESTONES.find((m) => m.days === days) || { icon: '🏆', label: `${days} Days`, tier: '#888888' };

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
      const d = await recordShare(habitId, days || skill, token);
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
            <span className="share-card-logo">
              <img src="/logo.png" alt="BreakFree" style={{ width: 20, height: 20, verticalAlign: 'middle', marginRight: 4 }} />
              BreakFree
            </span>
            <span className="share-card-badge">{meta.icon}</span>
          </div>
          {isSkill ? (
            <div className="share-card-days">
              <span className="share-card-num">{meta.icon}</span>
              <span className="share-card-unit">{meta.label}</span>
            </div>
          ) : (
            <div className="share-card-days">
              <span className="share-card-num">{days}</span>
              <span className="share-card-unit">days clean</span>
            </div>
          )}
          <p className="share-card-name">
            {isSkill ? `Unlocked: ${meta.label}` : `"${habitName}" — my day ${days} is done.`}
          </p>
          {!isSkill && moneySaved > 0 && (
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