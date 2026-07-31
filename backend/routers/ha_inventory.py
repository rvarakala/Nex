"""HA Inventory — SerialItem list / lifecycle timeline + AccessoryStock — Phase 2.

Serialised inventory (HA units): browse by branch / state / pool / brand / search by serial_no.
Lifecycle timeline: append-only `serial_events` rows from `transition_serial()`.
Accessory stock: qty-tracked, consume / replenish via +/- delta.
"""
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import (
    SerialItem, SerialItemUpdate,
    AccessoryStock, AccessoryAdjust,
)
from utils.ha_states import transition_serial
from utils.serde import serialize_datetime, deserialize_datetime

router = APIRouter(prefix="/api/ha")


def _branch_scope(user: dict) -> dict:
    """Return a Mongo filter fragment that restricts to branches this user can see."""
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {
        "clinic_id": user["clinic_id"],
        "branch_id": {"$in": user.get("branch_ids") or []},
    }


# ==================== SERIAL ITEMS ====================

@router.get("/serial-items", response_model=List[SerialItem])
async def list_serial_items(
    branch_id: Optional[str] = None,
    state: Optional[str] = None,
    pool: Optional[str] = None,
    product_id: Optional[str] = None,
    current_patient_id: Optional[str] = None,
    source_kind: Optional[str] = None,          # "vendor" | "borrowed"
    only_active: bool = False,                  # drop returned/retired rows
    search: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if branch_id:
        if not user_can_see_branch(user, branch_id):
            raise HTTPException(status_code=403, detail="Branch access denied")
        q["branch_id"] = branch_id
    if state:
        q["state"] = state
    if pool:
        q["pool"] = pool
    if product_id:
        q["product_id"] = product_id
    if current_patient_id:
        q["current_patient_id"] = current_patient_id
    if source_kind in ("vendor", "borrowed"):
        # Legacy rows (created before source_kind existed) don't have the
        # field at all — they should be treated as vendor by default.
        if source_kind == "vendor":
            q["$or"] = [{"source_kind": "vendor"}, {"source_kind": {"$exists": False}}]
        else:
            q["source_kind"] = "borrowed"
    if only_active:
        q["state"] = {"$nin": ["RETIRED", "RETURNED", "SOLD", "DAMAGED"]}
    if search:
        safe = re.escape(search.strip())
        if safe:
            q["serial_no"] = {"$regex": safe, "$options": "i"}
    rows = await db.serial_items.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/serial-items/by-branch-summary")
async def serial_items_summary(
    branch_id: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Count of serial items by (state, pool) for the Inventory Board KPI strip."""
    match = _branch_scope(user)
    if branch_id:
        if not user_can_see_branch(user, branch_id):
            raise HTTPException(status_code=403, detail="Branch access denied")
        match["branch_id"] = branch_id
    pipeline = [
        {"$match": match},
        {"$group": {"_id": {"state": "$state", "pool": "$pool"}, "n": {"$sum": 1}}},
    ]
    by_state: dict[str, int] = {}
    by_pool: dict[str, int] = {}
    total = 0
    async for row in db.serial_items.aggregate(pipeline):
        state, pool, n = row["_id"]["state"], row["_id"]["pool"], row["n"]
        by_state[state] = by_state.get(state, 0) + n
        by_pool[pool] = by_pool.get(pool, 0) + n
        total += n
    return {"total": total, "by_state": by_state, "by_pool": by_pool}


@router.get("/serial-items/{serial_id}", response_model=SerialItem)
async def get_serial_item(serial_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await db.serial_items.find_one(
        {"serial_id": serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Serial item not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    return deserialize_datetime(row)


@router.get("/serial-items/{serial_id}/timeline")
async def serial_timeline(serial_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    """Append-only lifecycle ledger for a single serial item (UC-HA03)."""
    si = await db.serial_items.find_one(
        {"serial_id": serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not si:
        raise HTTPException(status_code=404, detail="Serial item not found")
    if not user_can_see_branch(user, si["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    events = await db.serial_events.find(
        {"serial_id": serial_id}, {"_id": 0},
    ).sort("at", -1).to_list(500)
    return {"serial": deserialize_datetime(si), "events": events}


@router.put("/serial-items/{serial_id}", response_model=SerialItem)
async def update_serial_item(
    serial_id: str, payload: SerialItemUpdate,
    user=Depends(require_roles("inventory_manager", "clinic_owner")),
    db=Depends(get_db),
):
    """Edit non-state fields (pool, notes). State changes must go through the
    dedicated transition endpoint below."""
    existing = await db.serial_items.find_one(
        {"serial_id": serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Serial item not found")
    if not user_can_see_branch(user, existing["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        return deserialize_datetime(existing)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.serial_items.update_one({"serial_id": serial_id}, {"$set": update})
    row = await db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
    return deserialize_datetime(row)


@router.post("/serial-items/{serial_id}/transition")
async def transition_serial_state(
    serial_id: str, payload: dict,
    user=Depends(require_roles("inventory_manager", "clinic_owner", "front_desk", "audiologist")),
    db=Depends(get_db),
):
    """Explicit state transition. Body: {to_state, note?}. The state-machine
    helper validates legality and writes the audit row.

    Destructive / terminal transitions (DAMAGED, RETIRED, RETURNED) require
    inventory_manager or above — front-desk/audiologist can do clinical flow
    (RESERVED/TRIAL_OUT/SOLD/SERVICE_IN) but cannot scrap a unit."""
    to_state = payload.get("to_state")
    note = payload.get("note")
    if not to_state:
        raise HTTPException(status_code=400, detail="to_state is required")

    # Stricter role gate: destructive terminals need inventory/owner rights.
    DESTRUCTIVE = {"DAMAGED", "RETIRED", "RETURNED"}
    if to_state in DESTRUCTIVE and user["role"] not in {
        "super_admin", "clinic_owner", "inventory_manager", "technician",
    }:
        raise HTTPException(
            status_code=403,
            detail=f"Role {user['role']} cannot move a unit to {to_state}",
        )

    existing = await db.serial_items.find_one(
        {"serial_id": serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Serial item not found")
    if not user_can_see_branch(user, existing["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    updated = await transition_serial(
        db, serial_id, to_state,
        actor_user_id=user["user_id"],
        ref_doc={"kind": "manual", "note": note} if note else {"kind": "manual"},
        note=note,
    )
    return updated


@router.post("/serial-items/{serial_id}/mark-demo")
async def mark_serial_demo(
    serial_id: str, payload: dict | None = None,
    user=Depends(require_roles("clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    """Move a saleable unit into the DEMO pool (state stays IN_STOCK).

    Demo units are intended for take-home trials and clinic demos — they
    should never be sold. Only owners/inventory managers can flip the pool
    to prevent accidental saleable → demo cross-contamination.
    """
    row = await db.serial_items.find_one(
        {"serial_id": serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Serial item not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if row.get("pool") == "demo":
        return deserialize_datetime(row)
    if row["state"] not in ("IN_STOCK", "RESERVED"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot mark demo — unit is currently {row['state']}",
        )
    note = (payload or {}).get("note") if payload else None
    now = datetime.now(timezone.utc).isoformat()
    await db.serial_items.update_one(
        {"serial_id": serial_id},
        {"$set": {"pool": "demo", "updated_at": now}},
    )
    await db.serial_events.insert_one({
        "serial_id": serial_id,
        "from": row["state"], "to": row["state"],  # pool-only change
        "at": now, "actor_user_id": user["user_id"],
        "ref_doc": {"kind": "pool-change", "to_pool": "demo"},
        "note": note or "Moved to demo pool",
    })
    updated = await db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
    return deserialize_datetime(updated)


@router.post("/serial-items/{serial_id}/unmark-demo")
async def unmark_serial_demo(
    serial_id: str, payload: dict | None = None,
    user=Depends(require_roles("clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    """Return a demo unit to the saleable pool (e.g. to sell a demo at a
    discount, or retire from the demo pool)."""
    row = await db.serial_items.find_one(
        {"serial_id": serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Serial item not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if row.get("pool") != "demo":
        raise HTTPException(status_code=409, detail="Unit is not in demo pool")
    if row["state"] != "IN_STOCK":
        raise HTTPException(
            status_code=409,
            detail=f"Return the unit to stock first (currently {row['state']})",
        )
    now = datetime.now(timezone.utc).isoformat()
    await db.serial_items.update_one(
        {"serial_id": serial_id},
        {"$set": {"pool": "saleable", "updated_at": now}},
    )
    note = (payload or {}).get("note") if payload else None
    await db.serial_events.insert_one({
        "serial_id": serial_id,
        "from": row["state"], "to": row["state"],
        "at": now, "actor_user_id": user["user_id"],
        "ref_doc": {"kind": "pool-change", "to_pool": "saleable"},
        "note": note or "Removed from demo pool",
    })
    updated = await db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
    return deserialize_datetime(updated)


@router.get("/demo-stock")
async def list_demo_stock(
    branch_id: Optional[str] = None,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Demo units only — both IN_STOCK (available for trial) and TRIAL_OUT
    (currently with a patient). Used by the Demo Stock tab."""
    q = _branch_scope(user)
    q["pool"] = "demo"
    if branch_id:
        if not user_can_see_branch(user, branch_id):
            raise HTTPException(status_code=403, detail="Branch access denied")
        q["branch_id"] = branch_id
    rows = await db.serial_items.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

    # Hydrate product + patient names for the UI.
    product_ids = list({r["product_id"] for r in rows if r.get("product_id")})
    pmap: dict = {}
    if product_ids:
        async for p in db.ha_products.find(
            {"clinic_id": user["clinic_id"], "product_id": {"$in": product_ids}},
            {"_id": 0, "product_id": 1, "brand": 1, "model": 1, "form_factor": 1},
        ):
            pmap[p["product_id"]] = p
    patient_ids = list({r["current_patient_id"] for r in rows if r.get("current_patient_id")})
    patmap: dict = {}
    if patient_ids:
        async for pt in db.patients.find(
            {"clinic_id": user["clinic_id"], "patient_id": {"$in": patient_ids}},
            {"_id": 0, "patient_id": 1, "name": 1, "mrd": 1, "mobile": 1},
        ):
            patmap[pt["patient_id"]] = pt

    out = []
    for r in rows:
        r = deserialize_datetime(r)
        r["product"] = pmap.get(r.get("product_id"))
        r["current_patient"] = patmap.get(r.get("current_patient_id"))
        out.append(r)
    return out


# ==================== SALEABLE STOCK (Phase B) ====================

@router.get("/saleable-stock")
async def list_saleable_stock(
    branch_id: Optional[str] = None,
    source_kind: Optional[str] = None,   # "vendor" | "borrowed" | None (all)
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Saleable pool — every unit that could be sold to a patient.
    Excludes demo pool and lifecycle-terminated states (SOLD / RETIRED /
    RETURNED). Rows come hydrated with product + optional borrow-source
    context so the UI can render source badges without a second call.
    """
    q = _branch_scope(user)
    q["pool"] = "saleable"
    q["state"] = {"$nin": ["SOLD", "RETIRED", "RETURNED", "DAMAGED"]}
    if branch_id:
        if not user_can_see_branch(user, branch_id):
            raise HTTPException(status_code=403, detail="Branch access denied")
        q["branch_id"] = branch_id
    if source_kind in ("vendor", "borrowed"):
        if source_kind == "vendor":
            q["$or"] = [{"source_kind": "vendor"}, {"source_kind": {"$exists": False}}]
        else:
            q["source_kind"] = "borrowed"
    rows = await db.serial_items.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

    product_ids = list({r["product_id"] for r in rows if r.get("product_id")})
    pmap: dict = {}
    if product_ids:
        async for p in db.ha_products.find(
            {"clinic_id": user["clinic_id"], "product_id": {"$in": product_ids}},
            {"_id": 0, "product_id": 1, "brand": 1, "model": 1,
             "form_factor": 1, "sale_unit": 1, "mrp": 1, "min_sell_price": 1},
        ):
            pmap[p["product_id"]] = p

    # KPI strip totals
    total = len(rows)
    available = sum(1 for r in rows if r.get("state") == "IN_STOCK")
    on_trial = sum(1 for r in rows if r.get("state") == "TRIAL_OUT")
    reserved = sum(1 for r in rows if r.get("state") == "RESERVED")
    borrowed = sum(1 for r in rows if r.get("source_kind") == "borrowed")

    out = []
    for r in rows:
        r = deserialize_datetime(r)
        r["product"] = pmap.get(r.get("product_id"))
        out.append(r)
    return {
        "totals": {
            "total": total, "available": available, "on_trial": on_trial,
            "reserved": reserved, "borrowed_still_here": borrowed,
        },
        "items": out,
    }


@router.post("/serial-items/{serial_id}/return-borrow")
async def return_borrowed_unit(
    serial_id: str,
    payload: Optional[dict] = None,
    user=Depends(require_roles("clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    """Hand a borrowed unit back to the source clinic. The row stays in
    the DB (so history + audit remain) but its state flips to RETURNED
    and it drops off active stock lists.
    """
    row = await db.serial_items.find_one(
        {"serial_id": serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Unit not found")
    if not user_can_see_branch(user, row.get("branch_id")):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if row.get("source_kind") != "borrowed":
        raise HTTPException(status_code=409, detail="Only borrowed units can be returned to source")
    if row.get("state") in ("SOLD", "RETIRED", "RETURNED"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot return — unit is {row['state']}",
        )
    now = datetime.now(timezone.utc).isoformat()
    note = ((payload or {}).get("note") or "").strip() or "Returned to source clinic"
    await db.serial_items.update_one(
        {"serial_id": serial_id},
        {"$set": {
            "state": "RETURNED",
            "returned_at": now,
            "return_note": note,
            "updated_at": now,
        }},
    )
    await db.serial_events.insert_one({
        "serial_id": serial_id,
        "from": row["state"], "to": "RETURNED",
        "at": now, "actor_user_id": user["user_id"],
        "ref_doc": {"kind": "return-to-source",
                    "borrowed_from": row.get("borrowed_from")},
        "note": note,
    })
    updated = await db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
    return deserialize_datetime(updated)


@router.get("/borrowed-attention")
async def borrowed_needs_attention(
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Fuel for the Main Dashboard "Needs Attention" widget — count and
    top-5 preview of borrowed units still sitting in this clinic (i.e.
    not yet returned to source).
    """
    q = _branch_scope(user)
    q["source_kind"] = "borrowed"
    q["state"] = {"$nin": ["RETURNED", "RETIRED"]}
    rows = await db.serial_items.find(
        q, {"_id": 0, "serial_id": 1, "serial_no": 1, "product_id": 1,
            "borrowed_from": 1, "borrow_reason": 1, "borrowed_at": 1, "state": 1},
    ).sort("borrowed_at", 1).to_list(200)

    # Hydrate the top 5 with brand/model for the widget preview.
    top = rows[:5]
    product_ids = list({r.get("product_id") for r in top if r.get("product_id")})
    pmap: dict = {}
    if product_ids:
        async for p in db.ha_products.find(
            {"clinic_id": user["clinic_id"], "product_id": {"$in": product_ids}},
            {"_id": 0, "product_id": 1, "brand": 1, "model": 1},
        ):
            pmap[p["product_id"]] = p
    for r in top:
        r["product"] = pmap.get(r.get("product_id"))

    return {"count": len(rows), "top": top}


# ==================== ACCESSORY STOCK ====================

@router.get("/accessory-stock", response_model=List[AccessoryStock])
async def list_accessory_stock(
    branch_id: Optional[str] = None,
    product_id: Optional[str] = None,
    low_stock_only: bool = False,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if branch_id:
        if not user_can_see_branch(user, branch_id):
            raise HTTPException(status_code=403, detail="Branch access denied")
        q["branch_id"] = branch_id
    if product_id:
        q["product_id"] = product_id
    if low_stock_only:
        q["$expr"] = {"$lte": ["$qty_on_hand", "$reorder_level"]}
    rows = await db.accessory_stock.find(q, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return [deserialize_datetime(r) for r in rows]


@router.post("/accessory-stock/{sku_id}/adjust")
async def adjust_accessory_stock(
    sku_id: str, payload: AccessoryAdjust,
    user=Depends(require_roles("inventory_manager", "clinic_owner")),
    db=Depends(get_db),
):
    """Manual qty adjust. Writes to `accessory_events` for audit.
    Rejects if delta would drive qty below zero."""
    sku = await db.accessory_stock.find_one(
        {"sku_id": sku_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not sku:
        raise HTTPException(status_code=404, detail="Accessory SKU not found")
    if not user_can_see_branch(user, sku["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    new_qty = int(sku.get("qty_on_hand", 0)) + int(payload.delta)
    if new_qty < 0:
        raise HTTPException(status_code=409, detail="Adjustment would drive qty below zero")
    now = datetime.now(timezone.utc).isoformat()
    await db.accessory_stock.update_one(
        {"sku_id": sku_id},
        {"$set": {"qty_on_hand": new_qty, "updated_at": now}},
    )
    await db.accessory_events.insert_one({
        "sku_id": sku_id,
        "delta": payload.delta,
        "reason": payload.reason,
        "at": now,
        "actor_user_id": user["user_id"],
        "before": sku.get("qty_on_hand", 0),
        "after": new_qty,
    })
    return {"sku_id": sku_id, "qty_on_hand": new_qty}
