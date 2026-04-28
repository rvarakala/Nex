"""AUDINEXA Super-Admin Panel — Phase 14A.

Internal founder/super-admin command centre. Aggregates across every tenant.

Modules covered in this phase:
  1. Dashboard     — cross-tenant KPIs + charts
  2. Tenants       — enriched tenant table + detail + actions (suspend/impersonate/delete)
  3. Subscriptions — plan catalogue CRUD + upgrade/downgrade + manual invoices
  4. Revenue       — platform-wide revenue roll-up + invoice ledger
  5. Leads/Trials  — pipeline built on waitlist_signups + trial clinics
  6. FeatureFlags  — per-tenant additive module toggles on top of tier

Role gating:
  * `founder`       — full access including delete-tenant
  * `super_admin`   — everything except delete-tenant
  * All endpoints return 403 for anyone else.
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from auth import (
    get_current_user, hash_password, create_access_token,
    VALID_ROLES,
)
from database import get_db
from utils.serde import serialize_datetime, deserialize_datetime
from utils.tiers import (
    TIER_ORDER, TIER_MODULES, get_tier_prices,
    resolve_effective_tier, has_module_access,
)
from utils.rbac import require_permission


router = APIRouter(prefix="/api/admin/v2")


# ==================== HELPERS ====================

def _is_founder(user: dict) -> bool:
    return user.get("role") == "founder"


# Role gating for all routes is done via utils.rbac.require_permission(...)
# using the shared ROLE_PERMISSIONS matrix (Phase 14C).


async def _log_audit(db, user: dict, action: str, target: str, before: dict | None = None, after: dict | None = None, request: Request | None = None):
    """Append-only audit log for admin actions."""
    await db.admin_audit_logs.insert_one(serialize_datetime({
        "log_id": f"AUD-{uuid.uuid4().hex[:10].upper()}",
        "actor_user_id": user["user_id"],
        "actor_email": user.get("email"),
        "actor_role": user.get("role"),
        "action": action,
        "target": target,
        "before": before or {},
        "after": after or {},
        "ip": (request.client.host if request and request.client else None),
        "at": datetime.now(timezone.utc),
    }))


# ==================== 1. DASHBOARD ====================

@router.get("/dashboard")
async def dashboard(
    user=Depends(require_permission("dashboard:read")),
    db=Depends(get_db),
):
    now = datetime.now(timezone.utc)
    month_ago = (now - timedelta(days=30)).isoformat()
    months_ago_12 = (now - timedelta(days=365)).isoformat()

    # ---- KPI counts ----
    total_clinics = await db.clinics.count_documents({})
    # Trial vs paid via resolve_effective_tier (consult trial_ends_at)
    trials = 0
    active = 0
    suspended = 0
    plan_dist: dict[str, int] = {"BASIC": 0, "STANDARD": 0, "PREMIUM": 0}
    tier_revenue: dict[str, float] = {"BASIC": 0, "STANDARD": 0, "PREMIUM": 0}
    prices = get_tier_prices()
    async for c in db.clinics.find({}, {"_id": 0, "subscription_tier": 1, "trial_ends_at": 1, "status": 1}):
        if c.get("status") == "suspended":
            suspended += 1
            continue
        t = await resolve_effective_tier(c)
        plan_dist[t] = plan_dist.get(t, 0) + 1
        if c.get("trial_ends_at") and c.get("subscription_tier", "BASIC") == "BASIC":
            # Still on trial
            trials += 1
        else:
            active += 1
        # Estimated annual MRR-equivalent per tier
        tier_revenue[t] = tier_revenue.get(t, 0) + prices[t]["annual"] / 12.0

    mrr = round(sum(tier_revenue.values()), 2)
    arr = round(mrr * 12, 2)
    avg_per_tenant = round(mrr / max(total_clinics, 1), 2)

    # ---- New signups this month ----
    new_signups_30d = await db.clinics.count_documents({"created_at": {"$gte": month_ago}})

    # ---- Churn proxy (clinics with tier_auto_downgraded_from_trial in last 30d) ----
    churned = await db.clinics.count_documents({
        "tier_auto_downgraded_from_trial": True,
        "tier_updated_at": {"$gte": month_ago},
    })
    churn_rate = round(100 * churned / max(active + trials, 1), 1)

    # ---- Payment failures (placeholder — reads tenant_invoices collection) ----
    payment_failures = await db.tenant_invoices.count_documents({"status": "failed"})

    # ---- 12-month MRR growth chart ----
    mrr_series = []
    async for row in db.clinics.aggregate([
        {"$match": {"created_at": {"$gte": months_ago_12}}},
        {"$project": {
            "ts": {"$dateFromString": {"dateString": "$created_at", "onError": None}},
            "tier": {"$ifNull": ["$subscription_tier", "BASIC"]},
        }},
        {"$match": {"ts": {"$ne": None}}},
        {"$project": {
            "tier": 1,
            "bucket": {"$dateToString": {"date": "$ts", "format": "%Y-%m", "timezone": "Asia/Kolkata"}},
        }},
        {"$group": {"_id": {"month": "$bucket", "tier": "$tier"}, "n": {"$sum": 1}}},
        {"$sort": {"_id.month": 1}},
    ]):
        mrr_series.append(row)

    # Roll up into month->cumulative MRR
    monthly: dict[str, dict] = {}
    running = {"BASIC": 0, "STANDARD": 0, "PREMIUM": 0}
    for row in mrr_series:
        m = row["_id"]["month"]
        t = row["_id"]["tier"]
        if t not in running:
            running[t] = 0
        running[t] += row["n"]
        monthly.setdefault(m, {})
        monthly[m] = {
            "month": m,
            "basic": running.get("BASIC", 0),
            "standard": running.get("STANDARD", 0),
            "premium": running.get("PREMIUM", 0),
            "mrr": round(sum(running.get(k, 0) * prices[k]["annual"] / 12.0 for k in ("BASIC", "STANDARD", "PREMIUM")), 2),
        }
    mrr_chart = sorted(monthly.values(), key=lambda x: x["month"])

    # ---- New signups trend (last 30d, daily) ----
    signups_trend = []
    async for row in db.clinics.aggregate([
        {"$match": {"created_at": {"$gte": month_ago}}},
        {"$project": {
            "ts": {"$dateFromString": {"dateString": "$created_at", "onError": None}},
        }},
        {"$match": {"ts": {"$ne": None}}},
        {"$project": {
            "day": {"$dateToString": {"date": "$ts", "format": "%Y-%m-%d", "timezone": "Asia/Kolkata"}},
        }},
        {"$group": {"_id": "$day", "n": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]):
        signups_trend.append({"day": row["_id"], "count": row["n"]})

    # ---- Recent signups (last 10) ----
    recent = await db.clinics.find({}, {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "subscription_tier": 1, "trial_ends_at": 1, "created_at": 1})\
        .sort("created_at", -1).limit(10).to_list(10)
    recent_signups = [deserialize_datetime(r) for r in recent]

    # ---- Renewals due (trial ends in next 14 days) ----
    cutoff = (now + timedelta(days=14)).isoformat()
    now_iso = now.isoformat()
    renewals = await db.clinics.find(
        {"trial_ends_at": {"$gte": now_iso, "$lte": cutoff}},
        {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "trial_ends_at": 1, "email": 1, "phone": 1},
    ).sort("trial_ends_at", 1).limit(25).to_list(25)

    # ---- Conversion funnel (leads → trial → paid) ----
    waitlist_count = await db.waitlist_signups.count_documents({})
    trial_count = await db.clinics.count_documents({"trial_ends_at": {"$exists": True}})
    paid_count = await db.clinics.count_documents({"subscription_tier": {"$in": ["STANDARD", "PREMIUM"]}})

    return {
        "kpis": {
            "active_clinics": active,
            "trial_accounts": trials,
            "suspended": suspended,
            "total_tenants": total_clinics,
            "mrr": mrr,
            "arr": arr,
            "new_signups_30d": new_signups_30d,
            "churn_rate_pct": churn_rate,
            "payment_failures": payment_failures,
            "avg_revenue_per_tenant": avg_per_tenant,
        },
        "plan_distribution": [{"tier": t, "count": plan_dist.get(t, 0)} for t in TIER_ORDER],
        "revenue_by_tier": [{"tier": t, "revenue": round(tier_revenue.get(t, 0), 2)} for t in TIER_ORDER],
        "mrr_chart": mrr_chart,
        "signups_trend": signups_trend,
        "funnel": {
            "leads": waitlist_count,
            "trials": trial_count,
            "paid": paid_count,
            "trial_to_paid_pct": round(100 * paid_count / max(trial_count, 1), 1),
        },
        "recent_signups": recent_signups,
        "renewals_due": [deserialize_datetime(r) for r in renewals],
    }


# ==================== 2. TENANTS ====================

class TenantUpdate(BaseModel):
    name: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[Literal["active", "suspended"]] = None
    subscription_tier: Optional[str] = None


@router.get("/tenants")
async def list_tenants(
    status: Optional[str] = None,
    tier: Optional[str] = None,
    country: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 500,
    user=Depends(require_permission("tenants:read")),
    db=Depends(get_db),
):
    query: dict = {}
    if status:
        query["status"] = status
    if tier:
        query["subscription_tier"] = tier
    if country:
        query["country"] = country
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"clinic_id": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
        ]
    rows = await db.clinics.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)

    # Enrich each with user counts, branches, last login, health score
    out = []
    for c in rows:
        cid = c["clinic_id"]
        eff = await resolve_effective_tier(c)
        users_n = await db.users.count_documents({"clinic_id": cid, "active": True})
        branches_n = await db.branches.count_documents({"clinic_id": cid, "active": True})
        patients_n = await db.patients.count_documents({"clinic_id": cid})
        # Last login = most recent tokens.issued_at OR user-level field (we don't track yet; approximate via token activity)
        last_tok = await db.tokens.find_one({"clinic_id": cid}, {"_id": 0, "issued_at": 1}, sort=[("issued_at", -1)])
        last_activity = last_tok.get("issued_at") if last_tok else None
        # Health score 0-100
        tier_cap = {"BASIC": 50, "STANDARD": 150, "PREMIUM": 1000}.get(eff, 50)
        util = min(100, int(100 * patients_n / max(tier_cap, 1)))
        owner = await db.users.find_one({"clinic_id": cid, "role": {"$in": ["clinic_owner", "super_admin"]}}, {"_id": 0, "name": 1, "email": 1})
        out.append({
            **deserialize_datetime(c),
            "effective_tier": eff,
            "users_count": users_n,
            "branches_count": branches_n,
            "patients_count": patients_n,
            "last_activity_at": last_activity,
            "owner_name": (owner or {}).get("name"),
            "owner_email": (owner or {}).get("email"),
            "health_score": util,
        })
    return {"count": len(out), "rows": out}


@router.get("/tenants/{clinic_id}")
async def tenant_detail(
    clinic_id: str,
    user=Depends(require_permission("tenants:read")),
    db=Depends(get_db),
):
    c = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, detail="Tenant not found")
    eff = await resolve_effective_tier(c)
    users = await db.users.find({"clinic_id": clinic_id}, {"_id": 0, "password_hash": 0}).to_list(200)
    branches = await db.branches.find({"clinic_id": clinic_id}, {"_id": 0}).to_list(50)

    # Usage metrics
    patients_n = await db.patients.count_documents({"clinic_id": clinic_id})
    sessions_n = await db.test_sessions.count_documents({"clinic_id": clinic_id})
    invoices_n = await db.invoices.count_documents({"clinic_id": clinic_id})
    ha_sales_n = await db.ha_sales.count_documents({"clinic_id": clinic_id})
    tickets_n = await db.service_tickets.count_documents({"clinic_id": clinic_id})

    # Billing (admin-panel invoices — mock/manual)
    tenant_invoices = await db.tenant_invoices.find({"clinic_id": clinic_id}, {"_id": 0}).sort("issued_at", -1).to_list(50)

    # Feature flags — enriched payload so the embedded `<FeatureFlagsEditor>`
    # in the Founder tenant-detail page renders without a second round-trip.
    # Must match the shape returned by GET /admin/v2/feature-flags/{clinic_id}
    # (the editor reads base_modules + available_modules and crashes if either
    # is undefined).
    flags_doc_raw = await db.tenant_feature_flags.find_one(
        {"clinic_id": clinic_id}, {"_id": 0},
    ) or {"clinic_id": clinic_id, "extra_modules": [], "disabled_modules": []}
    base_mods = set(TIER_MODULES.get(eff, []))
    extra_set = set(flags_doc_raw.get("extra_modules", []))
    disabled_set = set(flags_doc_raw.get("disabled_modules", []))
    effective_modules = sorted((base_mods | extra_set) - disabled_set)
    flags_doc = {
        **flags_doc_raw,
        "tier": eff,
        "base_modules": sorted(base_mods),
        "available_modules": AVAILABLE_MODULES,
        "effective_modules": effective_modules,
    }

    # Audit trail
    audit = await db.admin_audit_logs.find(
        {"$or": [{"target": clinic_id}, {"target": {"$regex": f"^{clinic_id}:"}}]},
        {"_id": 0},
    ).sort("at", -1).limit(50).to_list(50)

    return {
        "tenant": {**deserialize_datetime(c), "effective_tier": eff},
        "users": [deserialize_datetime(u) for u in users],
        "branches": [deserialize_datetime(b) for b in branches],
        "usage": {
            "patients": patients_n, "test_sessions": sessions_n,
            "invoices": invoices_n, "ha_sales": ha_sales_n, "service_tickets": tickets_n,
        },
        "invoices": [deserialize_datetime(i) for i in tenant_invoices],
        "feature_flags": deserialize_datetime(flags_doc),
        "audit_trail": [deserialize_datetime(a) for a in audit],
    }


@router.patch("/tenants/{clinic_id}")
async def update_tenant(
    clinic_id: str,
    payload: TenantUpdate,
    request: Request,
    user=Depends(require_permission("tenants:write")),
    db=Depends(get_db),
):
    existing = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, detail="Tenant not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, detail="No fields to update")
    if "subscription_tier" in updates and updates["subscription_tier"] not in TIER_ORDER:
        raise HTTPException(400, detail=f"tier must be one of {TIER_ORDER}")
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.clinics.update_one({"clinic_id": clinic_id}, {"$set": serialize_datetime(updates)})
    await _log_audit(db, user, "tenant.update", clinic_id, before={k: existing.get(k) for k in updates}, after=updates, request=request)
    return {"ok": True}


@router.post("/tenants/{clinic_id}/suspend")
async def suspend_tenant(
    clinic_id: str, request: Request,
    user=Depends(require_permission("tenants:write")),
    db=Depends(get_db),
):
    await db.clinics.update_one({"clinic_id": clinic_id}, {"$set": {"status": "suspended", "suspended_at": datetime.now(timezone.utc).isoformat()}})
    await db.users.update_many({"clinic_id": clinic_id}, {"$set": {"active": False}})
    await _log_audit(db, user, "tenant.suspend", clinic_id, request=request)
    return {"ok": True, "clinic_id": clinic_id, "status": "suspended"}


@router.post("/tenants/{clinic_id}/activate")
async def activate_tenant(
    clinic_id: str, request: Request,
    user=Depends(require_permission("tenants:write")),
    db=Depends(get_db),
):
    await db.clinics.update_one({"clinic_id": clinic_id}, {"$set": {"status": "active"}, "$unset": {"suspended_at": ""}})
    await db.users.update_many({"clinic_id": clinic_id}, {"$set": {"active": True}})
    await _log_audit(db, user, "tenant.activate", clinic_id, request=request)
    return {"ok": True, "clinic_id": clinic_id, "status": "active"}


@router.post("/tenants/{clinic_id}/impersonate")
async def impersonate_tenant(
    clinic_id: str, request: Request,
    user=Depends(require_permission("tenants:impersonate")),
    db=Depends(get_db),
):
    """Mint a short-lived JWT as the tenant's clinic_owner for support / debugging.
    Impersonator identity recorded in audit trail.
    """
    owner = await db.users.find_one(
        {"clinic_id": clinic_id, "role": {"$in": ["clinic_owner", "super_admin"]}, "active": True},
        {"_id": 0},
    )
    if not owner:
        # fallback: any admin-ish active user in the clinic
        owner = await db.users.find_one({"clinic_id": clinic_id, "active": True}, {"_id": 0})
    if not owner:
        raise HTTPException(404, detail="No owner found in tenant")
    token = create_access_token(owner["user_id"], owner["email"], owner["role"], clinic_id)
    await _log_audit(db, user, "tenant.impersonate", clinic_id, after={"impersonated_user": owner["email"]}, request=request)
    return {"access_token": token, "token_type": "bearer", "as_user": owner["email"], "role": owner["role"]}


@router.delete("/tenants/{clinic_id}")
async def delete_tenant(
    clinic_id: str, request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """FOUNDER-ONLY. Hard-deletes a tenant + all its data. Not reversible."""
    if not _is_founder(user):
        raise HTTPException(status_code=403, detail="Only the founder can delete a tenant")
    if clinic_id in {"clinic-acs-demo"}:
        raise HTTPException(status_code=400, detail="Cannot delete the primary demo clinic")
    collections_to_purge = [
        "clinics", "users", "branches", "patients", "test_sessions",
        "invoices", "payments", "services", "tokens", "appointments",
        "ha_products", "ha_sales", "ha_fittings", "ha_trials", "quotations",
        "service_tickets", "ha_loaners", "ha_trade_ins", "ha_followups",
        "ha_subscriptions", "ha_amc_plans", "ha_amc_contracts",
        "referral_partners", "partner_payouts", "tenant_feature_flags",
        "tenant_invoices", "closeouts", "waitlist_signups",
        "patient_otps", "patient_appointment_requests", "patient_feedback",
        "service_estimates", "service_couriers", "service_approvals",
        "report_deliveries",
    ]
    deleted = {}
    for coll in collections_to_purge:
        r = await db[coll].delete_many({"clinic_id": clinic_id})
        deleted[coll] = r.deleted_count
    await _log_audit(db, user, "tenant.delete", clinic_id, before={"deleted_counts": deleted}, request=request)
    return {"ok": True, "clinic_id": clinic_id, "deleted": deleted}


# ==================== 3. SUBSCRIPTIONS — PLAN CRUD ====================
# We keep the original tier registry static (BASIC/STANDARD/PREMIUM); this section
# exposes the plan catalogue + lets admins issue manual invoices for a tenant.

@router.get("/subscriptions/plans")
async def get_plan_catalogue(user=Depends(require_permission("subscriptions:read")), db=Depends(get_db)):
    """Returns the currently-active 3-tier plan matrix + any plan overrides stored in DB."""
    prices = get_tier_prices()
    overrides = await db.plan_overrides.find({}, {"_id": 0}).to_list(20)
    ov_map = {o["tier"]: o for o in overrides}
    plans = []
    for t in TIER_ORDER:
        base = {
            "tier": t,
            "name": t.title(),
            "annual_price": prices[t]["annual"],
            "half_yearly_price": prices[t]["half_yearly"],
            "quarterly_price": prices[t]["quarterly"],
            "modules_included": TIER_MODULES[t],
        }
        if t in ov_map:
            o = ov_map[t]
            base.update({k: v for k, v in o.items() if k in {"user_limit", "branch_limit", "storage_limit_mb", "sms_credits", "whatsapp_credits", "support_level", "custom_note"}})
        plans.append(base)
    return {"plans": plans, "tier_order": TIER_ORDER}


class PlanOverride(BaseModel):
    user_limit: Optional[int] = None
    branch_limit: Optional[int] = None
    storage_limit_mb: Optional[int] = None
    sms_credits: Optional[int] = None
    whatsapp_credits: Optional[int] = None
    support_level: Optional[str] = None
    custom_note: Optional[str] = None


@router.put("/subscriptions/plans/{tier}")
async def update_plan_override(
    tier: str, payload: PlanOverride, request: Request,
    user=Depends(require_permission("subscriptions:write")),
    db=Depends(get_db),
):
    if tier not in TIER_ORDER:
        raise HTTPException(400, detail=f"tier must be one of {TIER_ORDER}")
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    upd["tier"] = tier
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.plan_overrides.update_one({"tier": tier}, {"$set": upd}, upsert=True)
    await _log_audit(db, user, "plan.override", tier, after=upd, request=request)
    return {"ok": True, "tier": tier, "overrides": {k: v for k, v in upd.items() if k not in {"tier", "updated_at"}}}


class TenantInvoiceCreate(BaseModel):
    clinic_id: str
    tier: str                                # BASIC|STANDARD|PREMIUM
    duration: Literal["annual", "half_yearly", "quarterly"] = "annual"
    amount_override: Optional[float] = None  # allows discounts / coupons
    coupon_code: Optional[str] = None
    notes: Optional[str] = None


@router.post("/subscriptions/invoices")
async def issue_tenant_invoice(
    payload: TenantInvoiceCreate, request: Request,
    user=Depends(require_permission("invoices:write")),
    db=Depends(get_db),
):
    if payload.tier not in TIER_ORDER:
        raise HTTPException(400, detail=f"tier must be one of {TIER_ORDER}")
    clinic = await db.clinics.find_one({"clinic_id": payload.clinic_id}, {"_id": 0, "name": 1, "email": 1})
    if not clinic:
        raise HTTPException(404, detail="Tenant not found")
    prices = get_tier_prices()[payload.tier]
    price_key = {"annual": "annual", "half_yearly": "half_yearly", "quarterly": "quarterly"}[payload.duration]
    base_amount = float(prices[price_key])
    amount = float(payload.amount_override) if payload.amount_override is not None else base_amount
    gst = round(amount * 0.18, 2)
    grand = round(amount + gst, 2)
    doc = {
        "invoice_id": f"TIN-{uuid.uuid4().hex[:8].upper()}",
        "clinic_id": payload.clinic_id,
        "clinic_name": clinic.get("name"),
        "tier": payload.tier,
        "duration": payload.duration,
        "base_amount": base_amount,
        "amount": amount,
        "gst_amount": gst,
        "grand_total": grand,
        "coupon_code": payload.coupon_code,
        "notes": payload.notes,
        "status": "pending",
        "payment_method": "manual",
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "issued_by": user["user_id"],
    }
    await db.tenant_invoices.insert_one(doc.copy())
    await _log_audit(db, user, "tenant_invoice.issue", payload.clinic_id, after=doc, request=request)
    doc.pop("_id", None)
    return doc


class InvoicePaidPayload(BaseModel):
    payment_ref: Optional[str] = None


@router.post("/subscriptions/invoices/{invoice_id}/mark-paid")
async def mark_tenant_invoice_paid(
    invoice_id: str, request: Request,
    payload: Optional[InvoicePaidPayload] = None,
    payment_ref: Optional[str] = None,
    user=Depends(require_permission("invoices:write")),
    db=Depends(get_db),
):
    ref = (payload.payment_ref if payload else None) or payment_ref
    r = await db.tenant_invoices.find_one_and_update(
        {"invoice_id": invoice_id, "status": "pending"},
        {"$set": {
            "status": "paid",
            "paid_at": datetime.now(timezone.utc).isoformat(),
            "payment_ref": ref,
            "paid_by": user["user_id"],
        }},
        projection={"_id": 0},
        return_document=True,
    )
    if not r:
        raise HTTPException(404, detail="Pending invoice not found")
    await _log_audit(db, user, "tenant_invoice.paid", r.get("clinic_id", invoice_id), after={"invoice_id": invoice_id, "ref": ref}, request=request)
    return r


# ==================== 4. REVENUE ====================

@router.get("/revenue")
async def platform_revenue(
    user=Depends(require_permission("revenue:read")),
    db=Depends(get_db),
):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    # Tenant invoices (SaaS revenue)
    pipeline_this_month = [
        {"$match": {"issued_at": {"$gte": month_start}}},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1},
            "sum": {"$sum": "$grand_total"},
        }},
    ]
    month_stats = {"paid": {"count": 0, "sum": 0}, "pending": {"count": 0, "sum": 0}, "failed": {"count": 0, "sum": 0}}
    async for row in db.tenant_invoices.aggregate(pipeline_this_month):
        month_stats[row["_id"]] = {"count": row["count"], "sum": round(float(row.get("sum") or 0), 2)}

    # Annual contracts still open
    annual_open = await db.tenant_invoices.count_documents({"duration": "annual", "status": "paid"})

    # Pending / overdue
    overdue = await db.tenant_invoices.find(
        {"status": "pending"},
        {"_id": 0},
    ).sort("issued_at", 1).limit(50).to_list(50)

    # Recent invoices
    recent = await db.tenant_invoices.find({}, {"_id": 0}).sort("issued_at", -1).limit(50).to_list(50)

    # Refunds (status=refunded)
    refunds_count = await db.tenant_invoices.count_documents({"status": "refunded"})

    return {
        "this_month": month_stats,
        "total_this_month_collected": month_stats["paid"]["sum"],
        "annual_contracts_open": annual_open,
        "refunds_count": refunds_count,
        "overdue": [deserialize_datetime(r) for r in overdue],
        "recent_invoices": [deserialize_datetime(r) for r in recent],
    }


# ==================== 5. LEADS / TRIALS PIPELINE ====================

LEAD_STAGES = ["Lead", "Demo Scheduled", "Trial Started", "Active Trial", "Converted", "Lost"]


class LeadUpdate(BaseModel):
    stage: Optional[str] = None
    assigned_sales_rep: Optional[str] = None
    notes: Optional[str] = None
    contact_name: Optional[str] = None
    mobile: Optional[str] = None
    source: Optional[str] = None


@router.get("/leads")
async def list_leads(
    stage: Optional[str] = None,
    user=Depends(require_permission("leads:read")),
    db=Depends(get_db),
):
    q: dict = {}
    if stage:
        q["stage"] = stage
    # Pull waitlist + enriched with any lead-pipeline fields
    rows = await db.waitlist_signups.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # Bucket counts for kanban header
    counts = {s: 0 for s in LEAD_STAGES}
    for r in rows:
        counts[r.get("stage") or "Lead"] = counts.get(r.get("stage") or "Lead", 0) + 1
    return {
        "stages": LEAD_STAGES,
        "counts": counts,
        "rows": [deserialize_datetime(r) for r in rows],
    }


@router.patch("/leads/{email}")
async def update_lead(
    email: str, payload: LeadUpdate, request: Request,
    user=Depends(require_permission("leads:write")),
    db=Depends(get_db),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updates.get("stage") and updates["stage"] not in LEAD_STAGES:
        raise HTTPException(400, detail=f"stage must be one of {LEAD_STAGES}")
    r = await db.waitlist_signups.find_one_and_update(
        {"email": email.lower()},
        {"$set": updates},
        projection={"_id": 0},
        return_document=True,
    )
    if not r:
        raise HTTPException(404, detail="Lead not found")
    await _log_audit(db, user, "lead.update", email, after=updates, request=request)
    return deserialize_datetime(r)


# ---------- Convert Lead → Clinic + Invitation -----------------------------

class ConvertLeadRequest(BaseModel):
    """Founder confirms / overrides the lead's submitted details before
    creating the clinic. All fields are optional; missing fields fall back
    to the lead's original values."""
    clinic_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    city: Optional[str] = None
    state: Optional[str] = None
    phone: Optional[str] = None
    owner_name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    owner_email: Optional[EmailStr] = None
    tier: Optional[Literal["BASIC", "STANDARD", "PREMIUM"]] = None
    trial_days: int = Field(default=30, ge=0, le=180)


class CreateTenantRequest(BaseModel):
    """For the manual 'Add Tenant' flow — founder onboards a clinic that
    didn't come through the website."""
    clinic_name: str = Field(min_length=2, max_length=120)
    owner_name: str = Field(min_length=2, max_length=80)
    owner_email: EmailStr
    city: Optional[str] = None
    state: Optional[str] = None
    phone: Optional[str] = None
    tier: Literal["BASIC", "STANDARD", "PREMIUM"] = "STANDARD"
    trial_days: int = Field(default=30, ge=0, le=180)


class TenantCreatedResponse(BaseModel):
    """Returned to the founder after a successful conversion / creation.
    `accept_url` is the WhatsApp/email-shareable invite link."""
    clinic_id: str
    clinic_name: str
    owner_email: str
    accept_url: str
    invite_token: str
    invite_expires_at: datetime
    converted_from_lead: bool = False


async def _create_clinic_with_invite(
    *, db, request: Request, actor: dict,
    clinic_name: str, owner_name: str, owner_email: str,
    city: str, state: str, phone: str,
    tier: str, trial_days: int,
    converted_from_lead: bool = False, lead_email: Optional[str] = None,
) -> TenantCreatedResponse:
    """Shared helper used by both 'Convert Lead' and 'Add Tenant'.
    Creates clinic + primary branch + invitation token. NO user is created
    here — the user is materialised when the invitee accepts the invite,
    so the password is chosen by the new owner, never the founder."""
    import re
    import secrets
    from datetime import timedelta as _td
    from routers.invitations import _build_accept_url, INVITE_TTL_DAYS

    email = owner_email.lower().strip()

    # Conflict guard — someone might already own a clinic on this email
    if await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1}):
        raise HTTPException(409, detail="A user with this email already exists. Use the existing tenant or invite to a different email.")

    # Unique slug
    slug = re.sub(r"[^a-z0-9]+", "-", clinic_name.lower()).strip("-")[:40] or "clinic"
    clinic_id = f"clinic-{slug}-{uuid.uuid4().hex[:6]}"
    branch_id = f"BR-{uuid.uuid4().hex[:8].upper()}"

    now = datetime.now(timezone.utc)
    trial_end = now + _td(days=trial_days) if trial_days > 0 else None

    clinic_doc = {
        "clinic_id": clinic_id,
        "name": clinic_name.strip(),
        "city": city or "",
        "state": state or "",
        "phone": phone or "",
        "email": email,
        "mrd_prefix": slug.upper()[:3] or "CLN",
        "subscription_tier": tier,
        "signup_source": "founder-converted" if converted_from_lead else "founder-direct",
        "created_at": now,
    }
    if trial_end:
        clinic_doc["trial_ends_at"] = trial_end
    await db.clinics.insert_one(serialize_datetime(clinic_doc))

    await db.branches.insert_one(serialize_datetime({
        "branch_id": branch_id,
        "clinic_id": clinic_id,
        "name": clinic_name.strip(),
        "city": city or "",
        "is_primary": True,
        "active": True,
        "created_at": now,
    }))

    # ----- Mint invitation token -----
    token = secrets.token_urlsafe(32)
    expires_at = now + _td(days=INVITE_TTL_DAYS)
    invite_doc = {
        "invite_id": f"INV-{uuid.uuid4().hex[:10].upper()}",
        "token": token,
        "clinic_id": clinic_id,
        "email": email,
        "name": owner_name.strip(),
        "role": "clinic_owner",
        "branch_ids": [branch_id],
        "phone": phone,
        "status": "pending",
        "created_at": now,
        "created_by": actor["user_id"],
        "expires_at": expires_at,
    }
    await db.invitations.insert_one(invite_doc)

    accept_url = _build_accept_url(request, token)

    # ----- Update lead → converted -----
    if converted_from_lead and lead_email:
        await db.waitlist_signups.update_one(
            {"email": lead_email.lower()},
            {"$set": {
                "stage": "Converted",
                "converted_clinic_id": clinic_id,
                "converted_at": now,
                "converted_by": actor["user_id"],
                "updated_at": now.isoformat(),
            }},
        )

    await _log_audit(db, actor,
                     "tenant.create_via_invite" if not converted_from_lead else "lead.convert",
                     clinic_id,
                     after={"email": email, "tier": tier, "lead_email": lead_email},
                     request=request)

    return TenantCreatedResponse(
        clinic_id=clinic_id,
        clinic_name=clinic_name.strip(),
        owner_email=email,
        accept_url=accept_url,
        invite_token=token,
        invite_expires_at=expires_at,
        converted_from_lead=converted_from_lead,
    )


@router.post("/leads/{email}/convert", response_model=TenantCreatedResponse)
async def convert_lead_to_tenant(
    email: str, payload: ConvertLeadRequest, request: Request,
    user=Depends(require_permission("leads:write")),
    db=Depends(get_db),
):
    """One-click convert: lead → clinic + primary branch + owner invitation.
    Founder shares the returned `accept_url` with the prospect (WhatsApp
    today; auto-emailed once SendGrid lands)."""
    lead = await db.waitlist_signups.find_one({"email": email.lower()}, {"_id": 0})
    if not lead:
        raise HTTPException(404, detail="Lead not found")
    if lead.get("stage") == "Converted" and lead.get("converted_clinic_id"):
        # Idempotent guard — return the existing clinic (no duplicate creation)
        raise HTTPException(409, detail=f"Lead already converted to clinic {lead['converted_clinic_id']}")

    return await _create_clinic_with_invite(
        db=db, request=request, actor=user,
        clinic_name=payload.clinic_name or lead.get("clinic_name") or f"{lead.get('name', 'New')} Clinic",
        owner_name=payload.owner_name or lead.get("name") or "Clinic Owner",
        owner_email=str(payload.owner_email or email).lower(),
        city=payload.city or lead.get("city", ""),
        state=payload.state or lead.get("state", ""),
        phone=payload.phone or lead.get("phone", ""),
        tier=payload.tier or lead.get("tier") or "STANDARD",
        trial_days=payload.trial_days,
        converted_from_lead=True,
        lead_email=email.lower(),
    )


@router.post("/tenants", response_model=TenantCreatedResponse)
async def create_tenant_with_invite(
    payload: CreateTenantRequest, request: Request,
    user=Depends(require_permission("tenants:write")),
    db=Depends(get_db),
):
    """Manual 'Add Tenant' — founder onboards a clinic that didn't come
    through the website. Same end-state as convert_lead, just no lead
    record to update."""
    return await _create_clinic_with_invite(
        db=db, request=request, actor=user,
        clinic_name=payload.clinic_name,
        owner_name=payload.owner_name,
        owner_email=payload.owner_email,
        city=payload.city or "",
        state=payload.state or "",
        phone=payload.phone or "",
        tier=payload.tier,
        trial_days=payload.trial_days,
        converted_from_lead=False,
    )


# ==================== 6. FEATURE FLAGS (per-tenant additive) ====================
# A tenant's effective modules = TIER_MODULES[tier] ∪ extra_modules − disabled_modules

AVAILABLE_MODULES = [
    # (code, label, description)
    {"code": "frontdesk", "label": "Clinical Front Desk", "category": "core"},
    {"code": "diagnostics", "label": "Clinical Diagnostics", "category": "core"},
    {"code": "hearing-aids", "label": "HA Commerce Engine", "category": "commerce"},
    {"code": "repair", "label": "Service & Repair (AUDINEXA)", "category": "commerce"},
    {"code": "amc", "label": "AMC Management", "category": "commerce"},
    {"code": "analytics", "label": "Analytics Pro", "category": "insights"},
    {"code": "patient-portal", "label": "Patient Portal", "category": "engagement"},
    {"code": "referral-partners", "label": "Referral Partners", "category": "engagement"},
    {"code": "loaners", "label": "Loaner Program", "category": "commerce"},
    {"code": "ci-module", "label": "Cochlear Implants (roadmap)", "category": "clinical"},
    {"code": "rehab-module", "label": "Rehabilitation (roadmap)", "category": "clinical"},
    {"code": "white-label", "label": "White Label", "category": "enterprise"},
    {"code": "api-access", "label": "API Access", "category": "enterprise"},
    {"code": "multi-branch", "label": "Multi Branch", "category": "enterprise"},
]


class FlagsUpdate(BaseModel):
    extra_modules: Optional[List[str]] = None
    disabled_modules: Optional[List[str]] = None


@router.get("/feature-flags/{clinic_id}")
async def get_feature_flags(
    clinic_id: str,
    user=Depends(require_permission("features:read")),
    db=Depends(get_db),
):
    c = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0, "subscription_tier": 1, "trial_ends_at": 1})
    if not c:
        raise HTTPException(404, detail="Tenant not found")
    tier = await resolve_effective_tier(c)
    flags = await db.tenant_feature_flags.find_one({"clinic_id": clinic_id}, {"_id": 0}) or {
        "clinic_id": clinic_id, "extra_modules": [], "disabled_modules": [],
    }
    base_mods = set(TIER_MODULES[tier])
    effective = (base_mods | set(flags.get("extra_modules", []))) - set(flags.get("disabled_modules", []))
    return {
        "clinic_id": clinic_id,
        "tier": tier,
        "base_modules": sorted(base_mods),
        "extra_modules": flags.get("extra_modules", []),
        "disabled_modules": flags.get("disabled_modules", []),
        "effective_modules": sorted(effective),
        "available_modules": AVAILABLE_MODULES,
    }


@router.put("/feature-flags/{clinic_id}")
async def update_feature_flags(
    clinic_id: str, payload: FlagsUpdate, request: Request,
    user=Depends(require_permission("features:write")),
    db=Depends(get_db),
):
    c = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, detail="Tenant not found")
    updates: dict = {}
    if payload.extra_modules is not None:
        updates["extra_modules"] = list({m for m in payload.extra_modules})
    if payload.disabled_modules is not None:
        updates["disabled_modules"] = list({m for m in payload.disabled_modules})
    if not updates:
        raise HTTPException(400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["clinic_id"] = clinic_id
    await db.tenant_feature_flags.update_one({"clinic_id": clinic_id}, {"$set": updates}, upsert=True)
    await _log_audit(db, user, "feature_flags.update", clinic_id, after=updates, request=request)
    return {"ok": True, **updates}


# ==================== AUDIT EXPORT ====================

@router.get("/audit-logs")
async def list_audit_logs(
    limit: int = 200,
    user=Depends(require_permission("audit:read")),
    db=Depends(get_db),
):
    rows = await db.admin_audit_logs.find({}, {"_id": 0}).sort("at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


# ==================== ACTIVITY TRACKING (Phase 14D) ====================

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

    import re
    rx = {"$regex": re.escape(q), "$options": "i"}
    safe_limit = max(1, min(limit, 25))

    # Tenants — by name, clinic_id, or city
    tenants = await db.clinics.find(
        {"$or": [{"name": rx}, {"clinic_id": rx}, {"city": rx}, {"state": rx}]},
        {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "state": 1,
         "subscription_tier": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(safe_limit)

    # Leads / waitlist — by email, clinic_name, contact_name, city
    leads = await db.waitlist_signups.find(
        {"$or": [{"email": rx}, {"clinic_name": rx}, {"contact_name": rx}, {"city": rx}]},
        {"_id": 0, "email": 1, "clinic_name": 1, "contact_name": 1,
         "city": 1, "stage": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(safe_limit)

    # Internal / all users — by email or name (exclude clinic-owner roles to keep internal separate,
    # OR include them so founder can find anyone). We include everyone here.
    users = await db.users.find(
        {"$or": [{"email": rx}, {"name": rx}]},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1,
         "clinic_id": 1, "active": 1, "last_seen_at": 1}
    ).sort("last_seen_at", -1).to_list(safe_limit)

    # Attach clinic name to users for display
    uc_ids = list({u.get("clinic_id") for u in users if u.get("clinic_id")})
    if uc_ids:
        uclinics = await db.clinics.find({"clinic_id": {"$in": uc_ids}}, {"_id": 0, "clinic_id": 1, "name": 1}).to_list(len(uc_ids))
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
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1, "token_version": 1, "name": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    new_tv = int(target.get("token_version", 0) or 0) + 1
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"token_version": new_tv, "last_seen_at": None}}
    )
    # Audit trail
    await db.admin_audit_logs.insert_one(serialize_datetime({
        "log_id": f"LOG-{uuid.uuid4().hex[:8].upper()}",
        "actor_email": actor["email"], "actor_role": actor.get("role"),
        "action": "force_logout",
        "details": {"target_user_id": user_id, "target_email": target.get("email"),
                    "new_token_version": new_tv, "reason": payload.reason or ""},
        "at": datetime.now(timezone.utc),
    }))
    return {
        "ok": True, "user_id": user_id, "email": target.get("email"),
        "token_version": new_tv,
        "message": f"All sessions for {target.get('email')} revoked. User must sign in again.",
    }


@router.get("/activity/funnel")
async def get_activation_funnel(
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Activation funnel: how many clinics at each stage?

    Stages (each clinic counts in exactly one — their highest reached):
      registered → first_login → first_patient → first_diagnostic
      → first_invoice → active (logged in <7d ago AND has invoice)
    """
    from utils.activity import activation_funnel
    return await activation_funnel(db)


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
    from datetime import datetime, timezone, timedelta
    # Naive UTC (Mongo stores naive UTC); compare naive→naive to avoid TypeError
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)

    clinics = await db.clinics.find(
        {}, {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "subscription_tier": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(2000)

    out = []
    for c in clinics:
        last = await db.login_events.find_one(
            {"clinic_id": c["clinic_id"]}, sort=[("at", -1)]
        )
        last_at = last["at"] if last else None
        # MongoDB capped collections return naive datetimes — normalize to naive UTC for comparison
        if last_at is not None and last_at.tzinfo is not None:
            last_at = last_at.replace(tzinfo=None)
        # Never logged in, or last login before cutoff
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
    # Sort: never-logged-in first, then by most days inactive
    out.sort(key=lambda r: (r["days_since_login"] is not None, -(r["days_since_login"] or 99999)))
    return [deserialize_datetime(r) for r in out]




# ==================== BETA TESTER SEEDER (founder-only, one-time) ====================

class BetaSeedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reset: bool = False  # if True, wipe all beta-* tenants/users before re-seeding (dangerous)


@router.post("/seed/beta-testers")
async def seed_beta_testers_endpoint(
    payload: BetaSeedRequest,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """One-shot founder-only endpoint to seed 10 beta tester workspaces.

    Idempotent — skips clinics that already exist unless `reset=true`.
    Returns the generated credentials ONLY on first creation; for skipped
    entries, password is masked (cannot recover — re-run with reset=true to
    rotate).
    """
    if user.get("role") != "founder":
        raise HTTPException(status_code=403, detail="Only founder can run the beta seeder")

    # Delegate to the standalone module so logic stays in one place
    from beta_seed import BETA_TESTERS, TRIAL_DAYS, _gen_password, _mrd_prefix
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4
    from utils.serde import serialize_datetime

    now = datetime.now(timezone.utc)
    credentials: list[dict] = []

    if payload.reset:
        ids = [t["clinic_id"] for t in BETA_TESTERS]
        emails = [t["email"] for t in BETA_TESTERS]
        await db.clinics.delete_many({"clinic_id": {"$in": ids}})
        await db.users.delete_many({"email": {"$in": emails}})
        await db.branches.delete_many({"clinic_id": {"$in": ids}})

    for t in BETA_TESTERS:
        cid = t["clinic_id"]
        existing_clinic = await db.clinics.find_one({"clinic_id": cid})
        existing_user = await db.users.find_one({"email": t["email"]})

        if existing_clinic and existing_user:
            credentials.append({
                "clinic": t["name"], "city": t["city"], "contact": t["contact_name"],
                "email": t["email"], "password": "<already-seeded>", "status": "skipped",
            })
            continue

        if not existing_clinic:
            await db.clinics.insert_one(serialize_datetime({
                "clinic_id": cid,
                "name": t["name"],
                "city": t["city"],
                "state": t["state"],
                "country": "India",
                "phone": t["phone"],
                "email": t["email"],
                "mrd_prefix": _mrd_prefix(cid),
                "subscription_tier": "STANDARD",
                "trial_ends_at": now + timedelta(days=TRIAL_DAYS),
                "signup_source": "beta-program",
                "status": "active",
                "created_at": now,
            }))

        branch = await db.branches.find_one({"clinic_id": cid, "is_primary": True})
        if branch:
            branch_id = branch["branch_id"]
        else:
            branch_id = f"BR-{str(uuid4())[:8].upper()}"
            await db.branches.insert_one(serialize_datetime({
                "branch_id": branch_id, "clinic_id": cid,
                "name": f"{t['city']} HQ",
                "city": t["city"], "state": t["state"],
                "is_primary": True, "active": True, "created_at": now,
            }))

        password = _gen_password()
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(uuid4())[:8].upper()}",
            "clinic_id": cid,
            "email": t["email"],
            "name": t["contact_name"],
            "role": "clinic_owner",
            "active": True,
            "password_hash": hash_password(password),
            "branch_ids": [branch_id],
            "created_at": now,
        }))

        # Service catalogue is now curated per-tenant in Settings → Service Catalogue.
        # We intentionally DO NOT auto-seed services so each clinic starts clean and
        # only sees what their owner explicitly adds. Owners can add their first
        # service in seconds via the inline "+ New service" button in Billing.

        credentials.append({
            "clinic": t["name"], "city": t["city"], "contact": t["contact_name"],
            "email": t["email"], "password": password, "status": "created",
        })

    # Audit trail
    await db.admin_audit_logs.insert_one(serialize_datetime({
        "log_id": f"LOG-{str(uuid4())[:8].upper()}",
        "actor_email": user["email"], "actor_role": user.get("role"),
        "action": "beta_testers_seeded",
        "details": {"reset": payload.reset, "created": sum(1 for c in credentials if c["status"] == "created")},
        "at": now,
    }))

    return {
        "success": True,
        "trial_days": TRIAL_DAYS,
        "tier": "STANDARD",
        "credentials": credentials,
        "instruction": "Distribute these credentials to your beta testers. Passwords cannot be recovered — copy them now.",
    }
