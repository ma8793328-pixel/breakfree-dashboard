// Real Stripe integration for the Workers build — talks to Stripe's REST API
// with plain fetch (no SDK), and verifies webhooks with Web Crypto HMAC.
// Fallback: if STRIPE_SECRET_KEY is not set, callers keep the simulated flow.

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_VERSION = '2024-06-20';

function encodeForm(obj) {
  const parts = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v == null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

export async function stripeRequest(env, method, path, form) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY).');
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_VERSION,
    },
    body: form ? encodeForm(form) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${method} ${path} failed (${res.status})`);
  return data;
}

// Create a Checkout Session for a one-month Premium subscription.
export async function createCheckout(env, { userId, email, origin }) {
  const form = {
    mode: 'subscription',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': PRICE_CENTS,
    'line_items[0][price_data][product][name]': 'BreakFree Premium',
    'line_items[0][price_data][recurring][interval]': 'month',
    client_reference_id: String(userId),
    customer_email: email,
    'metadata[user_id]': String(userId),
    success_url: `${origin}/app/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/premium?checkout=canceled`,
  };
  const s = await stripeRequest(env, 'POST', '/checkout/sessions', form);
  return { id: s.id, url: s.url, priceCents: PRICE_CENTS, currency: 'usd' };
}

export async function retrieveSession(env, sessionId) {
  const s = await stripeRequest(env, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  return {
    id: s.id,
    payment_status: s.payment_status,
    client_reference_id: s.client_reference_id,
    customer: s.customer,
    subscription: s.subscription,
  };
}

export async function cancelStripeSubscription(env, subscriptionId) {
  if (!subscriptionId) return null;
  try {
    return await stripeRequest(env, 'DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  } catch {
    return null;
  }
}

// Verify a Stripe webhook signature (t=...,v1=...) with the webhook secret.
export async function verifyWebhookSignature(env, rawBody, signatureHeader) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;
  const parts = {};
  const signature = signatureHeader;
  for (const item of String(signature || '').split(',')) {
    const [k, v] = item.split('=');
    parts[k.trim()] = (v || '').trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = new TextEncoder().encode(`${t}.${rawBody}`);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return expected === v1;
}

const PRICE_CENTS = 499;