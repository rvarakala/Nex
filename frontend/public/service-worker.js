/* eslint-disable no-restricted-globals */
/**
 * AUDINEXA Service Worker — App Shell cache (Tier 3a, ~50 lines).
 *
 * Strategy: stale-while-revalidate for same-origin assets so the app can
 * cold-boot offline. API calls are NEVER intercepted here — axios + the
 * IndexedDB layer (offlineCache.js) handle data caching with proper TTL
 * and tenant-scoping.
 *
 * Cache versioning: bump CACHE_VERSION on every deploy so stale bundles
 * (different filenames anyway thanks to webpack hashes) get evicted.
 */
const CACHE_VERSION = 'audinexa-shell-v1';

self.addEventListener('install', (event) => {
  // Activate immediately on first install — no need to wait for old tabs to close
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.add('/')));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Hands off API + auth + websocket — handled by axios layer or backend
  if (url.pathname.startsWith('/api/')) return;
  // Cross-origin (Google Fonts, Emergent assets, etc.) — let the network handle
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate for the app shell + bundled JS/CSS/images
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then((resp) => {
      // Only cache successful, non-opaque responses
      if (resp && resp.status === 200 && resp.type === 'basic') {
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    }).catch(() => null);

    // For the navigation request (HTML), prefer cached so cold-boot works offline
    if (req.mode === 'navigate') {
      return cached || (await networkPromise) || cache.match('/');
    }
    // For static assets, network-first, fall back to cache
    return (await networkPromise) || cached || new Response('', { status: 504 });
  })());
});
