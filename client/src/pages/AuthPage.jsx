import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

const PASSWORD_MIN = 8;
const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= PASSWORD_MIN },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p) => /[0-9]/.test(p) },
  { label: 'One symbol (!@#$%^&*)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordStrength(p) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s += 1;
  if (p.length >= 12) s += 1;
  if (/[A-Z]/.test(p)) s += 1;
  if (/[0-9]/.test(p)) s += 1;
  if (/[^A-Za-z0-9]/.test(p)) s += 1;
  return Math.min(4, s);
}

export default function AuthPage({ mode }) {
  const isLogin = mode === 'login';
  const { handleAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });

  const emailValid = useMemo(() => validateEmail(email), [email]);
  const passwordOk = useMemo(() => PASSWORD_RULES.every((r) => r.test(password)), [password]);
  const passwordStrengthLevel = useMemo(() => passwordStrength(password), [password]);
  const formValid = isLogin ? emailValid && password.length > 0 : emailValid && passwordOk;
  const shouldShowPasswordRules = !isLogin && touched.password && password.length > 0 && !passwordOk;

  async function onSubmit(e) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!formValid) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api(isLogin ? '/auth/login' : '/auth/signup', {
        method: 'POST',
        body: isLogin ? { email, password, rememberMe } : { email, password },
      });
      handleAuth(data);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
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
          {isLogin ? 'Welcome back. Today is another day you can own.' : 'A warm, grounded companion for breaking any habit — one day at a time.'}
        </p>
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
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              className={touched.email && !emailValid && email.length > 0 ? 'field-error' : ''}
              required
            />
            {touched.email && !emailValid && email.length > 0 && (
              <p className="field-hint error-text">Please enter a valid email address.</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="password">{isLogin ? 'Password' : 'Create a password'}</label>
            <div className="password-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder={isLogin ? 'Your password' : 'At least 8 characters'}
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
            {!isLogin && password.length > 0 && (
              <div className="password-strength">
                <div className="strength-bar">
                  <div className="strength-fill" style={{ width: `${passwordStrengthLevel * 25}%`, background: passwordStrengthLevel <= 1 ? 'var(--slip)' : passwordStrengthLevel <= 2 ? 'var(--accent)' : 'var(--sage)' }} />
                </div>
                <div className="strength-rules">
                  {PASSWORD_RULES.map((r, i) => (
                    <span key={i} className={`strength-rule ${r.test(password) ? 'ok' : ''}`}>
                      {r.test(password) ? '✓' : '○'} {r.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {isLogin && (
              <div className="auth-row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <label className="remember-row">
                  <input type="checkbox" /> Remember me
                </label>
                <Link to="/forgot-password" className="forgot-link">Forgot password?</Link>
              </div>
            )}
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-block mt" type="submit" disabled={busy || !formValid}>
            {busy ? 'One moment...' : isLogin ? 'Log in' : 'Create account'}
          </button>
          {!isLogin && (
            <p className="hint small" style={{ marginTop: 10, textAlign: 'center', color: 'var(--muted-2)' }}>
              No credit card needed. Every feature is included.
            </p>
          )}
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
          <p className="center muted tiny mt" style={{ padding: '0 8px' }}>
            <Link to="/terms" className="legal-link">Terms of Service</Link>
            <span className="legal-sep">·</span>
            <Link to="/privacy" className="legal-link">Privacy Policy</Link>
            <br />
            <a href="mailto:support@breakfree.app" className="legal-link">support@breakfree.app</a>
            <span className="legal-sep">·</span>
            © 2026 BreakFree. All rights reserved.
          </p>
      </div>
    </div>
  );
}
