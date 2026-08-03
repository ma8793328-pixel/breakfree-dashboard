export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Can\'t reach the server. Is it running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.code = data.code;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// The user's local calendar date (YYYY-MM-DD), sent with saves so the server
// records "today" in the user's timezone, not the server's.
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Forgive (or unforgive) a slip so it doesn't break the current streak.
export async function forgiveCheckin(habitId, date, forgiven, token) {
  return api(`/habits/${habitId}/forgive`, { method: 'POST', token, body: { date, forgiven } });
}

// Use a shield token: converts today's slip to a clean, grace day without breaking streak.
export async function spendShieldToken(habitId, token) {
  return api(`/habits/${habitId}/shield`, { method: 'POST', token });
}

// Toggle quit-buddy opt-in.
export async function setBuddyOptIn(optedIn, token) {
  return api('/community/buddies', { method: 'PUT', token, body: { optedIn } });
}

export async function fetchBuddies(token) {
  return api('/community/buddies', { token });
}

// Full GDPR export of the current account (all habits, urges, journals…).
export async function exportAccountData(token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/api/me/export', { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || 'Export failed.');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Permanently delete the current account and all of its data.
export async function deleteAccount(token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/api/me', { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || 'Deletion failed.');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Health/wellness samples (manual entry: steps, sleep hours, resting HR).
export async function fetchHealthSamples(habitId, token, days = 30) {
  return api(`/health?habitId=${habitId}&days=${days}`, { token });
}

export async function saveHealthSample(habitId, sample, token) {
  return api('/health', { method: 'POST', token, body: { habitId, ...sample } });
}

// Record a milestone share (feeds the landing-page social-proof counter).
export async function recordShare(habitId, days, token) {
  return api('/shares', { method: 'POST', token, body: { habitId, days } });
}

export async function fetchShareTotal() {
  return api('/shares/total');
}

export async function saveCoachJournal(habitId, content, token) {
  return api('/ai/save-journal', { method: 'POST', token, body: { habitId, content } });
}
