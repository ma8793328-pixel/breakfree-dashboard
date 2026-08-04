const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbPath = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, 'breakfree.db')
  : path.join(__dirname, '../data/breakfree.db');

const onDrive = dbPath.toLowerCase().includes('onedrive');
const allowDrive = process.env.ALLOW_ONEDRIVE === '1';
if (onDrive) {
  if (allowDrive) {
    console.warn('⚠️ ALLOW_ONEDRIVE=1 — DB sits under a OneDrive-synced path. Local dev only; never set this in production.');
  } else {
    console.error('❌ DB under OneDrive sync — EXCLUDE server/data FROM ONEDRIVE FIRST');
    process.exit(1);
  }
}
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
try {
  fs.writeFileSync(`${dbDir}/.onedrive-test`, 'ok');
  fs.unlinkSync(`${dbDir}/.onedrive-test`);
} catch (e) {
  console.error('❌ Data folder locked by OneDrive Files On-Demand — set "Always keep on this device"');
  process.exit(1);
}

const required = ['ADMIN_PASSWORD', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const unsafe = {
  ADMIN_PASSWORD: 'admin12345',
  JWT_SECRET: 'breakfree-dev-secret-change-me',
  STRIPE_SECRET_KEY: v => process.env.NODE_ENV === 'production' && !v.startsWith('sk_live_')
};
let fail = false;
for (const k of required) {
  const v = process.env[k];
  if (!v) { console.error(`❌ Missing env: ${k}`); fail = true; continue; }
  const bad = typeof unsafe[k] === 'function' ? unsafe[k](v) : v === unsafe[k];
  if (bad) { console.error(`❌ Unsafe default: ${k}`); fail = true; }
}
if (fail) process.exit(1);
console.log('✅ Secrets validated');