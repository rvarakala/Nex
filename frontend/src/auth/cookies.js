/**
 * Helpers for cookie-based auth (P1 XSS hardening, 2026-06).
 *
 * Reads the `audinexa_csrf` cookie (the only one accessible to JS — the
 * `access_token` is httpOnly) and exposes a single function that axios's
 * request interceptor uses to add `X-CSRF-Token` to every request.
 */
export function getCsrfTokenFromCookie() {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|; )audinexa_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** True when an httpOnly access_token cookie is presumed present.
 * We can't read httpOnly cookies from JS — but we *can* see the
 * non-httpOnly companion `audinexa_csrf` which is set+cleared in lockstep.
 * That's good enough to know "cookie session exists". */
export function hasCookieSession() {
  return !!getCsrfTokenFromCookie();
}
