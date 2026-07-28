"""Public + founder endpoints for the launch banner and gift-free-trial flows.

- Banner config lives in the `platform_settings` collection under a single
  well-known doc (`_id: "launch_banner"`). Public GET is unauthenticated so
  the landing/signup pages can render without a session.
- The gift-trial endpoint extends `clinics.trial_ends_at` for a specific
  clinic — founder-only, audit-logged.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/admin/v2")

BANNER_DOC_ID = "launch_banner"

# Sensible defaults on first-load (before founder edits anything).
BANNER_DEFAULTS = {
    "enabled": False,
    "message": "🎉 The platform is now live — book a demo and be one of our early adopters.",
    "cta_text": "Book a demo",
    "cta_href": "/#pricing",
    "tone": "indigo",  # visual: indigo | emerald | rose | amber
}


class BannerPayload(BaseModel):
    enabled: bool | None = None
    message: str | None = Field(default=None, max_length=280)
    cta_text: str | None = Field(default=None, max_length=40)
    cta_href: str | None = Field(default=None, max_length=200)
    tone: str | None = Field(default=None, pattern="^(indigo|emerald|rose|amber)$")


class GiftTrialPayload(BaseModel):
    months: int = Field(default=3, ge=1, le=24)
    reason: str | None = Field(default=None, max_length=200)


async def _load_banner(db) -> dict:
    doc = await db.platform_settings.find_one({"_id": BANNER_DOC_ID})
    if not doc:
        return {**BANNER_DEFAULTS}
    doc.pop("_id", None)
    # Merge with defaults so a partial row still returns a full shape.
    return {**BANNER_DEFAULTS, **doc}


# ==================== PUBLIC ================================================

public_router = APIRouter(prefix="/api")


@public_router.get("/platform/launch-banner")
async def public_get_banner(db=Depends(get_db)):
    """Unauthenticated — landing + signup pages call this on load."""
    b = await _load_banner(db)
    # Only expose the fields the marketing pages need. Never leak audit meta.
    return {
        "enabled":   bool(b.get("enabled")),
        "message":   b.get("message") or "",
        "cta_text":  b.get("cta_text") or "",
        "cta_href":  b.get("cta_href") or "",
        "tone":      b.get("tone") or "indigo",
        "version":   b.get("updated_at", "v0"),  # localStorage dismiss key
    }


# ==================== FOUNDER-ONLY ==========================================


def _require_founder(user):
    if user.get("role") != "founder":
        raise HTTPException(status_code=403, detail="Founder only")


@router.get("/platform/launch-banner")
async def founder_get_banner(user=Depends(get_current_user), db=Depends(get_db)):
    _require_founder(user)
    return await _load_banner(db)


@router.patch("/platform/launch-banner")
async def founder_update_banner(
    payload: BannerPayload, request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    _require_founder(user)
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = user["user_id"]
    await db.platform_settings.update_one(
        {"_id": BANNER_DOC_ID},
        {"$set": updates},
        upsert=True,
    )
    # Best-effort audit trail (import here to avoid a circular import).
    try:
        from routers.admin_panel import _log_audit
        await _log_audit(db, user, "banner.update", BANNER_DOC_ID,
                         after=updates, request=request)
    except Exception:
        pass
    return await _load_banner(db)


@router.post("/tenants/{clinic_id}/gift-trial")
async def gift_free_trial(
    clinic_id: str, payload: GiftTrialPayload, request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """FOUNDER-ONLY. Extends the clinic's `trial_ends_at` by N months from
    NOW (not from the existing end). Overwrites any prior extension so the
    founder can "reset" a trial by clicking the button again.
    """
    _require_founder(user)
    if clinic_id in {"audinexa-platform"}:
        raise HTTPException(status_code=400, detail="Cannot gift trial to the platform tenant")
    clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    new_end = datetime.now(timezone.utc) + timedelta(days=payload.months * 30)
    new_end_iso = new_end.isoformat()
    await db.clinics.update_one(
        {"clinic_id": clinic_id},
        {"$set": {
            "trial_ends_at": new_end_iso,
            "gift_trial_reason": payload.reason or "founder-comped",
            "gift_trial_months": payload.months,
            "gift_trial_at": datetime.now(timezone.utc).isoformat(),
            "gift_trial_by": user["user_id"],
        }},
    )
    try:
        from routers.admin_panel import _log_audit, _invalidate_dashboard_cache
        await _log_audit(db, user, "tenant.gift_trial", clinic_id,
                         before={"prev_trial_ends_at": clinic.get("trial_ends_at")},
                         after={"months": payload.months, "new_trial_ends_at": new_end_iso},
                         request=request)
        _invalidate_dashboard_cache()
    except Exception:
        pass
    return {
        "ok": True,
        "clinic_id": clinic_id,
        "trial_ends_at": new_end_iso,
        "months": payload.months,
    }
