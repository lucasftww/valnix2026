// Service Worker para notificações push + UTMify event filtering

self.addEventListener('install', (event) => {
  console.log('Service Worker instalado');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker ativado');
  event.waitUntil(clients.claim());
});

// Block unwanted UTMify events (Lead, ViewContent, AddToCart, PageView)
// Supports both single-event and batch-event payloads
// IMPORTANT: Only intercepts specific UTMify tracking endpoints, never other requests
const BLOCKED_EVENTS = ['ViewContent', 'Lead', 'AddToCart', 'PageView'];

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
        // Try to parse as JSON for intelligent filtering
        try {
          const parsed = JSON.parse(body);

          // Case 1: Array of events (batch) — filter individually
          if (Array.isArray(parsed)) {
            const allowed = parsed.filter((ev) => {
              const eventType = ev.type || ev.event || ev.eventName;
              return !BLOCKED_EVENTS.includes(eventType);
            });

            if (allowed.length === 0) {
              console.debug('[SW] Blocked entire batch:', parsed.length, 'events');
              return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              });
            }

            if (allowed.length < parsed.length) {
              console.debug('[SW] Filtered batch:', parsed.length - allowed.length, 'blocked,', allowed.length, 'allowed');
              // Clone original request preserving credentials, mode, referrer, etc. — only replace body
              const newReq = new Request(event.request, {
                body: JSON.stringify(allowed),
              });
              return fetch(newReq);
            }

            // All events allowed — pass through
            return fetch(event.request);
          }

          // Case 2: Single event object
          const eventType = parsed.type || parsed.event || parsed.eventName;
          if (eventType && BLOCKED_EVENTS.includes(eventType)) {
            console.debug('[SW] Blocked UTMify event:', eventType);
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
          }

          // Allowed event — pass through
          return fetch(event.request);
        } catch (e) {
          // JSON parse failed — fallback to contextual string matching (more specific than plain includes)
          const shouldBlock = BLOCKED_EVENTS.some((ev) =>
            body.includes('"type":"' + ev + '"') ||
            body.includes('"type": "' + ev + '"') ||
            body.includes('"event":"' + ev + '"') ||
            body.includes('"event": "' + ev + '"') ||
            body.includes('"eventName":"' + ev + '"') ||
            body.includes('"eventName": "' + ev + '"')
          );
          if (shouldBlock) {
            console.debug('[SW] Blocked UTMify event (string match):', body.substring(0, 80));
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
          }
          return fetch(event.request);
        }
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
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});
