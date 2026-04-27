"""Clinic Open / Close status — toggleable from the topbar.

When a clinic flips itself "Closed" at end-of-day:
  * Front-desk / receptionists see a soft-blocked "Clinic is closed" hint on
    the New Patient + Issue Token + Book Appointment screens.
  * Owners / super-admins can still override (back-end allows the write —
    enforcement is at the UI layer per product decision).

The flag is stored as `clinics.is_open` (default True). All flips are logged
to `clinic_status_history` for compliance / audit.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_roles
from database import get_db

router = APIRouter(prefix="/api/clinic", tags=["clinic-status"])


class ClinicStatus(BaseModel):
    is_open: bool
    updated_at: Optional[str] = None
    updated_by_name: Optional[str] = None
    note: Optional[str] = None


class StatusUpdatePayload(BaseModel):
    is_open: bool
    note: Optional[str] = None


@router.get("/status", response_model=ClinicStatus)
async def get_status(user=Depends(get_current_user), db=Depends(get_db)):
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    return ClinicStatus(
        is_open=bool(clinic.get("is_open", True)) if clinic else True,
        updated_at=(clinic or {}).get("status_updated_at"),
        updated_by_name=(clinic or {}).get("status_updated_by_name"),
        note=(clinic or {}).get("status_note"),
    )


@router.put("/status", response_model=ClinicStatus)
async def update_status(
    payload: StatusUpdatePayload,
    user=Depends(require_roles("clinic_owner", "super_admin", "founder", "front_desk", "accounts")),
    db=Depends(get_db),
):
    now = datetime.now(timezone.utc).isoformat()
    set_fields = {
        "is_open": payload.is_open,
        "status_updated_at": now,
        "status_updated_by_user_id": user["user_id"],
        "status_updated_by_name": user.get("name") or user.get("email"),
        "status_note": payload.note,
    }
    await db.clinics.update_one({"clinic_id": user["clinic_id"]}, {"$set": set_fields})
    await db.clinic_status_history.insert_one({
        "clinic_id": user["clinic_id"],
        "is_open": payload.is_open,
        "changed_at": now,
        "changed_by_user_id": user["user_id"],
        "changed_by_name": set_fields["status_updated_by_name"],
        "note": payload.note,
    })
    return ClinicStatus(
        is_open=payload.is_open, updated_at=now,
        updated_by_name=set_fields["status_updated_by_name"], note=payload.note,
    )
