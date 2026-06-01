"""Public AUDINEXA status page — `/api/status/public`.

Unauthenticated endpoint that returns a quick health snapshot of every
component a clinic owner cares about: the API itself, MongoDB, email
delivery (ZeptoMail), SMS (Twilio), WhatsApp (MSG91), payments (Razorpay),
and the daily backup loop.

Cached for 30 seconds — we don't need real-time and 50 paranoid clinic
owners reloading the page can't be allowed to hammer ZeptoMail's healthcheck.

Component status values: `operational | degraded | outage | unknown`.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends

from database import get_db

log = logging.getLogger("audinexa.status")

router = APIRouter(prefix="/api/status", tags=["status"])

_CACHE: dict = {"at": 0.0, "data": None}
_CACHE_TTL = 30.0  # seconds


# ─── Per-component probes ────────────────────────────────────────────────

async def _probe_mongo(db) -> dict:
    t0 = time.monotonic()
    try:
        await db.command("ping")
        ms = int((time.monotonic() - t0) * 1000)
        status = "operational" if ms < 250 else "degraded"
        return {"name": "Database (MongoDB)", "status": status, "latency_ms": ms}
    except Exception as e:
        return {"name": "Database (MongoDB)", "status": "outage", "error": str(e)[:120]}


async def _probe_backups(db) -> dict:
    """Look at the most recent successful backup row. Stale = degraded."""
    try:
        row = await db.backup_runs.find_one(
            {"status": "success"},
            sort=[("finished_at", -1)],
        )
        if not row:
            return {"name": "Daily backups", "status": "unknown",
                    "detail": "No completed runs yet"}
        finished = row.get("finished_at")
        if isinstance(finished, str):
            try:
                finished = datetime.fromisoformat(finished.replace("Z", "+00:00"))
            except ValueError:
                finished = None
        if not isinstance(finished, datetime):
            return {"name": "Daily backups", "status": "unknown"}
        if finished.tzinfo is None:
            finished = finished.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - finished
        if age < timedelta(hours=30):
            return {"name": "Daily backups", "status": "operational",
                    "last_run_at": finished.isoformat()}
        if age < timedelta(hours=72):
            return {"name": "Daily backups", "status": "degraded",
                    "last_run_at": finished.isoformat()}
        return {"name": "Daily backups", "status": "outage",
                "last_run_at": finished.isoformat()}
    except Exception as e:
        return {"name": "Daily backups", "status": "unknown", "error": str(e)[:120]}


async def _probe_email() -> dict:
    """ZeptoMail uses SMTP; we can't easily ping without sending mail. We
    surface configuration status only — actually-delivering-mail is reported
    via the per-day success-rate we log to `email_audit`."""
    has_creds = bool(os.environ.get("ZEPTOMAIL_HOST") and os.environ.get("ZEPTOMAIL_PASS"))
    return {
        "name": "Email (ZeptoMail)",
        "status": "operational" if has_creds else "unknown",
        "detail": "Credentials present" if has_creds else "No credentials configured",
    }


async def _probe_sms() -> dict:
    has_creds = bool(os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN"))
    return {
        "name": "SMS (Twilio)",
        "status": "operational" if has_creds else "unknown",
        "detail": "Credentials present" if has_creds else "No credentials configured",
    }


async def _probe_whatsapp() -> dict:
    has_creds = bool(os.environ.get("MSG91_AUTH_KEY") or os.environ.get("MSG91_API_KEY"))
    return {
        "name": "WhatsApp (MSG91)",
        "status": "operational" if has_creds else "unknown",
        "detail": "Credentials present" if has_creds else "Awaiting credentials (Phase 2)",
    }


async def _probe_razorpay() -> dict:
    key = os.environ.get("RAZORPAY_KEY_ID")
    secret = os.environ.get("RAZORPAY_KEY_SECRET")
    if not (key and secret):
        return {"name": "Payments (Razorpay)", "status": "unknown",
                "detail": "No credentials configured"}
    # Hit Razorpay's status header (cheap GET that doesn't require an
    # authenticated transaction). We only care that it answers.
    try:
        async with httpx.AsyncClient(timeout=4.0) as cli:
            r = await cli.get("https://api.razorpay.com/v1/", auth=(key, secret))
            if r.status_code < 500:
                return {"name": "Payments (Razorpay)", "status": "operational"}
            return {"name": "Payments (Razorpay)", "status": "degraded",
                    "detail": f"HTTP {r.status_code}"}
    except Exception:
        return {"name": "Payments (Razorpay)", "status": "outage",
                "detail": "Network unreachable"}


async def _probe_api() -> dict:
    return {"name": "API", "status": "operational"}


# ─── Aggregate ───────────────────────────────────────────────────────────

def _overall(components: list[dict]) -> str:
    order = {"operational": 0, "unknown": 1, "degraded": 2, "outage": 3}
    worst = max((order.get(c["status"], 0) for c in components), default=0)
    return [k for k, v in order.items() if v == worst][0]


@router.get("/public")
async def public_status(db=Depends(get_db)):
    """Cached 30s, anonymous. Safe to embed on the marketing site."""
    now = time.monotonic()
    if _CACHE["data"] and now - _CACHE["at"] < _CACHE_TTL:
        return _CACHE["data"]

    api, mongo, backups, email, sms, whatsapp, razorpay = await asyncio.gather(
        _probe_api(),
        _probe_mongo(db),
        _probe_backups(db),
        _probe_email(),
        _probe_sms(),
        _probe_whatsapp(),
        _probe_razorpay(),
    )
    components = [api, mongo, backups, email, sms, whatsapp, razorpay]
    payload = {
        "overall": _overall(components),
        "components": components,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "cache_ttl_seconds": int(_CACHE_TTL),
    }
    _CACHE["data"] = payload
    _CACHE["at"] = now
    return payload
