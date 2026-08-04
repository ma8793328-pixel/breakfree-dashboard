import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { SignJWT } from 'jose';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATIONS = join(ROOT, 'migrations');
const BUNDLE_OUT = join(ROOT, '__test-worker-bundle.mjs');

const JWT_SECRET = 'test-secret-not-used-in-prod';

let mf;
let db;

async function applyMigrations(database) {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n');
    for (const stmt of sql.split(';')) {
      const one = stmt.replace(/\s+/g, ' ').trim();
      if (one) await database.exec(one);
    }
  }
}

async function bundleWorker() {
  await build({
    entryPoints: [join(ROOT, 'src/index.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: BUNDLE_OUT,
    define: { 'process.env.NODE_ENV': '"test"' },
    logLevel: 'error',
  });
  return BUNDLE_OUT;
}

async function signToken(userId) {
  return new SignJWT({ role: 'user', email: 'tester@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: await bundleWorker(),
    compatibilityDate: '2025-04-01',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      JWT_SECRET,
      ADMIN_EMAIL: 'admin@breakfree.app',
      ADMIN_PASSWORD: 'admin12345',
    },
    d1Databases: ['DB'],
  });
  db = await mf.getD1Database('DB');
  await applyMigrations(db);

  // Seed a user, a habit, and urges directly (avoids signup rate limiting).
  await db
    .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .bind('tester@example.com', 'unused', 'user')
    .run();
  await db
    .prepare('INSERT INTO habits (user_id, name, start_date) VALUES (?, ?, ?)')
    .bind(1, 'Quit smoking', '2026-07-01')
    .run();
  await db.prepare('INSERT INTO urges (habit_id, logged_at, intensity, resisted) VALUES (?, ?, ?, ?)').bind(1, '2026-08-01T10:00:00Z', 4, 1).run();
  await db.prepare('INSERT INTO urges (habit_id, logged_at, intensity, resisted) VALUES (?, ?, ?, ?)').bind(1, '2026-08-03T12:00:00Z', 2, 1).run();
  await db.prepare('INSERT INTO urges (habit_id, logged_at, intensity, resisted) VALUES (?, ?, ?, ?)').bind(1, '2026-08-05T09:00:00Z', 1, 0).run();
  await db.prepare('INSERT INTO urges (habit_id, logged_at, intensity, resisted) VALUES (?, ?, ?, ?)').bind(1, '2000-01-01T00:00:00Z', 5, 1).run();
}, 60000);

afterAll(async () => {
  await mf.dispose();
});

describe('worker /api/habits/:id/urges/trend', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await mf.dispatchFetch('http://localhost/api/habits/1/urges/trend');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a habit that does not belong to the user', async () => {
    const token = await signToken(1);
    const res = await mf.dispatchFetch('http://localhost/api/habits/999/urges/trend', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns trend data for the owner of the habit', async () => {
    const token = await signToken(1);
    const res = await mf.dispatchFetch('http://localhost/api/habits/1/urges/trend?days=14', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(14);
    expect(body.series.length).toBeGreaterThan(0);
    for (const p of body.series) {
      expect(p).toHaveProperty('date');
      expect(p.count).toBeGreaterThanOrEqual(1);
    }
    // Grouped only days with >=1 urge: series must be ascending and unique.
    const dates = body.series.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('clamps invalid days values to the default 14', async () => {
    const token = await signToken(1);
    const res = await mf.dispatchFetch('http://localhost/api/habits/1/urges/trend?days=99', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.days).toBe(14);
  });

  it('excludes urges outside the requested window', async () => {
    const token = await signToken(1);
    const res = await mf.dispatchFetch('http://localhost/api/habits/1/urges/trend?days=30', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    // The year-2000 urge must never appear, regardless of the real clock.
    expect(body.series.some((p) => p.date === '2000-01-01')).toBe(false);
  });
});
