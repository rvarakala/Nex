"""Login event + clinic activation tracking.

This module provides:
  * `record_login(db, user, request)` — fire-and-forget writer invoked from
    the successful /api/auth/login path. Writes to a capped collection so
    the log auto-rotates at ~100k entries and never fills disk.

  * `record_heartbeat(db, user_id, request)` — throttled writer (1/min per
    user) that updates `users.last_seen_at` + `last_seen_ip` on every
    authenticated request. Feeds the "Who's online now" widget.

  * `compute_activation_stage(db, clinic_id)` — returns the highest
    activation milestone reached by a given clinic (registered → first
    login → first patient → first diagnostic → first invoice → active).

The stages form a strict ascending ladder. A clinic is always at exactly
one stage at any given time.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import Request

# How many login events to keep on rolling basis (cap ~20 MB)
LOGIN_EVENTS_CAP_SIZE = 20 * 1024 * 1024  # 20 MB
LOGIN_EVENTS_MAX_DOCS = 100_000

# Heartbeat throttle — only write to Mongo once per N seconds per user.
# Prevents every API call from triggering a write on busy clinics.
HEARTBEAT_THROTTLE_SECONDS = 60
# Users active within this window are considered "online right now"
ONLINE_WINDOW_SECONDS = 300  # 5 min

# In-memory last-write timestamps per user (for heartbeat throttling).
# This is per-process; two pods would double-write, but that's cheap/idempotent.
_last_heartbeat_written: dict[str, datetime] = {}

# Activation milestone keys — ordered lowest → highest
STAGES = (
    "registered",      # clinic document exists
    "first_login",     # any user from that clinic has logged in
    "first_patient",   # ≥1 patient record
    "first_diagnostic",  # ≥1 test session OR audiometry report
    "first_invoice",   # ≥1 invoice
    "active",          # all above + logged in within last 7 days
)
STAGE_LABELS = {
    "registered": "Registered",
    "first_login": "First Login",
    "first_patient": "First Patient",
    "first_diagnostic": "First Diagnostic",
    "first_invoice": "First Invoice",
    "active": "Active Trial",
}


async def ensure_login_events_collection(db) -> None:
    """Create the capped collection for login events. Idempotent."""
    names = await db.list_collection_names()
    if "login_events" in names:
        return
    try:
        await db.create_collection(
            "login_events",
            capped=True,
            size=LOGIN_EVENTS_CAP_SIZE,
            max=LOGIN_EVENTS_MAX_DOCS,
        )
    except Exception:
        # Race condition — another worker created it first
        pass


async def record_login(db, user: dict, clinic: Optional[dict], request: Optional[Request] = None) -> None:
    """Write a login event. Never raises — auth path must not fail on audit write."""
    try:
        ip = _extract_ip(request)
        ua = request.headers.get("user-agent") if request else None
        doc = {
            "at": datetime.now(timezone.utc),
            "user_id": user.get("user_id"),
            "email": user.get("email"),
            "name": user.get("name"),
            "role": user.get("role"),
            "clinic_id": user.get("clinic_id"),
            "clinic_name": (clinic or {}).get("name"),
            "ip": ip,
            "user_agent": (ua or "")[:250],  # cap to keep docs small
        }
        await db.login_events.insert_one(doc)
        # Also prime the user's last_seen on fresh login
        await db.users.update_one(
            {"user_id": user.get("user_id")},
            {"$set": {"last_seen_at": doc["at"], "last_seen_ip": ip, "last_seen_ua": doc["user_agent"]}},
        )
    except Exception:
        # Silent fail — login must always succeed even if audit insert breaks
        pass


def _extract_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


async def record_heartbeat(db, user_id: str, request: Optional[Request] = None) -> None:
    """Update user.last_seen_at. Throttled to 1 write/min per user, per process.

    This powers the "Who's online now" widget — anyone with a last_seen_at
    within ONLINE_WINDOW_SECONDS is considered currently active.
    """
    now = datetime.now(timezone.utc)
    last = _last_heartbeat_written.get(user_id)
    if last is not None and (now - last).total_seconds() < HEARTBEAT_THROTTLE_SECONDS:
        return
    _last_heartbeat_written[user_id] = now
    try:
        ip = _extract_ip(request)
        ua = (request.headers.get("user-agent", "") if request else "")[:250]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"last_seen_at": now, "last_seen_ip": ip, "last_seen_ua": ua}},
        )
    except Exception:
        # Never break an authenticated request because of heartbeat write failure
        pass


async def list_online_users(db, window_seconds: int = ONLINE_WINDOW_SECONDS) -> list[dict]:
    """Return users active within the last `window_seconds`. Joined with clinic + geo."""
    # users.last_seen_at is stored as aware UTC; Mongo strips tzinfo on insert.
    cutoff_naive = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=window_seconds)
    users = await db.users.find(
        {"last_seen_at": {"$gte": cutoff_naive}},
        {"_id": 0, "password_hash": 0}
    ).sort("last_seen_at", -1).to_list(500)
    if not users:
        return []

    # Batch-fetch clinic docs once
    clinic_ids = list({u.get("clinic_id") for u in users if u.get("clinic_id")})
    clinics = await db.clinics.find(
        {"clinic_id": {"$in": clinic_ids}},
        {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "state": 1, "subscription_tier": 1}
    ).to_list(len(clinic_ids))
    cmap = {c["clinic_id"]: c for c in clinics}

    # Resolve IPs → geo, batched
    from utils.geoip import resolve_ips_batch
    ips = [u.get("last_seen_ip") for u in users if u.get("last_seen_ip")]
    geo_map = await resolve_ips_batch(db, ips)

    out = []
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    for u in users:
        ls = u.get("last_seen_at")
        if ls and getattr(ls, "tzinfo", None) is not None:
            ls = ls.replace(tzinfo=None)
        seconds_ago = int((now_naive - ls).total_seconds()) if ls else None
        clinic = cmap.get(u.get("clinic_id"), {})
        geo = geo_map.get(u.get("last_seen_ip"), {})
        out.append({
            "user_id": u.get("user_id"),
            "email": u.get("email"),
            "name": u.get("name"),
            "role": u.get("role"),
            "clinic_id": u.get("clinic_id"),
            "clinic_name": clinic.get("name"),
            "city": clinic.get("city"),
            "state": clinic.get("state"),
            "tier": clinic.get("subscription_tier"),
            "last_seen_at": u.get("last_seen_at"),
            "seconds_ago": seconds_ago,
            "last_seen_ip": u.get("last_seen_ip"),
            "last_seen_ua": u.get("last_seen_ua"),
            # Geo-derived (preferred over clinic city when different)
            "geo_city": geo.get("city") or None,
            "geo_region": geo.get("region") or None,
            "geo_country": geo.get("country") or None,
            "geo_country_code": geo.get("country_code") or None,
            "geo_lat": geo.get("lat"),
            "geo_lon": geo.get("lon"),
        })
    return out


# ==================== PAGE VIEW TRACKING ====================

# Capped ~10 MB / 200k views — auto-rotates
PAGE_VIEWS_CAP_SIZE = 10 * 1024 * 1024
PAGE_VIEWS_MAX_DOCS = 200_000

# Per-user throttle (avoid write-spam from e.g. auto-polling pages)
_last_pageview_written: dict[str, datetime] = {}
PAGEVIEW_THROTTLE_SECONDS = 2


async def ensure_page_views_collection(db) -> None:
    names = await db.list_collection_names()
    if "page_views" in names:
        return
    try:
        await db.create_collection(
            "page_views",
            capped=True,
            size=PAGE_VIEWS_CAP_SIZE,
            max=PAGE_VIEWS_MAX_DOCS,
        )
    except Exception:
        pass


async def record_page_view(db, user: dict, path: str, ip: Optional[str] = None) -> None:
    """Write a page view event (throttled)."""
    if not path:
        return
    uid = user.get("user_id")
    if not uid:
        return
    now = datetime.now(timezone.utc)
    last = _last_pageview_written.get(uid + ":" + path[:50])
    if last is not None and (now - last).total_seconds() < PAGEVIEW_THROTTLE_SECONDS:
        return
    _last_pageview_written[uid + ":" + path[:50]] = now
    try:
        await db.page_views.insert_one({
            "at": now,
            "user_id": uid,
            "email": user.get("email"),
            "name": user.get("name"),
            "role": user.get("role"),
            "clinic_id": user.get("clinic_id"),
            "path": path[:300],
            "ip": ip,
        })
    except Exception:
        pass


async def list_page_views(db, user_id: str, limit: int = 30) -> list[dict]:
    rows = await db.page_views.find({"user_id": user_id}, {"_id": 0}).sort("at", -1).to_list(min(limit, 200))
    return rows


async def compute_activation_stage(db, clinic_id: str) -> str:
    """Return the highest activation milestone reached by this clinic."""
    # 1. Active = last login within 7 days + has invoice
    # MongoDB driver stores datetimes naive UTC; compare naive→naive to avoid TypeError
    seven_days = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)

    has_invoice = await db.tenant_invoices.count_documents({"clinic_id": clinic_id}) > 0 \
        or await db.invoices.count_documents({"clinic_id": clinic_id}) > 0
    has_patient = await db.patients.count_documents({"clinic_id": clinic_id}) > 0
    has_diagnostic = await db.test_sessions.count_documents({"clinic_id": clinic_id}) > 0 \
        or await db.audiometry_reports.count_documents({"clinic_id": clinic_id}) > 0
    recent_login = await db.login_events.find_one({"clinic_id": clinic_id, "at": {"$gte": seven_days}})
    has_login = bool(recent_login) or await db.login_events.find_one({"clinic_id": clinic_id})

    if has_invoice and has_patient and recent_login:
        return "active"
    if has_invoice:
        return "first_invoice"
    if has_diagnostic:
        return "first_diagnostic"
    if has_patient:
        return "first_patient"
    if has_login:
        return "first_login"
    return "registered"


async def activation_funnel(db) -> dict:
    """Compute funnel counts across all clinics.

    Returns:
        {
          "counts": {"registered": N, ..., "active": M},
          "total": N,
        }
    Each clinic counts in exactly one stage (its highest reached).
    """
    clinics = await db.clinics.find({}, {"_id": 0, "clinic_id": 1}).to_list(5000)
    counts = {s: 0 for s in STAGES}
    for c in clinics:
        stage = await compute_activation_stage(db, c["clinic_id"])
        counts[stage] = counts.get(stage, 0) + 1
    return {"counts": counts, "total": len(clinics), "labels": STAGE_LABELS, "stages": list(STAGES)}


async def per_tenant_funnel(db, limit: int = 100) -> list[dict]:
    """Return per-clinic row: {clinic_id, name, stage, last_login_at, created_at}."""
    clinics = await db.clinics.find(
        {}, {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "subscription_tier": 1, "created_at": 1, "status": 1}
    ).sort("created_at", -1).to_list(limit)
    rows = []
    for c in clinics:
        stage = await compute_activation_stage(db, c["clinic_id"])
        last = await db.login_events.find_one(
            {"clinic_id": c["clinic_id"]},
            sort=[("at", -1)],
        )
        rows.append({
            "clinic_id": c["clinic_id"],
            "name": c.get("name"),
            "city": c.get("city"),
            "tier": c.get("subscription_tier"),
            "status": c.get("status", "active"),
            "stage": stage,
            "stage_label": STAGE_LABELS.get(stage, stage),
            "created_at": c.get("created_at"),
            "last_login_at": last.get("at") if last else None,
            "last_login_by": last.get("email") if last else None,
        })
    return rows
