/**
 * Same-origin URL rewriter — production safety net.
 *
 * Defends against the failure mode where `REACT_APP_BACKEND_URL` is baked
 * into the production bundle pointing at the WRONG host (e.g. preview backend
 * instead of audinexa.com). When the frontend at audinexa.com calls a
 * different host, cookies don't attach → every page shows "Not authenticated"
 * even though the backend is healthy.
 *
 * Wired in `AuthContext.js`:
 *   • Every axios outgoing request runs through this helper.
 *   • The global `window.fetch` is patched to do the same for raw fetch calls.
 *
 * Strict scope:
 *   • Only rewrites if the URL is HTTP(S) AND cross-origin AND a `/api/*` path.
 *   • Relative URLs, same-origin URLs, and third-party calls (Razorpay,
 *     fonts, analytics) are returned untouched.
 */

export function rewriteToSameOriginIfNeeded(url) {
  if (typeof window === 'undefined' || !url) return url;
  // Skip relative URLs — they're already same-origin.
  if (!/^https?:\/\//i.test(url)) return url;
  let parsed;
  try { parsed = new URL(url); } catch { return url; }
  const pageHost = window.location.host;
  if (parsed.host === pageHost) return url;          // already same-origin
  // Only rewrite our own API calls (anything starting with `/api/...`). Leave
  // third-party calls (Razorpay, fonts, analytics) untouched.
  if (!parsed.pathname.startsWith('/api/') && parsed.pathname !== '/api') return url;
  parsed.protocol = window.location.protocol;
  parsed.host = pageHost;
  return parsed.toString();
}
