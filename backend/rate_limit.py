"""Shared slowapi limiter singleton.

Imported by server.py + any router that needs per-endpoint rate limits.
Keeps a single Limiter instance so all decorators share the same memory store
(in-memory by default; swap to Redis if multi-process).

`_proxy_aware_key()` reads X-Forwarded-For so production traffic behind a
reverse proxy (Emergent ingress, Cloudflare, k8s) is rate-limited per real
client IP, not per proxy IP.
"""
from slowapi import Limiter
from starlette.requests import Request


def _proxy_aware_key(request: Request) -> str:
    """Returns the leftmost IP in X-Forwarded-For (real client) when present;
    falls back to the direct socket peer otherwise."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "anonymous"


# Single instance — server.py registers it on app.state.limiter
limiter: Limiter = Limiter(key_func=_proxy_aware_key, default_limits=["300/minute"])
