"""Clinic Groups — multi-clinic organisations (Head + Branches).

A single owner can now run N clinics under one umbrella:
    Bengaluru HQ  ── head
    ├── Mysore branch
    ├── Hubli branch
    └── Mangalore branch

Model:
- `clinic_groups` doc  {group_id, name, head_clinic_id, member_clinic_ids[]}
- Each `clinics` doc gets `clinic_group_id` + `is_head_of_group` denormalised.
- Head owner (and any user at head with role clinic_owner / clinic_manager /
  super_admin) gets the branch clinic ids appended to `additional_clinic_ids`
  so the existing `/auth/switch-clinic` mechanism just works — no need to
  invent a new switching mechanism.

Branch inheritance on creation:
- Clinic branding fields (logo, letterhead, tagline, GSTIN etc.) copied
  from head so the branch's letterheads look uniform on day 1.
- Service catalogue copied from head via `billing.seed_default_services`
  fallback — but ALSO an explicit clone if head has customised services.

Data separation is preserved: each branch keeps its own patients,
appointments, staff, invoices, inventory. Transfers between them go
through the existing `stock_transfers` machinery. Cross-clinic reads are
opt-in and only happen when the head owner explicitly switches context.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, require_roles
from database import get_db
from utils.serde import serialize_datetime

router = APIRouter(prefix="/api/clinic-groups")

# Roles at the head clinic that should get auto-granted access to every
# newly-created branch. Front-desk / audiologist / receptionist stay
# single-clinic so day-to-day staff don't accidentally see other branches.
_HEAD_ADMIN_ROLES = {"clinic_owner", "clinic_manager", "super_admin"}


class CreateGroupPayload(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)


class CreateBranchPayload(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    city: str = Field(..., min_length=1, max_length=80)
    state: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    mrd_prefix: Optional[str] = None
    inherit_branding: bool = True
    inherit_services: bool = True


# ─── helpers ──────────────────────────────────────────────────────────────
async def _load_group_for_head(db, clinic_id: str) -> Optional[dict]:
    return await db.clinic_groups.find_one({"head_clinic_id": clinic_id}, {"_id": 0})


async def _load_group_for_member(db, clinic_id: str) -> Optional[dict]:
    """Return the group where `clinic_id` is either head or a member."""
    return await db.clinic_groups.find_one(
        {"$or": [{"head_clinic_id": clinic_id}, {"member_clinic_ids": clinic_id}]},
        {"_id": 0},
    )


async def _clinic_stock_summary(db, clinic_id: str) -> dict:
    """Cheap summary numbers per clinic for the group console cards.
    Returns `{ha_units, low_stock_skus, patients}`.
    """
    ha_units = await db.serial_items.count_documents({"clinic_id": clinic_id, "state": "IN_STOCK"})
    low = await db.accessory_stock.count_documents({
        "clinic_id": clinic_id,
        "$expr": {"$lte": ["$qty_on_hand", {"$ifNull": ["$reorder_at", 5]}]},
    })
    patients = await db.patients.count_documents({
        "clinic_id": clinic_id,
        "merged_into": {"$in": [None, False]},
    })
    return {"ha_units": ha_units, "low_stock_skus": low, "patients": patients}


async def _grant_head_admins_access(db, head_clinic_id: str, new_branch_id: str) -> int:
    """Push `new_branch_id` into every head-admin's `additional_clinic_ids`.
    Keeps the switch-clinic dropdown in sync with reality — otherwise the
    head owner wouldn't see the branch they just created.
    """
    res = await db.users.update_many(
        {
            "clinic_id": head_clinic_id,
            "role": {"$in": list(_HEAD_ADMIN_ROLES)},
            "active": {"$ne": False},
        },
        {"$addToSet": {"additional_clinic_ids": new_branch_id}},
    )
    return int(res.modified_count or 0)


async def _revoke_head_admins_access(db, head_clinic_id: str, branch_id: str) -> int:
    res = await db.users.update_many(
        {"clinic_id": head_clinic_id, "role": {"$in": list(_HEAD_ADMIN_ROLES)}},
        {"$pull": {"additional_clinic_ids": branch_id}},
    )
    return int(res.modified_count or 0)


async def _clone_services(db, from_clinic: str, to_clinic: str) -> int:
    """Copy the service catalogue verbatim. Fresh service_id per row
    so future edits at the branch don't ripple back to the head.
    """
    rows = await db.services.find({"clinic_id": from_clinic}, {"_id": 0}).to_list(500)
    if not rows:
        return 0
    for r in rows:
        r["clinic_id"] = to_clinic
        r["service_id"] = f"SVC-{uuid.uuid4().hex[:8].upper()}"
        r.pop("created_at", None)
        r["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.services.insert_one(r)
    return len(rows)


# ─── endpoints ────────────────────────────────────────────────────────────
@router.post("")
async def create_group(
    payload: CreateGroupPayload,
    user=Depends(require_roles("clinic_owner")),
    db=Depends(get_db),
):
    """Turn the current clinic into a Head Clinic of a new group.
    Idempotent: returns the existing group if the clinic is already
    a head.
    """
    clinic_id = user["clinic_id"]
    existing = await _load_group_for_member(db, clinic_id)
    if existing:
        if existing["head_clinic_id"] != clinic_id:
            raise HTTPException(
                status_code=409,
                detail="This clinic is a branch of another group. Ask the head clinic owner to add branches.",
            )
        return {"group": existing}

    now = datetime.now(timezone.utc)
    gid = f"CG-{uuid.uuid4().hex[:12].upper()}"
    doc = {
        "group_id": gid,
        "name": payload.name.strip(),
        "head_clinic_id": clinic_id,
        "member_clinic_ids": [],
        "created_by": user["user_id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.clinic_groups.insert_one(serialize_datetime(doc))
    await db.clinics.update_one(
        {"clinic_id": clinic_id},
        {"$set": {"clinic_group_id": gid, "is_head_of_group": True}},
    )
    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": clinic_id, "user_id": user["user_id"],
        "action": "clinic_group.create", "group_id": gid, "name": payload.name.strip(),
        "at": now,
    }))
    doc.pop("_id", None)
    return {"group": doc}


@router.get("/mine")
async def get_my_group(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Return the caller's clinic group with populated branch cards.
    Any role gets a read — the switcher and shipment widgets need it.
    Returns `{group: null}` if the clinic isn't part of any group.
    """
    clinic_id = user["clinic_id"]
    group = await _load_group_for_member(db, clinic_id)
    if not group:
        return {"group": None}

    head = await db.clinics.find_one(
        {"clinic_id": group["head_clinic_id"]},
        {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "state": 1, "gstin": 1, "logo_url": 1},
    ) or {"clinic_id": group["head_clinic_id"], "name": "Head clinic"}
    head["is_head"] = True
    head["stock"] = await _clinic_stock_summary(db, group["head_clinic_id"])

    branches = []
    for bid in group.get("member_clinic_ids", []):
        b = await db.clinics.find_one(
            {"clinic_id": bid},
            {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "state": 1, "gstin": 1, "logo_url": 1, "status": 1},
        )
        if not b:
            continue
        b["is_head"] = False
        b["stock"] = await _clinic_stock_summary(db, bid)
        branches.append(b)

    return {
        "group": {
            "group_id": group["group_id"],
            "name": group["name"],
            "head_clinic_id": group["head_clinic_id"],
            "created_at": group.get("created_at"),
        },
        "head": head,
        "branches": branches,
        "viewer_is_head": (clinic_id == group["head_clinic_id"]),
    }


@router.post("/mine/branches")
async def create_branch(
    payload: CreateBranchPayload,
    user=Depends(require_roles("clinic_owner")),
    db=Depends(get_db),
):
    """Head owner spins up a new branch clinic tenant. The branch:
      - Gets a fresh `clinic_id` and empty patient / staff / inventory.
      - Inherits branding + service catalogue from head (opt-in flags).
      - Is auto-added to the head's group.
      - Every head-admin user gets the new clinic id pushed into their
        `additional_clinic_ids`, so the switch-clinic dropdown updates
        without a re-login.

    Fails 409 if the caller's clinic isn't yet a head (must call
    `POST /clinic-groups` first).
    """
    head_clinic_id = user["clinic_id"]
    group = await _load_group_for_head(db, head_clinic_id)
    if not group:
        raise HTTPException(
            status_code=409,
            detail={"code": "no_group", "message": "Create a clinic group first."},
        )

    # Head clinic doc — needed for branding + gstin inheritance.
    head = await db.clinics.find_one({"clinic_id": head_clinic_id}) or {}

    # Mint the new branch clinic.
    now = datetime.now(timezone.utc)
    branch_id = f"BR-CL-{uuid.uuid4().hex[:8].upper()}"
    branch_doc = {
        "clinic_id": branch_id,
        "name": payload.name.strip(),
        "city": payload.city.strip(),
        "state": payload.state or head.get("state"),
        "country": head.get("country", "India"),
        "phone": payload.phone,
        "email": payload.email,
        "gstin": payload.gstin,
        "mrd_prefix": payload.mrd_prefix or head.get("mrd_prefix") or "MRD",
        "subscription_tier": head.get("subscription_tier", "STARTER"),
        "signup_source": "branch-of-" + head_clinic_id,
        "status": "active",
        "clinic_group_id": group["group_id"],
        "is_head_of_group": False,
        "parent_clinic_id": head_clinic_id,
        "created_at": now,
        "created_by": user["user_id"],
    }
    if payload.inherit_branding:
        for k in ("logo_url", "letterhead_url", "signature_url", "tagline", "website", "registration_no"):
            if head.get(k):
                branch_doc[k] = head[k]

    await db.clinics.insert_one(serialize_datetime(branch_doc))

    # Physical branch record (audinexa's per-clinic branch concept, used
    # by inventory/appointments schedulers). Every tenant needs one.
    physical_branch_id = f"BR-{uuid.uuid4().hex[:8].upper()}"
    await db.branches.insert_one(serialize_datetime({
        "branch_id": physical_branch_id,
        "clinic_id": branch_id,
        "name": f"{payload.name.strip()} · Main",
        "city": payload.city.strip(),
        "state": payload.state or head.get("state"),
        "is_primary": True,
        "active": True,
        "created_at": now,
    }))

    # Update the group with the new member.
    await db.clinic_groups.update_one(
        {"group_id": group["group_id"]},
        {"$push": {"member_clinic_ids": branch_id}, "$set": {"updated_at": now.isoformat()}},
    )

    # Grant head-admin users switcher access.
    granted = await _grant_head_admins_access(db, head_clinic_id, branch_id)

    # Seed service catalogue.
    services_seeded = 0
    if payload.inherit_services:
        services_seeded = await _clone_services(db, head_clinic_id, branch_id)
    if services_seeded == 0:
        # Fallback to the platform-default catalogue so the branch's
        # billing dropdown isn't empty on day 1.
        try:
            import billing as billing_module
            services_seeded = await billing_module.seed_default_services(db, branch_id)
        except Exception:
            services_seeded = 0

    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": head_clinic_id, "user_id": user["user_id"],
        "action": "clinic_group.add_branch",
        "group_id": group["group_id"], "branch_clinic_id": branch_id,
        "branch_name": payload.name.strip(),
        "granted_switcher_to_users": granted,
        "services_seeded": services_seeded,
        "at": now,
    }))

    return {
        "branch": {
            **branch_doc,
            "created_at": now.isoformat(),
            "physical_branch_id": physical_branch_id,
        },
        "services_seeded": services_seeded,
        "head_admins_granted": granted,
    }


@router.post("/mine/branches/{branch_id}/deactivate")
async def deactivate_branch(
    branch_id: str,
    user=Depends(require_roles("clinic_owner")),
    db=Depends(get_db),
):
    """Soft-remove a branch. Marks its `status='inactive'`, revokes
    switcher access, and pulls it from the group members list. Data
    stays in mongo for audit. Use this instead of a hard delete.
    """
    head_clinic_id = user["clinic_id"]
    group = await _load_group_for_head(db, head_clinic_id)
    if not group:
        raise HTTPException(status_code=404, detail="No group under this clinic")
    if branch_id not in (group.get("member_clinic_ids") or []):
        raise HTTPException(status_code=404, detail="Branch not part of your group")

    now = datetime.now(timezone.utc)
    await db.clinics.update_one(
        {"clinic_id": branch_id},
        {"$set": {"status": "inactive", "deactivated_at": now.isoformat()}},
    )
    await db.clinic_groups.update_one(
        {"group_id": group["group_id"]},
        {"$pull": {"member_clinic_ids": branch_id}, "$set": {"updated_at": now.isoformat()}},
    )
    revoked = await _revoke_head_admins_access(db, head_clinic_id, branch_id)

    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": head_clinic_id, "user_id": user["user_id"],
        "action": "clinic_group.deactivate_branch",
        "group_id": group["group_id"], "branch_clinic_id": branch_id,
        "revoked_from_users": revoked, "at": now,
    }))
    return {"ok": True, "revoked_from_users": revoked}
