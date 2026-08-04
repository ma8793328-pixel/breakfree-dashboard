-- Free forever: remove premium dependency, add community seed flag.

-- 1. Add is_seed column first.
ALTER TABLE community_posts ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;

-- 2. Mark existing seed posts (from 0005) as is_seed = 1.
UPDATE community_posts SET is_seed = 1 WHERE user_id = (SELECT id FROM users WHERE email = 'community@breakfree.app');
