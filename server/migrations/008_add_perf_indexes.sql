CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_urges_habit_date ON urges(habit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_habit_date ON checkins(habit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE TABLE IF NOT EXISTS stripe_event_ids (id TEXT PRIMARY KEY, processed_at TEXT DEFAULT CURRENT_TIMESTAMP);