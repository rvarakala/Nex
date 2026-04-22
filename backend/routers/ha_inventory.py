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
    helper validates legality and writes the audit row."""
    to_state = payload.get("to_state")
    note = payload.get("note")
    if not to_state:
        raise HTTPException(status_code=400, detail="to_state is required")
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
