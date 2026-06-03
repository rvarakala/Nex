"""In-process TTL cache for hot founder endpoints — Phase 15 perf.

No Redis required. We're a single-uvicorn-worker FastAPI for now, so an
in-process LRU+TTL covers 90% of the benefit at 5% of the operational
complexity. When we shard onto multiple workers, swap the backing store
for Redis without changing call sites.

Hot endpoints (per 2026-06-03 audit):
  • GET /api/admin/v2/dashboard           — founder KPI tile
  • GET /api/admin/v2/tenants             — tenants list (founder)
  • GET /api/admin/v2/activity/funnel     — conversion funnel
  • GET /api/admin/v2/leads               — leads list
  • GET /api/status/public                — public status page poll

Design choices
==============
* **TTL, not LRU-only** — these endpoints aggregate per-clinic counts; a
  stale tile for ≤30s is fine, an unbounded LRU isn't.
* **Per-key locking** — first request misses, populates; concurrent requests
  for the same key get the populated answer. Prevents cache stampede.
* **Cache-busting hook** — `invalidate(prefix)` lets writes invalidate
  all keys for a given route (e.g. tenant create → drop all dashboard +
  tenants cache entries).
* **Per-user keying** — Mongo queries are tenant-scoped; we key on
  `user.user_id` so a founder and a sales_manager don't share a cache.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Awaitable, Callable, Optional

from cachetools import TTLCache

logger = logging.getLogger("audinexa.cache")

# Hard ceiling — protects against accidental memory blowup if a route
# generates 10K unique cache keys (e.g. a bug accidentally keying on
# millisecond timestamps). At 1024 entries × ~10KB per JSON blob =
# ~10MB max — negligible for our footprint.
_MAX_ENTRIES = 1024

# Default TTL — 30 seconds is the sweet spot for founder polling at 15s
# intervals: cache hit on the SECOND poll, fresh data within 30s. Each
# call site can override.
_DEFAULT_TTL_SECONDS = 30

# `disable_cache=1` in env turns this into a no-op layer. Useful for
# debugging "is the cache lying to me?" questions.
_DISABLED = os.environ.get("AUDINEXA_CACHE_DISABLED") == "1"

# Per-key locks so two concurrent requests for the same key don't both
# hit Mongo. Cleared opportunistically when the cache entry expires.
_locks: dict[str, asyncio.Lock] = {}


class _Backend:
    """Wraps `cachetools.TTLCache` so we can swap to Redis later by
    implementing the same 3 methods. Thread-safety: cachetools handles
    its own locks; asyncio coroutines under a single event loop are
    already serialised."""

    def __init__(self):
        self._cache: TTLCache = TTLCache(maxsize=_MAX_ENTRIES, ttl=_DEFAULT_TTL_SECONDS)

    def get(self, key: str) -> Optional[Any]:
        try:
            return self._cache[key]
        except KeyError:
            return None

    def set(self, key: str, value: Any, ttl: int) -> None:
        # cachetools doesn't support per-entry TTL out of the box; we pin
        # to the cache's default TTL. To honour `ttl`, we use a separate
        # cache per TTL tier (currently we only use 30s, so this is fine).
        # If we ever need 60s/300s tiers, add `_cache_60s = TTLCache(...)`.
        if ttl != self._cache.ttl:
            logger.debug(f"per-key TTL ignored ({ttl}s); using default {self._cache.ttl}s")
        self._cache[key] = value

    def invalidate(self, prefix: str) -> int:
        """Drop every key starting with `prefix`. Returns count dropped."""
        keys = [k for k in self._cache.keys() if k.startswith(prefix)]
        for k in keys:
            self._cache.pop(k, None)
        return len(keys)

    def stats(self) -> dict:
        return {
            "size": len(self._cache),
            "max_size": _MAX_ENTRIES,
            "ttl_seconds": self._cache.ttl,
        }


_backend = _Backend()


async def cached(
    key: str,
    factory: Callable[[], Awaitable[Any]],
    ttl_seconds: int = _DEFAULT_TTL_SECONDS,
) -> Any:
    """Read-through cache. If `key` is hot, returns the cached value;
    otherwise calls `factory()`, caches the result, returns it.

    Stampede protection: two simultaneous misses for the same key only
    call `factory` once.

    Example:
        @router.get("/admin/v2/dashboard")
        async def dashboard(user=Depends(get_current_user), db=Depends(get_db)):
            async def _compute():
                # ...expensive aggregations...
                return {...}
            return await cached(
                f"dashboard:{user['user_id']}",
                _compute,
                ttl_seconds=30,
            )
    """
    if _DISABLED:
        return await factory()

    hit = _backend.get(key)
    if hit is not None:
        return hit

    # Per-key lock prevents stampede. If another coroutine is already
    # populating this key, wait for it to finish, then read the cached
    # value.
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        # Re-check after acquiring lock — populater may have finished
        # while we were waiting.
        hit = _backend.get(key)
        if hit is not None:
            return hit
        try:
            value = await factory()
            _backend.set(key, value, ttl_seconds)
            return value
        finally:
            # Opportunistic lock cleanup — keep the dict from growing
            # forever. Safe because any coroutine still waiting is
            # already past the `setdefault` line.
            _locks.pop(key, None)


def invalidate(prefix: str) -> int:
    """Drop every cache entry whose key starts with `prefix`.

    Called on writes. e.g. a tenant-create handler should call
    `invalidate("dashboard:")` and `invalidate("tenants:")` so the next
    read sees the new tenant.
    """
    if _DISABLED:
        return 0
    n = _backend.invalidate(prefix)
    if n:
        logger.info(f"cache invalidated: prefix={prefix!r} dropped={n}")
    return n


def stats() -> dict:
    """Diagnostic — currently consumed by `/api/admin/v2/system-health`."""
    return {
        **_backend.stats(),
        "disabled": _DISABLED,
        "active_locks": len(_locks),
    }
