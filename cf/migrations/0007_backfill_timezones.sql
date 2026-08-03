-- One-time best-guess timezone for existing users with none, so scheduled nudges
-- don't fire at 4am for people who never reopened the app.
--
-- Heuristic: the modal UTC hour they log urges is assumed to be ~17:00 local
-- (peak craving time). Store as a fixed "UTC±H" offset, which the runtime's
-- localHour() resolves directly. The client overwrites this with the exact IANA
-- zone on the next visit.

UPDATE users
SET timezone = (
  SELECT 'UTC' || CASE WHEN (17 - t.h) >= 0 THEN '+' ELSE '-' END || CAST(ABS(17 - t.h) AS TEXT)
  FROM (
    SELECT CAST(strftime('%H', u.logged_at) AS INTEGER) AS h, COUNT(*) AS n
    FROM urges u JOIN habits h ON h.id = u.habit_id
    WHERE h.user_id = users.id
    GROUP BY CAST(strftime('%H', u.logged_at) AS INTEGER)
    ORDER BY n DESC, h ASC
    LIMIT 1
  ) t
)
WHERE timezone IS NULL
  AND EXISTS (SELECT 1 FROM urges u JOIN habits h ON h.id = u.habit_id WHERE h.user_id = users.id);
