import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { usePushNotifications } from '../usePushNotifications.js';

const PREFS = [
  { key: 'dailyReminder', title: 'Daily check-in reminders', desc: 'A gentle nudge when your sleep score comes in low.' },
  { key: 'urgeTips', title: 'Urge & craving tips', desc: 'A quick coping tip after you log an urge.' },
  { key: 'milestones', title: 'Milestone celebrations', desc: 'A cheer when you earn a new streak badge.' },
];

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export default function SettingsPage() {
  const { token } = useAuth();
  const { supported: pushSupported, status: pushStatus, subscribe: enablePush, error: pushError } =
    usePushNotifications(token);
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/settings/notifications', { token })
      .then((data) => {
        if (!cancelled) setPrefs(data.prefs);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function setPref(key, value) {
    setPrefs((p) => ({ ...p, [key]: value }));
    setBusy(true);
    setError(null);
    try {
      const data = await api('/settings/notifications', {
        method: 'PUT',
        token,
        body: { [key]: value },
      });
      setPrefs(data.prefs);
    } catch (e) {
      setPrefs((p) => ({ ...p, [key]: !value }));
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const statusText =
    !pushSupported
      ? 'This browser doesn\'t support push notifications.'
      : pushStatus === 'granted'
        ? 'Notifications are allowed. You\'ll get alerts on this device.'
        : pushStatus === 'denied'
          ? 'Blocked in your browser. Allow breakfree notifications in your browser settings to receive alerts.'
          : 'Not enabled yet. Turn them on to get alerts on this device.';

  return (
    <Layout>
      <h1 className="page-title">🔔 Notifications</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Choose what your coach nudges you about. Everything stays on this device.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <p className="card-title">Alerts</p>
        {prefs ? (
          <div className="settings-list">
            {PREFS.map((p) => (
              <div className="settings-row" key={p.key}>
                <div style={{ flex: 1 }}>
                  <p className="settings-title">{p.title}</p>
                  <p className="muted small">{p.desc}</p>
                </div>
                <Toggle
                  checked={!!prefs[p.key]}
                  onChange={(v) => setPref(p.key, v)}
                  label={p.title}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Loading preferences...</p>
        )}
        {busy && <p className="muted small" style={{ marginTop: 10 }}>Saving…</p>}
      </div>

      <div className="card">
        <p className="card-title">This device</p>
        {pushSupported && pushStatus !== 'granted' && (
          <button className="btn btn-primary btn-block" onClick={() => enablePush()} disabled={busy}>
            {pushStatus === 'denied' ? 'Re-request notifications' : 'Enable notifications'}
          </button>
        )}
        {pushSupported && pushStatus === 'granted' && (
          <span className="badge-pill">🔔 On</span>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>{statusText}</p>
        {pushError && <p className="error-text">{pushError}</p>}
        <p className="muted small" style={{ marginTop: 10 }}>
          Notifications need the browser to stay installed on this device — there are no accounts or
          servers outside your machine.
        </p>
      </div>
    </Layout>
  );
}
