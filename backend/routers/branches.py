"""Branch CRUD — Phase 1 Foundation.

A Clinic may have many Branches. Users see branches scoped by `user.branch_ids`
(clinic-wide roles — super_admin / clinic_owner / accounts — see all).

Only super_admin + clinic_owner can mutate. Everyone else gets a read-only
scoped list for populating dropdowns.
"""
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from auth import (
    get_current_user, require_roles,
    user_can_see_branch, CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import Branch, BranchCreate
from utils.serde import serialize_datetime, deserialize_datetime

router = APIRouter(prefix="/api")


@router.get("/branches", response_model=List[Branch])
async def list_branches(user=Depends(get_current_user), db=Depends(get_db)):
    """Branches visible to the caller. Clinic-wide roles see all; others see
    only branches assigned to them."""
    q: dict = {"clinic_id": user["clinic_id"], "active": True}
    if user["role"] not in CLINIC_WIDE_ROLES:
        q["branch_id"] = {"$in": user.get("branch_ids", [])}
    rows = await db.branches.find(q, {"_id": 0}).sort("is_primary", -1).to_list(200)
    return [deserialize_datetime(r) for r in rows]


@router.post("/branches", response_model=Branch)
async def create_branch(payload: BranchCreate,
                        user=Depends(require_roles("clinic_owner")),
                        db=Depends(get_db)):
    """Create a new branch. Super-admin or clinic-owner only."""
    obj = Branch(clinic_id=user["clinic_id"], **payload.model_dump())
    # If caller asked for is_primary, clear the flag on any previous primary.
    if obj.is_primary:
        await db.branches.update_many(
            {"clinic_id": user["clinic_id"], "is_primary": True},
            {"$set": {"is_primary": False}},
        )
    await db.branches.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@router.get("/branches/{branch_id}", response_model=Branch)
async def get_branch(branch_id: str,
                     user=Depends(get_current_user), db=Depends(get_db)):
    if not user_can_see_branch(user, branch_id):
        raise HTTPException(status_code=403, detail="Branch access denied")
    row = await db.branches.find_one(
        {"branch_id": branch_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Branch not found")
    return deserialize_datetime(row)


@router.put("/branches/{branch_id}", response_model=Branch)
async def update_branch(branch_id: str, payload: BranchCreate,
                        user=Depends(require_roles("clinic_owner")),
                        db=Depends(get_db)):
    existing = await db.branches.find_one(
        {"branch_id": branch_id, "clinic_id": user["clinic_id"]},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Branch not found")
    # Invariant: exactly one primary must remain. Reject demoting the sole primary.
    if existing.get("is_primary") and not payload.is_primary:
        other_primaries = await db.branches.count_documents({
            "clinic_id": user["clinic_id"],
            "is_primary": True,
            "branch_id": {"$ne": branch_id},
        })
        if other_primaries == 0:
            raise HTTPException(
                status_code=409,
                detail="Cannot demote the only primary branch. Promote another branch first.",
            )
    data = payload.model_dump()
    data["updated_at"] = datetime.utcnow()
    await db.branches.update_one(
        {"branch_id": branch_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(data)},
    )
    if payload.is_primary:
        await db.branches.update_many(
            {"clinic_id": user["clinic_id"], "branch_id": {"$ne": branch_id}},
            {"$set": {"is_primary": False}},
        )
    row = await db.branches.find_one({"branch_id": branch_id}, {"_id": 0})
    return deserialize_datetime(row)


@router.delete("/branches/{branch_id}")
async def deactivate_branch(branch_id: str,
                            user=Depends(require_roles("clinic_owner")),
                            db=Depends(get_db)):
    """Soft-delete: flip `active=false` instead of removing. Prevents dangling
    inventory / user references."""
    res = await db.branches.update_one(
        {"branch_id": branch_id, "clinic_id": user["clinic_id"]},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Branch not found")
    return {"message": "Deactivated", "branch_id": branch_id}
