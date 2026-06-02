"""Self-hosted error telemetry.

Two write surfaces, one read surface.

Writes
------
1. **Backend exception middleware** (registered in `server.py`) — catches every
   uncaught 5xx, writes a structured doc to `error_logs` with the full
   traceback + user/clinic correlation.
2. **`POST /_telemetry/frontend-error`** — accepts crash reports from the
   React error boundary + global `window.onerror` / unhandled-rejection
   handlers.

Reads
-----
3. **`GET /admin/v2/errors`** (founder + super_admin only) — filterable list
   for the Founder Panel "Errors" page. No tenant-scoping: the founder sees
   crashes from every clinic so platform-wide regressions surface fast.

Why a Mongo-backed self-hosted store and not Sentry?
----------------------------------------------------
DPDPA compliance: keeping crash payloads on the same Mongo instance avoids
the data-processor agreement Sentry would require, since stack traces can
embed PII (patient IDs in URLs, request bodies). Trade-off: no source maps,
no session replay — that's Sentry's value-add and a future enhancement.
"""
from __future__ import annotations

import hashlib
import logging
import os
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from auth import get_current_user, require_roles
from database import get_db


_log = logging.getLogger("audinexa.error_telemetry")

router = APIRouter(prefix="/api/_telemetry", tags=["telemetry"])
admin_errors_router = APIRouter(prefix="/api/admin/v2", tags=["admin-errors"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class FrontendErrorIn(BaseModel):
    """Crash payload posted from the React error boundary / window handlers."""
    route: str = Field(..., description="window.location.pathname when crash happened")
    message: str
    stack: Optional[str] = None
    component_stack: Optional[str] = None
    # Free-form context the boundary chose to attach (e.g. last successful
    # axios URL, current module name).
    extra: dict = Field(default_factory=dict)
    # Browser fingerprint for grouping crashes by environment.
    user_agent: Optional[str] = None
    # Stable per-tab id assigned by the frontend bootstrap so we can group
    # consecutive errors from the same session.
    session_id: Optional[str] = None
    # Source category — `boundary`, `window.onerror`, `unhandledrejection`.
    source: str = "boundary"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_ERROR_LOG_TTL_DAYS = int(os.environ.get("ERROR_LOG_RETENTION_DAYS", "30"))
_MAX_BODY_SNIPPET = 4_000  # bytes


def _fingerprint(*parts: str) -> str:
    """Stable 12-char hash so the same exception groups across many entries."""
    blob = "|".join(p or "" for p in parts).encode("utf-8", errors="replace")
    return hashlib.sha1(blob).hexdigest()[:12]


def _safe(val: Any) -> Any:
    """Coerce any value into JSON-friendly form (drops Mongo ObjectId etc.)."""
    if val is None:
        return None
    if isinstance(val, (str, int, float, bool)):
        return val
    return str(val)


async def _write_error(db, doc: dict) -> None:
    """Insert with best-effort durability. Never raises (must not break the
    request path on top of an already-failing request)."""
    try:
        # Hard cap the size of stored fields so a 10MB stack trace doesn't
        # bloat Mongo. Cheap circuit breaker: clip every string field.
        for k, v in list(doc.items()):
            if isinstance(v, str) and len(v) > 8_000:
                doc[k] = v[:8_000] + "\n…[truncated]"
        await db.error_logs.insert_one(doc)
    except Exception as exc:  # noqa: BLE001
        _log.warning("error_logs insert failed: %s", exc)
        return

    # Spike alerter — best-effort. Runs after a successful insert so the
    # threshold count includes this very row. Errors swallowed inside.
    try:
        from utils.error_alerts import maybe_alert
        await maybe_alert(db, doc)
    except Exception as exc:  # noqa: BLE001
        _log.warning("alert dispatch failed: %s", exc)


# ---------------------------------------------------------------------------
# Backend exception middleware
# ---------------------------------------------------------------------------
class ErrorLoggerMiddleware(BaseHTTPMiddleware):
    """Catches uncaught 5xx exceptions on every API request and writes a
    structured `error_logs` doc with the user/clinic context.

    HTTPException 4xx are NOT logged (they're expected business validation).
    """

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
        start = datetime.now(timezone.utc)
        try:
            response = await call_next(request)
            return response
        except HTTPException:
            # Business validation — by convention not a crash. Re-raise.
            raise
        except Exception as exc:  # noqa: BLE001  — broad on purpose
            tb_text = traceback.format_exc()
            user_id = None
            clinic_id = None
            try:
                # Best-effort extract of who was acting, without re-running auth
                # (which itself could fail). The auth dep stashes the user dict
                # on `request.state.user` when it succeeds — but on uncaught
                # exceptions before auth runs, this is None.
                u = getattr(request.state, "user", None)
                if u:
                    user_id = u.get("user_id")
                    clinic_id = u.get("clinic_id")
            except Exception:  # noqa: BLE001
                pass

            doc = {
                "log_id": uuid.uuid4().hex,
                "kind": "backend",
                "fingerprint": _fingerprint(
                    type(exc).__name__,
                    str(request.url.path),
                    (tb_text or "").splitlines()[-1] if tb_text else "",
                ),
                "exception_type": type(exc).__name__,
                "message": _safe(exc)[:1000] if exc else "",
                "traceback": tb_text,
                "method": request.method,
                "path": request.url.path,
                "query_string": str(request.url.query)[:500],
                "user_id": user_id,
                "clinic_id": clinic_id,
                "request_id": request_id,
                "client_ip": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent", "")[:300],
                "started_at": start,
                "at": datetime.now(timezone.utc),
            }
            await _write_error(request.app.state.db, doc)

            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal server error",
                    "request_id": request_id,
                },
            )


# ---------------------------------------------------------------------------
# Frontend crash ingestion endpoint
# ---------------------------------------------------------------------------
@router.post("/frontend-error")
async def ingest_frontend_error(
    payload: FrontendErrorIn,
    request: Request,
    db=Depends(get_db),
):
    """Accepts crash reports from the React error boundary + global handlers.

    Auth is OPTIONAL — even an unauthenticated crash on the login page is
    interesting (it might be the auth flow itself that's broken). When the
    bearer token is present and valid we attach the user/clinic; otherwise
    `user_id`/`clinic_id` stay null and you can still see the crash with the
    `client_ip` correlation.
    """
    user_id, clinic_id = None, None
    if request.headers.get("authorization", "").startswith("Bearer "):
        try:
            user = await get_current_user(request=request)
            user_id = user.get("user_id")
            clinic_id = user.get("clinic_id")
        except Exception:  # noqa: BLE001  — anonymous crash is still useful
            pass

    # ── Server-side noise filter (defence in depth) ──────────────────
    # `crashReporter.js` already drops these, but older deployed frontends
    # or rogue clients can still send them. An `unhandledrejection` whose
    # message is "Request failed with status code 4xx" is a user-caused
    # HTTP error, not a crash — silently 200 it without writing the row.
    msg = (payload.message or "").lower()
    if payload.source == "unhandledrejection" and (
        "request failed with status code 4" in msg
        or msg.strip() in ("canceled", "aborted", "canceled error", "aborterror")
    ):
        return {"ok": True, "filtered": "noise"}

    doc = {
        "log_id": uuid.uuid4().hex,
        "kind": "frontend",
        "fingerprint": _fingerprint(payload.message, payload.stack or "", payload.route),
        "exception_type": payload.source,
        "message": payload.message[:1000],
        "traceback": payload.stack,
        "component_stack": payload.component_stack,
        "method": "FRONTEND",
        "path": payload.route,
        "query_string": "",
        "user_id": user_id,
        "clinic_id": clinic_id,
        "session_id": payload.session_id,
        "extra": payload.extra,
        "client_ip": request.client.host if request.client else None,
        "user_agent": payload.user_agent or request.headers.get("user-agent", ""),
        "at": datetime.now(timezone.utc),
    }
    await _write_error(db, doc)
    return {"ok": True, "log_id": doc["log_id"]}


# ---------------------------------------------------------------------------
# Founder/super-admin reader
# ---------------------------------------------------------------------------
@admin_errors_router.get("/errors")
async def list_errors(
    kind: Optional[str] = Query(None, description="`backend` or `frontend`"),
    clinic_id: Optional[str] = None,
    fingerprint: Optional[str] = None,
    since_minutes: int = Query(60 * 24, ge=1, le=60 * 24 * 30,
                               description="Look back N minutes (default 24h)"),
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_roles("founder", "super_admin")),
    db=Depends(get_db),
):
    """Founder Panel feed. Returns the most recent crashes (newest first)
    plus a fingerprint roll-up so the UI can show "this same error
    happened 47 times in the last hour"."""
    since = datetime.now(timezone.utc).timestamp() - since_minutes * 60
    q: dict = {"at": {"$gte": datetime.fromtimestamp(since, tz=timezone.utc)}}
    if kind:
        q["kind"] = kind
    if clinic_id:
        q["clinic_id"] = clinic_id
    if fingerprint:
        q["fingerprint"] = fingerprint

    rows = await (
        db.error_logs.find(q, {"_id": 0})
        .sort("at", -1)
        .limit(limit)
        .to_list(limit)
    )

    # Group-by-fingerprint roll-up over the same window.
    pipeline = [
        {"$match": q},
        {"$group": {
            "_id": "$fingerprint",
            "count": {"$sum": 1},
            "kind": {"$first": "$kind"},
            "exception_type": {"$first": "$exception_type"},
            "message": {"$first": "$message"},
            "path": {"$first": "$path"},
            "first_at": {"$min": "$at"},
            "last_at": {"$max": "$at"},
            "clinics": {"$addToSet": "$clinic_id"},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 50},
    ]
    groups = await db.error_logs.aggregate(pipeline).to_list(50)
    for g in groups:
        g["fingerprint"] = g.pop("_id")
        g["clinics_affected"] = len([c for c in g.pop("clinics", []) if c])

    return {
        "rows": rows,
        "groups": groups,
        "window_minutes": since_minutes,
    }


@admin_errors_router.get("/errors/{log_id}")
async def get_error(
    log_id: str,
    user=Depends(require_roles("founder", "super_admin")),
    db=Depends(get_db),
):
    row = await db.error_logs.find_one({"log_id": log_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Error log not found")
    return row


@admin_errors_router.get("/errors-alert/config")
async def alert_config(
    user=Depends(require_roles("founder")),
):
    """Returns the current alerter configuration so the founder can verify
    env vars loaded correctly. Webhook URL is masked."""
    from utils.error_alerts import _config
    cfg = _config()
    return {
        "threshold":         cfg["threshold"],
        "window_minutes":    cfg["window_minutes"],
        "cooldown_minutes":  cfg["cooldown_minutes"],
        "slack_webhook_set": bool(cfg["slack_webhook"]),
        "slack_webhook_preview": (cfg["slack_webhook"][:32] + "…") if cfg["slack_webhook"] else None,
        "email_to":          cfg["email_to"],
        "frontend_base":     cfg["frontend_base"],
        "enabled":           bool(cfg["slack_webhook"] or cfg["email_to"]),
    }


@admin_errors_router.post("/errors-alert/test")
async def alert_test(
    user=Depends(require_roles("founder")),
    db=Depends(get_db),
):
    """Synthesise a fake error spike and dispatch one alert to all
    configured channels. Bypasses cooldown by clearing state for the test
    fingerprint first."""
    from utils.error_alerts import maybe_alert
    fp = "TEST-ALERT-FINGERPRINT"
    await db.error_alert_state.delete_one({"fingerprint": fp})
    fake = {
        "fingerprint": fp,
        "kind": "backend",
        "exception_type": "TestSpikeAlert",
        "message": f"Synthetic spike triggered by founder {user['email']} at {datetime.now(timezone.utc).isoformat()}",
        "path": "/api/_telemetry/test",
        "clinic_id": user.get("clinic_id"),
        "user_id": user.get("user_id"),
    }
    # Force the count check above the threshold by inserting `threshold` rows.
    from utils.error_alerts import _config
    threshold = _config()["threshold"]
    now = datetime.now(timezone.utc)
    await db.error_logs.insert_many([
        {**fake,
         "log_id": f"test-{uuid.uuid4().hex[:8]}-{i}",
         "at": now,
         "method": "TEST", "query_string": "", "client_ip": "127.0.0.1",
         "user_agent": "test", "request_id": "test"} for i in range(threshold)
    ])
    await maybe_alert(db, fake)
    return {"ok": True, "dispatched": True, "fingerprint": fp}
