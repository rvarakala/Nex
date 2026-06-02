"""HttpOnly cookie auth helpers — P1 XSS hardening.

Sets / clears the `access_token` cookie (httpOnly, Secure, SameSite=Lax) and
a paired `audinexa_csrf` cookie (NOT httpOnly so JS can read it for the
double-submit CSRF token).

Frontend sets `withCredentials: true` on axios + sends the `audinexa_csrf`
value as the `X-CSRF-Token` header on every request. The CSRF middleware
in `server.py` enforces `header == cookie` for any state-changing request
authenticated via cookie. Bearer-header-authenticated requests (pytest,
curl, API clients) are exempt.
"""
from __future__ import annotations

import os
import secrets
from typing import Optional

from fastapi import Response

# 7 days — same as JWT_ACCESS_TTL_SECONDS in auth.py.
COOKIE_MAX_AGE = 7 * 24 * 60 * 60

ACCESS_COOKIE = "access_token"
CSRF_COOKIE = "audinexa_csrf"


def _cookie_domain() -> Optional[str]:
    """Optional cookie domain. Default empty = exact-host-only (apex domain),
    which is the safest setting and matches the deployed `audinexa.com`
    architecture (no API subdomain split today).

    Set `AUTH_COOKIE_DOMAIN=.example.com` if you ever introduce a separate
    API subdomain — that's the only case requiring a wildcard domain.
    """
    val = os.environ.get("AUTH_COOKIE_DOMAIN", "").strip()
    return val or None


def _is_production() -> bool:
    """Secure cookie flag. We default to True (HTTPS-only) — preview pods
    serve over HTTPS too. Set `AUTH_COOKIE_INSECURE=1` only for explicit
    local dev over plain HTTP."""
    return os.environ.get("AUTH_COOKIE_INSECURE") != "1"


def set_auth_cookies(response: Response, token: str) -> str:
    """Set both auth cookies on a successful login / switch-clinic /
    mfa-verify-login response. Returns the newly-minted CSRF token (so
    the response body can also include it, for clients that want it
    without relying on cookie parsing — e.g. future native mobile apps).
    """
    secure = _is_production()
    domain = _cookie_domain()
    csrf = secrets.token_urlsafe(32)

    response.set_cookie(
        key=ACCESS_COOKIE,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,         # ← the whole point: JS cannot read this
        secure=secure,
        samesite="lax",        # blocks the easy CSRF cases; double-submit covers the rest
        path="/",
        domain=domain,
    )
    response.set_cookie(
        key=CSRF_COOKIE,
        value=csrf,
        max_age=COOKIE_MAX_AGE,
        httponly=False,        # ← JS reads this and sends X-CSRF-Token
        secure=secure,
        samesite="lax",
        path="/",
        domain=domain,
    )
    return csrf


def clear_auth_cookies(response: Response) -> None:
    """Clear both cookies on logout. We pass the same domain we set them
    with — otherwise the delete-cookie won't match and the browser keeps
    the cookie until it expires."""
    domain = _cookie_domain()
    response.delete_cookie(ACCESS_COOKIE, path="/", domain=domain)
    response.delete_cookie(CSRF_COOKIE, path="/", domain=domain)
