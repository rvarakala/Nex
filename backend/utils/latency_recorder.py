"""In-process API latency recorder.

Every HTTP request through the ASGI stack pushes {ts, path, method, status,
duration_ms} into a bounded ring buffer. The founder dashboard queries this
via /api/admin/v2/system/latency to render a live speedometer + p50/p95/p99
tiles and a slowest-routes leaderboard.

Trade-offs:
- Per-worker (each uvicorn worker keeps its own buffer). For the single-worker
  prod pod today this is fine; when we scale to --workers 4 the numbers will
  become a per-worker sample rather than a global aggregate, which is still
  useful for spotting hot spots. A future upgrade could aggregate via Redis.
- Bounded to 5000 samples (~memory: 5000 * ~200 bytes = ~1 MB) so we never
  leak memory under sustained traffic.
- Buckets are computed on-demand at query time rather than continuously,
  keeping the hot request-path overhead to a single `time.perf_counter` call
  and one deque append.
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


# ---------------- Ring buffer ----------------
_MAX_SAMPLES = 5000
_samples: deque = deque(maxlen=_MAX_SAMPLES)
_lock = Lock()
_APP_START_TS = time.time()


def record_sample(path: str, method: str, status: int, duration_ms: float) -> None:
    """Append a request-timing sample to the ring buffer (thread-safe)."""
    now = time.time()
    with _lock:
        _samples.append(
            {
                "ts": now,
                "path": path,
                "method": method,
                "status": status,
                "duration_ms": duration_ms,
            }
        )


def _snapshot(window_seconds: Optional[float] = None) -> list[dict]:
    """Return a copy of samples inside `window_seconds` (or all if None)."""
    with _lock:
        buf = list(_samples)
    if window_seconds is None:
        return buf
    cutoff = time.time() - window_seconds
    return [s for s in buf if s["ts"] >= cutoff]


def _percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 2)
    # Nearest-rank method — simple, well-defined for small samples.
    k = max(0, min(len(sorted_vals) - 1, int(round(pct / 100.0 * (len(sorted_vals) - 1)))))
    return round(sorted_vals[k], 2)


def stats_for_window(window_seconds: float) -> dict:
    """Compute {count, rps, p50, p95, p99, max, avg} for the given window."""
    samples = _snapshot(window_seconds)
    n = len(samples)
    if n == 0:
        return {"count": 0, "rps": 0, "p50": 0, "p95": 0, "p99": 0, "max": 0, "avg": 0}
    durations = sorted(s["duration_ms"] for s in samples)
    return {
        "count": n,
        "rps": round(n / window_seconds, 2),
        "p50": _percentile(durations, 50),
        "p95": _percentile(durations, 95),
        "p99": _percentile(durations, 99),
        "max": round(durations[-1], 2),
        "avg": round(sum(durations) / n, 2),
    }


def slowest_routes(window_seconds: float, limit: int = 10) -> list[dict]:
    """Aggregate per-endpoint: {path, method, count, avg_ms, max_ms} — sorted by avg desc."""
    samples = _snapshot(window_seconds)
    if not samples:
        return []
    agg: dict[tuple[str, str], list[float]] = {}
    for s in samples:
        key = (s["method"], s["path"])
        agg.setdefault(key, []).append(s["duration_ms"])
    rows = []
    for (method, path), durs in agg.items():
        rows.append(
            {
                "method": method,
                "path": path,
                "count": len(durs),
                "avg_ms": round(sum(durs) / len(durs), 2),
                "max_ms": round(max(durs), 2),
                "p95_ms": _percentile(sorted(durs), 95),
            }
        )
    rows.sort(key=lambda r: r["avg_ms"], reverse=True)
    return rows[:limit]


def status_distribution(window_seconds: float) -> dict:
    """Return {2xx, 3xx, 4xx, 5xx} counts inside the window."""
    samples = _snapshot(window_seconds)
    buckets = {"2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0}
    for s in samples:
        code = int(s["status"])
        if 200 <= code < 300:
            buckets["2xx"] += 1
        elif 300 <= code < 400:
            buckets["3xx"] += 1
        elif 400 <= code < 500:
            buckets["4xx"] += 1
        elif code >= 500:
            buckets["5xx"] += 1
    return buckets


def health_level(p95_ms: float) -> str:
    """Map p95 latency to a human-readable health level for the speedometer."""
    if p95_ms == 0:
        return "idle"
    if p95_ms < 200:
        return "healthy"
    if p95_ms < 500:
        return "warning"
    return "critical"


def _normalise_path(raw: str) -> str:
    """Collapse the path so long UUID/id fragments don't fragment the aggregate.

    Example: `/api/patients/pat_abc123` → `/api/patients/:id`.
    """
    parts = []
    for seg in raw.split("/"):
        if not seg:
            parts.append(seg)
            continue
        # Any segment > 12 chars OR containing a hyphen/underscore + digit is
        # treated as an id — collapse it.
        if len(seg) > 12 or (any(c.isdigit() for c in seg) and any(c in "-_" for c in seg)):
            parts.append(":id")
        else:
            parts.append(seg)
    return "/".join(parts) or "/"


class LatencyRecorderMiddleware(BaseHTTPMiddleware):
    """Records duration of every request that hits an /api/* path."""

    async def dispatch(self, request: Request, call_next):
        # Skip non-API paths (SPA static assets etc) to keep the buffer focused
        # on backend behaviour.
        raw_path = request.url.path
        if not raw_path.startswith("/api"):
            return await call_next(request)
        start = time.perf_counter()
        status = 500  # default in case of exception
        response: Response
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            duration_ms = (time.perf_counter() - start) * 1000.0
            record_sample(
                path=_normalise_path(raw_path),
                method=request.method,
                status=status,
                duration_ms=duration_ms,
            )
