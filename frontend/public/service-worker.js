/* eslint-disable no-restricted-globals */
/**
 * AUDINEXA Service Worker — App Shell cache (Tier 3a).
 *
 * Strategy:
 *   • Navigation (HTML)    → NETWORK-first, cache as offline fallback.
 *     This is the only correct strategy for an app that deploys frequently:
 *     each deploy ships a new bundle hash, so the cached HTML's <script src>
 *     would otherwise point at a 404'd file → blank PWA window.
 *   • Static assets        → stale-while-revalidate. Webpack hashes guarantee
 *     content correctness, so caching aggressively is safe and fast.
 *   • API calls            → never intercepted; axios + IndexedDB own that.
 *
 * Cache versioning: bump CACHE_VERSION on any cache-strategy change so
 * existing installed PWAs evict their old shell on next launch.
 */
const CACHE_VERSION = 'audinexa-shell-v2';

self.addEventListener('install', (event) => {
  // Activate immediately so the new strategy takes effect on the next nav.
  // We deliberately do NOT pre-cache `/` here — if a deploy is mid-flight
  // and `/` references not-yet-uploaded bundles, pre-caching would freeze
  // a broken shell. Cache happens lazily on the first successful nav.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_VERSION));
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
  if (url.pathname.startsWith('/api/')) return;            // axios layer
  if (url.origin !== self.location.origin) return;          // cross-origin

  // ───────── Navigation (HTML) — network-first ─────────
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200 && fresh.type === 'basic') {
          const cache = await caches.open(CACHE_VERSION);
          // Always cache as `/` — every nav lands on the SPA shell anyway.
          cache.put('/', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('/'))
          || new Response('Offline — please reconnect to load AUDINEXA.', {
            status: 503, headers: { 'Content-Type': 'text/plain' },
          });
      }
    })());
    return;
  }

  // ───────── Static assets — stale-while-revalidate ─────────
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then((resp) => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    }).catch(() => null);
    return cached || (await networkPromise) || new Response('', { status: 504 });
  })());
});

// Allow page → SW upgrade trigger (used by future "App update available" toast).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
