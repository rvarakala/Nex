"""HA Loaner Allocations — Post-P7 backlog item.

Issue a temporary IN_STOCK HA unit to a patient while their own unit is in
service. Moves serial IN_STOCK → LOANER → IN_STOCK on return (or → DAMAGED
if returned broken).

Lifecycle:  active → returned | damaged | converted_to_sale

Roles:
- create / mutate : front_desk / audiologist / technician / clinic_owner / super_admin
- read            : any authenticated clinic user
"""
from __future__ import annotations

from datetime import datetime, timezone, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import Loaner, LoanerCreate, LoanerReturn
from utils.ha_states import transition_serial
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api/ha")

WRITE_ROLES = ("front_desk", "audiologist", "technician", "clinic_owner", "super_admin")


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


def _today_ymd() -> str:
    return date.today().isoformat()


async def _load(db, clinic_id: str, loaner_id: str) -> dict:
    row = await db.ha_loaners.find_one(
        {"clinic_id": clinic_id, "loaner_id": loaner_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Loaner not found")
    return row


@router.get("/loaners", response_model=List[Loaner])
async def list_loaners(
    status: Optional[str] = None,
    patient_id: Optional[str] = None,
    overdue: Optional[bool] = None,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    if overdue:
        q["status"] = "active"
        q["expected_return_date"] = {"$lt": _today_ymd()}
    rows = await db.ha_loaners.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/loaners-kpis")
async def kpis(user=Depends(get_current_user), db=Depends(get_db)):
    base = _branch_scope(user)
    today = _today_ymd()
    active = await db.ha_loaners.count_documents({**base, "status": "active"})
    overdue = await db.ha_loaners.count_documents({
        **base, "status": "active", "expected_return_date": {"$lt": today},
    })
    returned = await db.ha_loaners.count_documents({**base, "status": "returned"})
    damaged = await db.ha_loaners.count_documents({**base, "status": "damaged"})
    return {"active": active, "overdue": overdue, "returned": returned, "damaged": damaged}


@router.get("/loaners/{loaner_id}", response_model=Loaner)
async def get_loaner(loaner_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await _load(db, user["clinic_id"], loaner_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Loaner not in your branch")
    return deserialize_datetime(row)


@router.post("/loaners", response_model=Loaner, status_code=201)
async def issue_loaner(
    payload: LoanerCreate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    if not user_can_see_branch(user, payload.branch_id):
        raise HTTPException(status_code=403, detail="Branch access denied")

    try:
        ret = date.fromisoformat(payload.expected_return_date)
    except Exception:
        raise HTTPException(status_code=400, detail="expected_return_date must be YYYY-MM-DD")
    if ret < date.today():
        raise HTTPException(status_code=400, detail="expected_return_date must be today or later")

    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": payload.patient_id},
        {"_id": 0, "name": 1, "mobile": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    serial = await db.serial_items.find_one(
        {"clinic_id": user["clinic_id"], "serial_id": payload.serial_id}, {"_id": 0},
    )
    if not serial:
        raise HTTPException(status_code=404, detail="Serial not found")
    if serial["state"] != "IN_STOCK":
        raise HTTPException(
            status_code=409,
            detail=f"Serial {serial.get('serial_no')} is {serial['state']}, only IN_STOCK can be issued as loaner",
        )
    if not user_can_see_branch(user, serial["branch_id"]):
        raise HTTPException(status_code=403, detail="Serial is in another branch")

    # Validate linked service ticket if provided
    if payload.service_ticket_no:
        t = await db.service_tickets.find_one(
            {"clinic_id": user["clinic_id"], "ticket_no": payload.service_ticket_no},
            {"_id": 0, "status": 1, "patient_id": 1},
        )
        if not t:
            raise HTTPException(status_code=404, detail="Linked service ticket not found")
        if t.get("patient_id") != payload.patient_id:
            raise HTTPException(status_code=400, detail="Service ticket belongs to a different patient")

    now_iso = datetime.now(timezone.utc).isoformat()
    loaner = Loaner(
        clinic_id=user["clinic_id"],
        branch_id=payload.branch_id,
        patient_id=payload.patient_id,
        patient_name=patient.get("name"),
        patient_mobile=patient.get("mobile"),
        serial_id=payload.serial_id,
        serial_no=serial.get("serial_no"),
        service_ticket_no=payload.service_ticket_no,
        status="active",
        issued_on=_today_ymd(),
        expected_return_date=ret.isoformat(),
        deposit_amount=float(payload.deposit_amount or 0),
        notes=payload.notes,
        created_by_user_id=user["user_id"],
        updated_at=now_iso,
    )
    await db.ha_loaners.insert_one(serialize_datetime(loaner.model_dump()))

    # Move serial → LOANER + stamp current patient
    await transition_serial(
        db, payload.serial_id, "LOANER",
        actor_user_id=user["user_id"],
        ref_doc={"kind": "loaner", "id": loaner.loaner_id},
        note=f"Loaner issued to {patient.get('name') or payload.patient_id}",
    )
    await db.serial_items.update_one(
        {"serial_id": payload.serial_id},
        {"$set": {"current_patient_id": payload.patient_id}},
    )

    # Cross-link to service ticket
    if payload.service_ticket_no:
        await db.service_tickets.update_one(
            {"clinic_id": user["clinic_id"], "ticket_no": payload.service_ticket_no},
            {"$set": {"loaner_serial_id": payload.serial_id, "updated_at": now_iso}},
        )

    return deserialize_datetime(loaner.model_dump())


@router.post("/loaners/{loaner_id}/return", response_model=Loaner)
async def return_loaner(
    loaner_id: str, payload: LoanerReturn,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await _load(db, user["clinic_id"], loaner_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Loaner not in your branch")
    if row["status"] != "active":
        raise HTTPException(status_code=409, detail=f"Cannot return a {row['status']} loaner")

    actual = payload.actual_return_date or _today_ymd()
    try:
        date.fromisoformat(actual)
    except Exception:
        raise HTTPException(status_code=400, detail="actual_return_date must be YYYY-MM-DD")

    # Move serial back
    next_state = "DAMAGED" if payload.damaged else "IN_STOCK"
    cur = await db.serial_items.find_one({"serial_id": row["serial_id"]}, {"_id": 0, "state": 1})
    if cur and cur["state"] == "LOANER":
        await transition_serial(
            db, row["serial_id"], next_state,
            actor_user_id=user["user_id"],
            ref_doc={"kind": "loaner", "id": loaner_id},
            note=f"Loaner {loaner_id} {'returned damaged' if payload.damaged else 'returned'}",
        )
        await db.serial_items.update_one(
            {"serial_id": row["serial_id"]},
            {"$set": {"current_patient_id": None}},
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    upd = {
        "status": "damaged" if payload.damaged else "returned",
        "actual_return_date": actual,
        "updated_at": now_iso,
        "closed_at": now_iso,
    }
    if payload.notes:
        upd["notes"] = ((row.get("notes") or "") + f"\n[ret {actual}] {payload.notes}").strip()

    await db.ha_loaners.update_one(
        {"clinic_id": user["clinic_id"], "loaner_id": loaner_id},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})
