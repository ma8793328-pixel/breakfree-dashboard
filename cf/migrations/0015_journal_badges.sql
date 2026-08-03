-- Journal engagement badges: awarded when a user writes 3+ journal entries
-- in a single week (Monday–Sunday). Separate from streak badges so the two
-- systems don't interfere with each other.

CREATE TABLE IF NOT EXISTS journal_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  earned_date TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (habit_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_journal_badges_habit ON journal_badges(habit_id);
CREATE INDEX IF NOT EXISTS idx_journal_badges_week ON journal_badges(week_start);
