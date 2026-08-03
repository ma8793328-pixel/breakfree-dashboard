-- Store the user's IANA timezone so scheduled nudges fire in their local time.

ALTER TABLE users ADD COLUMN timezone TEXT;
