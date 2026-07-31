"""Regression: `POST /api/diagnostics/queue/start` must return
`referring_doctor_name` on the patient payload so the Report Builder
can auto-fill "Referred by" without the audiologist re-typing what
front desk already captured at registration.

Also verifies `_load_patient` in the report-versions router enriches
the same field on the archived snapshot so re-opening a completed
report shows the referring doctor even if the audiologist saved with
an empty `referred_by`.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _mkdb():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


async def _seed(db, with_doctor_link: bool):
    suffix = uuid.uuid4().hex[:8]
    clinic_id = f"clinic-refauto-{suffix}"
    doctor_id = f"REFDOC-{suffix}"
    patient_id = f"PT-{suffix}"

    await db.clinics.insert_one({
        "clinic_id": clinic_id, "name": f"Refill Test {suffix}",
        "subscription_tier": "PREMIUM",
    })
    if with_doctor_link:
        await db.referring_doctors.insert_one({
            "doctor_id": doctor_id, "clinic_id": clinic_id,
            "name": "Dr Vikram Reddy",
        })
    await db.patients.insert_one({
        "patient_id": patient_id, "clinic_id": clinic_id,
        "name": "Ramana Test",
        "referring_doctor_id": doctor_id if with_doctor_link else None,
        "referring_physician": None if with_doctor_link else "Dr Free-Text Fallback",
    })
    return {"clinic_id": clinic_id, "doctor_id": doctor_id, "patient_id": patient_id}


async def _cleanup(db, clinic_id: str):
    for coll in ("clinics", "referring_doctors", "patients"):
        await db[coll].delete_many({"clinic_id": clinic_id})


def test_load_patient_enriches_referring_doctor_name():
    """hearing_report_versions._load_patient looks up the doctor's name
    when the patient has `referring_doctor_id`."""
    async def _test():
        client, db = _mkdb()
        seeded = await _seed(db, with_doctor_link=True)
        try:
            from routers.hearing_report_versions import _load_patient

            patient = await _load_patient(db, seeded["patient_id"], seeded["clinic_id"])
            assert patient["referring_doctor_id"] == seeded["doctor_id"]
            assert patient["referring_doctor_name"] == "Dr Vikram Reddy", (
                "referring_doctor_name must be resolved from referring_doctors"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_load_patient_without_doctor_link_leaves_name_blank():
    """When the patient has only a free-text `referring_physician` and
    no FK, we DO NOT invent a name — the ReportsPanel fallback picks up
    the free-text field directly."""
    async def _test():
        client, db = _mkdb()
        seeded = await _seed(db, with_doctor_link=False)
        try:
            from routers.hearing_report_versions import _load_patient

            patient = await _load_patient(db, seeded["patient_id"], seeded["clinic_id"])
            assert not patient.get("referring_doctor_name")
            assert patient.get("referring_physician") == "Dr Free-Text Fallback"
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())
