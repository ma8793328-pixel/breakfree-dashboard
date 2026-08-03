-- Community moderation: user blocks and a report queue for admins.

CREATE TABLE IF NOT EXISTS community_blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS community_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES community_comments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  action TEXT,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status IN ('open', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_community_blocks_blocker ON community_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_community_reports_status ON community_reports(status);
