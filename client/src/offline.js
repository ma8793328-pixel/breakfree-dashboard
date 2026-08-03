import { api } from './api.js';

const WRITE_QUEUE_KEY = 'bf_offline_queue';
const JOURNAL_QUEUE_KEY = 'bf_journal_queue';
const CHECKIN_DRAFT_KEY = 'bf_checkin_draft';
const COACH_CACHE_KEY = 'bf_coach_cache';
const JOURNAL_CACHE_KEY = 'bf_journal_cache';

export function readQueue() {
  try {
    const raw = localStorage.getItem(WRITE_QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list) {
  try {
    localStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked — the in-memory copy still replays this session.
  }
}

// Queues a write to replay later. Identical ops (e.g. a double-tapped save)
// collapse into one, since replaying them would just be wasted work.
export function queueOffline(op) {
  const list = readQueue();
  const bodyKey = JSON.stringify(op.body ?? null);
  const alreadyQueued = list.some(
    (queued) => queued.path === op.path && queued.method === op.method && JSON.stringify(queued.body ?? null) === bodyKey
  );
  if (!alreadyQueued) {
    list.push(op);
    writeQueue(list);
  }
  return true;
}

// Reads from local cache for GET requests
export function readFromCache(cacheKey) {
  try {
    const raw = localStorage.getItem(cacheKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Writes data to local cache
export function writeToCache(cacheKey, data) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // Storage full or blocked
  }
}

// Replays queued writes in order:
//  - success: item is removed and the trimmed queue is persisted immediately,
//    so a crash mid-replay can't cause already-replayed items to run twice;
//  - network failure (no status): stop and keep the rest queued;
//  - 4xx: drop the item — the server will never accept it as-is;
//  - 5xx: keep the item and keep going — it may succeed on a later retry.
// All save endpoints are upserts, so replay is idempotent even for edge cases.
export async function flushOfflineQueue(token) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const queue = readQueue();
  if (queue.length === 0) return false;
  for (let i = 0; i < queue.length; i++) {
    const op = queue[i];
    try {
      await api(op.path, { method: op.method, body: op.body, token });
    } catch (err) {
      if (!err.status) {
        // Fetch failed entirely — still offline (or server down). Keep the
        // already-replayed items removed and leave the rest for later.
        writeQueue(queue);
        return false;
      }
      if (err.status >= 500) continue; // transient — retry on the next flush
      // 4xx: permanent rejection, drop it rather than replay it forever.
      queue.splice(i, 1);
      i -= 1;
      continue;
    }
    queue.splice(i, 1);
    i -= 1;
  }
  writeQueue(queue);
  return true;
}

export function readJournalQueue() {
  try {
    const raw = localStorage.getItem(JOURNAL_QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeJournalQueue(list) {
  try {
    localStorage.setItem(JOURNAL_QUEUE_KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked
  }
}

export function queueJournal(entry) {
  const list = readJournalQueue();
  list.push(entry);
  writeJournalQueue(list);
  return true;
}

export async function flushJournalQueue(token) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const queue = readJournalQueue();
  if (queue.length === 0) return false;
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    try {
      await api(`/habits/${entry.habitId}/journals`, {
        method: 'POST',
        token,
        body: { content: entry.content },
      });
      queue.splice(i, 1);
      i -= 1;
    } catch (err) {
      if (!err.status) {
        writeJournalQueue(queue);
        return false;
      }
      if (err.status >= 500) continue;
      queue.splice(i, 1);
      i -= 1;
    }
  }
  writeJournalQueue(queue);
  return true;
}

function readCheckinDraft() {
  try {
    const raw = localStorage.getItem(CHECKIN_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCheckinDraft(form) {
  try {
    localStorage.setItem(CHECKIN_DRAFT_KEY, JSON.stringify(form));
  } catch {
    // storage full or blocked
  }
}

function clearCheckinDraft() {
  try {
    localStorage.removeItem(CHECKIN_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function readCoachCache(habitId) {
  try {
    const raw = localStorage.getItem(`${COACH_CACHE_KEY}_${habitId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeCoachCache(habitId, data) {
  try {
    localStorage.setItem(`${COACH_CACHE_KEY}_${habitId}`, JSON.stringify(data));
  } catch {
    // storage full or blocked
  }
}

export function readJournalCache(habitId) {
  try {
    const raw = localStorage.getItem(`${JOURNAL_CACHE_KEY}_${habitId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJournalCache(habitId, data) {
  try {
    localStorage.setItem(`${JOURNAL_CACHE_KEY}_${habitId}`, JSON.stringify(data));
  } catch {
    // storage full or blocked
  }
}

export { writeCheckinDraft, clearCheckinDraft, readCheckinDraft };
