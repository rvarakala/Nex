"""M12 — Referral Partner Portal (Phase 13.C).

A Referral Partner is an external entity (ENT doctor, senior-care home, GP
chain, audiology college) that refers patients to an ACS clinic in exchange
for a commission on the resulting revenue.

7 UCs covered:
  1. Partner registration (admin invite or self-signup → pending approval)
  2. Partner approval / activation (super-admin / clinic owner)
  3. Unique referral code generation
  4. Patient tagging on registration (via referral_code)
  5. Partner dashboard — referred patients, revenue earned
  6. Commission calculation (flat % or fixed ₹ per referral)
  7. Payout ledger — clinic marks payouts as "paid"

A Partner has its own login (separate role: `referral_partner`). JWT is
issued by standard /auth/login but the resulting scope is limited to their
own partner_id.

Tier gate: PREMIUM.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from uuid import uuid4
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from auth import (
    get_current_user, require_roles, hash_password,
    create_access_token, verify_password,
)
from database import get_db
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime
from utils.tiers import require_tier


router = APIRouter(prefix="/api/referral-partners")


PartnerStatus = Literal["pending", "active", "suspended"]
CommissionKind = Literal["percent", "fixed"]


# ==================== MODELS ====================

class ReferralPartner(BaseModel):
    model_config = ConfigDict(extra="ignore")
    partner_id: str = Field(default_factory=lambda: f"RP-{str(uuid4())[:8].upper()}")
    clinic_id: str
    name: str
    email: EmailStr
    phone: Optional[str] = None
    organization: Optional[str] = None
    specialization: Optional[str] = None
    city: Optional[str] = None
    referral_code: str                   # unique per-clinic (human-readable)
    commission_kind: CommissionKind = "percent"
    commission_value: float = 5.0        # 5% of revenue OR ₹500 per referral
    bank_details: Optional[dict] = None  # account_no, ifsc, account_name
    status: PartnerStatus = "pending"
    notes: Optional[str] = None
    partner_since: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PartnerCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    organization: Optional[str] = None
    specialization: Optional[str] = None
    city: Optional[str] = None
    referral_code: Optional[str] = None    # auto-generated if not provided
    commission_kind: CommissionKind = "percent"
    commission_value: float = 5.0
    password: Optional[str] = None         # if set → provisions login
    notes: Optional[str] = None


class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    organization: Optional[str] = None
    specialization: Optional[str] = None
    city: Optional[str] = None
    commission_kind: Optional[CommissionKind] = None
    commission_value: Optional[float] = None
    bank_details: Optional[dict] = None
    status: Optional[PartnerStatus] = None
    notes: Optional[str] = None


class PartnerSelfSignup(BaseModel):
    clinic_id: str                       # they need to know which clinic
    name: str
    email: EmailStr
    phone: Optional[str] = None
    organization: Optional[str] = None
    specialization: Optional[str] = None
    city: Optional[str] = None
    password: str = Field(min_length=8)


class PartnerLogin(BaseModel):
    email: EmailStr
    password: str


class PartnerPayout(BaseModel):
    model_config = ConfigDict(extra="ignore")
    payout_id: str                                     # PAY-YYYY-NNNN
    clinic_id: str
    partner_id: str
    period_start: str                                  # YYYY-MM-DD
    period_end: str                                    # YYYY-MM-DD
    referral_count: int
    attributed_revenue: float
    commission_amount: float
    status: Literal["pending", "paid", "void"] = "pending"
    paid_at: Optional[str] = None
    payment_ref: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PayoutCreate(BaseModel):
    period_start: str
    period_end: str
    notes: Optional[str] = None


class PayoutMarkPaid(BaseModel):
    payment_ref: Optional[str] = None


# ==================== HELPERS ====================

def _gen_code(name: str) -> str:
    base = "".join(c for c in (name or "").upper() if c.isalpha())[:4] or "PTR"
    return f"{base}-{secrets.token_hex(2).upper()}"


async def _resolve_partner_from_user(user: dict, db) -> dict:
    """For users with role=referral_partner, look up their partner row."""
    row = await db.referral_partners.find_one(
        {"clinic_id": user["clinic_id"], "linked_user_id": user["user_id"]},
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="No partner profile linked to your login")
    return row


def _compute_commission(partner: dict, revenue: float, referrals: int) -> float:
    if (partner.get("commission_kind") or "percent") == "percent":
        pct = float(partner.get("commission_value") or 0)
        return round(revenue * pct / 100.0, 2)
    return round(float(partner.get("commission_value") or 0) * referrals, 2)


async def _attribute_revenue(db, clinic_id: str, partner_id: str,
                             start: Optional[str] = None, end: Optional[str] = None) -> dict:
    """Compute patients + invoice revenue + HA revenue attributed to a partner.
    Optionally bounded to a date window (YYYY-MM-DD inclusive-exclusive)."""
    pat_q = {"clinic_id": clinic_id, "referral_partner_id": partner_id}
    if start or end:
        created = {}
        if start: created["$gte"] = start + "T00:00:00"
        if end:   created["$lt"] = end + "T00:00:00"
        pat_q["created_at"] = created

    patients = await db.patients.find(pat_q, {"_id": 0, "patient_id": 1}).to_list(20000)
    pids = [p["patient_id"] for p in patients]

    invoice_rev = 0.0
    if pids:
        async for row in db.invoices.aggregate([
            {"$match": {
                "clinic_id": clinic_id,
                "patient_id": {"$in": pids},
                "status": {"$in": ["paid", "partial", "issued"]},
            }},
            {"$group": {"_id": None, "rev": {"$sum": {"$ifNull": ["$grand_total", "$total"]}}}},
        ]):
            invoice_rev = float(row.get("rev") or 0)

    ha_rev = 0.0
    if pids:
        async for row in db.ha_sales.aggregate([
            {"$match": {
                "clinic_id": clinic_id,
                "patient_id": {"$in": pids},
                "status": {"$nin": ["cancelled", "draft"]},
            }},
            {"$group": {"_id": None, "rev": {"$sum": "$total"}}},
        ]):
            ha_rev = float(row.get("rev") or 0)

    return {
        "patients": len(pids),
        "invoice_revenue": round(invoice_rev, 2),
        "ha_sale_revenue": round(ha_rev, 2),
        "total_revenue": round(invoice_rev + ha_rev, 2),
    }


# ==================== PUBLIC: SELF-SIGNUP ====================

@router.post("/public/signup")
async def partner_self_signup(payload: PartnerSelfSignup, db=Depends(get_db)):
    """Open endpoint — partners signup for a clinic and land in 'pending' status.
    Clinic owner must approve before they become active.
    """
    clinic = await db.clinics.find_one({"clinic_id": payload.clinic_id}, {"_id": 0, "clinic_id": 1})
    if not clinic:
        raise HTTPException(status_code=404, detail="Unknown clinic")

    # Email unique across users (partners share the users collection so /auth/login works)
    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    code = _gen_code(payload.name)
    while await db.referral_partners.find_one({"clinic_id": payload.clinic_id, "referral_code": code}):
        code = _gen_code(payload.name)

    partner = ReferralPartner(
        clinic_id=payload.clinic_id,
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        organization=payload.organization,
        specialization=payload.specialization,
        city=payload.city,
        referral_code=code,
        status="pending",
    )

    user_id = f"USR-{str(os.urandom(4).hex()).upper()}"
    user_doc = {
        "user_id": user_id,
        "clinic_id": payload.clinic_id,
        "email": payload.email.lower(),
        "name": payload.name,
        "role": "referral_partner",
        "active": True,                # allow login; tenant gate handles access
        "password_hash": hash_password(payload.password),
        "created_at": datetime.utcnow(),
        "branch_ids": [],
    }
    await db.users.insert_one(serialize_datetime(user_doc))

    p_doc = serialize_datetime(partner.model_dump())
    p_doc["linked_user_id"] = user_id
    await db.referral_partners.insert_one(p_doc)

    return {
        "partner_id": partner.partner_id,
        "referral_code": partner.referral_code,
        "status": partner.status,
        "message": "Thank you. Your application is pending approval.",
    }


# ==================== PARTNER SELF API (role=referral_partner) ====================

@router.get("/me")
async def partner_me(user=Depends(get_current_user), db=Depends(get_db)):
    if user["role"] != "referral_partner":
        raise HTTPException(status_code=403, detail="Not a partner account")
    p = await _resolve_partner_from_user(user, db)
    return deserialize_datetime(p)


@router.get("/me/dashboard")
async def partner_dashboard(
    days: int = 90,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    if user["role"] != "referral_partner":
        raise HTTPException(status_code=403, detail="Not a partner account")
    p = await _resolve_partner_from_user(user, db)
    if p["status"] != "active":
        return {
            "partner": deserialize_datetime(p),
            "status_message": "Your account is pending approval by the clinic.",
            "stats": {"patients": 0, "invoice_revenue": 0, "ha_sale_revenue": 0, "total_revenue": 0},
            "recent_patients": [],
            "payouts": [],
        }
    start_iso = (date.today() - timedelta(days=days)).isoformat()
    end_iso = (date.today() + timedelta(days=1)).isoformat()
    stats = await _attribute_revenue(db, user["clinic_id"], p["partner_id"], start_iso, end_iso)

    # Recent 25 patients (privacy-redacted name — first + initial)
    recent = await db.patients.find(
        {"clinic_id": user["clinic_id"], "referral_partner_id": p["partner_id"]},
        {"_id": 0, "patient_id": 1, "name": 1, "created_at": 1, "city": 1},
    ).sort("created_at", -1).to_list(25)
    redacted = []
    for r in recent:
        nm = (r.get("name") or "").strip().split(" ", 1)
        first = nm[0] if nm else "Patient"
        last_initial = nm[1][0] + "." if len(nm) > 1 and nm[1] else ""
        redacted.append({
            "patient_id": r["patient_id"],
            "display_name": f"{first} {last_initial}".strip(),
            "created_at": r.get("created_at"),
            "city": r.get("city"),
        })

    payouts = await db.partner_payouts.find(
        {"clinic_id": user["clinic_id"], "partner_id": p["partner_id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(20)

    stats["commission_estimate"] = _compute_commission(p, stats["total_revenue"], stats["patients"])

    return {
        "partner": deserialize_datetime(p),
        "window_days": days,
        "stats": stats,
        "recent_patients": redacted,
        "payouts": [deserialize_datetime(pp) for pp in payouts],
    }


# ==================== CLINIC-SIDE: PARTNER MANAGEMENT (PREMIUM-gated) ====================

ADMIN_ROLES = ("clinic_owner", "super_admin", "accounts")


@router.get(
    "",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def list_partners(
    status: Optional[str] = None,
    user=Depends(require_roles(*ADMIN_ROLES)),
    db=Depends(get_db),
):
    q = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    rows = await db.referral_partners.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [deserialize_datetime(r) for r in rows]


@router.post(
    "",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def create_partner(
    payload: PartnerCreate,
    user=Depends(require_roles(*ADMIN_ROLES)),
    db=Depends(get_db),
):
    existing_user = await db.users.find_one({"email": payload.email.lower()})
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    code = payload.referral_code or _gen_code(payload.name)
    while await db.referral_partners.find_one({"clinic_id": user["clinic_id"], "referral_code": code}):
        code = _gen_code(payload.name)

    partner = ReferralPartner(
        clinic_id=user["clinic_id"],
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        organization=payload.organization,
        specialization=payload.specialization,
        city=payload.city,
        referral_code=code,
        commission_kind=payload.commission_kind,
        commission_value=payload.commission_value,
        status="active",                        # clinic-created partners auto-active
        partner_since=date.today().isoformat(),
        notes=payload.notes,
    )
    p_doc = serialize_datetime(partner.model_dump())

    # Optional: provision login immediately
    if payload.password:
        user_id = f"USR-{str(os.urandom(4).hex()).upper()}"
        await db.users.insert_one(serialize_datetime({
            "user_id": user_id,
            "clinic_id": user["clinic_id"],
            "email": payload.email.lower(),
            "name": payload.name,
            "role": "referral_partner",
            "active": True,
            "password_hash": hash_password(payload.password),
            "created_at": datetime.utcnow(),
            "branch_ids": [],
        }))
        p_doc["linked_user_id"] = user_id

    await db.referral_partners.insert_one(p_doc)
    p_doc.pop("_id", None)
    return deserialize_datetime(p_doc)


@router.patch(
    "/{partner_id}",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def update_partner(
    partner_id: str,
    payload: PartnerUpdate,
    user=Depends(require_roles(*ADMIN_ROLES)),
    db=Depends(get_db),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    # if activating for the first time, stamp partner_since
    if updates.get("status") == "active":
        existing = await db.referral_partners.find_one(
            {"partner_id": partner_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "partner_since": 1},
        )
        if existing and not existing.get("partner_since"):
            updates["partner_since"] = date.today().isoformat()
    res = await db.referral_partners.find_one_and_update(
        {"partner_id": partner_id, "clinic_id": user["clinic_id"]},
        {"$set": updates},
        projection={"_id": 0},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Partner not found")
    return deserialize_datetime(res)


@router.get(
    "/{partner_id}/stats",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def partner_stats(
    partner_id: str,
    days: int = 90,
    user=Depends(require_roles(*ADMIN_ROLES)),
    db=Depends(get_db),
):
    p = await db.referral_partners.find_one(
        {"partner_id": partner_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    start_iso = (date.today() - timedelta(days=days)).isoformat()
    end_iso = (date.today() + timedelta(days=1)).isoformat()
    stats = await _attribute_revenue(db, user["clinic_id"], partner_id, start_iso, end_iso)
    stats["commission_estimate"] = _compute_commission(p, stats["total_revenue"], stats["patients"])
    return {"partner": deserialize_datetime(p), "window_days": days, "stats": stats}


# ==================== PATIENT TAGGING ====================

class AttachCodePayload(BaseModel):
    referral_code: str


@router.post(
    "/patients/{patient_id}/attach-code",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def attach_referral_code(
    patient_id: str,
    payload: AttachCodePayload,
    user=Depends(require_roles("front_desk", "clinic_owner", "super_admin", "accounts", "audiologist")),
    db=Depends(get_db),
):
    code = payload.referral_code.strip().upper()
    partner = await db.referral_partners.find_one({
        "clinic_id": user["clinic_id"],
        "referral_code": code,
        "status": "active",
    }, {"_id": 0, "partner_id": 1, "name": 1, "referral_code": 1})
    if not partner:
        raise HTTPException(status_code=404, detail=f"No active partner for code {code}")
    res = await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"$set": {
            "referral_partner_id": partner["partner_id"],
            "referral_source": "Partner",
        }},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Patient not found")
    return {"patient_id": patient_id, "partner_id": partner["partner_id"], "partner_name": partner["name"]}


# ==================== PAYOUTS ====================

@router.post(
    "/{partner_id}/payouts",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def create_payout(
    partner_id: str,
    payload: PayoutCreate,
    user=Depends(require_roles("clinic_owner", "super_admin", "accounts")),
    db=Depends(get_db),
):
    p = await db.referral_partners.find_one(
        {"partner_id": partner_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")

    stats = await _attribute_revenue(
        db, user["clinic_id"], partner_id,
        payload.period_start, payload.period_end,
    )
    commission = _compute_commission(p, stats["total_revenue"], stats["patients"])

    payout_id = await next_number(db, "payout", user["clinic_id"])
    payout = PartnerPayout(
        payout_id=payout_id,
        clinic_id=user["clinic_id"],
        partner_id=partner_id,
        period_start=payload.period_start,
        period_end=payload.period_end,
        referral_count=stats["patients"],
        attributed_revenue=stats["total_revenue"],
        commission_amount=commission,
        notes=payload.notes,
    )
    await db.partner_payouts.insert_one(serialize_datetime(payout.model_dump()))
    return payout


@router.get(
    "/{partner_id}/payouts",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def list_payouts(
    partner_id: str,
    user=Depends(require_roles(*ADMIN_ROLES)),
    db=Depends(get_db),
):
    rows = await db.partner_payouts.find(
        {"partner_id": partner_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return [deserialize_datetime(r) for r in rows]


@router.post(
    "/{partner_id}/payouts/{payout_id}/mark-paid",
    dependencies=[Depends(require_tier("referral-partners"))],
)
async def mark_paid(
    partner_id: str,
    payout_id: str,
    payload: PayoutMarkPaid,
    user=Depends(require_roles("clinic_owner", "super_admin", "accounts")),
    db=Depends(get_db),
):
    res = await db.partner_payouts.find_one_and_update(
        {"payout_id": payout_id, "partner_id": partner_id,
         "clinic_id": user["clinic_id"], "status": "pending"},
        {"$set": {
            "status": "paid",
            "paid_at": datetime.now(timezone.utc).isoformat(),
            "payment_ref": payload.payment_ref,
        }},
        projection={"_id": 0},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Pending payout not found")
    return deserialize_datetime(res)
