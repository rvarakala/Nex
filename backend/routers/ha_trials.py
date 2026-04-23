"""HA Trials — Phase 4.5 (catch-up from the original 7-phase plan).

A Trial is a take-home loan of one or more HA serial units to a patient.
* Create: moves each serial IN_STOCK → TRIAL_OUT.
* Extend: pushes the return_date forward, flips status to 'extended'.
* Return: moves serials TRIAL_OUT → IN_STOCK, trial 'returned'.
* Convert: mints a Sale, serials TRIAL_OUT → SOLD (direct path, skipping RESERVED).
* Lost: serials TRIAL_OUT → DAMAGED (clinic absorbs the loss).

Roles:
- create: front_desk / audiologist / clinic_owner / super_admin
- extend / convert / return / lost: audiologist / clinic_owner / super_admin
- read: any authenticated clinic user
"""
from datetime import datetime, timezone, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import (
    Trial, TrialCreate, TrialExtend, TrialReturn, TrialConvert,
    Sale, SaleLine,
)
from utils.ha_states import transition_serial
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api/ha")

CREATE_ROLES = ("front_desk", "audiologist", "clinic_owner", "super_admin")
MUTATE_ROLES = ("audiologist", "clinic_owner", "super_admin")


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {
        "clinic_id": user["clinic_id"],
        "branch_id": {"$in": user.get("branch_ids") or []},
    }


def _today_ymd() -> str:
    return date.today().isoformat()


def _parse_ymd(s: str, field: str) -> date:
    try:
        return date.fromisoformat(s)
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD")


async def _load_trial(db, clinic_id: str, trial_no: str) -> dict:
    row = await db.ha_trials.find_one(
        {"clinic_id": clinic_id, "trial_no": trial_no}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Trial not found")
    return row


# ==================== LIST / GET ====================

@router.get("/trials", response_model=List[Trial])
async def list_trials(
    status: Optional[str] = None,
    patient_id: Optional[str] = None,
    serial_id: Optional[str] = None,
    overdue: Optional[bool] = None,
    limit: int = 100,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    if serial_id:
        q["serials.serial_id"] = serial_id
    if overdue:
        q["status"] = {"$in": ["active", "extended"]}
        q["return_date"] = {"$lt": _today_ymd()}
    rows = await db.ha_trials.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/trials/{trial_no}", response_model=Trial)
async def get_trial(trial_no: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await _load_trial(db, user["clinic_id"], trial_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trial not in your branch")
    return deserialize_datetime(row)


# ==================== CREATE ====================

@router.post("/trials", response_model=Trial, status_code=201)
async def create_trial(
    payload: TrialCreate,
    user=Depends(require_roles(*CREATE_ROLES)),
    db=Depends(get_db),
):
    if not user_can_see_branch(user, payload.branch_id):
        raise HTTPException(status_code=403, detail="You don't have access to this branch")
    if not payload.serials:
        raise HTTPException(status_code=400, detail="At least one serial is required")

    # Validate dates
    start = _parse_ymd(payload.start_date, "start_date") if payload.start_date else date.today()
    ret = _parse_ymd(payload.return_date, "return_date")
    if ret < start:
        raise HTTPException(status_code=400, detail="return_date must be on/after start_date")

    # Patient
    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": payload.patient_id},
        {"_id": 0, "name": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Audiologist
    aud_user_id = payload.audiologist_user_id or user["user_id"]
    aud = await db.users.find_one(
        {"clinic_id": user["clinic_id"], "user_id": aud_user_id},
        {"_id": 0, "name": 1, "role": 1},
    )
    if not aud:
        raise HTTPException(status_code=404, detail="Audiologist user not found")

    # Validate every serial — must exist in clinic, IN_STOCK, accessible branch.
    serial_ids = [s.serial_id for s in payload.serials]
    if len(set(serial_ids)) != len(serial_ids):
        raise HTTPException(status_code=400, detail="Duplicate serial in trial request")

    rows = await db.serial_items.find(
        {"serial_id": {"$in": serial_ids}, "clinic_id": user["clinic_id"]}, {"_id": 0},
    ).to_list(len(serial_ids))
    by_id = {r["serial_id"]: r for r in rows}
    missing = set(serial_ids) - set(by_id)
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown serials: {sorted(missing)}")

    for sid, s in by_id.items():
        if s["state"] != "IN_STOCK":
            raise HTTPException(status_code=409,
                                detail=f"Serial {s['serial_no']} is {s['state']}, cannot trial")
        if not user_can_see_branch(user, s["branch_id"]):
            raise HTTPException(status_code=403,
                                detail=f"Serial {s['serial_no']} is in another branch")

    # Operational guard-rail (requested Apr 2026): trials must use DEMO units.
    # If the caller picks a saleable / non-demo unit, the audiologist must
    # declare WHERE the instrument came from via `notes` (manufacturer loan,
    # colleague, repaired unit back on shelf, etc.).
    non_demo = [s for s in by_id.values() if (s.get("pool") or "saleable") != "demo"]
    if non_demo and not (payload.notes and payload.notes.strip()):
        external_list = ", ".join(sorted(s["serial_no"] for s in non_demo))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Demo pool is empty for serial(s) {external_list}. "
                "Enter the instrument source in Notes (e.g. 'loaner from Phonak rep', "
                "'colleague-branch Hyderabad') before issuing the trial."
            ),
        )

    trial_no = await next_number(db, "trial", user["clinic_id"])
    now_iso = datetime.now(timezone.utc).isoformat()

    trial = Trial(
        trial_no=trial_no,
        clinic_id=user["clinic_id"],
        branch_id=payload.branch_id,
        patient_id=payload.patient_id,
        patient_name=patient.get("name"),
        audiologist_user_id=aud_user_id,
        audiologist_name=aud.get("name"),
        serials=payload.serials,
        status="active",
        start_date=start.isoformat(),
        return_date=ret.isoformat(),
        deposit_amount=float(payload.deposit_amount or 0),
        accessories_given=payload.accessories_given,
        condition_photos=payload.condition_photos,
        notes=payload.notes,
        source=("external" if non_demo else "demo"),
        created_by_user_id=user["user_id"],
        updated_at=now_iso,
    )
    await db.ha_trials.insert_one(serialize_datetime(trial.model_dump()))

    # Move every serial IN_STOCK → TRIAL_OUT + stamp current_patient_id.
    for sid in serial_ids:
        await transition_serial(
            db, sid, "TRIAL_OUT",
            actor_user_id=user["user_id"],
            ref_doc={"kind": "trial", "id": trial_no},
            note=f"Trial issued to {patient.get('name') or payload.patient_id}",
        )
        await db.serial_items.update_one(
            {"serial_id": sid},
            {"$set": {"current_patient_id": payload.patient_id}},
        )

    return deserialize_datetime(trial.model_dump())


# ==================== EXTEND ====================

@router.post("/trials/{trial_no}/extend", response_model=Trial)
async def extend_trial(
    trial_no: str, payload: TrialExtend,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    row = await _load_trial(db, user["clinic_id"], trial_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trial not in your branch")
    if row["status"] not in {"active", "extended"}:
        raise HTTPException(status_code=409, detail=f"Cannot extend a {row['status']} trial")

    new_ret = _parse_ymd(payload.return_date, "return_date")
    cur_ret = _parse_ymd(row["return_date"], "return_date")
    if new_ret <= cur_ret:
        raise HTTPException(status_code=400, detail="new return_date must be after current return_date")

    now_iso = datetime.now(timezone.utc).isoformat()
    upd = {
        "status": "extended",
        "return_date": new_ret.isoformat(),
        "updated_at": now_iso,
    }
    if payload.notes:
        upd["notes"] = ((row.get("notes") or "") + f"\n[ext {now_iso[:10]}] {payload.notes}").strip()

    await db.ha_trials.update_one(
        {"clinic_id": user["clinic_id"], "trial_no": trial_no},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


# ==================== RETURN ====================

@router.post("/trials/{trial_no}/return", response_model=Trial)
async def return_trial(
    trial_no: str, payload: TrialReturn,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    row = await _load_trial(db, user["clinic_id"], trial_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trial not in your branch")
    if row["status"] not in {"active", "extended"}:
        raise HTTPException(status_code=409, detail=f"Cannot return a {row['status']} trial")

    actual = _parse_ymd(payload.actual_return_date, "actual_return_date") if payload.actual_return_date else date.today()
    now_iso = datetime.now(timezone.utc).isoformat()

    for s in row.get("serials", []):
        sid = s["serial_id"]
        cur = await db.serial_items.find_one({"serial_id": sid}, {"_id": 0, "state": 1, "serial_no": 1})
        if not cur:
            continue
        if cur["state"] == "TRIAL_OUT":
            await transition_serial(
                db, sid, "IN_STOCK",
                actor_user_id=user["user_id"],
                ref_doc={"kind": "trial", "id": trial_no},
                note=f"Trial {trial_no} returned",
            )
            await db.serial_items.update_one(
                {"serial_id": sid}, {"$set": {"current_patient_id": None}},
            )

    upd = {
        "status": "returned",
        "actual_return_date": actual.isoformat(),
        "closed_at": now_iso,
        "updated_at": now_iso,
    }
    if payload.notes:
        upd["notes"] = ((row.get("notes") or "") + f"\n[ret {actual.isoformat()}] {payload.notes}").strip()

    await db.ha_trials.update_one(
        {"clinic_id": user["clinic_id"], "trial_no": trial_no},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


# ==================== LOST ====================

@router.post("/trials/{trial_no}/lost", response_model=Trial)
async def lost_trial(
    trial_no: str,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    row = await _load_trial(db, user["clinic_id"], trial_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trial not in your branch")
    if row["status"] not in {"active", "extended"}:
        raise HTTPException(status_code=409, detail=f"Cannot mark lost a {row['status']} trial")

    now_iso = datetime.now(timezone.utc).isoformat()
    for s in row.get("serials", []):
        sid = s["serial_id"]
        cur = await db.serial_items.find_one({"serial_id": sid}, {"_id": 0, "state": 1})
        if cur and cur["state"] == "TRIAL_OUT":
            await transition_serial(
                db, sid, "DAMAGED",
                actor_user_id=user["user_id"],
                ref_doc={"kind": "trial", "id": trial_no},
                note=f"Trial {trial_no} declared lost/damaged",
            )

    upd = {"status": "lost", "closed_at": now_iso, "updated_at": now_iso}
    await db.ha_trials.update_one(
        {"clinic_id": user["clinic_id"], "trial_no": trial_no},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


# ==================== CONVERT → SALE ====================

@router.post("/trials/{trial_no}/convert", response_model=Sale)
async def convert_trial_to_sale(
    trial_no: str, payload: TrialConvert,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    """Trial → Sale: mints a paid-reservation Sale, serials TRIAL_OUT → SOLD directly."""
    row = await _load_trial(db, user["clinic_id"], trial_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Trial not in your branch")
    if row["status"] not in {"active", "extended"}:
        raise HTTPException(status_code=409, detail=f"Cannot convert a {row['status']} trial")

    serials = row.get("serials", [])
    if len(payload.unit_prices) != len(serials):
        raise HTTPException(
            status_code=400,
            detail=f"unit_prices length ({len(payload.unit_prices)}) must match serials ({len(serials)})",
        )

    # Load serial rows to grab product_id + current state
    serial_ids = [s["serial_id"] for s in serials]
    si_rows = await db.serial_items.find(
        {"serial_id": {"$in": serial_ids}, "clinic_id": user["clinic_id"]}, {"_id": 0},
    ).to_list(len(serial_ids))
    by_id = {r["serial_id"]: r for r in si_rows}

    for sid in serial_ids:
        s = by_id.get(sid)
        if not s:
            raise HTTPException(status_code=400, detail=f"Serial {sid} no longer exists")
        if s["state"] != "TRIAL_OUT":
            raise HTTPException(
                status_code=409,
                detail=f"Serial {s['serial_no']} is {s['state']}, expected TRIAL_OUT",
            )

    # Pull product min_sell_price for margin check
    product_ids = list({by_id[sid]["product_id"] for sid in serial_ids})
    products = {p["product_id"]: p async for p in db.ha_products.find(
        {"product_id": {"$in": product_ids}, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )}

    sale_lines: List[SaleLine] = []
    below_floor: List[int] = []
    sub = disc = gst = 0.0

    for i, s in enumerate(serials):
        sid = s["serial_id"]
        si = by_id[sid]
        p = products.get(si["product_id"])
        unit = float(payload.unit_prices[i])
        d_pct = float(payload.discount_pct or 0)
        g_rate = float(payload.gst_rate or 0)
        net_unit = unit * (1 - d_pct / 100.0)
        if p and p.get("min_sell_price") and net_unit < float(p["min_sell_price"]) - 1e-6:
            below_floor.append(i)

        sale_lines.append(SaleLine(
            product_id=si["product_id"],
            serial_id=sid,
            side=s.get("side") or "single",
            qty=1,
            unit_price=unit,
            discount_pct=d_pct,
            gst_rate=g_rate,
        ))
        gross = round(unit, 2)
        d = round(gross * d_pct / 100.0, 2)
        net = round(gross - d, 2)
        g = round(net * g_rate / 100.0, 2)
        sub += gross; disc += d; gst += g

    # Margin approval gate
    if below_floor and not payload.margin_approval_user_id:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "margin_approval_required",
                "below_floor_line_indexes": below_floor,
                "message": "Unit price below min_sell_price. Provide margin_approval_user_id (clinic_owner / super_admin).",
            },
        )
    if below_floor and payload.margin_approval_user_id:
        approver = await db.users.find_one(
            {"user_id": payload.margin_approval_user_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "role": 1},
        )
        if not approver or approver["role"] not in {"super_admin", "clinic_owner"}:
            raise HTTPException(status_code=403, detail="Margin approver must be clinic_owner or super_admin")

    total = round(sub - disc + gst, 2)
    sale_no = await next_number(db, "sale", user["clinic_id"])
    now_iso = datetime.now(timezone.utc).isoformat()

    sale = Sale(
        sale_no=sale_no,
        clinic_id=user["clinic_id"],
        branch_id=row["branch_id"],
        patient_id=row["patient_id"],
        patient_name=row.get("patient_name"),
        quote_no=None,                                         # trial-origin; no quote
        is_pair=len(serials) == 2,
        lines=sale_lines,
        subtotal=round(sub, 2), discount_amount=round(disc, 2),
        gst_amount=round(gst, 2), total=total,
        status="reserved",
        below_floor_lines=below_floor,
        margin_approval_user_id=payload.margin_approval_user_id,
        margin_approval_at=now_iso if below_floor else None,
        created_by_user_id=user["user_id"],
    )
    await db.ha_sales.insert_one(serialize_datetime(sale.model_dump()))

    # Move serials TRIAL_OUT → SOLD (direct path on conversion).
    for sid in serial_ids:
        await transition_serial(
            db, sid, "SOLD",
            actor_user_id=user["user_id"],
            ref_doc={"kind": "sale", "id": sale_no, "from_trial": trial_no},
            note=f"Trial {trial_no} converted to sale {sale_no}",
        )

    # Flip trial to converted + link sale.
    upd = {
        "status": "converted",
        "converted_sale_no": sale_no,
        "closed_at": now_iso,
        "updated_at": now_iso,
    }
    if payload.notes:
        upd["notes"] = ((row.get("notes") or "") + f"\n[conv {now_iso[:10]}] {payload.notes}").strip()
    await db.ha_trials.update_one(
        {"clinic_id": user["clinic_id"], "trial_no": trial_no},
        {"$set": upd},
    )
    return sale


# ==================== DASHBOARD / OVERDUE ====================

@router.get("/trials-kpis")
async def trials_kpis(user=Depends(get_current_user), db=Depends(get_db)):
    """Returns counts for the Trials dashboard tile."""
    base = _branch_scope(user)
    today = _today_ymd()

    active = await db.ha_trials.count_documents({**base, "status": {"$in": ["active", "extended"]}})
    overdue = await db.ha_trials.count_documents({
        **base, "status": {"$in": ["active", "extended"]}, "return_date": {"$lt": today},
    })
    converted_30d = await db.ha_trials.count_documents({
        **base, "status": "converted",
        "closed_at": {"$gte": datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()[:10]},
    })
    returned_30d = await db.ha_trials.count_documents({**base, "status": "returned"})
    lost = await db.ha_trials.count_documents({**base, "status": "lost"})

    return {
        "active": active, "overdue": overdue,
        "converted": converted_30d, "returned": returned_30d,
        "lost": lost,
    }
