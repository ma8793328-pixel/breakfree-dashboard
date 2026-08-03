-- Health tracking (manual entry), milestone sharing, and re-engagement/digest de-dupe.

CREATE TABLE IF NOT EXISTS health_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  steps INTEGER,
  sleep_hours REAL,
  resting_hr INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (habit_id, date)
);

CREATE INDEX IF NOT EXISTS idx_health_samples_habit ON health_samples(habit_id);

CREATE TABLE IF NOT EXISTS milestone_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  days INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_milestone_shares_user ON milestone_shares(user_id);

-- One row per (user, nudge/digest) so each fires at most once.
CREATE TABLE IF NOT EXISTS engagement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_user ON engagement_events(user_id);
