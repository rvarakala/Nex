/**
 * clinicVault.js — BYOK Phase 1 client-side crypto.
 *
 * This module IS the security boundary. The server never sees:
 *   - the master passphrase
 *   - the derived MasterKey (PBKDF2 output)
 *   - the plaintext DEK (Data Encryption Key)
 *   - the plaintext data records
 *
 * It only ever sees:
 *   - public KDF parameters (salt, iters, algo) — fine, these aren't secret
 *   - encrypted_dek (DEK wrapped with MasterKey)
 *   - SHA-256(MasterKey) verifier  — usable only to confirm a passphrase, not
 *     to derive the master key (one-way hash)
 *   - encrypted record blobs
 *
 * Algo string: "pbkdf2-sha256-aesgcm-v1"
 *   - PBKDF2-SHA-256, 600_000 iterations, 256-bit output
 *   - AES-GCM 256-bit, fresh 12-byte IV per ciphertext
 */

/* ----------------------------- base64 helpers ----------------------------- */

export function b64enc(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64dec(str) {
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function hex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ----------------------------- core primitives ---------------------------- */

const KDF_ITERATIONS_DEFAULT = 600_000;

async function deriveMasterKey(passphrase, saltBytes, iterations = KDF_ITERATIONS_DEFAULT) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey'],
  );
  // Derive a 256-bit AES-GCM key (used to wrap/unwrap the DEK)
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
  // Also derive raw bytes once (for the verifier hash). Re-deriving is cheap
  // since we already paid the iteration cost for the AES key, but doing it
  // separately keeps the wrapping key extractable=true while the verifier
  // remains a one-way hash.
  const rawBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    256,
  );
  const verifierHash = await crypto.subtle.digest('SHA-256', rawBits);
  return { wrappingKey, verifierHex: hex(new Uint8Array(verifierHash)) };
}

async function generateDEK() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function wrapDEK(dek, wrappingKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawDek = await crypto.subtle.exportKey('raw', dek);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawDek);
  return { encryptedDekB64: b64enc(new Uint8Array(cipher)), ivB64: b64enc(iv) };
}

async function unwrapDEK(encryptedDekB64, ivB64, wrappingKey) {
  const cipher = b64dec(encryptedDekB64);
  const iv = b64dec(ivB64);
  const rawDek = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, cipher);
  return crypto.subtle.importKey(
    'raw', rawDek, { name: 'AES-GCM', length: 256 },
    true, ['encrypt', 'decrypt'],
  );
}

/* -------------------------- public encrypt/decrypt ------------------------ */

export async function encryptValue(plain, dek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, dek, enc.encode(JSON.stringify(plain)),
  );
  return { encrypted_payload: b64enc(new Uint8Array(cipher)), iv: b64enc(iv) };
}

export async function decryptValue({ encrypted_payload, iv }, dek) {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64dec(iv) }, dek, b64dec(encrypted_payload),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    return { _decrypt_error: true, message: e?.message || 'decrypt failed' };
  }
}

/* ----------------------------- vault setup -------------------------------- */

const RECOVERY_CODE_COUNT = 12;

function newRecoveryCode() {
  // 24-char base32-ish code: 6 groups of 4 chars, easy to read aloud
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // omit confusables
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 24)}`;
}

async function deriveCodeKey(code, saltBytes) {
  // Recovery codes are high-entropy (24 chars from 30-char alphabet ≈ 117 bits)
  // so 100k PBKDF2 iters are sufficient.
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(code), { name: 'PBKDF2' }, false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt'],
  );
}

/**
 * setupVault — runs once per clinic. Returns the request payload to POST to
 * `/api/vault/setup` AND the plaintext recovery codes to display to the owner.
 * After this function returns, the wrappingKey and DEK live in memory only.
 */
export async function buildVaultSetupPayload(passphrase, iterations = KDF_ITERATIONS_DEFAULT) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const { wrappingKey, verifierHex } = await deriveMasterKey(passphrase, saltBytes, iterations);
  const dek = await generateDEK();
  const { encryptedDekB64, ivB64 } = await wrapDEK(dek, wrappingKey);

  // Generate 12 recovery codes — each wraps the DEK independently
  const recoveryCodes = [];
  const recoverySlots = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = newRecoveryCode();
    const codeSalt = crypto.getRandomValues(new Uint8Array(16));
    const codeKey = await deriveCodeKey(code, codeSalt);
    const { encryptedDekB64: codeWrappedDek, ivB64: codeIv } = await wrapDEK(dek, codeKey);
    const codeHash = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(code),
    );
    recoveryCodes.push(code);
    recoverySlots.push({
      code_hash: hex(new Uint8Array(codeHash)),
      kdf_salt: b64enc(codeSalt),
      encrypted_dek: codeWrappedDek,
      dek_iv: codeIv,
    });
  }

  return {
    request: {
      kdf_salt: b64enc(saltBytes),
      kdf_iterations: iterations,
      kdf_algo: 'pbkdf2-sha256-aesgcm-v1',
      verifier: verifierHex,
      encrypted_dek: encryptedDekB64,
      dek_iv: ivB64,
      recovery_slots: recoverySlots,
    },
    dek,                  // hold in memory after setup
    recoveryCodes,        // SHOW to user once, then forget
  };
}

/* ----------------------------- vault unlock ------------------------------- */

/**
 * unlockVault — given server-supplied params + a passphrase, derive MasterKey,
 * verify it, and return the unwrapped DEK. Throws on wrong passphrase.
 */
export async function unlockVaultWithPassphrase(passphrase, params) {
  const saltBytes = b64dec(params.kdf_salt);
  const { wrappingKey, verifierHex } = await deriveMasterKey(
    passphrase, saltBytes, params.kdf_iterations,
  );
  if (verifierHex !== params.verifier) {
    const err = new Error('Wrong passphrase');
    err.code = 'WRONG_PASSPHRASE';
    throw err;
  }
  const dek = await unwrapDEK(params.encrypted_dek, params.dek_iv, wrappingKey);
  return { dek, verifierHex };
}

/* ----------------------------- recovery flow ------------------------------ */

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return hex(new Uint8Array(buf));
}

/**
 * Identifies which recovery slot matches the typed code, derives the code's
 * key, and unwraps the DEK. Returns { dek, slot } if found, throws otherwise.
 *
 * Codes are normalised (uppercased, whitespace stripped) before hashing so
 * a user typing 'aaaa-bbbb-...' with extra spaces still matches.
 */
export async function unwrapDEKWithRecoveryCode(rawCode, slots) {
  const code = (rawCode || '').replace(/\s+/g, '').toUpperCase();
  if (!code) {
    const err = new Error('Empty recovery code');
    err.code = 'EMPTY_CODE';
    throw err;
  }
  const codeHash = await sha256Hex(code);
  const slot = (slots || []).find((s) => s.code_hash === codeHash);
  if (!slot) {
    const err = new Error('Recovery code not recognised');
    err.code = 'CODE_NOT_FOUND';
    throw err;
  }
  const codeKey = await deriveCodeKey(code, b64dec(slot.kdf_salt));
  const dek = await unwrapDEK(slot.encrypted_dek, slot.dek_iv, codeKey);
  return { dek, slot, codeHash };
}

/**
 * Wraps an EXISTING (already-unwrapped) DEK with a new master key derived
 * from a new passphrase. Used right after a successful recovery to atomically
 * rotate the master + invalidate the consumed code on the server.
 */
export async function buildMasterRotationPayload(newPassphrase, dek, iterations = KDF_ITERATIONS_DEFAULT) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const { wrappingKey, verifierHex } = await deriveMasterKey(
    newPassphrase, saltBytes, iterations,
  );
  const { encryptedDekB64, ivB64 } = await wrapDEK(dek, wrappingKey);
  return {
    new_kdf_salt: b64enc(saltBytes),
    new_kdf_iterations: iterations,
    new_kdf_algo: 'pbkdf2-sha256-aesgcm-v1',
    new_verifier: verifierHex,
    new_encrypted_dek: encryptedDekB64,
    new_dek_iv: ivB64,
  };
}

export const VAULT_KDF_ITERATIONS_DEFAULT = KDF_ITERATIONS_DEFAULT;
