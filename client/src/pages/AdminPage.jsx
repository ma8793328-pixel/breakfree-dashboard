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

function StatCard({ label, value, sub, accent, hint }) {
  return (
    <div className="metric" style={{ borderColor: accent || 'var(--border)' }}>
      <div className="value" style={{ color: accent || 'var(--cream)' }}>
        {value}
        {hint && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-2)', marginLeft: 6 }}>{hint}</span>}
      </div>
      <div className="label">{label}</div>
      {sub && <div className="meta" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="card-title" style={{ marginBottom: 12 }}>{children}</p>;
}

function ErrorTrendChart({ trend }) {
  if (!trend || !trend.length) return null;
  const max = Math.max(1, ...trend.map((t) => t.count));
  const barW = 100 / trend.length;
  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted small" style={{ marginBottom: 6 }}>Last 7 days</p>
      <svg viewBox="0 0 420 80" style={{ width: '100%', height: 'auto' }} aria-label="Error count per day for the last 7 days">
        {trend.map((t, i) => {
          const h = Math.max(2, (t.count / max) * 60);
          const x = i * barW + barW * 0.15;
          const w = barW * 0.7;
          const fill = t.count === 0 ? 'var(--border)' : t.count > 3 ? 'var(--slip)' : 'var(--accent)';
          return (
            <g key={t.date}>
              <rect x={x} y={70 - h} width={w} height={h} rx={3} fill={fill} opacity={0.85} />
              <text x={x + w / 2} y={78} textAnchor="middle" className="trend-day-label">{t.label.split(' ')[0]}</text>
              {t.count > 0 && <text x={x + w / 2} y={68 - h} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: 'var(--cream)' }}>{t.count}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
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
  const [showResolved, setShowResolved] = useState(false);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [nudgeTarget, setNudgeTarget] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [users, setUsers] = useState(null);
  const [blacklist, setBlacklist] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const [blacklistEmail, setBlacklistEmail] = useState('');
  const [blacklistReason, setBlacklistReason] = useState('');
  const [adminBusy, setAdminBusy] = useState({});

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

  const loadMetrics = useCallback(async () => {
    try {
      const d = await api('/admin/metrics', { token });
      setMetrics(d);
    } catch {
      setMetrics(null);
    }
  }, [token]);

  const loadUsers = useCallback(async () => {
    try {
      const d = await api(`/admin/users${userSearch ? `?q=${encodeURIComponent(userSearch)}` : ''}`, { token });
      setUsers(d.users);
    } catch {
      setUsers([]);
    }
  }, [token, userSearch]);

  const loadBlacklist = useCallback(async () => {
    try {
      const d = await api('/admin/blacklist', { token });
      setBlacklist(d.blacklist);
    } catch {
      setBlacklist([]);
    }
  }, [token]);

  useEffect(() => {
    loadStatus();
    loadErrors();
    loadReports();
    loadAuditLog();
    loadWebhooks();
    loadMetrics();
    loadUsers();
    loadBlacklist();
    runAiCheck();
  }, [loadStatus, loadErrors, loadReports, loadAuditLog, loadWebhooks, loadMetrics, loadUsers, loadBlacklist]);

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

  async function blockUser(userId) {
    if (!confirm('Block this user site-wide and delete their account?')) return;
    setAdminBusy((b) => ({ ...b, block: userId }));
    try {
      await api(`/admin/users/${userId}/block`, { method: 'POST', token });
      await loadUsers();
      await loadBlacklist();
      await loadStatus();
      await loadAuditLog();
      alert('User blocked and deleted.');
    } catch (e) {
      alert(e.message);
    } finally {
      setAdminBusy((b) => ({ ...b, block: null }));
    }
  }

  async function unblockUser(userId) {
    setAdminBusy((b) => ({ ...b, unblock: userId }));
    try {
      await api(`/admin/users/${userId}/unblock`, { method: 'POST', token });
      await loadUsers();
      await loadBlacklist();
      await loadAuditLog();
      alert('User unblocked.');
    } catch (e) {
      alert(e.message);
    } finally {
      setAdminBusy((b) => ({ ...b, unblock: null }));
    }
  }

  async function makeAdmin(userId) {
    if (!confirm('Grant admin access to this user?')) return;
    setAdminBusy((b) => ({ ...b, makeAdmin: userId }));
    try {
      await api(`/admin/users/${userId}/make-admin`, { method: 'POST', token });
      await loadUsers();
      await loadAuditLog();
      alert('User is now an admin.');
    } catch (e) {
      alert(e.message);
    } finally {
      setAdminBusy((b) => ({ ...b, makeAdmin: null }));
    }
  }

  async function removeAdmin(userId) {
    if (!confirm('Remove admin access from this user? They will become a regular user.')) return;
    setAdminBusy((b) => ({ ...b, removeAdmin: userId }));
    try {
      await api(`/admin/users/${userId}/remove-admin`, { method: 'POST', token });
      await loadUsers();
      await loadAuditLog();
      alert('Admin access removed.');
    } catch (e) {
      alert(e.message);
    } finally {
      setAdminBusy((b) => ({ ...b, removeAdmin: null }));
    }
  }

  async function addToBlacklist(e) {
    e.preventDefault();
    if (!blacklistEmail) return;
    setAdminBusy((b) => ({ ...b, addBlacklist: true }));
    try {
      await api('/admin/blacklist', { method: 'POST', token, body: { email: blacklistEmail, reason: blacklistReason } });
      setBlacklistEmail('');
      setBlacklistReason('');
      await loadBlacklist();
      await loadAuditLog();
      alert('Email added to blacklist.');
    } catch (err) {
      alert(err.message);
    } finally {
      setAdminBusy((b) => ({ ...b, addBlacklist: false }));
    }
  }

  async function removeFromBlacklist(id) {
    setAdminBusy((b) => ({ ...b, [`blacklist_${id}`]: true }));
    try {
      await api(`/admin/blacklist/${id}`, { method: 'DELETE', token });
      await loadBlacklist();
      await loadAuditLog();
    } catch (e) {
      alert(e.message);
    } finally {
      setAdminBusy((b) => ({ ...b, [`blacklist_${id}`]: false }));
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

  async function triggerNudges() {
    setNudgeBusy(true);
    try {
      const body = nudgeTarget ? { userId: Number(nudgeTarget) } : {};
      const d = await api('/admin/trigger-nudges', { method: 'POST', token, body });
      alert(d.ok ? `Nudges sent: ${d.sent || d.totalSent} push(es) to ${d.user || d.users} user(s)` : `Failed: ${JSON.stringify(d)}`);
      await loadAuditLog();
    } catch (e) {
      alert(e.message);
    } finally {
      setNudgeBusy(false);
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
  const resolvedReportsList = reports?.filter((r) => r.status === 'resolved') || [];
  const errorGroups = errors?.groups || [];
  const errorEntries = errors?.errors || [];
  const uptimeMins = status ? Math.floor(status.uptime / 60) : 0;
  const uptimeDisplay = uptimeMins >= 60 ? `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m` : `${uptimeMins}m`;

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
            <StatCard label="Uptime" value={uptimeDisplay} sub="since last deploy" />
            <StatCard label="Total users" value={status.counts.users} sub="🌍 100% free — no paid tiers" />
            <StatCard label="Errors (24h)" value={status.errors24h} accent={status.errors24h > 0 ? 'var(--slip)' : undefined} />
            <StatCard label="Check-ins today" value={status.today?.checkins || 0} accent="var(--sage)" />
            <StatCard label="Urges logged today" value={status.today?.urges || 0} accent="var(--accent-strong)" />
            <StatCard label="Open reports" value={status.community?.openReports || 0} accent={status.community?.openReports > 0 ? 'var(--slip)' : 'var(--sage)'} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10 }}>
            <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              🔔 Push subscriptions: <strong>{status.notifications?.subs || 0}</strong>
              {(status.notifications?.subs || 0) === 0 && <span style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate('/app/settings')}>How to enable →</span>}
            </div>
            <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              📊 Total nudges sent: <strong>{status.notifications?.sentTotal || 0}</strong>
              {(status.notifications?.sentTotal || 0) === 0 && <span title="Nudges require push subscriptions. Ask users to enable notifications in Settings.">ℹ️</span>}
            </div>
            <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              📝 Journals: <strong>{status.counts.journals}</strong> total · <span title="Users can journal from the Journal tab">ℹ️</span>
            </div>
            <div className="meta">
              {status.counts.habits} habits · {status.counts.checkins} check-ins · {status.counts.urges} urges
            </div>
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

      {metrics && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="card-title" style={{ margin: 0 }}>📈 Engagement funnels (last 7d)</p>
            <button className="btn btn-ghost btn-xs" onClick={loadMetrics}>Refresh</button>
          </div>
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <StatCard label="Push prompt shown" value={metrics.push.shown} sub={`${metrics.push.optInRate}% opt-in rate`} />
            <StatCard label="Push enabled" value={metrics.push.enabled} sub={`${metrics.push.dismissed} dismissed`} />
            <StatCard label="Journal prompt shown" value={metrics.journal.shown} sub={`${metrics.journal.conversionRate}% clicked`} />
            <StatCard label="Journal badges earned" value={metrics.journal.badgesEarned} sub="3 entries in a week" />
          </div>
          {metrics.abTest && Object.keys(metrics.abTest).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p className="muted small" style={{ marginBottom: 6 }}>A/B test — push prompt variants</p>
              {Object.entries(metrics.abTest).map(([variant, count]) => (
                <div key={variant} className="toggle-row" style={{ padding: '4px 0' }}>
                  <span className="meta">{variant}</span>
                  <strong>{count} events</strong>
                </div>
              ))}
            </div>
          )}
          <div className="meta" style={{ marginTop: 8 }}>Total push subscriptions: {metrics.totalPushSubs}</div>
        </div>
      )}

      {status?.fab && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="card-title" style={{ margin: 0 }}>⚡ FAB Urge Panel</p>
            <span className="meta">Total opens: {status.fab.totalOpens}</span>
          </div>
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <StatCard label="Breathe" value={status.fab.modes.breathe} sub="Pause & Breathe" accent="var(--sage)" />
            <StatCard label="Reframe" value={status.fab.modes.reframe} sub="Thought reframe" accent="var(--accent)" />
            <StatCard label="Shift" value={status.fab.modes.shift} sub="Move / distract" accent="#f59e0b" />
            <StatCard label="Log" value={status.fab.modes.log} sub="Urge log" accent="var(--muted-2)" />
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Tracks which coping mode users choose when the urge hits. Used to refine content and UX.
          </p>
        </div>
      )}

      {status?.notifications && (
        <div className="card">
          <p className="card-title">🔔 Scheduled nudges</p>
          <div className={`ai-summary ${status.notifications.healthy ? 'ok' : 'bad'}`}>
            {status.notifications.healthy
              ? '✅ Cron is firing — nudges flowing'
              : '⚠️ No scheduled nudges in the last ~27h (free plan limitation: cron may not fire)'}
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
        <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          <input
            className="field"
            style={{ flex: 1, minWidth: 120, margin: 0 }}
            placeholder="User ID (optional — leave blank for all)"
            type="number"
            min="1"
            value={nudgeTarget}
            onChange={(e) => setNudgeTarget(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={triggerNudges} disabled={nudgeBusy}>
            {nudgeBusy ? 'Sending...' : '📢 Trigger nudges'}
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          Sends a check-in nudge to all subscribed users, or a specific user by ID. Requires push subscriptions.
        </p>
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
            <ErrorTrendChart trend={status?.errorTrend} />
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p className="card-title" style={{ margin: 0 }}>🛡️ Community moderation</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-xs" onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? 'Hide resolved' : `View history (${resolvedReportsList.length})`}
            </button>
          </div>
        </div>
        {reports === null ? (
          <div className="loading-screen" style={{ minHeight: '15vh' }}>
            <div className="spinner" />
          </div>
        ) : openReportsList.length === 0 && !showResolved ? (
          <p className="muted small">No open reports. The community is behaving itself. ✨</p>
        ) : (
          <div className="list" style={{ gap: 10 }}>
            {(showResolved ? [...openReportsList, ...resolvedReportsList] : openReportsList).map((r) => (
              <div key={r.id} className="ai-check">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    <span className={`badge-pill ${r.status === 'open' ? 'no' : 'ok'}`}>{r.status.toUpperCase()}</span>{' '}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p className="card-title" style={{ margin: 0 }}>👥 User management</p>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="field"
              style={{ margin: 0, padding: '6px 10px', fontSize: 13 }}
              placeholder="Search by email..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
            />
            <button className="btn btn-ghost btn-xs" onClick={loadUsers}>Search</button>
          </div>
        </div>
        {users === null ? (
          <div className="loading-screen" style={{ minHeight: '10vh' }}>
            <div className="spinner" />
          </div>
        ) : users.length === 0 ? (
          <p className="muted small">No users found.</p>
        ) : (
          <div className="list" style={{ gap: 6, maxHeight: 400, overflowY: 'auto' }}>
            {users.map((u) => (
              <div key={u.id} className="toggle-row" style={{ padding: '8px 0', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {u.email}
                    {u.role === 'admin' && <span className="badge-pill ok" style={{ marginLeft: 6, fontSize: 10 }}>ADMIN</span>}
                  </div>
                  <div className="meta">ID: {u.id}</div>
                </div>
                <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                  {u.role !== 'admin' ? (
                    <button className="btn btn-ghost btn-xs" onClick={() => makeAdmin(u.id)} disabled={adminBusy.makeAdmin === u.id}>
                      {adminBusy.makeAdmin === u.id ? '...' : 'Make admin'}
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-xs" onClick={() => removeAdmin(u.id)} disabled={adminBusy.removeAdmin === u.id}>
                      {adminBusy.removeAdmin === u.id ? '...' : 'Remove admin'}
                    </button>
                  )}
                  {u.role !== 'admin' && (
                    <button className="btn btn-slip btn-xs" onClick={() => blockUser(u.id)} disabled={adminBusy.block === u.id}>
                      {adminBusy.block === u.id ? '...' : 'Block'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p className="card-title" style={{ margin: 0 }}>🚫 Blacklist</p>
        </div>
        <p className="muted small" style={{ marginBottom: 10 }}>
          Blacklisted emails cannot sign up or log in. Blocked users are also added here automatically.
        </p>
        <form onSubmit={addToBlacklist} className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <input
            className="field"
            style={{ flex: 1, minWidth: 180, margin: 0 }}
            placeholder="email@example.com"
            value={blacklistEmail}
            onChange={(e) => setBlacklistEmail(e.target.value)}
            required
          />
          <input
            className="field"
            style={{ flex: 1, minWidth: 140, margin: 0 }}
            placeholder="Reason (optional)"
            value={blacklistReason}
            onChange={(e) => setBlacklistReason(e.target.value)}
          />
          <button className="btn btn-slip btn-sm" type="submit" disabled={adminBusy.addBlacklist}>
            {adminBusy.addBlacklist ? 'Adding...' : 'Add to blacklist'}
          </button>
        </form>
        {blacklist === null ? (
          <div className="loading-screen" style={{ minHeight: '10vh' }}>
            <div className="spinner" />
          </div>
        ) : blacklist.length === 0 ? (
          <p className="muted small">Blacklist is empty.</p>
        ) : (
          <div className="list" style={{ gap: 6 }}>
            {blacklist.map((b) => (
              <div key={b.id} className="toggle-row" style={{ padding: '6px 0' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{b.email}</div>
                  <div className="meta">
                    {b.reason || 'No reason'} · by {b.blocked_by_email || `admin #${b.blocked_by}`} · {new Date(b.created_at + 'Z').toLocaleString()}
                  </div>
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => removeFromBlacklist(b.id)} disabled={adminBusy[`blacklist_${b.id}`]}>
                  {adminBusy[`blacklist_${b.id}`] ? '...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
