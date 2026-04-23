"""Vendor CRUD — Phase 1 Foundation.

Hearing-aid distributors / accessory suppliers. Scoped per clinic (each
tenant maintains its own price-card relationships).

Read: any authenticated user (needed for PO dropdowns etc.).
Write: inventory_manager + clinic_owner + super_admin only.
"""
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, require_roles
from database import get_db
from models_ha import Vendor, VendorCreate
from utils.serde import serialize_datetime, deserialize_datetime

router = APIRouter(prefix="/api")


@router.get("/vendors", response_model=List[Vendor])
async def list_vendors(search: Optional[str] = None, active: Optional[bool] = None,
                       limit: int = 200,
                       user=Depends(get_current_user), db=Depends(get_db)):
    q: dict = {"clinic_id": user["clinic_id"]}
    if active is not None:
        q["active"] = active
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            q["$or"] = [{"name": rx}, {"contact_person": rx}, {"phone": rx}, {"email": rx}]
    rows = await db.vendors.find(q, {"_id": 0}).sort("name", 1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.post("/vendors", response_model=Vendor)
async def create_vendor(payload: VendorCreate,
                        user=Depends(require_roles("clinic_owner", "inventory_manager")),
                        db=Depends(get_db)):
    obj = Vendor(clinic_id=user["clinic_id"], **payload.model_dump())
    await db.vendors.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@router.get("/vendors/stats")
async def vendors_stats(user=Depends(get_current_user), db=Depends(get_db)):
    """Per-vendor open-PO summary for the Vendors master page.

    "Open" PO = any status other than `closed` or `cancelled`. We return the
    raw PO grand-total (not net-of-received) because finance wants to see the
    liability they've already committed to the vendor — partial receipts are
    reconciled against the invoice via the GRN ledger downstream.
    """
    # Single aggregation — cheap even for hundreds of vendors.
    pipeline = [
        {"$match": {
            "clinic_id": user["clinic_id"],
            "status": {"$nin": ["closed", "cancelled"]},
        }},
        {"$group": {
            "_id": "$vendor_id",
            "open_po_count": {"$sum": 1},
            # `total` is the GST-inclusive grand total set when the PO is created.
            "outstanding_amount": {"$sum": {"$ifNull": ["$total", 0]}},
        }},
    ]
    out: dict = {}
    async for row in db.purchase_orders.aggregate(pipeline):
        out[row["_id"]] = {
            "open_po_count": int(row.get("open_po_count") or 0),
            "outstanding_amount": float(row.get("outstanding_amount") or 0),
        }
    return out


@router.get("/vendors/{vendor_id}", response_model=Vendor)
async def get_vendor(vendor_id: str,
                     user=Depends(get_current_user), db=Depends(get_db)):
    row = await db.vendors.find_one(
        {"vendor_id": vendor_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return deserialize_datetime(row)


@router.put("/vendors/{vendor_id}", response_model=Vendor)
async def update_vendor(vendor_id: str, payload: VendorCreate,
                        user=Depends(require_roles("clinic_owner", "inventory_manager")),
                        db=Depends(get_db)):
    existing = await db.vendors.find_one(
        {"vendor_id": vendor_id, "clinic_id": user["clinic_id"]},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Vendor not found")
    data = payload.model_dump()
    data["updated_at"] = datetime.utcnow()
    await db.vendors.update_one(
        {"vendor_id": vendor_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(data)},
    )
    row = await db.vendors.find_one({"vendor_id": vendor_id}, {"_id": 0})
    return deserialize_datetime(row)


@router.delete("/vendors/{vendor_id}")
async def deactivate_vendor(vendor_id: str,
                            user=Depends(require_roles("clinic_owner", "inventory_manager")),
                            db=Depends(get_db)):
    """Soft-delete — preserves historical PO / GRN references."""
    res = await db.vendors.update_one(
        {"vendor_id": vendor_id, "clinic_id": user["clinic_id"]},
        {"$set": {"active": False, "updated_at": datetime.utcnow().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"message": "Deactivated", "vendor_id": vendor_id}


@router.post("/vendors/{vendor_id}/reactivate", response_model=Vendor)
async def reactivate_vendor(vendor_id: str,
                            user=Depends(require_roles("clinic_owner", "inventory_manager")),
                            db=Depends(get_db)):
    """Restore a soft-deleted vendor so it reappears in PO dropdowns."""
    res = await db.vendors.update_one(
        {"vendor_id": vendor_id, "clinic_id": user["clinic_id"]},
        {"$set": {"active": True, "updated_at": datetime.utcnow().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    row = await db.vendors.find_one({"vendor_id": vendor_id}, {"_id": 0})
    return deserialize_datetime(row)
