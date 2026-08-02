// Web Push for the Workers build — no `web-push` dependency.
// VAPID (ES256 JWT) + RFC 8291 / RFC 8188 aes128gcm payload encryption,
// all with Web Crypto, sent with plain fetch.

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- base64url <-> bytes ----------
function b64ToStr(urlstr) {
  const s = urlstr.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return atob(s + '='.repeat(pad));
}

function strToB64Url(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  return new Uint8Array([...b64ToStr(s)].map((ch) => ch.charCodeAt(0)));
}

function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return strToB64Url(s);
}

function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function rawPublicFromJwk(jwk) {
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(b64urlToBytes(jwk.x), 1);
  raw.set(b64urlToBytes(jwk.y), 33);
  return raw;
}

// ---------- VAPID key pair, persisted in D1 `meta` ----------

export async function loadOrCreateVapid(env) {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('vapid').first();
  if (row) return JSON.parse(row.value);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const vapid = { publicKey: bytesToB64url(rawPublicFromJwk(jwk)), privateKey: JSON.stringify(jwk) };
  try {
    await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('vapid', JSON.stringify(vapid)).run();
  } catch (e) {
    throw new Error(`Could not persist VAPID keys: ${e.message}`);
  }
  return vapid;
}

// ---------- VAPID JWT (ES256) ----------

const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' };

// Convert P1363 (r||s, 64 bytes) <-> DER -- WebCrypto emits/handles both,
// but VAPID requires the raw 64-byte compact form in the JWT signature.
function derToRawR32(der) {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('bad DER signature');
  let len = der[i++];
  if (len & 0x80) i += len & 0x7f;
  const readInt = () => {
    if (der[i] !== 0x02) throw new Error('bad DER integer');
    let ilen = der[i + 1];
    i += 2;
    const bytes = new Uint8Array(32);
    for (let k = 0; k < ilen; k++) bytes[32 - ilen + k] = der[i + k];
    i += ilen;
    return bytes;
  };
  const r = readInt();
  const s = readInt();
  return concat(r, s);
}

async function signJwtSig(jwk, dataBytes) {
  const key = await crypto.subtle.importKey('jwk', jwk, ECDSA_PARAMS, false, ['sign']);
  const der = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, dataBytes));
  return derToRawR32(der);
}

function b64urlJson(obj) {
  return strToB64Url(JSON.stringify(obj));
}

async function vapidAuthorization(vapid, endpoint) {
  const jwk = JSON.parse(vapid.privateKey);
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}/`;
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ typ: 'JWT', alg: 'ES256', kid: vapid.publicKey });
  const payload = b64urlJson({ aud, exp: now + 3600, sub: 'mailto:coach@breakfree.app' });
  const token = `${header}.${payload}`;
  const sig = await signJwtSig(jwk, enc.encode(token));
  return `vapid t=${token}.${bytesToB64url(sig)}, k=${vapid.publicKey}`;
}

// ---------- RFC 8291 // RFC 8188 message ----------

async function hkdfDigest(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

async function ecdhShared(privateKey, partnerRaw) {
  const partner = await crypto.subtle.importKey(
    'raw',
    partnerRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: partner }, privateKey, 256));
}

export async function encryptPushPayload(uaPublicB64, authB64, payloadBytes) {
  const uaPublic = b64urlToBytes(uaPublicB64);
  const authSecret = b64urlToBytes(authB64);

  const ecdh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const ecdhJwk = await crypto.subtle.exportKey('jwk', ecdh.publicKey);
  const ephemeralRaw = rawPublicFromJwk(ecdhJwk);
  const shared = await ecdhShared(ecdh.privateKey, uaPublic);

  const prk = await hkdfDigest(shared, authSecret, concat(enc.encode('WebPush: info\x00'), uaPublic, ephemeralRaw), 32);
  const aesKeyBytes = await hkdfDigest(prk, authSecret, enc.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfDigest(prk, authSecret, enc.encode('Content-Encoding: nonce\x00'), 12);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const padded = concat(new Uint8Array([0x00, 0x00]), payloadBytes);
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded)
  );

  // aes128gcm body: salt(16) | rs(4 BE) | idlen(1) | id -> then ciphertext
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([ephemeralRaw.length]);
  return concat(salt, rs, idlen, ephemeralRaw, cipher);
}

export async function sendPush(env, sub, payloadObj) {
  const vapid = await loadOrCreateVapid(env);
  const body = await encryptPushPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(payloadObj)));
  const auth = await vapidAuthorization(vapid, sub.endpoint);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'normal',
      Authorization: auth,
    },
    body,
  });
  if (!res.ok) throw { statusCode: res.status, message: res.statusText };
}