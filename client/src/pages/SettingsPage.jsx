import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { usePushNotifications } from '../usePushNotifications.js';
import { api, exportAccountData, deleteAccount, changePassword } from '../api.js';

const PREFS = [
  { key: 'triggerNudges', title: 'Trigger-time nudges', desc: 'A nudge at your usual trigger times to log how you\'re feeling.' },
  { key: 'dailyReminder', title: 'Daily check-in reminders', desc: 'A gentle morning nudge while your streak is alive.' },
  { key: 'urgeTips', title: 'Urge & craving tips', desc: 'A quick coping tip after you log an urge.' },
  { key: 'milestones', title: 'Milestone celebrations', desc: 'A cheer when you earn a new streak badge.' },
  { key: 'digestOptIn', title: 'Weekly email digest', desc: 'A Sunday summary of your clean days, urges and savings — by email.' },
  { key: 'reEngageOptIn', title: 'Re-engagement nudges', desc: 'If you go quiet for a day or two, gentle check-in pushes to bring you back.' },
  { key: 'emailOptIn', title: 'Email re-engagement', desc: 'A one-off email if you stay away for 3+ days — so the streak can still come back.' },
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

function PasswordField({ label, value, onChange, show, onToggleShow }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--cream)', marginBottom: 4 }}>{label}</label>
      <div className="password-wrap">
        <input
          id={label}
          type={show ? 'text' : 'password'}
          autoComplete={label === 'Current password' ? 'current-password' : 'new-password'}
          placeholder={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field"
        />
        {onToggleShow && (
          <button type="button" className="password-toggle" onClick={onToggleShow} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? '🙈' : '👁️'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { token, user, logout } = useAuth();
  const { supported: pushSupported, status: pushStatus, subscribe: enablePush, error: pushError } =
    usePushNotifications(token);
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwSuccess, setPwSuccess] = useState(null);
  const [showPwCurrent, setShowPwCurrent] = useState(false);
  const [showPwNew, setShowPwNew] = useState(false);

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

  async function setReminderTime(value) {
    setPrefs((p) => ({ ...p, reminderTime: value || null }));
    setBusy(true);
    setError(null);
    try {
      const data = await api('/settings/notifications', {
        method: 'PUT',
        token,
        body: { reminderTime: value || null },
      });
      setPrefs(data.prefs);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePassword() {
    setPwBusy(true);
    setPwError(null);
    setPwSuccess(null);
    try {
      if (pwNew !== pwConfirm) {
        setPwError('New passwords do not match.');
        return;
      }
      await changePassword(token, pwCurrent, pwNew);
      setPwSuccess('Password changed successfully.');
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
    } catch (e) {
      setPwError(e.message);
    } finally {
      setPwBusy(false);
    }
  }

  async function handleExport() {
    setExportBusy(true);
    setExportMsg(null);
    setError(null);
    try {
      const data = await exportAccountData(token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `breakfree_account_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setExportMsg('Your export is ready — it includes all habits, check-ins, urges and journals.');
    } catch (e) {
      setError(e.message);
    } finally {
      setExportBusy(false);
    }
  }

  async function handleDelete() {
    setDeleteBusy(true);
    setError(null);
    try {
      await deleteAccount(token);
      logout();
      window.location.href = '/';
    } catch (e) {
      setError(e.message);
      setDeleteBusy(false);
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
        {prefs && (
          <p className="muted small" style={{ marginBottom: 8 }}>
            Email options send to <strong style={{ color: 'var(--cream)' }}>{user?.email}</strong>; push options stay on this device.
          </p>
        )}
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
        {prefs && (
          <div className="settings-row" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 12 }}>
            <div style={{ flex: 1 }}>
              <p className="settings-title">Daily reminder time</p>
              <p className="muted small">Pick an exact time — otherwise it fires sometime in the morning (7–10am).</p>
            </div>
            <input
              type="time"
              aria-label="Daily reminder time"
              value={prefs.reminderTime || ''}
              onChange={(e) => setReminderTime(e.target.value)}
              disabled={busy}
            />
          </div>
        )}
        {busy && <p className="muted small" style={{ marginTop: 10 }}>Saving…</p>}
      </div>

      <div className="card">
        <p className="card-title">🔒 Password</p>
        <p className="muted small" style={{ marginBottom: 12 }}>
          Change your account password. You&apos;ll need to know your current one.
        </p>
        {pwError && <p className="error-text">{pwError}</p>}
        {pwSuccess && <p className="muted small" style={{ marginBottom: 8, color: 'var(--sage)' }}>{pwSuccess}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PasswordField label="Current password" value={pwCurrent} onChange={setPwCurrent} show={showPwCurrent} onToggleShow={() => setShowPwCurrent((v) => !v)} />
          <PasswordField label="New password" value={pwNew} onChange={setPwNew} show={showPwNew} onToggleShow={() => setShowPwNew((v) => !v)} />
          <PasswordField label="Confirm new password" value={pwConfirm} onChange={setPwConfirm} show={false} onToggleShow={() => {}} />
        </div>
        <button className="btn btn-primary btn-block mt" onClick={handleChangePassword} disabled={pwBusy || !pwCurrent || !pwNew || !pwConfirm}>
          {pwBusy ? 'Saving...' : 'Change password'}
        </button>
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

      <div className="card">
        <p className="card-title">🛡️ Your data</p>
        <p className="muted small" style={{ marginBottom: 12 }}>
          You own your data. Export everything at any time — or delete your account and all of it permanently.
        </p>
        <button className="btn btn-ghost" onClick={handleExport} disabled={exportBusy}>
          {exportBusy ? 'Preparing...' : '📥 Export all my data'}
        </button>
        {exportMsg && <p className="muted small" style={{ marginTop: 8 }}>{exportMsg}</p>}
        <div className="divider" style={{ margin: '14px 0' }} />
        {!confirmDelete ? (
          <button className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)} disabled={deleteBusy}>
            🗑️ Delete my account
          </button>
        ) : (
          <div>
            <p className="muted small" style={{ marginBottom: 8 }}>
              This permanently erases your account, habits, check-ins, urges, journals and community activity. This can't be undone.
            </p>
            <div className="row">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)} disabled={deleteBusy}>
                Cancel
              </button>
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting...' : 'Yes, delete everything'}
              </button>
            </div>
          </div>
        )}
      </div>

      <Link to="/app/help" className="card help-link">
        <div>
          <p className="settings-title">🫂 Get help</p>
          <p className="muted small" style={{ marginTop: 2 }}>
            Drug & alcohol support, crisis helplines and habit-change resources.
          </p>
        </div>
        <span className="help-arrow">→</span>
      </Link>

      <a href="/terms" className="card help-link" target="_blank" rel="noopener noreferrer">
        <div>
          <p className="settings-title">📄 Terms of Service</p>
          <p className="muted small" style={{ marginTop: 2 }}>
            Read the BreakFree terms and conditions.
          </p>
        </div>
        <span className="help-arrow">→</span>
      </a>

      <a href="/privacy" className="card help-link" target="_blank" rel="noopener noreferrer">
        <div>
          <p className="settings-title">🔒 Privacy Policy</p>
          <p className="muted small" style={{ marginTop: 2 }}>
            What we collect, how we store it, and your rights.
          </p>
        </div>
        <span className="help-arrow">→</span>
      </a>
    </Layout>
  );
}
