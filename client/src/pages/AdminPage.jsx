import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

const STATUS_COLORS = {
  healthy: 'var(--sage)',
  degraded: 'var(--slip)',
};

function HealthDot({ status }) {
  const color = STATUS_COLORS[status] || 'var(--muted-2)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 10px ${color}`,
        marginRight: 8,
        flexShrink: 0,
      }}
      title={status === 'healthy' ? 'All systems healthy' : 'Attention needed'}
    />
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="metric" style={{ borderColor: accent || 'var(--border)' }}>
      <div className="value" style={{ color: accent || 'var(--cream)' }}>{value}</div>
      <div className="label">{label}</div>
      {sub && <div className="meta" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="card-title" style={{ marginBottom: 12 }}>{children}</p>;
}

export default function AdminPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState(null);
  const [ai, setAi] = useState(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [reports, setReports] = useState(null);
  const [resolveBusy, setResolveBusy] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [auditLog, setAuditLog] = useState(null);
  const [webhooks, setWebhooks] = useState(null);
  const [webhookForm, setWebhookForm] = useState({ url: '', label: '', events: 'server_degraded,open_reports' });
  const [webhookBusy, setWebhookBusy] = useState(false);

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
      setErrors(d);
    } catch {
      /* handled by loadStatus */
    }
  }, [token]);

  const loadReports = useCallback(async () => {
    try {
      const d = await api('/community/moderation', { token });
      setReports(d.reports);
    } catch {
      setReports([]);
    }
  }, [token]);

  const loadAuditLog = useCallback(async () => {
    try {
      const d = await api('/admin/audit-log', { token });
      setAuditLog(d.entries);
    } catch {
      setAuditLog([]);
    }
  }, [token]);

  const loadWebhooks = useCallback(async () => {
    try {
      const d = await api('/admin/webhooks', { token });
      setWebhooks(d.webhooks);
    } catch {
      setWebhooks([]);
    }
  }, [token]);

  useEffect(() => {
    loadStatus();
    loadErrors();
    loadReports();
    loadAuditLog();
    loadWebhooks();
  }, [loadStatus, loadErrors, loadReports, loadAuditLog, loadWebhooks]);

  async function clearErrors() {
    if (!confirm('Clear errors older than 24 hours?')) return;
    setClearing(true);
    try {
      const res = await api('/admin/clear-errors', { method: 'POST', token, body: { olderThan: 24 } });
      await loadErrors();
      await loadStatus();
      await loadAuditLog();
      alert(`Cleared ${res.deleted} error(s).`);
    } catch (e) {
      alert(e.message);
    } finally {
      setClearing(false);
    }
  }

  async function resolveReport(reportId, action) {
    const label = action === 'dismiss' ? 'Dismiss this report?' : action === 'remove' ? 'Remove this content permanently?' : 'Block this user site-wide and delete their content?';
    if (!confirm(label)) return;
    setResolveBusy(reportId);
    try {
      await api(`/community/moderation/${reportId}`, { method: 'POST', token, body: { action } });
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      await loadStatus();
      await loadAuditLog();
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
      await loadAuditLog();
    } catch (e) {
      setAi({ healthy: false, summary: e.message, checks: [], suggestions: [] });
    } finally {
      setBusy(false);
    }
  }

  async function addWebhook(e) {
    e.preventDefault();
    setWebhookBusy(true);
    try {
      await api('/admin/webhooks', { method: 'POST', token, body: webhookForm });
      setWebhookForm({ url: '', label: '', events: 'server_degraded,open_reports' });
      await loadWebhooks();
      await loadAuditLog();
    } catch (err) {
      alert(err.message);
    } finally {
      setWebhookBusy(false);
    }
  }

  async function toggleWebhook(id) {
    try {
      await api(`/admin/webhooks/${id}/toggle`, { method: 'POST', token });
      await loadWebhooks();
      await loadAuditLog();
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteWebhook(id) {
    if (!confirm('Delete this webhook?')) return;
    try {
      await api(`/admin/webhooks/${id}`, { method: 'DELETE', token });
      await loadWebhooks();
      await loadAuditLog();
    } catch (e) {
      alert(e.message);
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

  const openReportsList = reports?.filter((r) => r.status === 'open') || [];
  const errorGroups = errors?.groups || [];
  const errorEntries = errors?.errors || [];

  return (
    <Layout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Admin</h1>
          <p className="page-sub">Server health, data, and actions at a glance.</p>
        </div>
        {status && (
          <div className={`badge-pill ${status.server?.healthy ? 'ok' : 'no'}`} style={{ fontSize: 12, padding: '8px 14px' }}>
            <HealthDot status={status.server?.status} />
            {status.server?.status === 'healthy' ? 'All systems healthy' : 'Degraded — needs attention'}
          </div>
        )}
      </div>

      {status && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p className="card-title" style={{ margin: 0 }}>🖥️ Server</p>
            <span className="meta">{new Date(status.startedAt).toLocaleString()}</span>
          </div>
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <StatCard label="Uptime" value={`${Math.floor(status.uptime / 60)}m`} />
            <StatCard label="Total users" value={status.counts.users} sub={`${status.premiumUsers} premium`} />
            <StatCard label="Errors (24h)" value={status.errors24h} accent={status.errors24h > 0 ? 'var(--slip)' : undefined} />
            <StatCard label="Check-ins today" value={status.today?.checkins || 0} accent="var(--sage)" />
            <StatCard label="Urges logged today" value={status.today?.urges || 0} accent="var(--accent-strong)" />
            <StatCard label="Open reports" value={status.community?.openReports || 0} accent={status.community?.openReports > 0 ? 'var(--slip)' : 'var(--sage)'} />
          </div>
          <div className="meta" style={{ marginTop: 10 }}>
            {status.counts.habits} habits · {status.counts.checkins} check-ins · {status.counts.urges} urges · {status.counts.journals} journals
          </div>
        </div>
      )}

      {status?.insights && (
        <div className="card" style={{ borderColor: status.insights.streakRiskCount > 0 ? 'rgba(229,9,20,0.35)' : undefined }}>
          <p className="card-title">🔍 Insights</p>
          {status.insights.streakRiskCount > 0 && (
            <div className="reflection-card" style={{ marginBottom: 10, borderColor: 'rgba(229,9,20,0.35)' }}>
              <div className="head">⚠️ Streak risk — {status.insights.streakRiskCount} user{status.insights.streakRiskCount === 1 ? '' : 's'} haven't checked in for 3+ days</div>
              <div className="text" style={{ marginTop: 4 }}>
                {status.insights.streakRisk.slice(0, 5).map((u) => (
                  <div key={u.id}>• {u.email} — {u.habit} (streak: {u.streak_days}d)</div>
                ))}
                {status.insights.streakRisk.length > 5 && <div className="meta">+{status.insights.streakRisk.length - 5} more</div>}
              </div>
            </div>
          )}
          <div className="ai-summary ok">
            📊 Journal correlation: {status.insights.journalCorrelation}
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
          <div className="list" style={{ gap: 6, marginTop: 10 }}>
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
        <SectionTitle>⚡ Quick actions</SectionTitle>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={runAiCheck} disabled={busy}>
            {busy ? 'Checking...' : '🤖 Run AI health check'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearErrors} disabled={clearing}>
            {clearing ? 'Clearing...' : '🗑️ Clear errors (24h+)'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/help')}>
            🧪 Test push notification
          </button>
        </div>
      </div>

      <div className="card">
        <p className="card-title">🔔 Webhook alerts</p>
        <p className="muted small" style={{ marginBottom: 12 }}>
          Get notified in Slack/Discord/Email when something needs attention. Paste an incoming webhook URL and pick the events you want.
        </p>
        <form onSubmit={addWebhook} className="row" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <input
            className="field"
            style={{ flex: 1, minWidth: 180, margin: 0 }}
            placeholder="https://hooks.slack.com/services/..."
            value={webhookForm.url}
            onChange={(e) => setWebhookForm((f) => ({ ...f, url: e.target.value }))}
            required
          />
          <input
            className="field"
            style={{ flex: 1, minWidth: 120, margin: 0 }}
            placeholder="Label (optional)"
            value={webhookForm.label}
            onChange={(e) => setWebhookForm((f) => ({ ...f, label: e.target.value }))}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={webhookBusy}>
            {webhookBusy ? 'Saving...' : 'Add webhook'}
          </button>
        </form>
        {webhooks && webhooks.length > 0 ? (
          <div className="list" style={{ gap: 8 }}>
            {webhooks.map((w) => (
              <div key={w.id} className="ai-check">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{w.label || 'Webhook'}</div>
                  <div className="meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.url}</div>
                  <div className="meta">Events: {w.events} · {w.active ? '✅ Active' : '⏸️ Paused'}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => toggleWebhook(w.id)}>
                    {w.active ? 'Pause' : 'Resume'}
                  </button>
                  <button className="btn btn-danger btn-xs" onClick={() => deleteWebhook(w.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No webhooks configured yet.</p>
        )}
      </div>

      <div className="card">
        <p className="card-title">📋 Admin audit log</p>
        {auditLog === null ? (
          <div className="loading-screen" style={{ minHeight: '10vh' }}>
            <div className="spinner" />
          </div>
        ) : auditLog.length === 0 ? (
          <p className="muted small">No admin actions recorded yet.</p>
        ) : (
          <div className="list" style={{ gap: 6 }}>
            {auditLog.slice(0, 20).map((entry) => (
              <div key={entry.id} className="toggle-row" style={{ padding: '6px 0' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{entry.action}</div>
                  {entry.detail && <div className="meta">{entry.detail}</div>}
                  <div className="meta">{entry.admin_email || `admin #${entry.admin_id}`} · {new Date(entry.created_at + 'Z').toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p className="card-title" style={{ margin: 0 }}>🐞 Recent errors</p>
          <button className="btn btn-ghost btn-sm" onClick={loadErrors} disabled={errors === null}>
            Refresh
          </button>
        </div>
        {errors === null ? (
          <div className="loading-screen" style={{ minHeight: '15vh' }}>
            <div className="spinner" />
          </div>
        ) : errorGroups.length === 0 ? (
          <p className="muted small">No errors logged.</p>
        ) : (
          <>
            <div className="list" style={{ gap: 6, marginBottom: 12 }}>
              {errorGroups.slice(0, 10).map((g, i) => (
                <div key={i} className="ai-check">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{g.message}</div>
                    <div className="meta">
                      {g.count} occurrence{g.count === 1 ? '' : 's'} · last: {new Date(g.lastAt).toLocaleString()}
                    </div>
                  </div>
                  <span className={`badge-pill ${g.count > 3 ? 'no' : ''}`} style={{ flexShrink: 0 }}>{g.count}x</span>
                </div>
              ))}
            </div>
            <details style={{ marginTop: 8 }}>
              <summary className="muted small" style={{ cursor: 'pointer', padding: 6 }}>Show all {errorEntries.length} errors</summary>
              <div className="list" style={{ gap: 6, marginTop: 8 }}>
                {errorEntries.slice(0, 50).map((e) => (
                  <div key={e.id} className="ai-check">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{e.message}</div>
                      <div className="meta">
                        {e.url} · {new Date(e.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </>
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
        ) : openReportsList.length === 0 ? (
          <p className="muted small">No open reports. The community is behaving itself. ✨</p>
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 10 }}>
              {openReportsList.length} open report{openReportsList.length === 1 ? '' : 's'} — resolve them below or open the full moderation tool.
            </p>
            <div className="list" style={{ gap: 10 }}>
              {openReportsList.map((r) => (
                <div key={r.id} className="ai-check">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      <span className="badge-pill no">{r.status.toUpperCase()}</span>{' '}
                      {r.reason} · by {r.reporter}
                    </div>
                    <div className="meta">
                      {r.post_id ? `post #${r.post_id}` : `comment #${r.comment_id}`} by {r.author || 'Anonymous'} ·{' '}
                      {new Date(r.created_at + 'Z').toLocaleString()}
                    </div>
                    {(r.post_content || r.comment_content) && (
                      <div className="meta" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                        "{(r.post_content || r.comment_content).slice(0, 160)}
                        {(r.post_content || r.comment_content).length > 160 ? '…' : ''}"
                      </div>
                    )}
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
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
