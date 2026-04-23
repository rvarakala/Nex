"""Login event + clinic activation tracking.

This module provides:
  * `record_login(db, user, request)` — fire-and-forget writer invoked from
    the successful /api/auth/login path. Writes to a capped collection so
    the log auto-rotates at ~100k entries and never fills disk.

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
        ip = None
        ua = None
        if request is not None:
            # Respect X-Forwarded-For (we're behind an ingress)
            fwd = request.headers.get("x-forwarded-for", "")
            ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
            ua = request.headers.get("user-agent")
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
    except Exception:
        # Silent fail — login must always succeed even if audit insert breaks
        pass


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
