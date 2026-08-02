// BreakFree service worker — handles push events and notification clicks.

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
