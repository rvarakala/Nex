"""Founder-only admin endpoints for one-shot data backfills.

These wrap maintenance scripts in `/app/backend/scripts/` so they can be
triggered from production via API (since the production pod is
sandboxed — no SSH access). Dry-run by default; explicit `apply: true`
needed to write.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Depends

from auth import require_roles
from database import get_db

router = APIRouter(prefix="/api/admin/v2/backfill", tags=["admin-backfill"])

TARGET_STATES = {"SOLD", "AT_SERVICE", "DISPATCHED_TO_VENDOR", "RETURNED"}


@router.post("/serial-current-patient-id")
async def backfill_serial_current_patient_id(
    apply: bool = Body(False, embed=True),
    user=Depends(require_roles("founder", "super_admin")),
    db=Depends(get_db),
):
    """Stamp `current_patient_id` on `serial_items` rows that are SOLD /
    AT_SERVICE / RETURNED but were never linked to a patient.

    Mirrors `scripts/backfill_serial_current_patient_id.py`. Founder /
    super_admin only — this writes across every tenant in one go.
    """

    fixed_per_clinic: dict[str, int] = {}
    skipped_no_match = 0
    total_candidates = 0
    fixed_examples: list[dict] = []

    cursor = db.serial_items.find(
        {
            "state": {"$in": list(TARGET_STATES)},
            "$or": [
                {"current_patient_id": None},
                {"current_patient_id": {"$exists": False}},
            ],
        },
        {"_id": 0, "serial_id": 1, "clinic_id": 1, "serial_no": 1},
    )

    async for si in cursor:
        total_candidates += 1
        sid = si["serial_id"]
        sale = await db.ha_sales.find_one(
            {
                "clinic_id": si["clinic_id"],
                "lines.serial_id": sid,
                "status": {"$in": ["paid", "invoiced", "reserved"]},
            },
            {"_id": 0, "patient_id": 1, "sale_no": 1, "status": 1},
        )
        if not sale or not sale.get("patient_id"):
            qs = await db.quick_sales.find_one(
                {"clinic_id": si["clinic_id"], "serial_id": sid},
                {"_id": 0, "patient_id": 1},
            )
            sale = qs if qs and qs.get("patient_id") else None
        if not sale or not sale.get("patient_id"):
            skipped_no_match += 1
            continue

        if apply:
            await db.serial_items.update_one(
                {"serial_id": sid},
                {"$set": {"current_patient_id": sale["patient_id"]}},
            )
        fixed_per_clinic[si["clinic_id"]] = fixed_per_clinic.get(si["clinic_id"], 0) + 1
        if len(fixed_examples) < 20:
            fixed_examples.append({
                "clinic_id": si["clinic_id"],
                "serial_no": si.get("serial_no"),
                "serial_id": sid,
                "patient_id": sale["patient_id"],
            })

    return {
        "ok": True,
        "dry_run": not apply,
        "candidates": total_candidates,
        "backfilled": sum(fixed_per_clinic.values()),
        "skipped_no_match": skipped_no_match,
        "fixed_per_clinic": fixed_per_clinic,
        "examples": fixed_examples,
        "actor_email": user.get("email"),
    }
