"""HA Product Catalogue CRUD — Phase 2.

Products are catalogue SKUs shared across a clinic's branches. Per-branch
stock lives on SerialItem (serialised) and AccessoryStock (qty-tracked).

Role gates:
- read: any authenticated user in the clinic
- write: inventory_manager or clinic_owner (super_admin always)
"""
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, require_roles
from database import get_db
from models_ha import Product, ProductCreate
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
