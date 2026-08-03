-- Intake + urge tracking fields.

ALTER TABLE habits ADD COLUMN units_per_day REAL;
ALTER TABLE habits ADD COLUMN trigger_times TEXT;
ALTER TABLE habits ADD COLUMN reason TEXT;

ALTER TABLE urges ADD COLUMN trigger_type TEXT;
ALTER TABLE urges ADD COLUMN action TEXT;

CREATE INDEX IF NOT EXISTS idx_urges_trigger_type ON urges(trigger_type);
