/**
 * VaultContext — holds the unwrapped DEK in window memory only.
 *
 * Lifetime rules:
 *   - Created on app mount, starts in `locked` state.
 *   - Once unlocked, DEK lives in JS memory only (no localStorage, no IDB,
 *     no sessionStorage). It's wiped on:
 *       * logout
 *       * tab close (memory dies anyway)
 *       * idle timeout (we listen to the existing IdleLogout signal)
 *       * manual `lock()` call from the UI
 *   - Encrypt/decrypt helpers are exposed via `useVault()` and refuse to
 *     operate until DEK is loaded.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { encryptValue, decryptValue, unlockVaultWithPassphrase, buildVaultSetupPayload, unwrapDEKWithRecoveryCode, buildMasterRotationPayload } from './clinicVault';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND}/api/vault`;

const VaultContext = createContext(null);

export const VaultProvider = ({ children, isAuthed }) => {
  const [status, setStatus] = useState({ loading: true, enabled: false, locked: true });
  const dekRef = useRef(null);

  /* ------------------------ status sync with server ------------------------ */
  const refreshStatus = useCallback(async () => {
    if (!isAuthed) {
      setStatus({ loading: false, enabled: false, locked: true });
      dekRef.current = null;
      return;
    }
    try {
      const r = await axios.get(`${API}/status`);
      setStatus({
        loading: false,
        enabled: !!r.data.enabled,
        locked: !dekRef.current,
        setupAt: r.data.setup_at,
        kdfIterations: r.data.kdf_iterations,
        recoverySlotsRemaining: r.data.recovery_slots_remaining,
      });
    } catch {
      setStatus({ loading: false, enabled: false, locked: true });
    }
  }, [isAuthed]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  /* ------------------------ vault setup ------------------------------------ */
  const setupVault = useCallback(async (passphrase) => {
    const { request, dek, recoveryCodes } = await buildVaultSetupPayload(passphrase);
    await axios.post(`${API}/setup`, request);
    dekRef.current = dek;
    await refreshStatus();
    setStatus((s) => ({ ...s, locked: false }));
    return { recoveryCodes };
  }, [refreshStatus]);

  /* ------------------------ vault unlock ----------------------------------- */
  const unlockVault = useCallback(async (passphrase) => {
    const params = (await axios.get(`${API}/unlock-params`)).data;
    const { dek, verifierHex } = await unlockVaultWithPassphrase(passphrase, params);
    // Telemetry only — server does NOT learn the master key
    await axios.post(`${API}/unlock-verify`, { verifier: verifierHex });
    dekRef.current = dek;
    setStatus((s) => ({ ...s, locked: false }));
  }, []);

  /* ------------------------ recovery code redemption ----------------------- *
   * 2-step API:
   *   1) loadRecoverySlots() — fetches public slot params from server
   *   2) redeemRecoveryCode(code, newPassphrase) — derives DEK locally with
   *      the code, builds a fresh master payload from the new passphrase,
   *      sends rotation request to server. On success, vault is unlocked
   *      with the freshly-derived DEK in memory.
   */
  const loadRecoverySlots = useCallback(async () => {
    const r = await axios.get(`${API}/recovery-slots`);
    return r.data || [];
  }, []);

  const redeemRecoveryCode = useCallback(async (code, newPassphrase) => {
    if (!newPassphrase || newPassphrase.length < 12) {
      const err = new Error('New passphrase must be at least 12 characters');
      err.code = 'WEAK_PASSPHRASE';
      throw err;
    }
    const slots = await loadRecoverySlots();
    if (slots.length === 0) {
      const err = new Error('No recovery codes remain — contact support');
      err.code = 'NO_SLOTS';
      throw err;
    }
    const { dek, codeHash } = await unwrapDEKWithRecoveryCode(code, slots);
    const rotation = await buildMasterRotationPayload(newPassphrase, dek);
    await axios.post(`${API}/recovery-redeem`, { code_hash: codeHash, ...rotation });
    dekRef.current = dek;
    await refreshStatus();
    setStatus((s) => ({ ...s, locked: false }));
  }, [loadRecoverySlots, refreshStatus]);

  /* ------------------------ lock / wipe ------------------------------------ */
  const lock = useCallback(() => {
    dekRef.current = null;
    setStatus((s) => ({ ...s, locked: true }));
  }, []);

  // Wipe DEK on logout-style events from rest of app
  useEffect(() => {
    const onWipe = () => lock();
    window.addEventListener('audinexa:wipe-vault', onWipe);
    window.addEventListener('audinexa:idle-logout', onWipe);
    return () => {
      window.removeEventListener('audinexa:wipe-vault', onWipe);
      window.removeEventListener('audinexa:idle-logout', onWipe);
    };
  }, [lock]);

  /* ------------------------ encrypt/decrypt helpers ------------------------ */
  const encrypt = useCallback(async (value) => {
    if (!dekRef.current) throw new Error('Vault is locked');
    return encryptValue(value, dekRef.current);
  }, []);

  const decrypt = useCallback(async (envelope) => {
    if (!dekRef.current) throw new Error('Vault is locked');
    return decryptValue(envelope, dekRef.current);
  }, []);

  const value = useMemo(() => ({
    ...status,
    setupVault,
    unlockVault,
    redeemRecoveryCode,
    lock,
    refreshStatus,
    encrypt,
    decrypt,
    hasDEK: !!dekRef.current,
  }), [status, setupVault, unlockVault, redeemRecoveryCode, lock, refreshStatus, encrypt, decrypt]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
};

export const useVault = () => {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside <VaultProvider>');
  return ctx;
};
