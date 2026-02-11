// Service Worker para notificações push

self.addEventListener('install', (event) => {
  console.log('Service Worker instalado');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker ativado');
  event.waitUntil(clients.claim());
});

// Block unwanted UTMify events (Lead, ViewContent, AddToCart, PageView)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  if (url.includes('utmify') && (url.includes('/lead') || url.includes('/events'))) {
    if (event.request.method === 'POST') {
      event.respondWith(
        event.request.clone().text().then((body) => {
          if (body.includes('"ViewContent"') ||
              body.includes('"Lead"') ||
              body.includes('"AddToCart"') ||
              body.includes('"PageView"')) {
            console.debug('[SW] Blocked UTMify event:', body.substring(0, 60));
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return fetch(event.request);
        }).catch(() => fetch(event.request))
      );
      return;
    }
    // Block preflight-like GETs to these endpoints too
    if (event.request.method === 'OPTIONS') {
      event.respondWith(new Response(null, { status: 204 }));
      return;
    }
  }
});

self.addEventListener('push', (event) => {
  console.log('Push notification recebida');

  let data = {
    title: 'VALNIX',
    body: 'Nova notificação',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      url: data.url || '/',
    },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('Notificação clicada');

  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Verificar se já existe uma janela aberta
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Se não, abrir nova janela
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});
