"""AMC (Annual Maintenance Contract) Management — Phase 13.A (UC-CM05).

An AMC is a paid maintenance plan attached to a sold hearing aid. It bundles
N cleanings/services + accidental-damage cover + battery-pack credits over a
fixed duration (typically 12 months). When the contract expires, the clinic
gets a renewal reminder in the CRM.

Flow:
  1. Clinic Owner/Admin defines AMC *Plans*  (name, duration_months, price, includes)
  2. Post-sale (or on a sold HA's anniversary) staff sell an AMC *Contract*
     linking patient + serial + plan. status starts 'active'.
  3. Each service ticket created against a covered serial consumes one
     included_services slot (via POST /{contract_no}/consume).
  4. A nightly cron (future) flips `expiry_date < today` contracts to 'expired'
     and raises a CRM follow-up. For now /renewals-due exposes the list.

Tier gate: STANDARD + PREMIUM (HA-commerce-adjacent).
"""
from __future__ import annotations

from datetime import datetime, timezone, date, timedelta
from dateutil.relativedelta import relativedelta
from typing import List, Optional, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user, require_roles
from database import get_db
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime
from utils.tiers import require_tier


router = APIRouter(prefix="/api/ha/amc", dependencies=[Depends(require_tier("amc"))])


# ==================== MODELS ====================

AMCStatus = Literal["active", "expired", "cancelled", "renewed"]


class AMCPlan(BaseModel):
    model_config = ConfigDict(extra="ignore")
    plan_id: str = Field(default_factory=lambda: f"AMP-{str(uuid4())[:8].upper()}")
    clinic_id: str
    name: str
    tier_label: Optional[str] = None          # "Basic" | "Silver" | "Gold"
    duration_months: int = 12
    price: float
    gst_rate: float = 18.0
    included_services: int = 4                # cleanings / free check-ups
    covers_accidental_damage: bool = False
    includes_battery_packs: int = 0
    description: Optional[str] = None
    active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AMCPlanCreate(BaseModel):
    name: str
    tier_label: Optional[str] = None
    duration_months: int = 12
    price: float
    gst_rate: float = 18.0
    included_services: int = 4
    covers_accidental_damage: bool = False
    includes_battery_packs: int = 0
    description: Optional[str] = None


class AMCPlanUpdate(BaseModel):
    name: Optional[str] = None
    tier_label: Optional[str] = None
    duration_months: Optional[int] = None
    price: Optional[float] = None
    gst_rate: Optional[float] = None
    included_services: Optional[int] = None
    covers_accidental_damage: Optional[bool] = None
    includes_battery_packs: Optional[int] = None
    description: Optional[str] = None
    active: Optional[bool] = None


class AMCContract(BaseModel):
    model_config = ConfigDict(extra="ignore")
    contract_no: str                                 # AMC-YYYY-NNNN
    clinic_id: str
    branch_id: Optional[str] = None
    # `plan_id` is required for new contracts but legacy/imported rows in
    # some tenants (esp. demo-seed tenants and pre-2026 clinics) may not
    # have it — make it optional on the response model so listing doesn't
    # 500. The write path (`AMCContractCreate`) still enforces it.
    plan_id: Optional[str] = None
    plan_snapshot: dict = Field(default_factory=dict)  # frozen copy at sale time
    patient_id: str
    patient_name: Optional[str] = None
    serial_id: Optional[str] = None
    serial_no: Optional[str] = None
    sale_no: Optional[str] = None                      # original HA sale linked
    amc_start_date: str                                # YYYY-MM-DD
    amc_expiry_date: str                               # YYYY-MM-DD
    services_used: int = 0
    services_log: list[dict] = Field(default_factory=list)  # [{ticket_no, at}]
    status: AMCStatus = "active"
    price_paid: float = 0.0
    invoice_id: Optional[str] = None
    last_service_at: Optional[str] = None
    notes: Optional[str] = None
    created_by_user_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AMCContractCreate(BaseModel):
    plan_id: str
    patient_id: str
    serial_id: Optional[str] = None
    sale_no: Optional[str] = None
    amc_start_date: Optional[str] = None                # default today
    price_override: Optional[float] = None              # let owner negotiate
    notes: Optional[str] = None


class AMCConsumePayload(BaseModel):
    ticket_no: Optional[str] = None
    note: Optional[str] = None


# ==================== PLAN CRUD ====================

@router.get("/plans", response_model=List[AMCPlan])
async def list_plans(
    include_inactive: bool = False,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = {"clinic_id": user["clinic_id"]}
    if not include_inactive:
        q["active"] = True
    rows = await db.ha_amc_plans.find(q, {"_id": 0}).sort("price", 1).to_list(100)
    return [deserialize_datetime(r) for r in rows]


@router.post("/plans", response_model=AMCPlan)
async def create_plan(
    payload: AMCPlanCreate,
    user=Depends(require_roles("clinic_owner", "super_admin", "accounts")),
    db=Depends(get_db),
):
    plan = AMCPlan(**payload.model_dump(), clinic_id=user["clinic_id"])
    await db.ha_amc_plans.insert_one(serialize_datetime(plan.model_dump()))
    return plan


@router.patch("/plans/{plan_id}", response_model=AMCPlan)
async def update_plan(
    plan_id: str,
    payload: AMCPlanUpdate,
    user=Depends(require_roles("clinic_owner", "super_admin", "accounts")),
    db=Depends(get_db),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.ha_amc_plans.find_one_and_update(
        {"plan_id": plan_id, "clinic_id": user["clinic_id"]},
        {"$set": updates},
        projection={"_id": 0},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Plan not found")
    return deserialize_datetime(res)


# ==================== CONTRACT CRUD ====================

@router.get("/contracts", response_model=List[AMCContract])
async def list_contracts(
    status: Optional[str] = None,
    patient_id: Optional[str] = None,
    expiring_within_days: Optional[int] = None,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    if expiring_within_days is not None:
        cutoff = (date.today() + timedelta(days=expiring_within_days)).isoformat()
        today_iso = date.today().isoformat()
        q["status"] = "active"
        q["amc_expiry_date"] = {"$gte": today_iso, "$lte": cutoff}
    rows = await db.ha_amc_contracts.find(q, {"_id": 0}).sort("amc_expiry_date", 1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/contracts/{contract_no}", response_model=AMCContract)
async def get_contract(
    contract_no: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    row = await db.ha_amc_contracts.find_one(
        {"contract_no": contract_no, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Contract not found")
    return deserialize_datetime(row)


@router.post("/contracts", response_model=AMCContract)
async def create_contract(
    payload: AMCContractCreate,
    user=Depends(require_roles("clinic_owner", "super_admin", "front_desk", "accounts", "audiologist")),
    db=Depends(get_db),
):
    plan = await db.ha_amc_plans.find_one(
        {"plan_id": payload.plan_id, "clinic_id": user["clinic_id"], "active": True},
        {"_id": 0},
    )
    if not plan:
        raise HTTPException(status_code=404, detail="AMC plan not found or inactive")

    patient = await db.patients.find_one(
        {"patient_id": payload.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "name": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    start = payload.amc_start_date or date.today().isoformat()
    try:
        start_d = date.fromisoformat(start)
    except ValueError:
        raise HTTPException(status_code=400, detail="amc_start_date must be YYYY-MM-DD")
    # Calendar-accurate anniversary math (Jan 1 + 12 months → Jan 1, not Dec 27)
    expiry_d = start_d + relativedelta(months=int(plan.get("duration_months") or 12))

    serial_no = None
    branch_id = None
    if payload.serial_id:
        s = await db.serial_items.find_one(
            {"serial_id": payload.serial_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "serial_no": 1, "branch_id": 1},
        )
        if not s:
            raise HTTPException(status_code=404, detail="Serial item not found")
        serial_no = s.get("serial_no")
        branch_id = s.get("branch_id")
        # Duplicate active contract on same serial?
        dup = await db.ha_amc_contracts.find_one({
            "clinic_id": user["clinic_id"],
            "serial_id": payload.serial_id,
            "status": "active",
        }, {"_id": 0, "contract_no": 1})
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f"Active AMC already exists for this device: {dup['contract_no']}",
            )

    contract_no = await next_number(db, "amc", user["clinic_id"])

    price_paid = float(payload.price_override if payload.price_override is not None else plan["price"])

    contract = AMCContract(
        contract_no=contract_no,
        clinic_id=user["clinic_id"],
        branch_id=branch_id,
        plan_id=plan["plan_id"],
        plan_snapshot={
            "name": plan["name"],
            "tier_label": plan.get("tier_label"),
            "duration_months": plan["duration_months"],
            "included_services": plan["included_services"],
            "covers_accidental_damage": plan.get("covers_accidental_damage", False),
            "includes_battery_packs": plan.get("includes_battery_packs", 0),
            "price": plan["price"],
        },
        patient_id=payload.patient_id,
        patient_name=patient.get("name"),
        serial_id=payload.serial_id,
        serial_no=serial_no,
        sale_no=payload.sale_no,
        amc_start_date=start_d.isoformat(),
        amc_expiry_date=expiry_d.isoformat(),
        price_paid=round(price_paid, 2),
        notes=payload.notes,
        created_by_user_id=user["user_id"],
    )
    await db.ha_amc_contracts.insert_one(serialize_datetime(contract.model_dump()))
    return contract


@router.post("/contracts/{contract_no}/consume", response_model=AMCContract)
async def consume_service(
    contract_no: str,
    payload: AMCConsumePayload,
    user=Depends(require_roles("technician", "audiologist", "front_desk", "clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    contract = await db.ha_amc_contracts.find_one(
        {"contract_no": contract_no, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    if contract["status"] != "active":
        raise HTTPException(status_code=409, detail=f"Contract is {contract['status']}")
    included = int(contract.get("plan_snapshot", {}).get("included_services") or 0)
    used = int(contract.get("services_used") or 0)
    if used >= included:
        raise HTTPException(
            status_code=409,
            detail=f"All {included} included services already consumed",
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    log_entry = {"at": now_iso, "user_id": user["user_id"]}
    if payload.ticket_no:
        log_entry["ticket_no"] = payload.ticket_no
    if payload.note:
        log_entry["note"] = payload.note
    res = await db.ha_amc_contracts.find_one_and_update(
        {"contract_no": contract_no, "clinic_id": user["clinic_id"]},
        {
            "$inc": {"services_used": 1},
            "$set": {"last_service_at": now_iso},
            "$push": {"services_log": log_entry},
        },
        projection={"_id": 0},
        return_document=True,
    )
    return deserialize_datetime(res)


@router.post("/contracts/{contract_no}/cancel", response_model=AMCContract)
async def cancel_contract(
    contract_no: str,
    user=Depends(require_roles("clinic_owner", "super_admin", "accounts")),
    db=Depends(get_db),
):
    res = await db.ha_amc_contracts.find_one_and_update(
        {"contract_no": contract_no, "clinic_id": user["clinic_id"], "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc).isoformat()}},
        projection={"_id": 0},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Active contract not found")
    return deserialize_datetime(res)


@router.post("/contracts/{contract_no}/renew", response_model=AMCContract)
async def renew_contract(
    contract_no: str,
    payload: AMCContractCreate,
    user=Depends(require_roles("clinic_owner", "super_admin", "front_desk", "accounts", "audiologist")),
    db=Depends(get_db),
):
    """Marks the old contract 'renewed' and mints a fresh one (patient + serial preserved if not overridden)."""
    old = await db.ha_amc_contracts.find_one(
        {"contract_no": contract_no, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not old:
        raise HTTPException(status_code=404, detail="Contract not found")

    # Create new using same patient/serial unless caller overrides
    new_payload = AMCContractCreate(
        plan_id=payload.plan_id,
        patient_id=payload.patient_id or old["patient_id"],
        serial_id=payload.serial_id or old.get("serial_id"),
        sale_no=payload.sale_no or old.get("sale_no"),
        amc_start_date=payload.amc_start_date,
        price_override=payload.price_override,
        notes=payload.notes or "Renewed from " + contract_no,
    )
    # We must temporarily deactivate the active flag check — if old is active
    # and on same serial, create_contract would 409. Mark old as renewed first.
    await db.ha_amc_contracts.update_one(
        {"contract_no": contract_no, "clinic_id": user["clinic_id"]},
        {"$set": {"status": "renewed", "renewed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return await create_contract(new_payload, user=user, db=db)


# ==================== RENEWALS & STATS ====================

@router.get("/renewals-due")
async def renewals_due(
    days: int = 30,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Active contracts expiring in the next N days. The front-desk CRM view."""
    today_iso = date.today().isoformat()
    cutoff = (date.today() + timedelta(days=days)).isoformat()
    rows = await db.ha_amc_contracts.find({
        "clinic_id": user["clinic_id"],
        "status": "active",
        "amc_expiry_date": {"$gte": today_iso, "$lte": cutoff},
    }, {"_id": 0}).sort("amc_expiry_date", 1).to_list(500)
    expired = await db.ha_amc_contracts.find({
        "clinic_id": user["clinic_id"],
        "status": "active",
        "amc_expiry_date": {"$lt": today_iso},
    }, {"_id": 0}).sort("amc_expiry_date", 1).to_list(500)
    return {
        "window_days": days,
        "expiring_soon": [deserialize_datetime(r) for r in rows],
        "already_expired": [deserialize_datetime(r) for r in expired],
        "count_soon": len(rows),
        "count_expired": len(expired),
    }


@router.get("/stats")
async def amc_stats(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = {"clinic_id": user["clinic_id"]}
    active = await db.ha_amc_contracts.count_documents({**q, "status": "active"})
    expired = await db.ha_amc_contracts.count_documents({**q, "status": "expired"})
    cancelled = await db.ha_amc_contracts.count_documents({**q, "status": "cancelled"})
    renewed = await db.ha_amc_contracts.count_documents({**q, "status": "renewed"})
    total_revenue = 0.0
    async for row in db.ha_amc_contracts.aggregate([
        {"$match": q},
        {"$group": {"_id": None, "rev": {"$sum": "$price_paid"}}},
    ]):
        total_revenue = round(float(row.get("rev") or 0), 2)
    return {
        "active": active,
        "expired": expired,
        "cancelled": cancelled,
        "renewed": renewed,
        "total_revenue": total_revenue,
    }


# ==================== INTERNAL: EXPIRY SWEEP ====================

async def run_amc_expiry_sweep(db) -> dict:
    """Flip active contracts with expired dates → 'expired'. Called nightly
    via APScheduler. Safe to run repeatedly.
    """
    today_iso = date.today().isoformat()
    res = await db.ha_amc_contracts.update_many(
        {"status": "active", "amc_expiry_date": {"$lt": today_iso}},
        {"$set": {"status": "expired", "expired_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"expired_count": res.modified_count}
