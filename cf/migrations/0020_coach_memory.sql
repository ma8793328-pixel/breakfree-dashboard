-- Coach conversation memory: keyword-based topic extraction and follow-up tracking.
-- The (user_id, habit_id) index MUST be UNIQUE so the saveMemory upsert
-- (ON CONFLICT(user_id, habit_id) DO UPDATE) resolves to a real constraint.

CREATE TABLE IF NOT EXISTS coach_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  topics TEXT NOT NULL DEFAULT '[]',
  follow_ups TEXT NOT NULL DEFAULT '[]',
  mood_trend TEXT NOT NULL DEFAULT 'stable',
  last_topic TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP INDEX IF EXISTS idx_coach_memories_user_habit;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_memories_user_habit ON coach_memories(user_id, habit_id);
