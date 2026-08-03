import { useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="logo-row">
            <div className="logo-badge">🔥</div>
            <span className="logo-text">BreakFree</span>
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>Reset your password</h1>
          <p className="tagline">
            Enter the email associated with your account and we&apos;ll send you a link to reset your password.
          </p>
          {sent ? (
            <div className="card" style={{ padding: 20 }}>
              <p style={{ margin: 0 }}>
                If an account with that email exists, you&apos;ll receive a reset link shortly.
              </p>
              <p className="center muted small mt">
                <Link to="/login">Back to login</Link>
              </p>
            </div>
          ) : (
            <form className="card auth-form" onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary btn-block mt" type="submit" disabled={busy || !email}>
                {busy ? 'One moment...' : 'Send reset link'}
              </button>
              <p className="center muted small mt">
                Remember your password? <Link to="/login">Log in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </Layout>
  );
}
