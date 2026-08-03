-- Admin webhook config: stores alert webhook URLs for proactive notifications.

CREATE TABLE IF NOT EXISTS admin_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  label TEXT,
  events TEXT NOT NULL DEFAULT 'server_degraded,open_reports',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
