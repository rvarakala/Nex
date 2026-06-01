"""Shared slowapi limiter singleton.

Imported by server.py + any router that needs per-endpoint rate limits.
Keeps a single Limiter instance so all decorators share the same memory store
(in-memory by default; swap to Redis if multi-process).

Key strategy (in order):
  1. **Authenticated requests**  → `clinic:<clinic_id>` from the JWT.
     This means a runaway loop in one clinic's UI throttles *that* clinic,
     not every clinic sharing the same egress IP (common in shared office
     buildings, college hospitals, etc.).
  2. **Public requests with token** that failed to decode → IP.
  3. **Unauthenticated**          → real client IP (XFF-aware).

The `clinic:` prefix means the bucket namespaces are disjoint from IP
buckets, so a clinic with 50 staff under the same office IP can still
each get the full quota.

`_proxy_aware_key()` is kept as a fallback / direct import for the very few
places that explicitly want IP-only behaviour (e.g. login brute-force on
unauthenticated requests).
"""
import jwt
from slowapi import Limiter
from starlette.requests import Request

# Local import to dodge the circular auth → rate_limit chain
def _jwt_secret_lazy() -> str:
    from auth import _jwt_secret  # noqa: PLC0415
    return _jwt_secret()


def _proxy_aware_key(request: Request) -> str:
    """Returns the leftmost IP in X-Forwarded-For (real client) when present;
    falls back to the direct socket peer otherwise."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "anonymous"


def _tenant_aware_key(request: Request) -> str:
    """Prefer clinic_id (from the JWT) as the rate-limit bucket key.

    Why: a single clinic with many users behind one office NAT shouldn't
    eat the global per-IP budget. And if one clinic's misbehaving UI loops,
    we want to throttle *that clinic*, not their innocent neighbours.

    Falls back to the IP-based key for unauthenticated requests and any
    token we can't decode.
    """
    auth = request.headers.get("authorization") or ""
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        try:
            payload = jwt.decode(
                token, _jwt_secret_lazy(), algorithms=["HS256"],
                options={"verify_exp": False},
            )
            cid = payload.get("clinic_id")
            if cid:
                return f"clinic:{cid}"
        except jwt.PyJWTError:
            pass
    return _proxy_aware_key(request)


# Single instance — server.py registers it on app.state.limiter
limiter: Limiter = Limiter(key_func=_tenant_aware_key, default_limits=["600/minute"])
