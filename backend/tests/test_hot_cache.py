"""Hot-cache layer regression — Phase 15 perf.

Validates `utils.hot_cache.cached` behaves correctly under:
- cache miss → factory called, result cached
- cache hit  → factory NOT called
- stampede   → concurrent misses for same key only call factory once
- invalidate → drops matching keys
- disabled mode → factory called every time

Run: `cd /app/backend && pytest tests/test_hot_cache.py -x -q`
"""
import asyncio
from unittest import mock

import pytest

from utils import hot_cache


@pytest.fixture(autouse=True)
def _reset_cache():
    """Each test starts with a clean cache."""
    hot_cache._backend._cache.clear()
    hot_cache._locks.clear()
    yield
    hot_cache._backend._cache.clear()
    hot_cache._locks.clear()


def _run(coro):
    """Run an async coroutine in a fresh event loop, restoring the
    previous loop so we don't pollute global state for downstream tests
    (e.g. test_razorpay_webhook.py uses `asyncio.get_event_loop()` in its
    fixtures, which breaks if we close/replace the loop)."""
    try:
        prev = asyncio.get_event_loop()
    except RuntimeError:
        prev = None
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        if prev is not None and not prev.is_closed():
            asyncio.set_event_loop(prev)


def test_cache_miss_calls_factory_once():
    async def _go():
        call_count = 0

        async def _factory():
            nonlocal call_count
            call_count += 1
            return {"value": 42}

        r1 = await hot_cache.cached("test:k1", _factory, ttl_seconds=30)
        r2 = await hot_cache.cached("test:k1", _factory, ttl_seconds=30)
        return r1, r2, call_count

    r1, r2, count = _run(_go())
    assert r1 == {"value": 42}
    assert r2 == {"value": 42}
    assert count == 1


def test_different_keys_have_independent_caches():
    async def _go():
        calls = {"a": 0, "b": 0}

        async def _factory_a():
            calls["a"] += 1
            return "A"

        async def _factory_b():
            calls["b"] += 1
            return "B"

        a1 = await hot_cache.cached("test:a", _factory_a)
        b1 = await hot_cache.cached("test:b", _factory_b)
        a2 = await hot_cache.cached("test:a", _factory_a)
        return a1, b1, a2, calls

    a1, b1, a2, calls = _run(_go())
    assert a1 == "A"
    assert b1 == "B"
    assert a2 == "A"
    assert calls == {"a": 1, "b": 1}


def test_stampede_protection():
    """10 concurrent requests for the same uncached key should only
    invoke the factory ONCE."""
    async def _go():
        call_count = 0

        async def _slow_factory():
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.05)
            return {"hit": call_count}

        results = await asyncio.gather(*[
            hot_cache.cached("test:stampede", _slow_factory) for _ in range(10)
        ])
        return results, call_count

    results, count = _run(_go())
    assert all(r == {"hit": 1} for r in results), "all 10 must see the same value"
    assert count == 1, "stampede protection must prevent thundering herd"


def test_invalidate_drops_matching_keys():
    async def _go():
        async def _f(v):
            return v

        await hot_cache.cached("dashboard:k1", lambda: _f("d1"))
        await hot_cache.cached("dashboard:k2", lambda: _f("d2"))
        await hot_cache.cached("tenants:k1", lambda: _f("t1"))

        n = hot_cache.invalidate("dashboard:")

        call_count = 0
        async def _new():
            nonlocal call_count
            call_count += 1
            return "fresh"

        await hot_cache.cached("dashboard:k1", _new)
        await hot_cache.cached("tenants:k1", _new)
        return n, call_count

    n_dropped, fresh_calls = _run(_go())
    assert n_dropped == 2
    assert fresh_calls == 1, "only dashboard:k1 should re-fetch; tenants:k1 hits cache"


def test_disabled_mode_always_calls_factory():
    """Setting `AUDINEXA_CACHE_DISABLED=1` should bypass cache entirely."""
    async def _go():
        with mock.patch.object(hot_cache, "_DISABLED", True):
            call_count = 0

            async def _factory():
                nonlocal call_count
                call_count += 1
                return call_count

            r1 = await hot_cache.cached("test:disabled", _factory)
            r2 = await hot_cache.cached("test:disabled", _factory)
            return r1, r2, call_count

    r1, r2, count = _run(_go())
    assert r1 == 1
    assert r2 == 2
    assert count == 2


def test_stats_reports_size_and_config():
    info = hot_cache.stats()
    assert "size" in info
    assert "max_size" in info
    assert "ttl_seconds" in info
    assert info["ttl_seconds"] >= 1
