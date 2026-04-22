"""HA Trade-in + Upgrade Engine — Phase 10.5.

Structured flow for patients trading in their old hearing aid towards a new
purchase. Combines the existing upgrade-candidates CRM signal with a concrete
appraisal/accept/apply workflow.

Serial lifecycle on trade-in:
    SOLD  -- accept  --> RETURNED   (patient hands over old HA at the clinic)
    RETURNED -- apply --> RETIRED   (new sale paid · old HA retired to stock-out)

Trade-in doc lifecycle:
    appraised -> accepted -> applied
                         -> rejected   (serial stays SOLD)

Roles:
- create/accept/apply/reject  : audiologist / clinic_owner / super_admin
- read                         : any authenticated clinic user
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import TradeIn, TradeInCreate, TradeInApply
from utils.ha_states import transition_serial
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api/ha")

WRITE_ROLES = ("audiologist", "clinic_owner", "super_admin")
READ_ROLES = ("super_admin", "clinic_owner", "accounts", "audiologist", "front_desk",
              "technician", "inventory_manager")


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


async def _load(db, clinic_id: str, tid: str) -> dict:
    row = await db.ha_trade_ins.find_one(
        {"clinic_id": clinic_id, "trade_in_id": tid}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Trade-in not found")
    return row


@router.get("/trade-ins", response_model=List[TradeIn])
async def list_tradeins(
    status: Optional[str] = Query(None, description="appraised|accepted|applied|rejected"),
    patient_id: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    rows = await db.ha_trade_ins.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/trade-ins-kpis")
async def tradein_kpis(user=Depends(get_current_user), db=Depends(get_db)):
    base = _branch_scope(user)
    out = {"appraised": 0, "accepted": 0, "applied": 0, "rejected": 0,
           "offered_credit_total": 0.0, "applied_credit_total": 0.0}
    async for row in db.ha_trade_ins.aggregate([
        {"$match": base},
        {"$group": {
            "_id": "$status",
            "n": {"$sum": 1},
            "credit": {"$sum": {"$ifNull": ["$offered_credit", 0]}},
        }},
    ]):
        st = row["_id"]
        out[st] = row["n"]
        out["offered_credit_total"] += float(row.get("credit") or 0)
        if st == "applied":
            out["applied_credit_total"] = float(row.get("credit") or 0)
    out["offered_credit_total"] = round(out["offered_credit_total"], 2)
    out["applied_credit_total"] = round(out["applied_credit_total"], 2)
    return out


@router.get("/trade-ins/available-for-patient/{patient_id}")
async def available_tradeins(
    patient_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Return accepted, not-yet-linked trade-ins for a patient — callers use
    this to populate the 'Apply trade-in' dropdown when creating a new Sale."""
    base = _branch_scope(user)
    q = {**base, "patient_id": patient_id, "status": "accepted",
         "$or": [{"linked_sale_no": {"$exists": False}},
                 {"linked_sale_no": None}]}
    rows = await db.ha_trade_ins.find(q, {"_id": 0}).sort("created_at", -1).to_list(20)
    return [deserialize_datetime(r) for r in rows]


@router.get("/trade-ins/{trade_in_id}", response_model=TradeIn)
async def get_tradein(trade_in_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await _load(db, user["clinic_id"], trade_in_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trade-in not in your branch")
    return deserialize_datetime(row)


@router.post("/trade-ins", response_model=TradeIn, status_code=201)
async def create_tradein(
    payload: TradeInCreate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    if not user_can_see_branch(user, payload.branch_id):
        raise HTTPException(status_code=403, detail="Branch access denied")

    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": payload.patient_id},
        {"_id": 0, "name": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    serial = await db.serial_items.find_one(
        {"clinic_id": user["clinic_id"], "serial_id": payload.old_serial_id}, {"_id": 0},
    )
    if not serial:
        raise HTTPException(status_code=404, detail="Old serial not found")
    if serial["state"] != "SOLD":
        raise HTTPException(
            status_code=409,
            detail=f"Serial {serial.get('serial_no')} is {serial['state']}, only SOLD units can be traded in",
        )
    if serial.get("current_patient_id") and serial.get("current_patient_id") != payload.patient_id:
        raise HTTPException(
            status_code=400,
            detail="Old serial currently belongs to a different patient",
        )

    # Validate linked quote if supplied
    if payload.linked_quote_no:
        q = await db.quotations.find_one(
            {"clinic_id": user["clinic_id"], "quote_no": payload.linked_quote_no},
            {"_id": 0, "patient_id": 1, "status": 1},
        )
        if not q:
            raise HTTPException(status_code=404, detail="Linked quotation not found")
        if q.get("patient_id") != payload.patient_id:
            raise HTTPException(status_code=400, detail="Quote belongs to a different patient")

    # Auto-fetch original sale + brand/model + compute age
    old_sale_no = None
    age_years = None
    prod = await db.ha_products.find_one(
        {"product_id": serial.get("product_id"), "clinic_id": user["clinic_id"]},
        {"_id": 0, "brand": 1, "model": 1},
    )
    # Find the Sale that originally sold this serial (line.serial_id match)
    sale_row = await db.ha_sales.find_one(
        {"clinic_id": user["clinic_id"], "lines.serial_id": payload.old_serial_id,
         "status": {"$in": ["paid", "invoiced", "reserved"]}},
        {"_id": 0, "sale_no": 1, "created_at": 1},
    )
    if sale_row:
        old_sale_no = sale_row.get("sale_no")
        try:
            created = sale_row["created_at"]
            if isinstance(created, str):
                created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            age_days = (datetime.now(timezone.utc) - created).days
            age_years = round(age_days / 365, 2)
        except Exception:
            age_years = None

    tid = await next_number(db, "tradein", user["clinic_id"])
    doc = TradeIn(
        trade_in_id=tid,
        clinic_id=user["clinic_id"],
        branch_id=payload.branch_id,
        patient_id=payload.patient_id,
        patient_name=patient.get("name"),
        old_serial_id=payload.old_serial_id,
        old_serial_no=serial.get("serial_no"),
        old_brand=(prod or {}).get("brand"),
        old_model=(prod or {}).get("model"),
        old_sale_no=old_sale_no,
        age_years=age_years,
        condition=payload.condition,
        appraised_value=float(payload.appraised_value or 0),
        offered_credit=float(payload.offered_credit or 0),
        linked_quote_no=payload.linked_quote_no,
        notes=payload.notes,
        created_by_user_id=user["user_id"],
    )
    await db.ha_trade_ins.insert_one(serialize_datetime(doc.model_dump()))
    return deserialize_datetime(doc.model_dump())


@router.post("/trade-ins/{trade_in_id}/accept", response_model=TradeIn)
async def accept_tradein(
    trade_in_id: str,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    """Patient hands over the old HA. Serial SOLD → RETURNED."""
    row = await _load(db, user["clinic_id"], trade_in_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trade-in not in your branch")
    if row["status"] != "appraised":
        raise HTTPException(status_code=409, detail=f"Cannot accept a {row['status']} trade-in")

    now_iso = datetime.now(timezone.utc).isoformat()
    await transition_serial(
        db, row["old_serial_id"], "RETURNED",
        actor_user_id=user["user_id"],
        ref_doc={"kind": "trade_in", "id": trade_in_id},
        note=f"Trade-in accepted · patient handed over {row.get('old_serial_no') or row['old_serial_id']}",
    )
    await db.serial_items.update_one(
        {"serial_id": row["old_serial_id"]},
        {"$set": {"current_patient_id": None}},
    )
    await db.ha_trade_ins.update_one(
        {"clinic_id": user["clinic_id"], "trade_in_id": trade_in_id},
        {"$set": {"status": "accepted", "accepted_at": now_iso}},
    )
    row["status"] = "accepted"
    row["accepted_at"] = now_iso
    return deserialize_datetime(row)


@router.post("/trade-ins/{trade_in_id}/apply", response_model=TradeIn)
async def apply_tradein(
    trade_in_id: str, payload: TradeInApply,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    """Link trade-in to a Sale and retire the old serial. Called AFTER
    `accept` (so the old serial is in RETURNED state)."""
    row = await _load(db, user["clinic_id"], trade_in_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trade-in not in your branch")
    if row["status"] != "accepted":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot apply a {row['status']} trade-in (accept it first so the old HA is RETURNED)",
        )

    sale = await db.ha_sales.find_one(
        {"clinic_id": user["clinic_id"], "sale_no": payload.sale_no}, {"_id": 0},
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.get("patient_id") != row["patient_id"]:
        raise HTTPException(status_code=400, detail="Sale belongs to a different patient")
    if sale.get("status") == "cancelled":
        raise HTTPException(status_code=409, detail="Cannot apply trade-in to a cancelled sale")

    now_iso = datetime.now(timezone.utc).isoformat()
    # Retire the old serial — RETURNED → RETIRED
    await transition_serial(
        db, row["old_serial_id"], "RETIRED",
        actor_user_id=user["user_id"],
        ref_doc={"kind": "trade_in", "id": trade_in_id},
        note=f"Trade-in applied to sale {payload.sale_no}",
    )
    await db.ha_trade_ins.update_one(
        {"clinic_id": user["clinic_id"], "trade_in_id": trade_in_id},
        {"$set": {
            "status": "applied",
            "applied_at": now_iso,
            "linked_sale_no": payload.sale_no,
        }},
    )
    # Cross-link on the sale doc for audit
    await db.ha_sales.update_one(
        {"clinic_id": user["clinic_id"], "sale_no": payload.sale_no},
        {"$set": {"trade_in_id": trade_in_id, "trade_in_credit": row.get("offered_credit", 0)}},
    )
    row["status"] = "applied"
    row["applied_at"] = now_iso
    row["linked_sale_no"] = payload.sale_no
    return deserialize_datetime(row)


@router.post("/trade-ins/{trade_in_id}/reject", response_model=TradeIn)
async def reject_tradein(
    trade_in_id: str,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    """Patient declines the offer. If already accepted (serial RETURNED), push
    it back to SOLD with the same patient — we must re-stamp current_patient_id.
    From `appraised`, nothing on the serial changes."""
    row = await _load(db, user["clinic_id"], trade_in_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trade-in not in your branch")
    if row["status"] in ("applied", "rejected"):
        raise HTTPException(status_code=409, detail=f"Cannot reject a {row['status']} trade-in")

    now_iso = datetime.now(timezone.utc).isoformat()
    # Note: re-SOLD transition is not in the state table (RETURNED → RETIRED only).
    # For a rejected-after-accept flow, the clinic physically returns the unit to
    # the patient, but state-wise we keep it RETURNED and record the rejection
    # for audit. The unit is effectively out-of-stock. Owner may later move it
    # to RETIRED via damaged/retire flow.
    await db.ha_trade_ins.update_one(
        {"clinic_id": user["clinic_id"], "trade_in_id": trade_in_id},
        {"$set": {"status": "rejected", "rejected_at": now_iso}},
    )
    row["status"] = "rejected"
    row["rejected_at"] = now_iso
    return deserialize_datetime(row)


# ==================== UPGRADE FUNNEL ====================

@router.get("/upgrade-funnel")
async def upgrade_funnel(
    years_min: int = 3,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Combined view of:
    * aged HA owners (potential upgrade candidates — stage=candidate)
    * in-flight trade-ins (stage=appraised|accepted|applied|rejected)

    Used by the Upgrade Funnel Board UI to show the pipeline end-to-end.
    """
    base = _branch_scope(user)
    # --- candidates (aged HA sales without an active trade-in) ---
    from datetime import timedelta
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=years_min * 365)).isoformat()
    aged = await db.ha_sales.find(
        {**base, "status": {"$in": ["paid", "invoiced"]},
         "created_at": {"$lt": cutoff_iso}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)

    # Map of patient_id → existing active trade-in so we don't double-count
    active_ti_patients = set()
    async for r in db.ha_trade_ins.find(
        {**base, "status": {"$in": ["appraised", "accepted"]}},
        {"_id": 0, "patient_id": 1},
    ):
        active_ti_patients.add(r["patient_id"])

    candidates = []
    for s in aged:
        if s["patient_id"] in active_ti_patients:
            continue  # already in flight
        try:
            created = s["created_at"]
            if isinstance(created, str):
                created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            age_days = (datetime.now(timezone.utc) - created).days
        except Exception:
            age_days = years_min * 365
        # pick any serialised line as the upgrade-target serial
        old_serial_id = None
        old_serial_no = None
        for ln in s.get("lines") or []:
            if ln.get("serial_id"):
                old_serial_id = ln["serial_id"]
                # best-effort serial_no lookup
                si = await db.serial_items.find_one(
                    {"serial_id": old_serial_id}, {"_id": 0, "serial_no": 1, "state": 1},
                )
                if si and si.get("state") == "SOLD":
                    old_serial_no = si.get("serial_no")
                    break
                else:
                    old_serial_id = None  # not eligible
        if not old_serial_id:
            continue
        candidates.append({
            "patient_id": s["patient_id"],
            "patient_name": s.get("patient_name"),
            "sale_no": s["sale_no"],
            "age_years": round(age_days / 365, 2),
            "total": s.get("total"),
            "old_serial_id": old_serial_id,
            "old_serial_no": old_serial_no,
            "branch_id": s.get("branch_id"),
        })

    # --- in-flight trade-ins ---
    tradeins = []
    async for ti in db.ha_trade_ins.find(base, {"_id": 0}).sort("created_at", -1):
        tradeins.append(deserialize_datetime(ti))

    # --- funnel counts ---
    by_status = {"candidate": len(candidates), "appraised": 0, "accepted": 0, "applied": 0, "rejected": 0}
    for ti in tradeins:
        by_status[ti["status"]] = by_status.get(ti["status"], 0) + 1

    return {
        "candidates": candidates,
        "trade_ins": tradeins,
        "funnel": by_status,
    }
