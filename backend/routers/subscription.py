"""Subscription + Waitlist + Clinic-admin router (Phase 12.0).

Endpoints:
  PUBLIC:
    GET    /api/subscription/tiers        — pricing matrix (landing page)
    POST   /api/waitlist                   — anonymous signup

  AUTHENTICATED:
    GET    /api/subscription/my            — current clinic's tier + trial info
    GET    /api/subscription/access        — {module: bool} access map

  SUPER-ADMIN:
    GET    /api/admin/clinics              — all clinics + tiers
    PATCH  /api/admin/clinics/{clinic_id}/tier        — flip tier
    POST   /api/admin/clinics/{clinic_id}/extend-trial — +30 days
    GET    /api/admin/waitlist             — list waitlist
    GET    /api/admin/waitlist/export.csv  — CSV export
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from auth import get_current_user, require_roles
from database import get_db
from utils.serde import serialize_datetime, deserialize_datetime
from utils.tiers import (
    TIER_ORDER, TIER_MODULES, get_tier_prices,
    resolve_effective_tier, has_module_access,
)


router = APIRouter(prefix="/api")


# ==================== PUBLIC ====================

@router.get("/subscription/tiers")
async def list_tiers():
    """Landing-page pricing matrix. No auth required."""
    return {
        "tiers": [
            {
                "code": t,
                "name": t.title(),
                "modules": TIER_MODULES[t],
                "prices": get_tier_prices()[t],
            }
            for t in TIER_ORDER
        ],
        "trial_days": 30,
        "default_tier_for_new_clinics": "BASIC",
    }


class WaitlistCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    clinic_name: Optional[str] = None
    city: Optional[str] = None
    tier_interest: Optional[str] = Field(default=None, description="BASIC|STANDARD|PREMIUM")
    referrer: Optional[str] = None
    whatsapp: Optional[str] = None
    notes: Optional[str] = None


@router.post("/public/waitlist-signup", status_code=201)
async def join_waitlist(payload: WaitlistCreate, db=Depends(get_db)):
    """Public waitlist signup — idempotent on email (upsert)."""
    doc = {
        **payload.model_dump(exclude_unset=True),
        "email": payload.email.lower().strip(),
        "created_at": datetime.now(timezone.utc),
    }
    await db.waitlist_signups.update_one(
        {"email": doc["email"]},
        {"$setOnInsert": {"created_at": doc["created_at"]},
         "$set": {k: v for k, v in doc.items() if k != "created_at"}},
        upsert=True,
    )
    return {"ok": True, "email": doc["email"],
            "message": "You're on the waitlist. We'll email you at launch."}


# ==================== AUTHENTICATED ====================

@router.get("/subscription/my")
async def my_subscription(user=Depends(get_current_user), db=Depends(get_db)):
    clinic = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    tier = await resolve_effective_tier(clinic)
    trial_end = clinic.get("trial_ends_at")
    trial_active = False
    trial_days_left = None
    if trial_end:
        if isinstance(trial_end, str):
            try:
                trial_end_dt = datetime.fromisoformat(trial_end.replace("Z", "+00:00"))
            except ValueError:
                trial_end_dt = None
        else:
            trial_end_dt = trial_end
        if trial_end_dt and trial_end_dt.tzinfo is None:
            trial_end_dt = trial_end_dt.replace(tzinfo=timezone.utc)
        if trial_end_dt and trial_end_dt > datetime.now(timezone.utc):
            trial_active = True
            trial_days_left = (trial_end_dt - datetime.now(timezone.utc)).days
    return {
        "clinic_id": user["clinic_id"],
        "stored_tier": clinic.get("subscription_tier") or "BASIC",
        "effective_tier": tier,
        "trial_active": trial_active,
        "trial_days_left": trial_days_left,
        "trial_ends_at": trial_end.isoformat() if hasattr(trial_end, "isoformat") else trial_end,
        "modules": TIER_MODULES[tier],
    }


@router.get("/subscription/access")
async def module_access(user=Depends(get_current_user), db=Depends(get_db)):
    """Returns {module_code: bool} for the shell to gate navigation."""
    clinic = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0, "subscription_tier": 1, "trial_ends_at": 1},
    ) or {}
    tier = await resolve_effective_tier(clinic)
    if user["role"] == "super_admin":
        # Super admin bypasses every gate (for demos)
        return {"tier": tier, "super_admin_bypass": True,
                "access": {m: True for m in TIER_MODULES["PREMIUM"]}}
    return {
        "tier": tier,
        "super_admin_bypass": False,
        "access": {m: has_module_access(tier, m) for m in TIER_MODULES["PREMIUM"]},
    }


# ==================== SUPER-ADMIN ====================

@router.get("/admin/clinics")
async def admin_list_clinics(
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    rows = await db.clinics.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for c in rows:
        tier = await resolve_effective_tier(c)
        out.append({
            **deserialize_datetime(c),
            "effective_tier": tier,
        })
    return out


class TierFlipPayload(BaseModel):
    subscription_tier: str  # BASIC|STANDARD|PREMIUM


@router.patch("/admin/clinics/{clinic_id}/tier")
async def admin_flip_tier(
    clinic_id: str, payload: TierFlipPayload,
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    if payload.subscription_tier not in TIER_ORDER:
        raise HTTPException(400, detail=f"tier must be one of {TIER_ORDER}")
    r = await db.clinics.update_one(
        {"clinic_id": clinic_id},
        {"$set": {"subscription_tier": payload.subscription_tier,
                  "tier_updated_at": datetime.now(timezone.utc),
                  "tier_updated_by": user["user_id"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, detail="Clinic not found")
    return {"ok": True, "clinic_id": clinic_id, "new_tier": payload.subscription_tier}


@router.post("/admin/clinics/{clinic_id}/extend-trial")
async def admin_extend_trial(
    clinic_id: str, days: int = 30,
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    new_end = datetime.now(timezone.utc) + timedelta(days=days)
    r = await db.clinics.update_one(
        {"clinic_id": clinic_id}, {"$set": {"trial_ends_at": new_end}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, detail="Clinic not found")
    return {"ok": True, "trial_ends_at": new_end.isoformat(), "days": days}


@router.get("/admin/waitlist")
async def admin_list_waitlist(
    limit: int = 500,
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    rows = await db.waitlist_signups.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/admin/waitlist/export.csv")
async def admin_waitlist_csv(
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["email", "clinic_name", "city", "tier_interest", "whatsapp", "referrer",
                "notes", "created_at"])
    async for r in db.waitlist_signups.find({}, {"_id": 0}).sort("created_at", -1):
        created_at = r.get("created_at")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        w.writerow([
            r.get("email", ""), r.get("clinic_name", ""), r.get("city", ""),
            r.get("tier_interest", ""), r.get("whatsapp", ""), r.get("referrer", ""),
            (r.get("notes") or "").replace("\n", " "), created_at or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audinexa_waitlist.csv"'},
    )
