import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { useSubscription } from '../subscription.jsx';
import { api } from '../api.js';

const PERKS = [
  { icon: '🧠', title: 'AI coach that remembers', text: 'Grounds every reply in your real journal and urge history.' },
  { icon: '🗺️', title: 'Days out with photos', text: 'Real nearby places with real photos, for when the urge hits.' },
  { icon: '📊', title: 'Monthly reports', text: 'Streaks, savings, triggers and patterns — unpacked every month.' },
  { icon: '🛟', title: 'Recovery plans', text: 'A ready-made 3-day plan to rebuild momentum after a slip.' },
  { icon: '🔍', title: 'Deeper urge analysis', text: 'Peak windows and trigger patterns your journal reveals.' },
  { icon: '♾️', title: 'Unlimited habits', text: 'The free plan caps at 1 habit. Premium covers every journey.' },
];

export default function PremiumPage() {
  const { token } = useAuth();
  const { sub, loading, premium, refresh } = useSubscription();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmStep, setConfirmStep] = useState(null);

  async function startCheckout() {
    setBusy(true);
    setError(null);
    try {
      const data = await api('/subscription/checkout', { method: 'POST', token });
      if (data.alreadyPremium) {
        await refresh();
        return;
      }
      setConfirmStep(data.session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment() {
    setBusy(true);
    setError(null);
    try {
      await api('/subscription/complete', { method: 'POST', token, body: { sessionId: confirmStep.id } });
      setConfirmStep(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelPlan() {
    setBusy(true);
    setError(null);
    try {
      await api('/subscription/cancel', { method: 'POST', token });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <Layout>
      <h1 className="page-title">Premium</h1>
      <p className="page-sub">A little more help, for the long haul.</p>

      <div className="premium-hero">
        <div className="ph-badge">👑</div>
        <div className="ph-title">{premium ? 'You\'re Premium' : 'Unlock the full BreakFree'}</div>
        <p className="ph-sub">
          {premium
            ? `Renews ${fmtDate(sub?.renewsAt)} — thank you for investing in yourself.`
            : 'Everything you need to stay ahead of the urge, and get out into the world.'}
        </p>
        {premium ? (
          <div className="ph-price">
            <span className="ph-amount">$4.99</span>
            <span className="ph-per">/month</span>
          </div>
        ) : (
          <div className="ph-price">
            <span className="ph-amount">$4.99</span>
            <span className="ph-per">/month</span>
          </div>
        )}
        {!premium && (
          <button className="btn btn-primary btn-block mt" onClick={startCheckout} disabled={busy}>
            {busy ? 'Preparing checkout...' : 'Go Premium'}
          </button>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="perk-list">
        {PERKS.map((p) => (
          <div className="perk" key={p.title}>
            <span className="perk-icon">{p.icon}</span>
            <div>
              <div className="perk-title">{p.title}</div>
              <div className="perk-text">{p.text}</div>
            </div>
          </div>
        ))}
      </div>

      {premium && (
        <div className="card">
          <p className="card-title">Manage plan</p>
          <div className="divider" />
          <div className="toggle-row">
            <div>
              <div className="toggle-label">Current plan</div>
              <div className="meta">Premium · started {fmtDate(sub?.startedAt)}</div>
            </div>
            <span className="badge-pill ok">Active</span>
          </div>
          <div className="toggle-row">
            <div>
              <div className="toggle-label">Renewal</div>
              <div className="meta">{fmtDate(sub?.renewsAt)}</div>
            </div>
            <span className="badge-pill ok">Auto</span>
          </div>
          <button className="btn btn-slip btn-block mt" onClick={cancelPlan} disabled={busy}>
            {busy ? 'Working...' : 'Cancel subscription'}
          </button>
          <p className="hint small" style={{ marginTop: 8, color: 'var(--muted-2)' }}>
            You keep Premium until the renewal date, then return to the free plan.
          </p>
        </div>
      )}

      {!premium && (
        <div className="card">
          <p className="card-title">Still free?</p>
          <p className="muted small">
            The free plan includes <strong>1 habit</strong> and the offline coach. Upgrade any time — no lock-in.
          </p>
          <button className="btn btn-ghost btn-block mt" onClick={() => navigate('/app')}>
            Back to today
          </button>
        </div>
      )}

      {confirmStep && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirmStep(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => !busy && setConfirmStep(null)} aria-label="Close">✕</button>
            <h3>Demo checkout</h3>
            <p className="sub">
              This is a simulated payment to keep the app self-contained. In production this is replaced by a real
              Stripe checkout session.
            </p>
            <div className="card" style={{ background: 'var(--bg-soft)' }}>
              <div className="toggle-row" style={{ padding: '8px 0' }}>
                <span>BreakFree Premium</span>
                <span className="badge-pill ok">$4.99 / mo</span>
              </div>
              <div className="toggle-row" style={{ padding: '8px 0' }}>
                <span className="meta">Card</span>
                <span className="meta">4242 4242 4242 4242</span>
              </div>
            </div>
            <div className="row mt">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmStep(null)} disabled={busy}>
                Back
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={confirmPayment} disabled={busy}>
                {busy ? 'Confirming...' : 'Confirm payment'}
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>
        </div>
      )}

      {loading && (
        <div className="loading-screen" style={{ minHeight: '20vh' }}>
          <div className="spinner" />
        </div>
      )}
    </Layout>
  );
}
