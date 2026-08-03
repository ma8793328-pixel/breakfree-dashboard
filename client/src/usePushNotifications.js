import { useCallback, useEffect, useState } from 'react';

function detectTimezone() {
  try {
    return (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
  } catch {
    return 'UTC';
  }
}

function timeBucket(hour) {
  if (hour >= 5 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 14) return 'Midday';
  if (hour >= 14 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

const BUCKET_HOURS = { Morning: 5, Midday: 11, Afternoon: 14, Evening: 17, Night: 21 };

function formatPeakLabel(bucket) {
  const h = BUCKET_HOURS[bucket];
  if (h == null) return bucket;
  if (h === 5) return '5 am';
  if (h === 11) return '11 am';
  if (h === 14) return '2 pm';
  if (h === 17) return '5 pm';
  if (h === 21) return '9 pm';
  return `${h}am`;
}

function findPeakBucket(urges) {
  const counts = {};
  for (const u of urges || []) {
    const d = new Date(u.logged_at);
    if (isNaN(d.getTime())) continue;
    const b = timeBucket(d.getHours());
    counts[b] = (counts[b] || 0) + 1;
  }
  let peak = null;
  let peakCount = 0;
  for (const [bucket, count] of Object.entries(counts)) {
    if (count > peakCount) { peak = bucket; peakCount = count; }
  }
  return peakCount >= 3 ? { bucket: peak, count: peakCount } : null;
}

// Registers the service worker once and manages the push subscription lifecycle.
// Returns { supported, status, enabled, enable, error }.
export function usePushNotifications(token) {
  const [supported] = useState(() => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window);
  const [status, setStatus] = useState('unknown'); // unknown | default | granted | denied
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supported) return;
    if (navigator.serviceWorker.controller?.state === 'activated') return;
    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => setError('Service worker failed to register.'));
  }, [supported]);

  // Keep the server's copy of our timezone fresh so scheduled nudges fire at the right local time.
  useEffect(() => {
    if (!supported || !token) return;
    fetch('/api/push/tz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timezone: detectTimezone() }),
    }).catch(() => {});
  }, [supported, token]);

  useEffect(() => {
    if (!supported || typeof Notification === 'undefined') return;
    setStatus(Notification.permission);
    const onChange = () => setStatus(Notification.permission);
    window.addEventListener('focus', onChange);
    return () => window.removeEventListener('focus', onChange);
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported) return false;
    try {
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        setStatus(perm);
        if (perm !== 'granted') return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const vapidRes = await fetch('/api/push/vapid');
      const { publicKey } = await vapidRes.json();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
      }
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys, timezone: detectTimezone() }),
      });
      return true;
    } catch {
      setError('Could not enable notifications.');
      return false;
    }
  }, [supported, token]);

  return { supported, status, subscribe, error };
}

export async function scheduleTriggerNudges(urges, token, habitId) {
  if (!token) return null;
  const peak = findPeakBucket(urges);
  if (!peak) return null;

  try {
    const res = await fetch('/api/push/schedule-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        habitId: habitId ?? null,
        bucketLabel: peak.bucket,
        bucketStartHour: BUCKET_HOURS[peak.bucket],
      }),
    });
    if (!res.ok) return null;
    return { bucket: peak.bucket, label: formatPeakLabel(peak.bucket) };
  } catch {
    return null;
  }
}
