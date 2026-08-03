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

  CREATE TABLE IF NOT EXISTS trigger_nudges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    bucket_label TEXT NOT NULL,
    bucket_start_hour INTEGER NOT NULL,
    timezone TEXT NOT NULL,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, habit_id)
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

  CREATE TABLE IF NOT EXISTS community_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    habit_name TEXT,
    streak INTEGER,
    badge INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS community_reactions (
    post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS community_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS community_follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
  );

  CREATE TABLE IF NOT EXISTS community_blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS community_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER REFERENCES community_posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES community_comments(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    action TEXT,
    resolved_at TEXT,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (status IN ('open', 'resolved'))
  );

  CREATE TABLE IF NOT EXISTS app_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    stack TEXT,
    url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS health_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    steps INTEGER,
    sleep_hours REAL,
    resting_hr INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (habit_id, date)
  );

  CREATE TABLE IF NOT EXISTS milestone_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    days INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS engagement_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, kind)
  );

  CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
  CREATE INDEX IF NOT EXISTS idx_checkins_habit ON checkins(habit_id);
  CREATE INDEX IF NOT EXISTS idx_urges_habit ON urges(habit_id);
  CREATE INDEX IF NOT EXISTS idx_journals_habit ON journals(habit_id);
  CREATE INDEX IF NOT EXISTS idx_daily_checkins_habit ON daily_checkins(habit_id);
  CREATE INDEX IF NOT EXISTS idx_errors_created ON app_errors(created_at);
  CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user ON checkout_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_community_posts_user ON community_posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_community_posts_created ON community_posts(created_at);
  CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_community_reactions_post ON community_reactions(post_id);
  CREATE INDEX IF NOT EXISTS idx_community_follows_follower ON community_follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_community_blocks_blocker ON community_blocks(blocker_id);
  CREATE INDEX IF NOT EXISTS idx_community_reports_status ON community_reports(status);
  CREATE INDEX IF NOT EXISTS idx_health_samples_habit ON health_samples(habit_id);
  CREATE INDEX IF NOT EXISTS idx_milestone_shares_user ON milestone_shares(user_id);
  CREATE INDEX IF NOT EXISTS idx_engagement_events_user ON engagement_events(user_id);
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
  if (!usersCols.some((c) => c.name === 'username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  }
  if (!usersCols.some((c) => c.name === 'timezone')) {
    db.exec('ALTER TABLE users ADD COLUMN timezone TEXT');
  }
  if (!usersCols.some((c) => c.name === 'buddy_opt_in')) {
    db.exec('ALTER TABLE users ADD COLUMN buddy_opt_in INTEGER NOT NULL DEFAULT 0');
  }
} catch (e) {
  console.error('Migration warning (users):', e.message);
}

// One-time best-guess timezone backfill for users with none (same heuristic as
// migration 0007): modal UTC hour of urge logging is assumed to be ~17:00 local.
try {
  db.exec(
    `UPDATE users
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
       AND EXISTS (SELECT 1 FROM urges u JOIN habits h ON h.id = u.habit_id WHERE h.user_id = users.id)`
  );
} catch (e) {
  console.error('Timezone backfill warning:', e.message);
}

try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
} catch (e) {
  console.error('Migration warning (username index):', e.message);
}

try {
  const pushCols = db.prepare('PRAGMA table_info(push_subscriptions)').all();
  if (!pushCols.some((c) => c.name === 'last_seen')) {
    db.exec('ALTER TABLE push_subscriptions ADD COLUMN last_seen TEXT');
  }
} catch (e) {
  console.error('Migration warning (push_subscriptions):', e.message);
}

try {
  const subCols = db.prepare('PRAGMA table_info(subscriptions)').all();
  if (!subCols.some((c) => c.name === 'stripe_customer_id')) {
    db.exec('ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT');
  }
  if (!subCols.some((c) => c.name === 'stripe_subscription_id')) {
    db.exec('ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT');
  }
} catch (e) {
  console.error('Migration warning (subscriptions):', e.message);
}

try {
  const habitCols = db.prepare('PRAGMA table_info(habits)').all();
  if (!habitCols.some((c) => c.name === 'units_per_day')) {
    db.exec('ALTER TABLE habits ADD COLUMN units_per_day REAL');
  }
  if (!habitCols.some((c) => c.name === 'trigger_times')) {
    db.exec('ALTER TABLE habits ADD COLUMN trigger_times TEXT');
  }
  if (!habitCols.some((c) => c.name === 'reason')) {
    db.exec('ALTER TABLE habits ADD COLUMN reason TEXT');
  }
  if (!habitCols.some((c) => c.name === 'relapse_plan')) {
    db.exec('ALTER TABLE habits ADD COLUMN relapse_plan TEXT');
  }
  if (!habitCols.some((c) => c.name === 'shield_tokens')) {
    db.exec('ALTER TABLE habits ADD COLUMN shield_tokens INTEGER NOT NULL DEFAULT 0');
  }
} catch (e) {
  console.error('Migration warning (habits):', e.message);
}

try {
  const checkinCols = db.prepare('PRAGMA table_info(checkins)').all();
  if (!checkinCols.some((c) => c.name === 'forgiven')) {
    db.exec('ALTER TABLE checkins ADD COLUMN forgiven INTEGER NOT NULL DEFAULT 0');
  }
} catch (e) {
  console.error('Migration warning (checkins):', e.message);
}

try {
  const urgeCols = db.prepare('PRAGMA table_info(urges)').all();
  if (!urgeCols.some((c) => c.name === 'trigger_type')) {
    db.exec('ALTER TABLE urges ADD COLUMN trigger_type TEXT');
  }
  if (!urgeCols.some((c) => c.name === 'action')) {
    db.exec('ALTER TABLE urges ADD COLUMN action TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_urges_trigger_type ON urges(trigger_type)');
} catch (e) {
  console.error('Migration warning (urges):', e.message);
}

// Seed the community with a system account + starter posts so it's never empty.
try {
  const seedUser = db
    .prepare("INSERT OR IGNORE INTO users (email, password_hash, role, username) VALUES ('community@breakfree.app', 'seed:disabled-login', 'user', 'BreakFree')")
    .run();
  const community = db.prepare("SELECT id FROM users WHERE email = 'community@breakfree.app'").get();
  if (community) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ?').get(community.id).n;
    if (count === 0) {
      const ins = db.prepare('INSERT INTO community_posts (user_id, content) VALUES (?, ?)');
      ins.run(
        community.id,
        "Welcome to BreakFree Community. You're not alone — someone out there is on day 1 today, just like you. Share your win, even the small ones. 💪"
      );
      ins.run(
        community.id,
        "Reminder: progress isn't a straight line. A slip is a data point, not a verdict. We're glad you're here. 🌱"
      );
      ins.run(
        community.id,
        'Fun fact: most cravings pass within 10–20 minutes. Next one hits? Ride it out before you decide anything. 🧘'
      );
      console.log('Seeded community starter posts.');
    }
  }
} catch (e) {
  console.error('Community seed warning:', e.message);
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
