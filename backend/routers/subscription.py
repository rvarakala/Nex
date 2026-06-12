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
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from auth import get_current_user, require_roles
from database import get_db
from utils.serde import serialize_datetime, deserialize_datetime
from utils.tiers import (
    TIER_ORDER, TIER_MODULES, get_tier_prices,
    resolve_effective_tier, has_module_access,
)
from utils.waitlist_autoresponder import (
    queue_position_for, send_waitlist_autoresponder_sync,
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
    source: Optional[str] = Field(default=None, description="Free-form provenance tag — e.g. 'landing_demo_request'")
    contact_name: Optional[str] = None


@router.post("/public/waitlist-signup", status_code=201)
async def join_waitlist(
    payload: WaitlistCreate,
    background_tasks: BackgroundTasks,
    db=Depends(get_db),
):
    """Public waitlist signup — idempotent on email (upsert).

    All landing-page demo requests funnel through here, then surface in the
    Founder Command Centre's Leads Kanban (`stage='Lead'`). The optional
    `source` field lets us slice traffic later (landing vs. organic vs. partner).

    Side-effect: a Zepto autoresponder email ("You're #N on the waitlist")
    is scheduled via FastAPI `BackgroundTasks` so the HTTP response returns
    in <100ms even when SMTP takes 1-3 seconds. The autoresponder is sent
    exactly ONCE per email — re-submissions are no-ops because the helper
    checks `autoresponder_sent_at` before firing.
    """
    doc = {
        **payload.model_dump(exclude_unset=True),
        "email": payload.email.lower().strip(),
        "created_at": datetime.now(timezone.utc),
    }
    await db.waitlist_signups.update_one(
        {"email": doc["email"]},
        {
            "$setOnInsert": {
                "created_at": doc["created_at"],
                "stage": "Lead",  # so it lands in the founder kanban's first column
            },
            "$set": {k: v for k, v in doc.items() if k != "created_at"},
        },
        upsert=True,
    )

    # Fire the autoresponder exactly once per email. We check the persisted
    # `autoresponder_sent_at` flag here (not just the upsert result) because
    # a re-submission could land on an existing row that already received
    # the email — we don't want to re-spam the lead.
    existing = await db.waitlist_signups.find_one(
        {"email": doc["email"]},
        {"_id": 0, "autoresponder_sent_at": 1},
    )
    queue_position = await queue_position_for(db, doc["email"])
    if not (existing or {}).get("autoresponder_sent_at"):
        background_tasks.add_task(
            send_waitlist_autoresponder_sync,
            doc["email"],
            payload.contact_name,
            queue_position,
        )

    return {
        "ok": True,
        "email": doc["email"],
        "queue_position": queue_position,
        "message": "You're on the waitlist. Check your inbox for confirmation.",
    }


# ==================== PUBLIC VISITOR COUNTER ====================

@router.post("/public/visitor-ping")
async def visitor_ping(db=Depends(get_db)):
    """Lightweight landing-page visitor counter.

    Atomic `$inc` on a single `site_stats` doc — MongoDB's upsert guarantees
    correctness under concurrency. Not real analytics (no per-session dedup);
    just a friendly social-proof widget on the landing page.
    """
    now = datetime.now(timezone.utc)
    today_key = now.strftime("%Y-%m-%d")
    await db.site_stats.update_one(
        {"_id": "visitors"},
        {"$inc": {"total": 1, f"by_day.{today_key}": 1},
         "$set": {"last_at": now.isoformat()}},
        upsert=True,
    )
    doc = await db.site_stats.find_one({"_id": "visitors"}, {"_id": 0, "total": 1, "by_day": 1})
    return {
        "total": int((doc or {}).get("total") or 0),
        "today": int(((doc or {}).get("by_day") or {}).get(today_key) or 0),
    }


@router.get("/public/visitor-count")
async def visitor_count(db=Depends(get_db)):
    """Read-only count (no increment) for cached display."""
    doc = await db.site_stats.find_one({"_id": "visitors"}, {"_id": 0, "total": 1, "by_day": 1})
    today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {
        "total": int((doc or {}).get("total") or 0),
        "today": int(((doc or {}).get("by_day") or {}).get(today_key) or 0),
    }


@router.get("/public/landing-stats")
async def landing_stats(db=Depends(get_db)):
    """Public landing-page social proof — live, honest counts.

    Excludes platform-internal + sandbox tenants and pytest seed data so the
    numbers reflect real beta clinics. Cached client-side; cheap to recompute
    so we don't bother caching server-side.
    """
    EXCLUDED_CLINIC_PREFIXES = (
        "audinexa-platform",
        "clinic-pytest-",
        "clinic-sandbox-",
        "clinic-test-",
        "clinic-smoke-",
        "clinic-direct-test-",
        "clinic-invite-test-",
        "clinic-ui-direct-",
    )
    clinic_filter = {
        "$nor": [{"clinic_id": {"$regex": f"^{p}"}} for p in EXCLUDED_CLINIC_PREFIXES]
        + [{"_id": {"$regex": f"^{p}"}} for p in EXCLUDED_CLINIC_PREFIXES]
    }
    record_filter = {
        "$nor": [{"clinic_id": {"$regex": f"^{p}"}} for p in EXCLUDED_CLINIC_PREFIXES]
    }

    clinics = await db.clinics.count_documents(clinic_filter)
    patients = await db.patients.count_documents(record_filter)
    ha_sales = await db.ha_sales.count_documents(record_filter)
    appointments = await db.appointments.count_documents(record_filter)
    return {
        "clinics_onboarded": clinics,
        "patients_managed": patients,
        "hearing_aids_tracked": ha_sales,
        "appointments_run": appointments,
        "data_sovereign_pct": 100,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/public/waitlist-stats")
async def waitlist_stats(db=Depends(get_db)):
    """Public-facing beta-waitlist counter for the landing-page sticky
    ribbon ("Beta cohort full — N clinics in queue · Next batch July
    2026").

    Honest count: real signups in `db.waitlist_signups`, minus obvious
    test/seed entries. A small `FLOOR_OFFSET` (set via env
    `AUDINEXA_WAITLIST_FLOOR`) is added so a fresh prod with 0 signups
    still shows a non-zero figure that grows real with every new lead.
    Default floor is 0 — no inflation unless an operator explicitly opts
    in.
    """
    import os
    floor = int(os.environ.get("AUDINEXA_WAITLIST_FLOOR", "0") or 0)
    # Exclude obvious test rows. Real product signups never use these
    # placeholders.
    real = await db.waitlist_signups.count_documents({
        "email": {"$not": {"$regex": r"(?i)^(test|qa|sample|demo|smoke|pytest|fake)@"}}
    })
    total = real + max(0, floor)
    next_batch = os.environ.get("AUDINEXA_NEXT_BATCH_LABEL", "").strip() or None
    return {
        "in_queue": total,
        "real_signups": real,
        "next_batch": next_batch,
        "beta_status": "FULL",
    }


# ==================== PUBLIC CLINIC SIGNUP ====================

class ClinicSignup(BaseModel):
    """Public self-signup payload. Creates a clinic + owner user in one call.
    New clinic auto-gets BASIC tier + 30-day Premium trial.
    """
    model_config = ConfigDict(extra="ignore")
    # Clinic fields
    clinic_name: str = Field(min_length=2, max_length=120)
    city: Optional[str] = None
    state: Optional[str] = None
    phone: Optional[str] = None
    # Owner/admin user fields
    owner_name: str = Field(min_length=2, max_length=80)
    owner_email: EmailStr
    owner_password: str = Field(min_length=8, max_length=128,
                                  description="min 8 chars")
    # Light bot protection — honeypot field that UI leaves empty
    company_url: Optional[str] = None


@router.post("/public/clinic-signup", status_code=201)
async def clinic_self_signup(payload: ClinicSignup, db=Depends(get_db)):
    """Creates a fresh clinic + clinic_owner user. Auto-login JWT returned.

    The new clinic starts on BASIC with `trial_ends_at = now + 30 days`
    (which resolves to PREMIUM via `resolve_effective_tier()` for the trial
    window). A primary branch is auto-created so the first staff member has
    somewhere to log patients.
    """
    # Honeypot — real users leave this empty
    if payload.company_url:
        raise HTTPException(status_code=400, detail="Invalid request")

    # Uniqueness check on email across the whole users table
    email = payload.owner_email.lower().strip()
    existing_u = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
    if existing_u:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Try signing in instead.",
        )

    # ----- Import locally to avoid circular at module load -----
    from auth import hash_password, create_access_token

    # Generate stable IDs (lower-cased slug + short uuid for idempotence)
    import re
    slug = re.sub(r"[^a-z0-9]+", "-", payload.clinic_name.lower()).strip("-")[:40] or "clinic"
    clinic_id = f"clinic-{slug}-{uuid.uuid4().hex[:6]}"
    user_id = f"USR-{uuid.uuid4().hex[:8].upper()}"
    branch_id = f"BR-{uuid.uuid4().hex[:8].upper()}"

    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=30)

    # ----- Create clinic -----
    await db.clinics.insert_one(serialize_datetime({
        "clinic_id": clinic_id,
        "name": payload.clinic_name.strip(),
        "city": payload.city or "",
        "state": payload.state or "",
        "phone": payload.phone or "",
        "email": email,
        "mrd_prefix": slug.upper()[:3] or "CLN",
        "subscription_tier": "BASIC",          # post-trial default
        "trial_ends_at": trial_end,            # 30-day Premium trial
        "signup_source": "public",
        "created_at": now,
    }))

    # ----- Create owner user -----
    await db.users.insert_one(serialize_datetime({
        "user_id": user_id,
        "clinic_id": clinic_id,
        "email": email,
        "name": payload.owner_name.strip(),
        "role": "clinic_owner",
        "active": True,
        "password_hash": hash_password(payload.owner_password),
        "branch_ids": [branch_id],
        "created_at": now,
    }))

    # ----- Create primary branch -----
    await db.branches.insert_one(serialize_datetime({
        "branch_id": branch_id,
        "clinic_id": clinic_id,
        "name": payload.clinic_name.strip(),
        "city": payload.city or "",
        "is_primary": True,
        "active": True,
        "created_at": now,
    }))

    # ----- Issue access token so the user is auto-logged-in -----
    token = create_access_token(user_id, email, "clinic_owner", clinic_id)

    return {
        "ok": True,
        "clinic_id": clinic_id,
        "user_id": user_id,
        "branch_id": branch_id,
        "access_token": token,
        "token_type": "bearer",
        "trial_ends_at": trial_end.isoformat(),
        "trial_days": 30,
        "effective_tier": "PREMIUM",   # during trial
        "stored_tier": "BASIC",
        "message": f"Welcome, {payload.owner_name.split()[0]}! Your 30-day Premium trial is active.",
    }


# ==================== AUTHENTICATED ====================

@router.get("/subscription/invoices")
async def my_subscription_invoices(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Tenant invoices the clinic owes Audinexa (or has paid in the past).
    Newest first. Used by the clinic-facing /billing/my-subscription page.
    """
    cur = (
        db.tenant_invoices
          .find({"clinic_id": user["clinic_id"]}, {"_id": 0})
          .sort("created_at", -1)
    )
    items = [r async for r in cur]
    # Buckets for the UI
    pending = [i for i in items if i.get("status") == "pending"]
    paid    = [i for i in items if i.get("status") == "paid"]
    others  = [i for i in items if i.get("status") not in ("pending", "paid")]
    return {
        "pending": pending,
        "paid": paid,
        "other": others,                 # cancelled / refunded / partially_refunded
        "total_count": len(items),
    }


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
