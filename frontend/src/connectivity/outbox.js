/**
 * outbox.js — durable write queue for offline-first writes.
 *
 * When a POST/PUT/PATCH/DELETE has exhausted its retries (network still down
 * or server still 5xx), we stash the request here so it can be replayed when
 * connectivity returns. The queue is tenant-scoped (DB name embeds the JWT's
 * clinic_id+user_id) so two clinic logins on a shared terminal can never
 * cross-replay each other's writes.
 *
 * Item shape:
 *   {
 *     id:           string  – uuid
 *     method:       'POST' | 'PUT' | 'PATCH' | 'DELETE'
 *     url:          string  – absolute URL the original request went to
 *     data:         any     – serialised request body
 *     headers:      object  – auth + content-type captured at queue time
 *     description:  string  – human-readable summary for the dashboard
 *     status:       'pending' | 'failed'
 *     attempts:     number  – replay attempts so far
 *     lastError:    string?
 *     createdAt:    number  – ms epoch
 *     updatedAt:    number  – ms epoch
 *   }
 */
const DB_VERSION = 1;
const STORE = 'outbox';

function getTenantKey() {
  try {
    const t = localStorage.getItem('acs.token');
    if (!t) return 'anonymous';
    const [, payload] = t.split('.');
    if (!payload) return 'anonymous';
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const cid = json.clinic_id || 'unknown';
    const uid = json.user_id || json.sub || 'user';
    return `${cid}__${uid}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  } catch {
    return 'anonymous';
  }
}

const dbName = () => `audinexa-outbox-${getTenantKey()}`;

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
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

const uuid = () => (
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `out-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

// ---- Public API -----------------------------------------------------------
export async function addToOutbox(item) {
  const db = await openDb();
  const now = Date.now();
  const record = {
    id: uuid(),
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...item,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  notifyChange();
  return record;
}

export async function listOutbox() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.createdAt - b.createdAt));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function updateOutbox(id, patch) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const existing = req.result;
      if (!existing) { resolve(); return; }
      store.put({ ...existing, ...patch, updatedAt: Date.now() });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  notifyChange();
}

export async function removeOutbox(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  notifyChange();
}

export async function clearOutbox() {
  try {
    indexedDB.deleteDatabase(dbName());
    _dbPromise = null;
    _dbOwner = null;
    notifyChange();
  } catch { /* ignore */ }
}

// ---- Pub/sub for the UI ---------------------------------------------------
const _listeners = new Set();
export function subscribeOutbox(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
function notifyChange() {
  for (const cb of _listeners) {
    try { cb(); } catch { /* ignore listener errors */ }
  }
}
