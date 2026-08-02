// Auth for the Workers build: PBKDF2 password hashing + jose HS256 JWTs
// (same route shapes and token claims as the Node build).

import { SignJWT, jwtVerify } from 'jose';

const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 100000;

function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBytes = toBytes(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    64 * 8
  );
  return toHex(new Uint8Array(bits));
}

function toBytes(str) {
  if (typeof str === 'string' && /^[0-9a-f]+$/.test(str) && str.length % 2 === 0) {
    const out = new Uint8Array(str.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return enc.encode(str);
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return toHex(bytes);
}

export async function hashPassword(password) {
  const salt = randomHex(16);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${salt}:${PBKDF2_ITERATIONS}:${hash}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [, its, want] = parts;
  const gotSalt = parts[0];
  const got = await derive(password, gotSalt, Number(its) || PBKDF2_ITERATIONS);
  return got === want;
}

export async function signToken(user, secret, expiresSec = 60 * 60 * 24 * 365) {
  return new SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(expiresSec)}s`)
    .sign(enc.encode(secret));
}

export async function verifyToken(token, secret) {
  try {
    const { payload } = await jwtVerify(token, enc.encode(secret));
    return { id: Number(payload.sub), email: payload.email || '', role: payload.role || 'user' };
  } catch {
    return null;
  }
}