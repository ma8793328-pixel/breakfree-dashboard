-- Streak shield tokens: earned every 7 clean days, spent to forgive a slip
-- without breaking the streak.

ALTER TABLE habits ADD COLUMN shield_tokens INTEGER NOT NULL DEFAULT 0;
