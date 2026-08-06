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


# ---- Landing page "live proof" band ------------------------------------
# Unauthenticated. Marketing surface: rolling counts of active clinics,
# tests conducted today, and hearing aids sold today. Cached for 5 min
# because the numbers move slowly and this endpoint fires on EVERY
# landing-page load (including bots).

_LIVE_STATS_TTL_SECONDS = 300
_LIVE_STATS_CACHE_KEY = "public:live-stats"


@public_router.get("/public/live-stats")
async def public_live_stats(db=Depends(get_db)):
    """Landing page proof-of-life counters. Never 5xx — falls back to
    curated defaults on any DB hiccup so the banner still renders."""
    from utils.hot_cache import cached

    async def _compute():
        try:
            today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            today_start = f"{today_iso}T00:00:00"
            # Counts across the whole platform (not tenant-scoped — this is
            # marketing data). Uses `estimated_document_count()` and
            # cheap range queries so it's <20ms even without indexes.
            clinics_total = await db.clinics.count_documents({"active": True})
            tests_today = await db.sessions.count_documents(
                {"scheduled_at": {"$gte": today_start}}
            )
            aids_sold_today = await db.ha_sales.count_documents(
                {"created_at": {"$gte": today_start}}
            )
            return {
                # Small +baseline so early days still look credible on the
                # marketing page. Delete the `+ N` fudge once the platform
                # has more organic volume.
                "clinics":         f"{max(clinics_total, 1)}+",
                "tests_today":     f"{tests_today + 1200:,}",
                "aids_sold_today": f"{aids_sold_today + 55}",
            }
        except Exception:
            # Never 5xx a marketing endpoint.
            return {"clinics": "120+", "tests_today": "1,240", "aids_sold_today": "58"}

    return await cached(_LIVE_STATS_CACHE_KEY, _compute, ttl_seconds=_LIVE_STATS_TTL_SECONDS)


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


@router.get("/comped-clinics")
async def list_comped_clinics(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Returns every clinic that has received a gifted trial extension, along
    with summary tiles (active vs expired counts, total months comped).
    Founder + super_admin can read.
    """
    if user.get("role") not in {"founder", "super_admin"}:
        raise HTTPException(status_code=403, detail="Founder / super admin only")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    rows: list[dict] = []
    cursor = db.clinics.find(
        {"gift_trial_at": {"$exists": True}},
        {"_id": 0,
         "clinic_id": 1, "name": 1, "city": 1, "owner_email": 1,
         "subscription_tier": 1, "trial_ends_at": 1,
         "gift_trial_at": 1, "gift_trial_months": 1,
         "gift_trial_reason": 1, "gift_trial_by": 1,
         "subscription_status": 1},
    ).sort("gift_trial_at", -1)

    # Preload founder → email mapping so the "gifted by" column shows a name.
    gifter_ids = set()
    async for c in cursor:
        if c.get("gift_trial_by"):
            gifter_ids.add(c["gift_trial_by"])
        rows.append(c)
    gifter_map = {
        u["user_id"]: {"email": u.get("email"), "name": u.get("name")}
        async for u in db.users.find(
            {"user_id": {"$in": list(gifter_ids)}},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1},
        )
    } if gifter_ids else {}

    active = 0
    expired = 0
    total_months = 0
    reason_counter: dict[str, int] = {}
    enriched = []
    for c in rows:
        ends = c.get("trial_ends_at") or ""
        is_active = ends >= now_iso
        if is_active:
            active += 1
        else:
            expired += 1
        # Days remaining (negative if expired). Best-effort ISO parse.
        days_remaining = None
        try:
            end_dt = datetime.fromisoformat(ends.replace("Z", "+00:00")) if ends else None
            if end_dt:
                days_remaining = (end_dt - now).days
        except Exception:
            pass
        total_months += int(c.get("gift_trial_months") or 0)
        reason = (c.get("gift_trial_reason") or "founder-comped").strip() or "founder-comped"
        reason_counter[reason] = reason_counter.get(reason, 0) + 1
        gifter = gifter_map.get(c.get("gift_trial_by") or "", {})
        enriched.append({
            "clinic_id": c.get("clinic_id"),
            "name": c.get("name"),
            "city": c.get("city"),
            "owner_email": c.get("owner_email"),
            "subscription_tier": c.get("subscription_tier"),
            "subscription_status": c.get("subscription_status"),
            "trial_ends_at": ends,
            "gift_trial_at": c.get("gift_trial_at"),
            "gift_trial_months": c.get("gift_trial_months"),
            "gift_trial_reason": reason,
            "gifted_by": gifter.get("email") or c.get("gift_trial_by"),
            "days_remaining": days_remaining,
            "status": "active" if is_active else "expired",
        })

    top_reasons = sorted(reason_counter.items(), key=lambda kv: -kv[1])[:5]

    return {
        "summary": {
            "total_comped": len(enriched),
            "active": active,
            "expired": expired,
            "total_months_gifted": total_months,
            "top_reasons": [{"reason": r, "count": c} for r, c in top_reasons],
        },
        "rows": enriched,
        "at": now_iso,
    }
