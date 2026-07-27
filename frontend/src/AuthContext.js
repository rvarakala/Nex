import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { clearOfflineCache } from './connectivity/offlineCache';
import { clearOutbox } from './connectivity/outbox';
import { getCsrfTokenFromCookie, hasCookieSession } from './auth/cookies';
import { rewriteToSameOriginIfNeeded } from './auth/sameOriginRewriter';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ── P1 XSS hardening (2026-06) ──────────────────────────────────────────
// Primary auth is now an httpOnly cookie. We:
//   1) ALWAYS send cookies (`withCredentials: true`)
//   2) Read the non-httpOnly `audinexa_csrf` cookie and send it as
//      `X-CSRF-Token` on every request (double-submit pattern; the
//      backend's CSRF middleware enforces equality for state-changing
//      cookie-authenticated requests).
//   3) Fall back to `localStorage.acs.token` as a **legacy bearer** while
//      live sessions migrate — but we no longer *write* to localStorage on
//      new logins. Old tokens stay valid until they expire, then the user
//      re-logs in via the cookie path.
//
// `acs.token` is removed at logout (existing behaviour preserved) and on
// any 401 response from /auth/me (handled in `checkSession`).
const LEGACY_TOKEN_KEY = 'acs.token';

axios.defaults.withCredentials = true;

// ----------------------------------------------------------------------------
// Same-origin auto-correction (production safety net) — implementation lives
// in `./auth/sameOriginRewriter.js` so it stays pure-JS + unit-testable
// without dragging axios + React imports into the test runtime.
//
// REACT_APP_BACKEND_URL is baked into the bundle at build time, so a misconfig
// in the deploy pipeline (e.g. shipping audinexa.com with the preview backend
// URL) causes EVERY API call to go cross-site. Cookies don't attach across
// hosts → user sees "Not authenticated" on every page even though backend is
// healthy. The interceptor + window.fetch patch below catch that failure mode
// at runtime and rewrite cross-origin `/api/*` URLs to the page origin so
// cookies always attach.
// ----------------------------------------------------------------------------

axios.interceptors.request.use((config) => {
  config.withCredentials = true;
  // Rewrite cross-origin API URLs to same-origin so cookies attach. See the
  // long comment block above for the failure mode this defends against.
  if (config.url) config.url = rewriteToSameOriginIfNeeded(config.url);
  if (config.baseURL) config.baseURL = rewriteToSameOriginIfNeeded(config.baseURL);
  const headers = { ...(config.headers || {}) };
  // Legacy bearer for users whose browser still has a localStorage token
  // from before this change shipped. Authorization beats cookies for
  // CSRF middleware exemption (server treats Bearer-auth as API client).
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy && !headers.Authorization) headers.Authorization = `Bearer ${legacy}`;
  // CSRF double-submit for cookie-authenticated state-changing requests.
  const csrf = getCsrfTokenFromCookie();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  config.headers = headers;
  return config;
});

// Also patch the global `fetch` so the 2 places that use raw fetch (the
// connectivity health-pinger + the public waitlist signup) benefit from the
// same same-origin correction. Limited to `/api/*` URLs — third-party calls
// (Razorpay, fonts, analytics) pass through untouched.
if (typeof window !== 'undefined' && window.fetch && !window.__audinexaFetchPatched) {
  const _origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      if (typeof input === 'string') {
        input = rewriteToSameOriginIfNeeded(input);
      } else if (input && typeof input === 'object' && 'url' in input) {
        // `Request` object — rebuild it with rewritten URL if needed.
        const rewritten = rewriteToSameOriginIfNeeded(input.url);
        if (rewritten !== input.url) input = new Request(rewritten, input);
      }
    } catch { /* fall through with the original input */ }
    return _origFetch(input, init);
  };
  window.__audinexaFetchPatched = true;
}

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);       // authenticated user object
  const [clinic, setClinic] = useState(null);
  const [loading, setLoading] = useState(true); // initial session check

  const checkSession = useCallback(async () => {
    // Either: cookie session exists, OR legacy localStorage token exists.
    // If neither, skip the /auth/me call — but STILL clear any stale
    // in-memory user/clinic state so peer tabs that just received an
    // `auth:changed` broadcast (from a logout in another tab) don't
    // keep rendering the previous user's dashboard.
    const hasLegacy = !!localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!hasCookieSession() && !hasLegacy) {
      setUser(null);
      setClinic(null);
      setLoading(false);
      return;
    }
    try {
      const r = await axios.get(`${API}/auth/me`);
      setUser(r.data.user);
      setClinic(r.data.clinic);
    } catch {
      // Session expired or invalid — wipe any legacy token and reset state.
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      setUser(null);
      setClinic(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  // Auto re-hydrate when the tab regains focus.
  //
  // Defends against the "same browser, different user" scenario:
  // if you sign in as user A in tab-1, then sign in as user B in tab-2,
  // tab-1's cookie was silently swapped to user B — but React state still
  // shows A. Any API call from tab-1 now returns B's data → sidebar and
  // profile drift apart (the exact incident from 2026-07-26).
  //
  // Refresh happens on:
  //   • `visibilitychange` — tab foregrounded
  //   • `focus` — window gains focus (covers window-switching)
  //   • `storage` event on our legacy-token key — another tab logged
  //      in/out with a bearer token
  //   • BroadcastChannel messages — other tabs post `auth:changed` on
  //      login / logout
  useEffect(() => {
    const revalidate = () => { checkSession(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') revalidate(); };
    const onStorage = (e) => { if (e.key === LEGACY_TOKEN_KEY) revalidate(); };
    window.addEventListener('focus', revalidate);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);

    let bc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('audinexa_auth');
        bc.onmessage = (ev) => { if (ev.data === 'auth:changed') revalidate(); };
      }
    } catch { /* ignore */ }

    return () => {
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
      if (bc) bc.close();
    };
  }, [checkSession]);

  // Post a cross-tab notification so peer tabs re-hydrate immediately
  // instead of waiting for their next window focus.
  const broadcastAuthChange = useCallback(() => {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('audinexa_auth');
        bc.postMessage('auth:changed');
        bc.close();
      }
    } catch { /* ignore */ }
  }, []);

  const login = async (email, password) => {
    let r;
    try {
      r = await axios.post(`${API}/auth/login`, { email, password });
    } catch (e) {
      // Email verification gate — hard-block via 403 EMAIL_NOT_VERIFIED.
      // We rethrow a special error the LoginPage recognises and uses to
      // redirect the user to /verify-email with the field prefilled.
      const d = e?.response?.data?.detail;
      if (e?.response?.status === 403 && d && typeof d === 'object' && d.code === 'EMAIL_NOT_VERIFIED') {
        const err = new Error(d.message || 'Please verify your email first.');
        err.emailNotVerified = true;
        err.email = d.email || email;
        throw err;
      }
      throw e;
    }
    // Two-step MFA flow: server returns a short-lived challenge instead of
    // the access token. Caller (LoginPage) detects `mfa_token` and prompts
    // the user for the 6-digit code, then calls `loginVerifyMfa()`.
    if (r.data?.requires_mfa) {
      return { requiresMfa: true, mfaToken: r.data.mfa_token };
    }
    // Server has set httpOnly auth cookies; we don't store the token
    // anywhere on the client. Drop any legacy localStorage token now that
    // we have a cookie session.
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    setUser(r.data.user);
    setClinic(r.data.clinic);
    // Enrich the in-memory user with fields only returned by /auth/me
    // (e.g. `mfa_enforcement` for the platform-admin grace banner).
    try {
      const me = await axios.get(`${API}/auth/me`);
      setUser(me.data.user);
      setClinic(me.data.clinic);
    } catch { /* keep the post-login user */ }
    broadcastAuthChange();
    return r.data.user;
  };

  const loginVerifyMfa = async (mfaToken, code, useRecoveryCode = false) => {
    const r = await axios.post(`${API}/auth/mfa/verify-login`, {
      mfa_token: mfaToken, code, use_recovery_code: useRecoveryCode,
    });
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    setUser(r.data.user);
    setClinic(r.data.clinic);
    try {
      const me = await axios.get(`${API}/auth/me`);
      setUser(me.data.user);
      setClinic(me.data.clinic);
    } catch { /* keep the post-login user */ }
    return r.data.user;
  };

  // Seeds an externally-issued JWT (e.g., from /public/clinic-signup) and
  // hydrates the user/clinic from /auth/me so downstream components see a
  // fully-authenticated session.
  //
  // Note: this is the one remaining path that *intentionally* writes to
  // localStorage — because the JWT arrives in a JSON response (not a
  // Set-Cookie header from the same domain), we have no cookie to rely
  // on. The legacy bearer fallback in the axios interceptor picks it up.
  // First /auth/me call will succeed; subsequent requests authenticate
  // via the same Authorization header (bypassing CSRF, which is fine for
  // a freshly-signed-up clinic owner).
  const loginWithToken = async (token) => {
    localStorage.setItem(LEGACY_TOKEN_KEY, token);
    try {
      const r = await axios.get(`${API}/auth/me`);
      setUser(r.data.user);
      setClinic(r.data.clinic);
      return r.data.user;
    } catch (e) {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      setUser(null);
      setClinic(null);
      throw e;
    }
  };

  const logout = async () => {
    // Tell the server to clear the cookies. Best-effort — even if this
    // call fails (offline, expired token), the local cleanup below still
    // happens so the next user on a shared terminal sees a clean state.
    try { await axios.post(`${API}/auth/logout`); } catch { /* offline / expired */ }
    localStorage.removeItem(LEGACY_TOKEN_KEY);
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
    broadcastAuthChange();
  };

  // Multi-clinic switcher — requests a new JWT bound to a sibling clinic
  // this user has been granted access to. On success, the server rotates
  // the cookies; we just refresh the in-memory user/clinic from /auth/me.
  const switchClinic = async (clinic_id) => {
    await axios.post(`${API}/auth/switch-clinic`, { clinic_id });
    // Server has rotated the cookie; we no longer need to write to
    // localStorage. Clear any tenant-scoped caches the user had on the
    // old clinic so yesterday's data can't leak through.
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem('acs.activeTest');
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
    <AuthContext.Provider value={{ user, clinic, loading, login, loginVerifyMfa, loginWithToken, logout, switchClinic, hasRole, refreshUser: checkSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
