"""HA Fittings — Phase 4 Clinical Workflows.

A Fitting is a clinical session tying a patient to one or more HA serial units
(typically from a Sale). It carries:

* A first-fit event + unbounded follow-up/adjustment visits (programming ledger — per-visit summary; Q3=b).
* An embedded aided audiogram (Q1=a).
* Audiologist-logged adaptation scores at each follow-up (Q4=b).

Roles (Q5 confirmed):
  - create / update / append-visit / attach aided-audiogram:
      audiologist, clinic_owner, super_admin
  - read:
      any authenticated clinic user (front-desk schedulers need visibility)

Branch scoping: same pattern as the rest of the HA module.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import (
    Fitting, FittingCreate, FittingUpdate,
    FittingVisit, FittingVisitCreate,
    AidedAudiogram,
)
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api/ha")


WRITE_ROLES = ("audiologist", "clinic_owner", "super_admin")


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {
        "clinic_id": user["clinic_id"],
        "branch_id": {"$in": user.get("branch_ids") or []},
    }


async def _load_fitting(db, clinic_id: str, fitting_id: str) -> dict:
    row = await db.ha_fittings.find_one(
        {"clinic_id": clinic_id, "fitting_id": fitting_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Fitting not found")
    return row


@router.get("/fittings", response_model=List[Fitting])
async def list_fittings(
    status: Optional[str] = None,
    patient_id: Optional[str] = None,
    audiologist_user_id: Optional[str] = None,
    sale_no: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    if audiologist_user_id:
        q["audiologist_user_id"] = audiologist_user_id
    if sale_no:
        q["sale_no"] = sale_no
    rows = await db.ha_fittings.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/fittings/{fitting_id}", response_model=Fitting)
async def get_fitting(fitting_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await _load_fitting(db, user["clinic_id"], fitting_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Fitting not in your branch")
    return deserialize_datetime(row)


@router.post("/fittings", response_model=Fitting, status_code=201)
async def create_fitting(
    payload: FittingCreate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    # Branch access check
    if not user_can_see_branch(user, payload.branch_id):
        raise HTTPException(status_code=403, detail="You don't have access to this branch")

    # Patient must exist in the caller's clinic.
    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": payload.patient_id},
        {"_id": 0, "name": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # If a Sale is linked, validate it and inherit serials when not provided.
    serials = [s.model_dump() for s in payload.serials]
    if payload.sale_no:
        sale = await db.ha_sales.find_one(
            {"clinic_id": user["clinic_id"], "sale_no": payload.sale_no},
            {"_id": 0},
        )
        if not sale:
            raise HTTPException(status_code=404, detail=f"Sale {payload.sale_no} not found")
        if sale["patient_id"] != payload.patient_id:
            raise HTTPException(status_code=400, detail="Sale belongs to a different patient")
        if sale["status"] == "cancelled":
            raise HTTPException(status_code=409, detail="Cannot start fitting on a cancelled sale")
        if not serials:
            # Inherit serialised lines from the sale
            for ln in sale.get("lines", []):
                if ln.get("serial_id"):
                    serials.append({"serial_id": ln["serial_id"], "side": ln.get("side") or "single"})

    # Resolve audiologist (default to caller if role is audiologist)
    aud_user_id = payload.audiologist_user_id or user["user_id"]
    aud = await db.users.find_one(
        {"clinic_id": user["clinic_id"], "user_id": aud_user_id},
        {"_id": 0, "name": 1, "role": 1},
    )
    if not aud:
        raise HTTPException(status_code=404, detail="Audiologist user not found")
    if aud.get("role") not in ("audiologist", "clinic_owner", "super_admin"):
        raise HTTPException(status_code=400, detail="Selected user is not an audiologist")

    now_iso = datetime.now(timezone.utc).isoformat()
    fitting = Fitting(
        clinic_id=user["clinic_id"],
        branch_id=payload.branch_id,
        patient_id=payload.patient_id,
        patient_name=patient.get("name"),
        audiologist_user_id=aud_user_id,
        audiologist_name=aud.get("name"),
        sale_no=payload.sale_no,
        quote_no=payload.quote_no,
        serials=serials,
        status="active",
        first_fit_at=now_iso,
        notes=payload.notes,
        created_by_user_id=user["user_id"],
        updated_at=now_iso,
    )
    doc = serialize_datetime(fitting.model_dump())
    await db.ha_fittings.insert_one(doc)
    doc.pop("_id", None)
    return deserialize_datetime(doc)


@router.put("/fittings/{fitting_id}", response_model=Fitting)
async def update_fitting(
    fitting_id: str,
    payload: FittingUpdate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await _load_fitting(db, user["clinic_id"], fitting_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Fitting not in your branch")

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.status is not None:
        if row["status"] == "completed" and payload.status != "completed":
            raise HTTPException(status_code=409, detail="Completed fittings cannot be reopened")
        if row["status"] == "cancelled" and payload.status != "cancelled":
            raise HTTPException(status_code=409, detail="Cancelled fittings cannot change status")
        updates["status"] = payload.status
        if payload.status == "completed":
            updates["completed_at"] = payload.completed_at or updates["updated_at"]
    if payload.notes is not None:
        updates["notes"] = payload.notes
    if payload.completed_at is not None and "completed_at" not in updates:
        updates["completed_at"] = payload.completed_at

    await db.ha_fittings.update_one(
        {"clinic_id": user["clinic_id"], "fitting_id": fitting_id},
        {"$set": updates},
    )
    return deserialize_datetime({**row, **updates})


@router.post("/fittings/{fitting_id}/visits", response_model=Fitting)
async def append_visit(
    fitting_id: str,
    payload: FittingVisitCreate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await _load_fitting(db, user["clinic_id"], fitting_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Fitting not in your branch")
    if row["status"] != "active":
        raise HTTPException(status_code=409, detail=f"Cannot append visit to {row['status']} fitting")

    if payload.comfort_score is not None and not (1 <= payload.comfort_score <= 5):
        raise HTTPException(status_code=400, detail="comfort_score must be between 1 and 5")
    if payload.wear_hours_per_day is not None and not (0 <= payload.wear_hours_per_day <= 24):
        raise HTTPException(status_code=400, detail="wear_hours_per_day must be 0..24")

    visit = FittingVisit(
        kind=payload.kind,
        at=datetime.now(timezone.utc).isoformat(),
        actor_user_id=user["user_id"],
        actor_name=user.get("name") or user.get("email"),
        notes=payload.notes,
        adjustments=payload.adjustments,
        wear_hours_per_day=payload.wear_hours_per_day,
        comfort_score=payload.comfort_score,
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.ha_fittings.update_one(
        {"clinic_id": user["clinic_id"], "fitting_id": fitting_id},
        {
            "$push": {"visits": serialize_datetime(visit.model_dump())},
            "$set": {"updated_at": now_iso},
        },
    )
    updated = await _load_fitting(db, user["clinic_id"], fitting_id)
    return deserialize_datetime(updated)


@router.put("/fittings/{fitting_id}/aided-audiogram", response_model=Fitting)
async def set_aided_audiogram(
    fitting_id: str,
    payload: AidedAudiogram,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await _load_fitting(db, user["clinic_id"], fitting_id)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Fitting not in your branch")
    if row["status"] == "cancelled":
        raise HTTPException(status_code=409, detail="Cannot edit a cancelled fitting")

    now_iso = datetime.now(timezone.utc).isoformat()
    audio = payload.model_dump()
    audio["measured_at"] = audio.get("measured_at") or now_iso
    await db.ha_fittings.update_one(
        {"clinic_id": user["clinic_id"], "fitting_id": fitting_id},
        {"$set": {"aided_audiogram": audio, "updated_at": now_iso}},
    )
    updated = await _load_fitting(db, user["clinic_id"], fitting_id)
    return deserialize_datetime(updated)


# ==================== M02 ↔ HA BRIDGE ====================

@router.get("/fittings-candidates/{patient_id}")
async def fitting_candidates(
    patient_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Return open Sales + last PTA for a patient so the UI can offer
    a 'Start Fitting' action pre-filled with the right serials / thresholds.

    * open_sales: Sales in (reserved / invoiced / paid) without a linked active fitting.
    * last_pta: most recent PTA test_session (right/left thresholds dict).
    """
    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": patient_id}, {"_id": 0, "name": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    sale_q = _branch_scope(user).copy()
    sale_q["patient_id"] = patient_id
    sale_q["status"] = {"$in": ["reserved", "invoiced", "paid"]}
    sales = await db.ha_sales.find(sale_q, {"_id": 0}).sort("created_at", -1).to_list(20)

    # Already-covered sales — exclude those with an active fitting.
    if sales:
        sale_nos = [s["sale_no"] for s in sales]
        used = await db.ha_fittings.distinct(
            "sale_no",
            {"clinic_id": user["clinic_id"], "status": "active", "sale_no": {"$in": sale_nos}},
        )
        sales = [s for s in sales if s["sale_no"] not in set(used)]

    # Last PTA
    last_pta = await db.test_sessions.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": patient_id},
        {"_id": 0, "session_id": 1, "test_date": 1,
         "right_ear_audiogram": 1, "left_ear_audiogram": 1,
         "right_ear_degree": 1, "left_ear_degree": 1},
        sort=[("test_date", -1)],
    )

    return {
        "patient": {"patient_id": patient_id, "name": patient.get("name")},
        "open_sales": [deserialize_datetime(s) for s in sales],
        "last_pta": deserialize_datetime(last_pta) if last_pta else None,
    }
