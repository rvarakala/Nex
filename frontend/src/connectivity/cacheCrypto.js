/**
 * cacheCrypto.js — AES-GCM encryption for the IDB offline cache.
 * Why: medical data on disk is a privacy risk if a laptop is stolen.
 *
 * Key lifecycle:
 *   - Derived per-session via PBKDF2 from the JWT signature + a salt held
 *     in sessionStorage. Both die on logout/tab-close so disk ciphertext
 *     becomes unreadable. Fresh logins regenerate the salt → old cache is
 *     unreadable (cache layer treats it as a miss; auto-replenished).
 *   - AES-GCM 256-bit, fresh 12-byte IV per record (best practice).
 */

const SALT_KEY = 'audinexa.cache.salt';

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(str) {
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function getOrCreateSalt() {
  let salt = sessionStorage.getItem(SALT_KEY);
  if (!salt) {
    const raw = crypto.getRandomValues(new Uint8Array(16));
    salt = b64encode(raw);
    sessionStorage.setItem(SALT_KEY, salt);
  }
  return b64decode(salt);
}

function getJwtSecret() {
  const t = localStorage.getItem('acs.token');
  if (!t) return null;
  const parts = t.split('.');
  return parts[2] || parts[0] || null;
}

let _keyPromise = null;
let _keyOwner = null;

async function deriveKey() {
  const sig = getJwtSecret();
  if (!sig) return null;
  if (_keyPromise && _keyOwner === sig) return _keyPromise;
  _keyOwner = sig;
  _keyPromise = (async () => {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(sig), { name: 'PBKDF2' }, false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: getOrCreateSalt(), iterations: 100_000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt'],
    );
  })();
  return _keyPromise;
}

export const isCryptoAvailable = () =>
  typeof crypto !== 'undefined' && !!crypto.subtle;

export async function encryptValue(value) {
  if (!isCryptoAvailable()) return { _plain: value };
  const key = await deriveKey();
  if (!key) return { _plain: value };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)),
  );
  return { _enc: 'aes-gcm-v1', iv: b64encode(iv), cipher: b64encode(new Uint8Array(cipher)) };
}

export async function decryptValue(envelope) {
  if (!envelope || typeof envelope !== 'object') return envelope;
  if ('_plain' in envelope) return envelope._plain;
  if (envelope._enc !== 'aes-gcm-v1') return null;
  if (!isCryptoAvailable()) return null;
  const key = await deriveKey();
  if (!key) return null;
  try {
    const iv = b64decode(envelope.iv);
    const cipher = b64decode(envelope.cipher);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    // Wrong key / tampered ciphertext — caller treats as cache miss
    return null;
  }
}

export function clearCacheCrypto() {
  sessionStorage.removeItem(SALT_KEY);
  _keyPromise = null;
  _keyOwner = null;
}
