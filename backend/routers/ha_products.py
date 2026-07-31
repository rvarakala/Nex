"""HA Product Catalogue CRUD — Phase 2.

Products are catalogue SKUs shared across a clinic's branches. Per-branch
stock lives on SerialItem (serialised) and AccessoryStock (qty-tracked).

Role gates:
- read: any authenticated user in the clinic
- write: inventory_manager or clinic_owner (super_admin always)
"""
import re
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_roles, user_can_see_branch
from database import get_db
from models_ha import Product, ProductCreate, SerialItem
from utils.serde import serialize_datetime, deserialize_datetime

router = APIRouter(prefix="/api/ha")


@router.get("/products", response_model=List[Product])
async def list_products(
    search: Optional[str] = None,
    brand: Optional[str] = None,
    form_factor: Optional[str] = None,
    tech_tier: Optional[str] = None,
    is_serialised: Optional[bool] = None,
    active: Optional[bool] = None,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q: dict = {"clinic_id": user["clinic_id"]}
    if active is not None:
        q["active"] = active
    if brand:
        q["brand"] = brand
    if form_factor:
        q["form_factor"] = form_factor
    if tech_tier:
        q["tech_tier"] = tech_tier
    if is_serialised is not None:
        q["is_serialised"] = is_serialised
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            q["$or"] = [{"brand": rx}, {"model": rx}]
    rows = await db.ha_products.find(q, {"_id": 0}).sort("brand", 1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.post("/products", response_model=Product)
async def create_product(
    payload: ProductCreate,
    user=Depends(require_roles("clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    obj = Product(clinic_id=user["clinic_id"], **payload.model_dump())
    await db.ha_products.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await db.ha_products.find_one(
        {"product_id": product_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return deserialize_datetime(row)


@router.put("/products/{product_id}", response_model=Product)
async def update_product(
    product_id: str, payload: ProductCreate,
    user=Depends(require_roles("clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    existing = await db.ha_products.find_one(
        {"product_id": product_id, "clinic_id": user["clinic_id"]},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    data = payload.model_dump()
    data["updated_at"] = datetime.utcnow()
    await db.ha_products.update_one(
        {"product_id": product_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(data)},
    )
    row = await db.ha_products.find_one({"product_id": product_id}, {"_id": 0})
    return deserialize_datetime(row)


@router.delete("/products/{product_id}")
async def deactivate_product(
    product_id: str,
    user=Depends(require_roles("clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    """Soft-delete: preserves PO / serial history."""
    res = await db.ha_products.update_one(
        {"product_id": product_id, "clinic_id": user["clinic_id"]},
        {"$set": {"active": False, "updated_at": datetime.utcnow().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"message": "Deactivated", "product_id": product_id}


# ==================== INLINE SERIAL-NUMBER ADD ====================

class SerialAddIn(BaseModel):
    """Quick-add entry used by the Catalogue form's 'Serial Numbers' section.

    One row per physical unit. All fields other than `serial_no` and `branch_id`
    are optional — the inventory manager can back-fill later.
    """
    serial_no: str
    branch_id: str
    pool: Literal["saleable", "demo", "loaner", "refurbished"] = "saleable"
    warranty_end_date: Optional[str] = None
    grn_no: Optional[str] = None
    # Provenance — when a unit is borrowed from another clinic we MUST
    # capture where it came from + why, so the owner has a clean audit
    # trail and the "Needs Attention" widget can nudge front desk to
    # return it. `source_kind="vendor"` is the default and doesn't need
    # the borrow fields.
    source_kind: Literal["vendor", "borrowed"] = "vendor"
    borrowed_from: Optional[str] = None
    borrow_reason: Optional[str] = None


@router.post("/products/{product_id}/serials")
async def add_serials_to_product(
    product_id: str, payload: List[SerialAddIn],
    user=Depends(require_roles("clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    """Quick-add one or many physical units for this product. Each row creates
    a `serial_items` doc in state IN_STOCK. Duplicates (by `serial_no` within
    the clinic) are rejected — manufacturer stickers are globally unique.
    """
    product = await db.ha_products.find_one(
        {"product_id": product_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.get("is_serialised", True):
        raise HTTPException(status_code=400,
                            detail="This product is not serialised (accessories/batteries)")
    if not payload:
        return {"inserted": 0, "serials": []}

    # Validate branches + check duplicate serial numbers (per-clinic uniqueness).
    serial_nos = [p.serial_no.strip() for p in payload if p.serial_no.strip()]
    if len(set(serial_nos)) != len(serial_nos):
        raise HTTPException(status_code=400, detail="Duplicate serial_no in request body")
    existing = await db.serial_items.find(
        {"clinic_id": user["clinic_id"], "serial_no": {"$in": serial_nos}},
        {"_id": 0, "serial_no": 1},
    ).to_list(len(serial_nos))
    if existing:
        dupes = sorted(e["serial_no"] for e in existing)
        raise HTTPException(
            status_code=409,
            detail=f"Serial number(s) already exist in this clinic: {dupes}",
        )

    for p in payload:
        if not user_can_see_branch(user, p.branch_id):
            raise HTTPException(
                status_code=403, detail=f"Branch {p.branch_id} not in your access")

    now_iso = datetime.now(timezone.utc).isoformat()
    docs = []
    created: List[dict] = []
    for p in payload:
        # Borrowed units MUST identify the source clinic so the "Needs
        # Attention" widget on the main dashboard has something to show.
        # Reason is optional but strongly recommended for the audit trail.
        if p.source_kind == "borrowed" and not (p.borrowed_from or "").strip():
            raise HTTPException(
                status_code=400,
                detail="Borrowed units must have 'borrowed_from' set (source clinic name).",
            )
        si = SerialItem(
            clinic_id=user["clinic_id"],
            branch_id=p.branch_id,
            product_id=product_id,
            serial_no=p.serial_no.strip(),
            state="IN_STOCK",
            pool=p.pool,
            warranty_end_date=p.warranty_end_date,
            grn_no=p.grn_no,
            source_kind=p.source_kind,
            borrowed_from=(p.borrowed_from or "").strip() or None,
            borrow_reason=(p.borrow_reason or "").strip() or None,
            borrowed_at=now_iso if p.source_kind == "borrowed" else None,
            updated_at=now_iso,
        )
        docs.append(serialize_datetime(si.model_dump()))
        created.append(si.model_dump())
    await db.serial_items.insert_many(docs, ordered=True)

    # Audit trail — one event per insert.
    events = [{
        "serial_id": d["serial_id"],
        "from": None, "to": "IN_STOCK",
        "at": now_iso, "actor_user_id": user["user_id"],
        "ref_doc": {"kind": "catalogue-quick-add", "id": product_id},
        "note": f"Added via Catalogue form ({d.get('pool', 'saleable')})",
    } for d in docs]
    if events:
        await db.serial_events.insert_many(events, ordered=True)

    return {"inserted": len(created), "serials": [deserialize_datetime(s) for s in created]}


@router.get("/products/{product_id}/serials")
async def list_product_serials(
    product_id: str,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """List existing physical units for a product (tenant-scoped).
    Used by the Catalogue form to show what's already on file."""
    product = await db.ha_products.find_one(
        {"product_id": product_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    rows = await db.serial_items.find(
        {"clinic_id": user["clinic_id"], "product_id": product_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return [deserialize_datetime(r) for r in rows]
