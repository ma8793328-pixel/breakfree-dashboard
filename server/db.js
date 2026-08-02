import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where SQLite data, VAPID keys and backups live. Override with DATA_DIR when
// deploying (e.g. Render persistent disk) — defaults to ./data next to this
// file for local development.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

const dataDir = DATA_DIR;
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'breakfree.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    daily_cost REAL,
    cost_unit TEXT NOT NULL DEFAULT 'day',
    daily_time REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('clean','slip')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (habit_id, date)
  );

  CREATE TABLE IF NOT EXISTS urges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    logged_at TEXT NOT NULL,
    intensity INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 5),
    trigger TEXT,
    resisted INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS journals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    energy INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 5),
    sleep INTEGER NOT NULL CHECK (sleep BETWEEN 1 AND 5),
    mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (habit_id, date)
  );

  CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    threshold INTEGER NOT NULL,
    earned_date TEXT NOT NULL,
    UNIQUE (habit_id, threshold)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'free',
    started_at TEXT,
    renews_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    price_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS journals_fts USING fts5(content);

  CREATE TABLE IF NOT EXISTS app_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    stack TEXT,
    url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
  CREATE INDEX IF NOT EXISTS idx_checkins_habit ON checkins(habit_id);
  CREATE INDEX IF NOT EXISTS idx_urges_habit ON urges(habit_id);
  CREATE INDEX IF NOT EXISTS idx_journals_habit ON journals(habit_id);
  CREATE INDEX IF NOT EXISTS idx_daily_checkins_habit ON daily_checkins(habit_id);
  CREATE INDEX IF NOT EXISTS idx_errors_created ON app_errors(created_at);
  CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user ON checkout_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
`);

// Migrations: older databases lack columns added later.
try {
  const usersCols = db.prepare('PRAGMA table_info(users)').all();
  if (!usersCols.some((c) => c.name === 'role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!usersCols.some((c) => c.name === 'notification_prefs')) {
    db.exec("ALTER TABLE users ADD COLUMN notification_prefs TEXT");
  }
} catch (e) {
  console.error('Migration warning (users):', e.message);
}

try {
  const pushCols = db.prepare('PRAGMA table_info(push_subscriptions)').all();
  if (!pushCols.some((c) => c.name === 'last_seen')) {
    db.exec('ALTER TABLE push_subscriptions ADD COLUMN last_seen TEXT');
  }
} catch (e) {
  console.error('Migration warning (push_subscriptions):', e.message);
}

// Keep the FTS index in sync with journal entries.
export function indexJournal(id, content) {
  try {
    db.prepare('DELETE FROM journals_fts WHERE rowid = ?').run(id);
    db.prepare('INSERT INTO journals_fts (rowid, content) VALUES (?, ?)').run(id, String(content));
  } catch (e) {
    console.error('FTS index failed:', e.message);
  }
}

// Backfill: index any entries written before FTS existed.
try {
  const rows = db
    .prepare('SELECT j.id, j.content FROM journals j LEFT JOIN journals_fts f ON f.rowid = j.id WHERE f.rowid IS NULL')
    .all();
  const ins = db.prepare('INSERT INTO journals_fts (rowid, content) VALUES (?, ?)');
  for (const r of rows) ins.run(r.id, String(r.content));
  if (rows.length > 0) console.log(`Indexed ${rows.length} journal entr${rows.length === 1 ? 'y' : 'ies'} for search.`);
} catch (e) {
  console.error('FTS backfill failed:', e.message);
}
