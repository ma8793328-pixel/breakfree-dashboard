-- Streak forgiveness, relapse prevention plan, and community buddy matching.

-- A slip can be "forgiven" so it doesn't break the current streak (grace day).
ALTER TABLE checkins ADD COLUMN forgiven INTEGER NOT NULL DEFAULT 0;

-- The user's plan for what to do if they slip (set during onboarding / habit setup).
ALTER TABLE habits ADD COLUMN relapse_plan TEXT;

-- Opt in to finding a "quit buddy" — matched on similar habit / start date.
ALTER TABLE users ADD COLUMN buddy_opt_in INTEGER NOT NULL DEFAULT 0;
