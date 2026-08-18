self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};

  event.waitUntil(
    self.registration.showNotification(data.title || 'Push Test', {
      body: data.body || 'New notification',
      icon: '/icon.png',
      badge: '/icon.png',
      tag: data.tag || 'push-test',
      renotify: true,
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(openClients => {
        const existing = openClients.find(client =>
          client.url.startsWith(self.location.origin)
        );

        return existing
          ? existing.focus()
          : clients.openWindow(event.notification.data.url);
      })
  );
});