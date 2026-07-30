"""HttpOnly cookie auth helpers — P1 XSS hardening.

Sets / clears the `access_token` cookie (httpOnly, Secure, SameSite=Lax) and
a paired `audinexa_csrf` cookie (NOT httpOnly so JS can read it for the
double-submit CSRF token).

Frontend sets `withCredentials: true` on axios + sends the `audinexa_csrf`
value as the `X-CSRF-Token` header on every request. The CSRF middleware
in `server.py` enforces `header == cookie` for any state-changing request
authenticated via cookie. Bearer-header-authenticated requests (pytest,
curl, API clients) are exempt.

Domain resolution (production incident 2026-06-02 #3)
-----------------------------------------------------
A founder reported "not authenticated" on every founder-admin page on
production at `www.audinexa.com`. Root cause: the user landed on
`www.audinexa.com`, the API silently 308-redirects POSTs to apex
`audinexa.com`, and the login response set the auth cookies WITHOUT a
`Domain` attribute. Per RFC 6265 §5.3, a no-Domain cookie is **host-only**
— it's bound to the exact responding host (`audinexa.com`), not `www`.
The browser at `www.audinexa.com/dashboard` then never sent the cookie
on follow-up API calls, so every admin endpoint returned 401.

The fix: when the request host matches the `audinexa.com` family,
**auto-set `Domain=.audinexa.com`** so cookies are shared between apex +
www + any future subdomain (api, staging, etc.). Preview pods and
localhost still get host-only cookies (each preview has a unique host —
a wildcard makes no sense there).

Operators can override the auto-detection via `AUTH_COOKIE_DOMAIN` env var.
"""
from __future__ import annotations

import os
import secrets
from typing import Optional

from fastapi import Request, Response

# 7 days — same as JWT_ACCESS_TTL_SECONDS in auth.py.
COOKIE_MAX_AGE = 7 * 24 * 60 * 60
# 30 days — long-lived when the user ticks "Remember this device".
COOKIE_MAX_AGE_REMEMBERED = 30 * 24 * 60 * 60
# 8 hours — ephemeral sessions (unchecked box). Bounds the abuse window
# for cap-skipping sessions and forces frequent re-auth on shared machines.
COOKIE_MAX_AGE_EPHEMERAL = 8 * 60 * 60

ACCESS_COOKIE = "access_token"
CSRF_COOKIE = "audinexa_csrf"

PROD_APEX = "audinexa.com"
PROD_COOKIE_DOMAIN = ".audinexa.com"  # leading dot = also matches subdomains


def _resolve_cookie_domain(request: Optional[Request]) -> Optional[str]:
    """Decide the cookie `Domain` attribute for this response.

    Priority:
      1. `AUTH_COOKIE_DOMAIN` env var (operator-controlled override).
      2. Auto-detect: if the request host is part of the audinexa.com
         family, return `.audinexa.com` so apex + www share the same
         cookie jar.
      3. Otherwise return `None` (host-only — correct for preview pods +
         localhost, each of which has its own unique hostname).
    """
    env = os.environ.get("AUTH_COOKIE_DOMAIN", "").strip()
    if env:
        return env
    host = _request_host(request)
    if host == PROD_APEX or host.endswith("." + PROD_APEX):
        return PROD_COOKIE_DOMAIN
    return None


def _request_host(request: Optional[Request]) -> str:
    """Best-effort extraction of the responding hostname. Falls back to
    the empty string when the request object isn't available (callers
    that pass `request=None` for some reason)."""
    if request is None:
        return ""
    # Prefer the explicit Host header (covers proxy / load-balancer cases).
    host = (request.headers.get("host") or "").lower().strip()
    if not host:
        try:
            host = (request.url.hostname or "").lower().strip()
        except Exception:
            host = ""
    # Strip any :port suffix
    return host.split(":")[0]


def _is_production() -> bool:
    """Secure cookie flag. We default to True (HTTPS-only) — preview pods
    serve over HTTPS too. Set `AUTH_COOKIE_INSECURE=1` only for explicit
    local dev over plain HTTP."""
    return os.environ.get("AUTH_COOKIE_INSECURE") != "1"


def set_auth_cookies(
    response: Response,
    token: str,
    request: Optional[Request] = None,
    *,
    remember_device: bool = True,
) -> str:
    """Set both auth cookies on a successful login / switch-clinic /
    mfa-verify-login response. Returns the newly-minted CSRF token (so
    the response body can also include it, for clients that want it
    without relying on cookie parsing — e.g. future native mobile apps).

    Pass the FastAPI `Request` so we can auto-scope the cookie Domain
    correctly for the audinexa.com family (apex + www).

    `remember_device` picks the cookie TTL:
      * True  → 30 days (persist across browser restarts, real device).
      * False → 8 hours (ephemeral, matches the incognito-test-drive
                intent behind the login checkbox).
    """
    secure = _is_production()
    domain = _resolve_cookie_domain(request)
    csrf = secrets.token_urlsafe(32)
    max_age = COOKIE_MAX_AGE_REMEMBERED if remember_device else COOKIE_MAX_AGE_EPHEMERAL

    # Belt-and-braces migration from the legacy host-only cookies.
    # When we're setting a `.audinexa.com`-scoped cookie, ALSO emit a
    # `Max-Age=0` Set-Cookie for the previous host-only variant so the
    # browser drops it on the same response. Otherwise the host-only
    # cookie keeps shadowing the new one whenever the request host
    # matches the apex exactly (browsers pick the more-specific cookie).
    # This single line means our cookie-scope hotfix self-migrates every
    # live user the moment they hit `/auth/login` on the new code — no
    # manual sign-out required.
    if domain == PROD_COOKIE_DOMAIN:
        response.delete_cookie(ACCESS_COOKIE, path="/", domain=None)
        response.delete_cookie(CSRF_COOKIE, path="/", domain=None)

    response.set_cookie(
        key=ACCESS_COOKIE,
        value=token,
        max_age=max_age,
        httponly=True,         # ← the whole point: JS cannot read this
        secure=secure,
        samesite="lax",        # blocks easy CSRF cases; double-submit covers the rest
        path="/",
        domain=domain,
    )
    response.set_cookie(
        key=CSRF_COOKIE,
        value=csrf,
        max_age=max_age,
        httponly=False,        # ← JS reads this and sends X-CSRF-Token
        secure=secure,
        samesite="lax",
        path="/",
        domain=domain,
    )
    return csrf


def clear_auth_cookies(
    response: Response,
    request: Optional[Request] = None,
) -> None:
    """Clear both cookies on logout. We pass the same domain we set them
    with — otherwise the delete-cookie won't match and the browser keeps
    the cookie until it expires."""
    domain = _resolve_cookie_domain(request)
    response.delete_cookie(ACCESS_COOKIE, path="/", domain=domain)
    response.delete_cookie(CSRF_COOKIE, path="/", domain=domain)
    # Belt-and-braces: legacy sessions established before the auto-domain
    # fix shipped have host-only cookies on `audinexa.com`. If we're
    # logging out on the apex (or a subdomain), also try to delete the
    # host-only variant so old browsers cleanly cross-over to the new
    # `.audinexa.com` cookie on next login.
    if domain == PROD_COOKIE_DOMAIN:
        response.delete_cookie(ACCESS_COOKIE, path="/", domain=None)
        response.delete_cookie(CSRF_COOKIE, path="/", domain=None)
