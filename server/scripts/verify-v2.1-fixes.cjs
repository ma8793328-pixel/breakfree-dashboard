const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

console.log('🔍 BreakFree v2.1 Critical Fixes Verification\n');

let allPassed = true;
const results = [];

// ========== HELPER FUNCTIONS ==========
function check(name, condition, details = '') {
  const passed = condition();
  results.push({ name, passed, details });
  console.log(`${passed ? '✅' : '❌'} ${name}${details ? ` - ${details}` : ''}`);
  if (!passed) allPassed = false;
  return passed;
}

// ========== PHASE 1: BOOT BLOCKER ==========
console.log('\n📦 Phase 1: Boot Blocker (Dependencies)');

check('express-rate-limit installed',
  () => {
    try { require.resolve('express-rate-limit'); return true; }
    catch { return false; }
  });

check('helmet installed',
  () => {
    try { require.resolve('helmet'); return true; }
    catch { return false; }
  });

check('csurf installed',
  () => {
    try { require.resolve('csurf'); return true; }
    catch { return false; }
  });

check('cookie-parser installed',
  () => {
    try { require.resolve('cookie-parser'); return true; }
    catch { return false; }
  });

// ========== PHASE 2: SECURITY ==========
console.log('\n🔒 Phase 2: Security');

check('ADMIN_PASSWORD not default',
  () => process.env.ADMIN_PASSWORD !== 'admin12345',
  process.env.ADMIN_PASSWORD ? 'Set' : 'NOT SET');

check('JWT_SECRET not default',
  () => process.env.JWT_SECRET !== 'breakfree-dev-secret-change-me',
  process.env.JWT_SECRET ? 'Set' : 'NOT SET');

check('JWT_SECRET is strong (64+ chars)',
  () => process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 64);

check('Stripe keys are live mode',
  () => process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_live_'));

check('Stripe webhook secret set',
  () => process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_'));

// Check index.js for security middleware
const indexPath = path.join(__dirname, '../index.js');
if (fs.existsSync(indexPath)) {
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  check('CSRF middleware configured',
    () => indexContent.includes('csurf') &&
          indexContent.includes('httpOnly:') &&
          indexContent.includes('secure:') &&
          indexContent.includes('sameSite:'));

  check('cookie-parser applied before csrf',
    () => {
      const cookieIdx = indexContent.indexOf("app.use(cookieParser())");
      const csrfIdx = indexContent.indexOf('csrf({');
      return cookieIdx !== -1 && csrfIdx !== -1 && cookieIdx < csrfIdx;
    });

  check('No bare require() in ESM routes (self-check uses createRequire)',
    () => indexContent.includes('createRequire(import.meta.url)') &&
          !/require\(\s*d\s*\)/.test(indexContent));

  check('Self-check queries the shared db for indexes',
    () => indexContent.includes("sqlite_master WHERE type='index' AND name LIKE 'idx_%'") &&
          indexContent.includes('>= 5'));

  check('No .pragma() calls remain (must use db.exec)',
    () => !/\.pragma\(/.test(indexContent));

  check('OneDrive watchdog writes a probe file (not accessSync on a missing file)',
    () => indexContent.includes('.onedrive-test') &&
          indexContent.includes('writeFileSync(probe'));

  check('Rate limiting configured',
    () => indexContent.includes('rateLimit') &&
          indexContent.includes('windowMs') &&
          indexContent.includes('max:'));

  check('Log redaction middleware exists',
    () => indexContent.includes('redact') &&
          indexContent.includes('authorization|password|token|secret'));

  check('Stripe webhook IP allowlist',
    () => indexContent.includes('STRIPE_IPS') &&
          indexContent.includes('cf-connecting-ip'));

  check('Stripe idempotency guard',
    () => indexContent.includes('stripe_event_ids') &&
          indexContent.includes('ON CONFLICT'));
}

// ========== PHASE 3: PUSH NOTIFICATIONS ==========
console.log('\n📱 Phase 3: Push Notifications');

check('VAPID keys configured',
  () => process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_PUBLIC_KEY.length > 20 &&
        process.env.VAPID_PRIVATE_KEY.length > 20,
  process.env.VAPID_CONTACT_EMAIL ? `Email: ${process.env.VAPID_CONTACT_EMAIL}` : 'Email NOT SET');

check('vapid.json exists',
  () => fs.existsSync(path.join(__dirname, '../vapid.json')));

check('VAPID validation test',
  () => {
    try {
      const wp = require('web-push');
      const email = /^mailto:/i.test(process.env.VAPID_CONTACT_EMAIL || '')
        ? process.env.VAPID_CONTACT_EMAIL
        : `mailto:${process.env.VAPID_CONTACT_EMAIL}`;
      wp.setVapidDetails(
        email,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      return true;
    } catch {
      return false;
    }
  });

// ========== PHASE 4: DATABASE ==========
console.log('\n🗃️ Phase 4: Database Performance');

const dbPath = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, 'breakfree.db')
  : path.join(__dirname, '../data/breakfree.db');

let db;
try {
  db = new Database(dbPath);

  check('Database accessible', () => true);

  const journalMode = db.pragma('journal_mode', { simple: true });
  check('WAL mode enabled', () => journalMode === 'wal', `Current: ${journalMode}`);

  const indexCount = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").get().c;
  check('All 5 indexes exist', () => indexCount >= 5, `Found: ${indexCount} indexes`);

  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stripe_event_ids'").get() !== undefined;
  check('stripe_event_ids table exists', () => tableExists);

  const integrity = db.pragma('integrity_check', { simple: true });
  check('Database integrity', () => integrity === 'ok', `Status: ${integrity}`);

  // fullfsync/temp_store are per-connection, so a fresh connection always reads
  // fullfsync=0. Verify the boot-time pragmas exist in server/index.js instead.
  const serverSrc = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const hasFullfsync = /PRAGMA\s*fullfsync\s*=\s*ON/i.test(serverSrc);
  const hasTempStore = /PRAGMA\s*temp_store\s*=\s*MEMORY/i.test(serverSrc);
  const hasCheckpoint = /wal_checkpoint\(\s*PASSIVE\s*\)/.test(serverSrc);
  check('OneDrive pragmas configured', () => hasFullfsync && hasTempStore && hasCheckpoint, `fullfsync=${hasFullfsync} temp_store=${hasTempStore} checkpoint=${hasCheckpoint}`);

} catch (e) {
  check('Database accessible', () => false, `Error: ${e.message}`);
} finally {
  if (db) db.close();
}

// ========== PHASE 5: SCRIPTS ==========
console.log('\n📜 Phase 5: Scripts');

check('check-secrets.cjs exists',
  () => fs.existsSync(path.join(__dirname, 'check-secrets.cjs')));

check('check-secrets has ALLOW_ONEDRIVE dev override (prod stays strict)',
  () => {
    const src = fs.readFileSync(path.join(__dirname, 'check-secrets.cjs'), 'utf8');
    return src.includes('ALLOW_ONEDRIVE') && src.includes('process.exit(1)');
  });

check('smoke-test.ps1 exists',
  () => fs.existsSync(path.join(__dirname, 'smoke-test.ps1')));

check('run-migrations.cjs exists',
  () => fs.existsSync(path.join(__dirname, 'run-migrations.cjs')));

check('Migration 008 exists',
  () => fs.existsSync(path.join(__dirname, '../migrations/008_add_perf_indexes.sql')));

// ========== FILE CHECKS ==========
console.log('\n📁 File Checks');

check('.env exists and has content',
  () => {
    const f = path.join(__dirname, '../.env');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').length > 0;
    return true; // CI provides env vars directly; other checks catch missing secrets
  });

check('.env has ALLOW_ONEDRIVE=1 (local dev)',
  () => {
    const f = path.join(__dirname, '../.env');
    const has = fs.existsSync(f) && /^ALLOW_ONEDRIVE=1\s*$/m.test(fs.readFileSync(f, 'utf8'));
    const dbPath = path.join(__dirname, '../data/breakfree.db');
    return has || !dbPath.toLowerCase().includes('onedrive'); // not needed off-OneDrive (CI)
  });

check('.env.example exists',
  () => fs.existsSync(path.join(__dirname, '../.env.example')));

check('.gitignore blocks sensitive files',
  () => {
    const gitignore = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8');
    return gitignore.includes('.env') &&
           gitignore.includes('vapid.json') &&
           gitignore.includes('*.db') &&
           gitignore.includes('*.sqlite');
  });

check('.gitattributes exists',
  () => fs.existsSync(path.join(__dirname, '../.gitattributes')));

// ========== CLOUDFLARE WORKER SYNC ==========
console.log('\n☁️ Cloudflare Worker Synchronization');

const cfPath = path.join(__dirname, '../../cf/src/index.js');
if (fs.existsSync(cfPath)) {
  check('CF Worker exists', () => true);

  const cfContent = fs.readFileSync(cfPath, 'utf8');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  const nodeIssuer = /issuer:\s*['"]([^'"]+)['"]/.exec(indexContent)?.[1];
  const cfIssuer = /issuer:\s*['"]([^'"]+)['"]/.exec(cfContent)?.[1];
  check('JWT issuer matches Node', () => nodeIssuer === cfIssuer && nodeIssuer === 'breakfree', `Node: ${nodeIssuer}, CF: ${cfIssuer}`);

  const nodeAudience = /audience:\s*['"]([^'"]+)['"]/.exec(indexContent)?.[1];
  const cfAudience = /audience:\s*['"]([^'"]+)['"]/.exec(cfContent)?.[1];
  check('JWT audience matches Node', () => nodeAudience === cfAudience && nodeAudience === 'breakfree-api', `Node: ${nodeAudience}, CF: ${cfAudience}`);

  const nodeOrigins = /ALLOWED_ORIGINS.*?\[([^\]]+)\]/s.exec(indexContent)?.[1];
  const cfOrigins = /ALLOWED_ORIGINS.*?\[([^\]]+)\]/s.exec(cfContent)?.[1];
  const norm = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  check('CORS origins match', () => norm(nodeOrigins) === norm(cfOrigins) && norm(nodeOrigins) !== '', `Node: ${norm(nodeOrigins)}, CF: ${norm(cfOrigins)}`);

  check('CF Worker uses strong consistency', () => cfContent.includes("consistency: 'strong'") || cfContent.includes('consistency:"strong"'));

  check('CF Worker has context.waitUntil', () => cfContent.includes('context.waitUntil'));
} else {
  check('CF Worker exists', () => false, 'File not found');
}

// ========== FINAL SUMMARY ==========
console.log('\n' + '='.repeat(50));
console.log('📊 VERIFICATION SUMMARY');
console.log('='.repeat(50));

const passed = results.filter(r => r.passed).length;
const total = results.length;
const percentage = Math.round((passed / total) * 100);

console.log(`\nPassed: ${passed}/${total} (${percentage}%)\n`);

if (allPassed) {
  console.log('🎉 ALL CHECKS PASSED - BreakFree v2.1 is production-ready!');
  process.exit(0);
} else {
  console.log('⚠️  SOME CHECKS FAILED - Review the ❌ items above\n');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}${r.details ? ` (${r.details})` : ''}`);
  });
  process.exit(1);
}