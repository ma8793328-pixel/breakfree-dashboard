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
  const [reports, setReports] = useState(null);
  const [resolveBusy, setResolveBusy] = useState(null);

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
    loadReports();
  }, [loadStatus, loadErrors]);

  const loadReports = useCallback(async () => {
    try {
      const d = await api('/community/moderation', { token });
      setReports(d.reports);
    } catch {
      setReports([]);
    }
  }, [token]);

  async function resolveReport(reportId, action) {
    const label = action === 'dismiss' ? 'Dismiss this report?' : action === 'remove' ? 'Remove this content permanently?' : 'Block this user site-wide and delete their content?';
    if (!confirm(label)) return;
    setResolveBusy(reportId);
    try {
      await api(`/community/moderation/${reportId}`, { method: 'POST', token, body: { action } });
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (e) {
      alert(e.message);
    } finally {
      setResolveBusy(null);
    }
  }

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
              <div className="value">{status.totalUsers}</div>
              <div className="label">users</div>
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

      {status?.notifications && (
        <div className="card">
          <p className="card-title">🔔 Scheduled nudges</p>
          <div className={`ai-summary ${status.notifications.healthy ? 'ok' : 'bad'}`}>
            {status.notifications.healthy
              ? '✅ Cron is firing — nudges flowing'
              : '⚠️ No scheduled nudges in the last ~27h'}
          </div>
          <div className="list" style={{ gap: 6 }}>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">Last cron run</span>
              <strong>{status.notifications.lastRun ? new Date(status.notifications.lastRun).toLocaleString() : 'never'}</strong>
            </div>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">Last nudge sent</span>
              <strong>{status.notifications.lastSent ? new Date(status.notifications.lastSent).toLocaleString() : 'never'}</strong>
            </div>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">Nudges sent (all time)</span>
              <strong>{status.notifications.sentTotal}</strong>
            </div>
            <div className="toggle-row" style={{ padding: '6px 0' }}>
              <span className="meta">Push subscriptions</span>
              <strong>{status.notifications.subs}</strong>
            </div>
          </div>
          {!status.notifications.healthy && (
            <div className="reflection-card mt">
              <div className="head">Likely cause: Workers free plan</div>
              <p className="text" style={{ marginTop: 4 }}>
                 Cloudflare <strong>cron triggers require the Workers Paid plan</strong>. On the free plan the
                 schedule exists but never fires — and this dashboard is the only way to notice. Fix: change the
                Workers plan, or open Cloudflare dashboard → Workers → breakfree → Triggers to confirm the
                hourly schedule is active.
              </p>
            </div>
          )}
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
        <p className="card-title">🛡️ Community moderation</p>
        {reports === null ? (
          <div className="loading-screen" style={{ minHeight: '15vh' }}>
            <div className="spinner" />
          </div>
        ) : reports.length === 0 ? (
          <p className="muted small">No reports. The community is behaving itself. ✨</p>
        ) : (
          <div className="list" style={{ gap: 10 }}>
            {reports.map((r) => (
              <div key={r.id} className="ai-check">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    <span className={`badge-pill ${r.status === 'open' ? '' : 'no'}`}>{r.status === 'open' ? 'OPEN' : 'RESOLVED'}</span>{' '}
                    {r.reason} · by {r.reporter}
                  </div>
                  <div className="meta">
                    {r.post_id ? `post #${r.post_id}` : `comment #${r.comment_id}`} by {r.author || 'Anonymous'} ·{' '}
                    {new Date(r.created_at + 'Z').toLocaleString()}
                  </div>
                  {(r.post_content || r.comment_content) && (
                    <div className="meta" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                      “{(r.post_content || r.comment_content).slice(0, 160)}
                      {(r.post_content || r.comment_content).length > 160 ? '…' : ''}”
                    </div>
                  )}
                  {r.status === 'open' && (
                    <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => resolveReport(r.id, 'dismiss')} disabled={resolveBusy === r.id}>
                        {resolveBusy === r.id ? '…' : 'Dismiss'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => resolveReport(r.id, 'remove')} disabled={resolveBusy === r.id}>
                        {resolveBusy === r.id ? '…' : 'Remove content'}
                      </button>
                      <button className="btn btn-slip btn-sm" onClick={() => resolveReport(r.id, 'block')} disabled={resolveBusy === r.id}>
                        {resolveBusy === r.id ? '…' : 'Block user'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
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
