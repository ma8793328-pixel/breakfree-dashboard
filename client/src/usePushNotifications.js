import { useCallback, useEffect, useState } from 'react';

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
        body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
      });
      return true;
    } catch {
      setError('Could not enable notifications.');
      return false;
    }
  }, [supported, token]);

  return { supported, status, subscribe, error };
}
