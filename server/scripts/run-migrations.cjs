const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const dryRun = process.argv.includes('--dry-run');

const dbPath = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, 'breakfree.db')
  : path.join(__dirname, '../data/breakfree.db');

if (!dryRun) {
  const backupPath = path.join(path.dirname(dbPath), `mb-${Date.now().toString(36)}.enc`);
  const key = crypto.scryptSync(process.env.JWT_SECRET, 'breakfree-backup-salt', 32);
  const iv = crypto.randomBytes(12);
  const plaintext = fs.readFileSync(dbPath);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  fs.writeFileSync(backupPath, enc);
  console.log(`💾 Encrypted pre-migrate backup: ${path.basename(backupPath)}`);
}

const db = new Database(dbPath);
const migrationsDir = path.join(__dirname, '../migrations');

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) { console.log(`⏭ Skipped: ${file}`); continue; }
  if (dryRun) { console.log(`[DRY RUN] Would apply: ${file}`); continue; }
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run(file); })();
  console.log(`✅ Applied: ${file}`);
}

const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
fs.readdirSync(path.dirname(dbPath))
  .filter(f => f.startsWith('mb-') && f.endsWith('.enc') || f.includes('migrate-backup-'))
  .forEach(f => {
    const fp = path.join(path.dirname(dbPath), f);
    if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); console.log(`🧹 Stale backup deleted: ${f}`); }
  });

console.log('🎉 All migrations up to date');
db.close();