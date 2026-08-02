import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

export default function AuthPage({ mode }) {
  const isLogin = mode === 'login';
  const { handleAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api(isLogin ? '/auth/login' : '/auth/signup', {
        method: 'POST',
        body: { email, password },
      });
      handleAuth(data);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo-row">
          <div className="logo-badge">🔥</div>
          <span className="logo-text">BreakFree</span>
        </div>
        <p className="tagline">
          {isLogin
            ? 'Welcome back. Today is another day you can own.'
            : 'A warm, grounded companion for breaking any habit — one day at a time.'}
        </p>
        <form className="card" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
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
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              placeholder={isLogin ? 'Your password' : 'At least 6 characters'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-block mt" type="submit" disabled={busy}>
            {busy ? 'One moment...' : isLogin ? 'Log in' : 'Create account'}
          </button>
        </form>
        <p className="center muted small mt">
          {isLogin ? (
            <>
              New here? <Link to="/signup">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/login">Log in</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
