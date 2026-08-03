// BreakFree service worker — handles push events, notification clicks,
// offline coach responses, and static asset caching.

const STATIC_CACHE = 'breakfree-static-v1';
const APP_SHELL = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'BreakFree';
  const options = {
    body: data.body || 'Time to check in with yourself.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/app' },
    tag: data.habitId ? `wellness-alert-${data.habitId}` : 'breakfree-general',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const url = event.notification.data?.url || '/app';
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Offline coach stream — intercept POST to /api/ai/chat/stream
  const isCoachStream =
    event.request.method === 'POST' && url.pathname.endsWith('/api/ai/chat/stream');
  if (isCoachStream) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(event.request);
          if (res.ok) return res;
          throw new Error('coach stream failed');
        } catch {
          const encoder = new TextEncoder();
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"offline":true}\n'));
              controller.enqueue(encoder.encode('data: {"done":true,"quickReplies":[]}\n\n'));
              controller.close();
            },
          });
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-store',
              'X-Offline-Coach': '1',
            },
          });
        }
      })()
    );
    return;
  }

  // Cache-first for static assets and app shell
  const isStaticAsset =
    event.request.method === 'GET' &&
    (url.origin === self.location.origin) &&
    /\.(js|css|html|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|eot|json|wasm)$/.test(url.pathname) ||
    url.pathname === '/' ||
    url.pathname === '/index.html';

  if (isStaticAsset) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((res) => {
            if (res && res.status === 200) {
              cache.put(event.request, res.clone());
            }
            return res;
          }).catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }
});
