"""AUDINEXA Super-Admin Panel — activity & funnel sub-routes.

Extracted from `routers/admin_panel.py` (Phase 3 refactor, 2026-04-28).

All routes mount at `/api/admin/v2/activity/*` (and one `/search`) and are
gated via `usage:read` permission, with `force-logout` further restricted to
founder/super_admin.

Endpoints:
  GET  /activity/logins                 — recent login events
  GET  /activity/online                 — users active in last N minutes
  GET  /activity/users/{id}/pageviews   — per-user page-view trail
  POST /activity/users/{id}/force-logout — bump token_version (founder only)
  GET  /activity/funnel                 — activation funnel buckets
  GET  /activity/funnel/by-tenant       — per-tenant stage breakdown
  GET  /activity/inactive               — silent clinics (no login in N days)
  GET  /search                          — unified admin search (tenants, leads, users)
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from database import get_db
from utils.serde import serialize_datetime, deserialize_datetime
from utils.rbac import require_permission


router = APIRouter(prefix="/api/admin/v2")


# ─────────────────────────── Logins / Online ───────────────────────────

@router.get("/activity/logins")
async def list_recent_logins(
    limit: int = 50,
    clinic_id: Optional[str] = None,
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Latest login events across all tenants (or filtered by clinic_id)."""
    q: dict = {}
    if clinic_id:
        q["clinic_id"] = clinic_id
    rows = await db.login_events.find(q, {"_id": 0}).sort("at", -1).to_list(min(limit, 500))
    return [deserialize_datetime(r) for r in rows]


@router.get("/activity/online")
async def list_online(
    minutes: int = 5,
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Users currently active — any authenticated request in the last N minutes.

    Each authenticated API call updates user.last_seen_at (throttled to
    1 write/min per user). This endpoint returns everyone still inside
    that window, with their clinic + location details.
    """
    from utils.activity import list_online_users
    rows = await list_online_users(db, window_seconds=max(60, minutes * 60))
    return [deserialize_datetime(r) for r in rows]


@router.get("/activity/users/{user_id}/pageviews")
async def user_page_views(
    user_id: str,
    limit: int = 30,
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Recent page views for a specific user — shown in the online-user drawer."""
    from utils.activity import list_page_views
    rows = await list_page_views(db, user_id, limit=limit)
    return [deserialize_datetime(r) for r in rows]


# ─────────────────────────── Force-logout ───────────────────────────

class ForceLogoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Optional[str] = None


@router.post("/activity/users/{user_id}/force-logout")
async def force_logout_user(
    user_id: str,
    payload: ForceLogoutRequest,
    actor=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Invalidate ALL active sessions for a user by bumping their token_version.

    JWTs are stateless, so we enforce revocation by incrementing
    `users.token_version`. Every subsequent authenticated request checks
    that its JWT's `tv` claim is ≥ the user's current token_version; if
    not, we 401. Affected user must sign in again.

    Only founder & super_admin can use this action.
    """
    if actor.get("role") not in ("founder", "super_admin"):
        raise HTTPException(status_code=403, detail="Only founder or super_admin can force-logout")
    target = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "email": 1, "token_version": 1, "name": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    new_tv = int(target.get("token_version", 0) or 0) + 1
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"token_version": new_tv, "last_seen_at": None}},
    )
    await db.admin_audit_logs.insert_one(serialize_datetime({
        "log_id": f"LOG-{uuid.uuid4().hex[:8].upper()}",
        "actor_email": actor["email"], "actor_role": actor.get("role"),
        "action": "force_logout",
        "details": {
            "target_user_id": user_id,
            "target_email": target.get("email"),
            "new_token_version": new_tv,
            "reason": payload.reason or "",
        },
        "at": datetime.now(timezone.utc),
    }))
    return {
        "ok": True,
        "user_id": user_id,
        "email": target.get("email"),
        "token_version": new_tv,
        "message": f"All sessions for {target.get('email')} revoked. User must sign in again.",
    }


# ─────────────────────────── Activation funnel ───────────────────────────

@router.get("/activity/funnel")
async def get_activation_funnel(
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Activation funnel: how many clinics at each stage?

    Stages (each clinic counts in exactly one — their highest reached):
      registered → first_login → first_patient → first_diagnostic
      → first_invoice → active (logged in <7d ago AND has invoice)

    **Cached 30s** — recomputing aggregates per poll is wasteful when the
    funnel changes slowly (daily). Founder dashboard polls every 15s →
    cache hit on the second poll.
    """
    from utils.activity import activation_funnel
    from utils.hot_cache import cached
    return await cached(
        key="funnel:v1",
        factory=lambda: activation_funnel(db),
        ttl_seconds=30,
    )


@router.get("/activity/funnel/by-tenant")
async def funnel_by_tenant(
    limit: int = 100,
    stage: Optional[str] = None,
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Per-tenant activation stage + last login details. Optionally filter by stage."""
    from utils.activity import per_tenant_funnel
    rows = await per_tenant_funnel(db, limit=limit)
    if stage:
        rows = [r for r in rows if r["stage"] == stage]
    return [deserialize_datetime(r) for r in rows]


@router.get("/activity/inactive")
async def list_inactive_tenants(
    days: int = 7,
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Clinics with no successful login in the last N days.

    Used to surface at-risk / silent trial clinics for proactive outreach.
    """
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)

    clinics = await db.clinics.find(
        {},
        {"_id": 0, "clinic_id": 1, "name": 1, "city": 1,
         "subscription_tier": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(2000)

    out = []
    for c in clinics:
        last = await db.login_events.find_one(
            {"clinic_id": c["clinic_id"]}, sort=[("at", -1)],
        )
        last_at = last["at"] if last else None
        if last_at is not None and last_at.tzinfo is not None:
            last_at = last_at.replace(tzinfo=None)
        if last_at is None or last_at < cutoff:
            out.append({
                "clinic_id": c["clinic_id"],
                "name": c.get("name"),
                "city": c.get("city"),
                "tier": c.get("subscription_tier"),
                "created_at": c.get("created_at"),
                "last_login_at": last_at,
                "days_since_login": None if last_at is None
                    else (now_naive - last_at).days,
            })
    out.sort(key=lambda r: (r["days_since_login"] is not None,
                            -(r["days_since_login"] or 99999)))
    return [deserialize_datetime(r) for r in out]


# ─────────────────────────── Unified admin search ───────────────────────────

@router.get("/search")
async def global_admin_search(
    q: str = "",
    limit: int = 10,
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Unified admin search — tenants (clinic name/city/id), leads
    (email/clinic/contact), and internal users (email/name).

    Returns a mixed result list grouped by entity type. Case-insensitive
    substring match. Results capped at `limit` per group.
    """
    q = (q or "").strip()
    if len(q) < 2:
        return {"q": q, "tenants": [], "leads": [], "users": [], "total": 0}

    rx = {"$regex": re.escape(q), "$options": "i"}
    safe_limit = max(1, min(limit, 25))

    tenants = await db.clinics.find(
        {"$or": [{"name": rx}, {"clinic_id": rx}, {"city": rx}, {"state": rx}]},
        {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "state": 1,
         "subscription_tier": 1, "status": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(safe_limit)

    leads = await db.waitlist_signups.find(
        {"$or": [{"email": rx}, {"clinic_name": rx},
                 {"contact_name": rx}, {"city": rx}]},
        {"_id": 0, "email": 1, "clinic_name": 1, "contact_name": 1,
         "city": 1, "stage": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(safe_limit)

    users = await db.users.find(
        {"$or": [{"email": rx}, {"name": rx}]},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1,
         "clinic_id": 1, "active": 1, "last_seen_at": 1},
    ).sort("last_seen_at", -1).to_list(safe_limit)

    uc_ids = list({u.get("clinic_id") for u in users if u.get("clinic_id")})
    if uc_ids:
        uclinics = await db.clinics.find(
            {"clinic_id": {"$in": uc_ids}},
            {"_id": 0, "clinic_id": 1, "name": 1},
        ).to_list(len(uc_ids))
        cmap = {c["clinic_id"]: c.get("name") for c in uclinics}
        for u in users:
            u["clinic_name"] = cmap.get(u.get("clinic_id"))

    return {
        "q": q,
        "tenants": [deserialize_datetime(r) for r in tenants],
        "leads": [deserialize_datetime(r) for r in leads],
        "users": [deserialize_datetime(r) for r in users],
        "total": len(tenants) + len(leads) + len(users),
    }
