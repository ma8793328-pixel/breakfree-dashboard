-- Fix coach_memories upsert: the saveMemory() SQL uses
-- ON CONFLICT(user_id, habit_id) DO UPDATE, which SQLite only allows when
-- that column pair is UNIQUE. The plain index from 0020 never matched a
-- constraint, so every saveMemory() threw and chat fell back to canned
-- coachReply() replies. This migration converts it to a UNIQUE index.

DROP INDEX IF EXISTS idx_coach_memories_user_habit;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_memories_user_habit ON coach_memories(user_id, habit_id);
