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
// IMPORTANT: Only intercepts specific UTMify tracking endpoints, never other requests
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only target UTMify tracking API endpoints — never block pixel.js, SDKs, Supabase, etc.
  const isUtmifyTrackingEndpoint =
    (url.includes('track.utmify.com') || url.includes('tracking.utmify.com.br') || url.includes('api.utmify.com')) &&
    (url.includes('/lead') || url.includes('/events'));

  if (!isUtmifyTrackingEndpoint) return; // Let everything else pass through untouched

  // Only intercept POST requests with unwanted event types
  if (event.request.method === 'POST') {
    event.respondWith(
      event.request.clone().text().then((body) => {
        const blockedEvents = ['"ViewContent"', '"Lead"', '"AddToCart"', '"PageView"'];
        const shouldBlock = blockedEvents.some((ev) => body.includes(ev));

        if (shouldBlock) {
          console.debug('[SW] Blocked UTMify event:', body.substring(0, 60));
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        // Allow legitimate events (InitiateCheckout, Purchase) through
        return fetch(event.request);
      }).catch(() => fetch(event.request))
    );
    return;
  }

  // Let OPTIONS (CORS preflight) pass through to avoid breaking CORS
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
