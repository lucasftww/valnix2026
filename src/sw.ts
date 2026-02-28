/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import {
  StaleWhileRevalidate,
  CacheFirst,
  NetworkFirst,
  NetworkOnly,
} from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// Take control immediately on activation
self.skipWaiting();
clientsClaim();

// Precache static assets (injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Shared plugins ──
const cacheableOk = new CacheableResponsePlugin({ statuses: [0, 200] });

// ── 1. UTMify — strip query from cache key so all ?utm_*= variants share 1 entry ──
registerRoute(
  ({ url }) =>
    url.hostname === 'cdn.utmify.com.br' &&
    url.pathname === '/scripts/utms/latest.js',
  new StaleWhileRevalidate({
    cacheName: 'vendor-utmify-v1',
    plugins: [
      {
        cacheKeyWillBeUsed: async ({ request }) => {
          const url = new URL(request.url);
          url.search = ''; // strip all query params
          return new Request(url.toString(), request);
        },
      },
      new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 }),
      cacheableOk,
    ],
  })
);

// ── 2. Google Fonts stylesheet ──
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      cacheableOk,
    ],
  })
);

// ── 3. Google Fonts gstatic ──
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      cacheableOk,
    ],
  })
);

// ── 4. R2 CDN product images (LCP critical) ──
registerRoute(
  ({ url }) => url.hostname.includes('r2.dev'),
  new CacheFirst({
    cacheName: 'r2-images-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      cacheableOk,
    ],
  })
);

// ── 5. Supabase images ──
registerRoute(
  ({ url }) =>
    /\.supabase\.co$/.test(url.hostname) &&
    /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'supabase-images-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 14 }),
      cacheableOk,
    ],
  })
);

// ── 6. Discord images ──
registerRoute(
  ({ url }) =>
    (url.hostname === 'media.discordapp.net' || url.hostname === 'cdn.discordapp.com') &&
    /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'discord-images-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 14 }),
      cacheableOk,
    ],
  })
);

// ── 7. Local images ──
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'local-images-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      cacheableOk,
    ],
  })
);

// ── 8. Supabase Edge Functions (site-data) — SWR for instant LCP on repeat visits ──
registerRoute(
  ({ url }) =>
    /\.supabase\.co$/.test(url.hostname) && url.pathname.includes('/functions/v1/site-data'),
  new StaleWhileRevalidate({
    cacheName: 'site-data-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 }),
      cacheableOk,
    ],
  })
);

// ── 9. Supabase REST API ──
registerRoute(
  ({ url }) =>
    /\.supabase\.co$/.test(url.hostname) && url.pathname.startsWith('/rest/v1/'),
  new StaleWhileRevalidate({
    cacheName: 'supabase-api-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 30 }),
      cacheableOk,
    ],
  })
);

// ── 8. Firestore REST — NetworkOnly ──
registerRoute(
  ({ url }) => url.hostname === 'firestore.googleapis.com',
  new NetworkOnly()
);

// ── 9. HTML pages — NetworkFirst ──
registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' && !url.pathname.startsWith('/~oauth/'),
  new NetworkFirst({
    cacheName: 'pages-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  })
);
