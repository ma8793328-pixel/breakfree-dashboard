import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

export default function AdminPage() {
  const { token, user } = useAuth();
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState(null);
  const [ai, setAi] = useState(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const d = await api('/admin/status', { token });
      setStatus(d);
    } catch (e) {
      if (e.status === 403) setDenied(true);
    }
  }, [token]);

  const loadErrors = useCallback(async () => {
    try {
      const d = await api('/admin/errors', { token });
      setErrors(d.errors);
    } catch {
      /* handled by loadStatus */
    }
  }, [token]);

  useEffect(() => {
    loadStatus();
    loadErrors();
  }, [loadStatus, loadErrors]);

  async function runAiCheck() {
    setBusy(true);
    setAi(null);
    try {
      const d = await api('/admin/ai-check', { method: 'POST', token });
      setAi(d);
    } catch (e) {
      setAi({ healthy: false, summary: e.message, checks: [], suggestions: [] });
    } finally {
      setBusy(false);
    }
  }

  if (denied || (user && user.role !== 'admin')) {
    return (
      <Layout>
        <h1 className="page-title">Admin</h1>
        <div className="card empty-state">
          <div className="icon">🔒</div>
          <div className="title">Admins only</div>
          <p>You don't have permission to view this dashboard.</p>
        </div>
      </Layout>
    );
  }

  const countRows = status
    ? Object.entries(status.counts).map(([k, v]) => ({ k, v }))
    : [];

  return (
    <Layout>
      <h1 className="page-title">Admin</h1>
      <p className="page-sub">Server health, data, and errors at a glance.</p>

      {status && (
        <div className="card">
          <p className="card-title">🖥️ Server</p>
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div className="metric">
              <div className="value">{Math.floor(status.uptime / 60)}m</div>
              <div className="label">uptime</div>
            </div>
            <div className="metric">
              <div className="value">{status.premiumUsers}</div>
              <div className="label">premium users</div>
            </div>
            <div className="metric">
              <div className="value">{status.errors24h}</div>
              <div className="label">errors (24h)</div>
            </div>
            <div className="metric">
              <div className="value">{status.counts.users}</div>
              <div className="label">users</div>
            </div>
          </div>
          <div className="meta" style={{ marginTop: 10 }}>
            Started {new Date(status.startedAt).toLocaleString()}
          </div>
        </div>
      )}

      <div className="card">
        <p className="card-title">🗄️ Table counts</p>
        {countRows.length ? (
          <div className="list" style={{ gap: 6 }}>
            {countRows.map((r) => (
              <div key={r.k} className="toggle-row" style={{ padding: '6px 0' }}>
                <span className="meta">{r.k}</span>
                <strong>{r.v}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="loading-screen" style={{ minHeight: '15vh' }}>
            <div className="spinner" />
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p className="card-title" style={{ margin: 0 }}>🤖 AI health check</p>
          <button className="btn btn-ghost btn-sm" onClick={runAiCheck} disabled={busy}>
            {busy ? 'Checking...' : 'Run check'}
          </button>
        </div>
        {ai && (
          <div className="mt">
            <div className={`ai-summary ${ai.healthy ? 'ok' : 'bad'}`}>
              {ai.healthy ? '✅' : '⚠️'} {ai.summary}
            </div>
            {ai.checks && ai.checks.length > 0 && (
              <div className="list mt" style={{ gap: 8 }}>
                {ai.checks.map((c) => (
                  <div key={c.name} className="ai-check">
                    <span className={`ai-dot ${c.ok ? 'ok' : 'bad'}`} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                      <div className="meta">{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ai.suggestions && ai.suggestions.length > 0 && (
              <div className="reflection-card mt">
                <div className="head">Suggested fixes</div>
                {ai.suggestions.map((s, i) => (
                  <div key={i} className="text" style={{ marginTop: 4 }}>
                    • {s}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <p className="card-title">🐞 Recent errors</p>
        {errors === null ? (
          <div className="loading-screen" style={{ minHeight: '15vh' }}>
            <div className="spinner" />
          </div>
        ) : errors.length === 0 ? (
          <p className="muted small">No errors logged.</p>
        ) : (
          <div className="list" style={{ gap: 8 }}>
            {errors.map((e) => (
              <div key={e.id} className="ai-check">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{e.message}</div>
                  <div className="meta">
                    {e.url} · {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
