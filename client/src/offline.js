import { api } from './api.js';

const KEY = 'bf_offline_queue';

export function readQueue() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
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
