"""Tiny in-memory per-key sliding-window rate limiter.

Keeps a deque of recent request timestamps per (endpoint, identity) tuple and
evicts entries older than `window_seconds` on each check. No external deps.

Single-worker-process assumptions: the backend runs under supervisor with one
Uvicorn worker, so a process-local dict is sufficient. If we ever scale to
multiple workers we can swap this for Redis with a drop-in interface.

Usage in a FastAPI route:
    from utils.rate_limit import enforce_rate_limit
    enforce_rate_limit(request, "queue_public", max_requests=60, window_seconds=60)
    # Raises 429 HTTPException if the caller exceeded the window.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request


# key → deque[timestamp_seconds]
_BUCKETS: dict[str, deque] = defaultdict(deque)
_LOCK = Lock()


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Respects X-Forwarded-For (ingress sets it)."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # First entry is the original client; the rest is the proxy chain.
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def enforce_rate_limit(request: Request, name: str, max_requests: int, window_seconds: int) -> None:
    """Raise 429 if the caller's IP has exceeded `max_requests` in the last
    `window_seconds` on the endpoint identified by `name`.

    Fail-open on internal errors — rate-limit bugs should never block paying users.
    """
    try:
        ip = _client_ip(request)
        key = f"{name}:{ip}"
        now = time.monotonic()
        cutoff = now - window_seconds
        with _LOCK:
            dq = _BUCKETS[key]
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= max_requests:
                retry = max(1, int(dq[0] + window_seconds - now))
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many requests. Try again in {retry}s.",
                    headers={"Retry-After": str(retry)},
                )
            dq.append(now)
    except HTTPException:
        raise
    except Exception:
        # Fail-open: never take down a working route over a rate-limit bug.
        return


def reset() -> None:
    """Test-only: flush all buckets."""
    with _LOCK:
        _BUCKETS.clear()
