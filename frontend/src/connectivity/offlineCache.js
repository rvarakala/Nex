/**
 * offlineCache.js — IndexedDB-backed read-through cache for whitelisted GETs.
 *
 * Tier 2 of our offline strategy: keep the app *useful* during network outages
 * by serving recently-fetched data (appointments, patients, service catalogue)
 * from local storage. Writes are NOT cached — they still need a connection
 * (the axios retry interceptor handles flaky writes).
 *
 * Tenant safety:
 *   The IndexedDB database name embeds the clinic_id from the JWT, so two
 *   clinic logins on the same device cannot ever cross-read each other's data.
 *   On logout we just call `clearOfflineCache()` to wipe everything.
 *
 * Cache key:
 *   `${method}:${path}?${sortedQuery}` — strips the host so preview URL changes
 *   don't invalidate yesterday's cache.
 *
 * TTL:
 *   24h. Stale entries are served only when we're offline; if the network is
 *   reachable we always go to origin.
 */

const DB_VERSION = 1;
const STORE = 'gets';
const TTL_MS = 24 * 60 * 60 * 1000;

// ---- Tenant scoping --------------------------------------------------------
// Decode the clinic_id (and user_id) from the bearer JWT so each tenant gets
// its own IDB database. Returns 'anonymous' for unauthenticated states.
function getTenantKey() {
  try {
    const t = localStorage.getItem('acs.token');
    if (!t) return 'anonymous';
    const [, payload] = t.split('.');
    if (!payload) return 'anonymous';
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const cid = json.clinic_id || 'unknown';
    const uid = json.user_id || json.sub || 'user';
    // Hash-ish fingerprint — short, stable, won't collide for our scale
    return `${cid}__${uid}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  } catch {
    return 'anonymous';
  }
}

function dbName() {
  return `audinexa-cache-${getTenantKey()}`;
}

// ---- IndexedDB plumbing ----------------------------------------------------
let _dbPromise = null;
let _dbOwner = null;

function openDb() {
  const owner = getTenantKey();
  if (_dbPromise && _dbOwner === owner) return _dbPromise;
  _dbOwner = owner;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore — cache failures must never break the app */
  }
}

// ---- Allowlist of cacheable GETs ------------------------------------------
// Add a path here only if a) it's stable per-day and b) showing slightly stale
// data offline is genuinely better than a blank page.
const CACHEABLE_PATHS = [
  /^\/api\/appointments(\/|\?|$)/,        // calendar — today + week
  /^\/api\/patients(\/|\?|$)/,            // list, search, individual
  /^\/api\/billing\/services(\/|\?|$)/,   // service catalogue
  /^\/api\/branches(\/|\?|$)/,            // clinic branches
  /^\/api\/settings\/clinic(\/|\?|$)/,    // clinic profile
  /^\/api\/auth\/me(\/|\?|$)/,            // current user
];

function isCacheable(config) {
  if ((config.method || 'get').toLowerCase() !== 'get') return false;
  if (config.noCache) return false;
  // Strip the origin so we match against just `/api/...`
  let path;
  try {
    path = new URL(config.url, window.location.origin).pathname + new URL(config.url, window.location.origin).search;
  } catch {
    path = config.url;
  }
  return CACHEABLE_PATHS.some((re) => re.test(path));
}

function buildKey(config) {
  try {
    const u = new URL(config.url, window.location.origin);
    // Sort query params for a stable key regardless of order
    const params = config.params
      ? Object.entries(config.params).sort().map(([k, v]) => `${k}=${v}`).join('&')
      : u.search.slice(1);
    return `GET:${u.pathname}?${params}`;
  } catch {
    return `GET:${config.url}`;
  }
}

// ---- Public surface --------------------------------------------------------
let _onCacheServed = null;

/**
 * Subscribe to "served from cache" events so the UI can show a freshness pill.
 * Called with `{ key, cachedAt }` each time we serve a stale response.
 */
export function onCacheServed(cb) {
  _onCacheServed = cb;
  return () => { _onCacheServed = null; };
}

export async function clearOfflineCache() {
  try {
    indexedDB.deleteDatabase(dbName());
    _dbPromise = null;
    _dbOwner = null;
  } catch {
    /* ignore */
  }
}

let _installed = false;

/**
 * Wires axios so:
 *   - Successful cacheable GETs persist their response to IDB.
 *   - Failed cacheable GETs (network error / 5xx) fall back to the cached body.
 *
 * Idempotent — safe to call multiple times.
 */
export function installOfflineCache(axios) {
  if (_installed) return;
  _installed = true;

  // Persist successful responses
  axios.interceptors.response.use(
    async (response) => {
      const config = response.config;
      if (config && isCacheable(config) && response.status >= 200 && response.status < 300) {
        const key = buildKey(config);
        await idbPut(key, {
          data: response.data,
          status: response.status,
          headers: response.headers,
          cachedAt: Date.now(),
        });
      }
      return response;
    },
    async (error) => {
      const config = error.config;
      if (!config || !isCacheable(config)) return Promise.reject(error);
      // Only fall back on network errors / 5xx — 4xx are intentional
      const isNetwork = !error.response;
      const is5xx = error.response && error.response.status >= 500;
      if (!isNetwork && !is5xx) return Promise.reject(error);

      const key = buildKey(config);
      const hit = await idbGet(key);
      if (!hit) return Promise.reject(error);
      // Honour TTL — stale-but-still-useful is fine offline; expired isn't
      if (Date.now() - hit.cachedAt > TTL_MS) return Promise.reject(error);

      if (_onCacheServed) _onCacheServed({ key, cachedAt: hit.cachedAt });

      // Return a synthetic axios response. Mark with `_fromCache: true` so
      // callers that care can render a "showing cached" indicator.
      return Promise.resolve({
        data: hit.data,
        status: hit.status || 200,
        statusText: 'OK (cached)',
        headers: hit.headers || {},
        config,
        request: null,
        _fromCache: true,
        _cachedAt: hit.cachedAt,
      });
    },
  );
}
