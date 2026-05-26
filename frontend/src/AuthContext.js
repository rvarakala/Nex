import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { clearOfflineCache } from './connectivity/offlineCache';
import { clearOutbox } from './connectivity/outbox';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const TOKEN_KEY = 'acs.token';

// Attach Bearer token to every axios request
axios.interceptors.request.use((config) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) config.headers = { ...(config.headers || {}), Authorization: `Bearer ${t}` };
  return config;
});

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);       // authenticated user object
  const [clinic, setClinic] = useState(null);
  const [loading, setLoading] = useState(true); // initial session check

  const checkSession = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setLoading(false); return; }
    try {
      const r = await axios.get(`${API}/auth/me`);
      setUser(r.data.user);
      setClinic(r.data.clinic);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      setClinic(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  const login = async (email, password) => {
    const r = await axios.post(`${API}/auth/login`, { email, password });
    // Two-step MFA flow: server returns a short-lived challenge instead of
    // the access token. Caller (LoginPage) detects `mfa_token` and prompts
    // the user for the 6-digit code, then calls `loginVerifyMfa()`.
    if (r.data?.requires_mfa) {
      return { requiresMfa: true, mfaToken: r.data.mfa_token };
    }
    localStorage.setItem(TOKEN_KEY, r.data.access_token);
    setUser(r.data.user);
    setClinic(r.data.clinic);
    return r.data.user;
  };

  const loginVerifyMfa = async (mfaToken, code, useRecoveryCode = false) => {
    const r = await axios.post(`${API}/auth/mfa/verify-login`, {
      mfa_token: mfaToken, code, use_recovery_code: useRecoveryCode,
    });
    localStorage.setItem(TOKEN_KEY, r.data.access_token);
    setUser(r.data.user);
    setClinic(r.data.clinic);
    return r.data.user;
  };

  // Seeds an externally-issued JWT (e.g., from /public/clinic-signup) and
  // hydrates the user/clinic from /auth/me so downstream components see a
  // fully-authenticated session.
  const loginWithToken = async (token) => {
    localStorage.setItem(TOKEN_KEY, token);
    try {
      const r = await axios.get(`${API}/auth/me`);
      setUser(r.data.user);
      setClinic(r.data.clinic);
      return r.data.user;
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      setClinic(null);
      throw e;
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('acs.activeTest');  // Prevent ghost-context leak between users on shared terminal
    // Wipe the offline read-cache so the next user can't see this user's data
    // (cached patient lists, appointments, etc.) on a shared terminal.
    clearOfflineCache();
    // Wipe any pending writes — they belong to this user's session, not the next user's
    clearOutbox();
    // Wipe the in-memory clinic vault DEK (BYOK Phase 1)
    try { window.dispatchEvent(new Event('audinexa:wipe-vault')); } catch { /* noop */ }
    setUser(null);
    setClinic(null);
  };

  // Multi-clinic switcher — requests a new JWT bound to a sibling clinic
  // this user has been granted access to. On success, replace the stored
  // token + hydrate user/clinic from the fresh /auth/me so every downstream
  // query is scoped to the new tenant.
  const switchClinic = async (clinic_id) => {
    const r = await axios.post(`${API}/auth/switch-clinic`, { clinic_id });
    localStorage.setItem(TOKEN_KEY, r.data.access_token);
    // Clear any tenant-scoped caches the user had on the old clinic.
    localStorage.removeItem('acs.activeTest');
    // Wipe the IDB read-cache too — a fresh JWT means a fresh tenant scope,
    // and yesterday's patient list from the old clinic must not leak through.
    clearOfflineCache();
    // Same for the outbox — pending writes were authored against the old
    // clinic_id; replaying them under a new scope would corrupt data.
    clearOutbox();
    const me = await axios.get(`${API}/auth/me`);
    setUser(me.data.user);
    setClinic(me.data.clinic);
    return me.data;
  };

  const hasRole = (...roles) => {
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'founder') return true;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, clinic, loading, login, loginVerifyMfa, loginWithToken, logout, switchClinic, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
