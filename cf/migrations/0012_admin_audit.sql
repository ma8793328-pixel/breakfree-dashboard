-- Admin audit log: tracks admin actions for debugging and accountability.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
