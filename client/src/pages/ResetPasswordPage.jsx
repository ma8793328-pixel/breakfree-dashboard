import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'One number', test: (p) => /\d/.test(p) },
  { label: 'One symbol (!@#$%^&*)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({ password: false });

  const passwordOk = PASSWORD_RULES.every((r) => r.test(password));

  function onSubmit(e) {
    e.preventDefault();
    setTouched({ password: true });
    if (!passwordOk) return;
    setBusy(true);
    setError(null);
    api('/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword: password },
    })
      .then(() => setSuccess(true))
      .catch((err) => setError(err.message || 'Something went wrong.'))
      .finally(() => setBusy(false));
  }

  if (!token) {
    return (
      <Layout>
        <div className="auth-wrap">
          <div className="auth-card">
            <h1 className="page-title">Invalid reset link</h1>
            <p className="tagline">This password reset link is missing or invalid.</p>
            <p className="center muted small mt">
              <Link to="/forgot">Request a new link</Link>
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  if (success) {
    return (
      <Layout>
        <div className="auth-wrap">
          <div className="auth-card">
            <h1 className="page-title">Password updated</h1>
            <p className="tagline">Your password has been reset successfully.</p>
            <p className="center muted small mt">
              <Link to="/login">Log in</Link>
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="logo-row">
            <div className="logo-badge">🔥</div>
            <span className="logo-text">BreakFree</span>
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>Choose a new password</h1>
          <form className="card auth-form" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="password">New password</label>
              <div className="password-wrap">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  className={touched.password && !passwordOk && password.length > 0 ? 'field-error' : ''}
                  required
                />
                {password.length > 0 && (
                  <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                )}
              </div>
              {touched.password && password.length > 0 && (
                <div className="password-strength">
                  <div className="strength-rules">
                    {PASSWORD_RULES.map((r, i) => (
                      <span key={i} className={`strength-rule ${r.test(password) ? 'ok' : ''}`}>
                        {r.test(password) ? '✓' : '○'} {r.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {error && <p className="error-text">{error}</p>}
            <button className="btn btn-primary btn-block mt" type="submit" disabled={busy || !passwordOk}>
              {busy ? 'One moment...' : 'Reset password'}
            </button>
            <p className="center muted small mt">
              <Link to="/login">Back to login</Link>
            </p>
          </form>
        </div>
      </div>
    </Layout>
  );
}
