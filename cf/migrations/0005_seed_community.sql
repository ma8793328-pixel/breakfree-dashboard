-- Seed a system community account + starter posts so new communities aren't empty.

INSERT OR IGNORE INTO users (email, password_hash, role, username)
VALUES ('community@breakfree.app', 'seed:disabled-login', 'user', 'BreakFree');

INSERT OR IGNORE INTO community_posts (user_id, content)
SELECT id, 'Welcome to BreakFree Community. You''re not alone — someone out there is on day 1 today, just like you. Share your win, even the small ones. 💪'
FROM users WHERE email = 'community@breakfree.app';

INSERT OR IGNORE INTO community_posts (user_id, content)
SELECT id, 'Reminder: progress isn''t a straight line. A slip is a data point, not a verdict. We''re glad you''re here. 🌱'
FROM users WHERE email = 'community@breakfree.app';

INSERT OR IGNORE INTO community_posts (user_id, content)
SELECT id, 'Fun fact: most cravings pass within 10–20 minutes. Next one hits? Ride it out before you decide anything. 🧘'
FROM users WHERE email = 'community@breakfree.app';
