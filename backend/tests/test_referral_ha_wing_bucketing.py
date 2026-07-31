"""Regression: HA-wing appointment invoices must count as HA revenue for
the referring doctor payout, even when invoice line `product_type` isn't
tagged explicitly.

User report (2026-07-31): "Ramana was tested and fitted with HA — but no
referral payout is shown even though it's configured." Root cause: the
`POST /api/appointments/with-invoice` frontend path never sent
`product_type` on invoice lines, so the referrals rollup bucketed 100%
of HA sale revenue into the DIAGNOSTIC bucket → HA payout was ₹0 even
when a doctor's HA cut was configured.

Two guards verified here:
1. Frontend now sends `product_type='Hearing Aid'` when wing=HA — the
   backend accepts it and produces HA revenue on the payout row.
2. Backend fallback: even when `product_type` is missing on the lines,
   if the linked appointment's `wing == 'hearing_aid'`, the invoice is
   still treated as HA revenue (heals existing production data without
   a migration).
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) \
        if False else asyncio.new_event_loop().run_until_complete(coro)


def _mkdb():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


async def _seed(db):
    suffix = uuid.uuid4().hex[:8]
    clinic_id = f"clinic-test-{suffix}"
    doctor_id = f"REFDOC-{suffix}"
    patient_id = f"PT-{suffix}"

    await db.clinics.insert_one({
        "clinic_id": clinic_id, "name": f"Test Clinic {suffix}",
        "subscription_tier": "PREMIUM",
    })
    await db.referring_doctors.insert_one({
        "doctor_id": doctor_id, "clinic_id": clinic_id,
        "name": "Dr Test Ramana",
        "diag_cut_mode": "percent", "diag_cut_value": 10.0,
        "ha_cut_mode": "flat", "ha_cut_value": 5000.0,
    })
    await db.patients.insert_one({
        "patient_id": patient_id, "clinic_id": clinic_id,
        "name": "Ramana Test",
        "referring_doctor_id": doctor_id,
    })
    return {
        "clinic_id": clinic_id,
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "today": datetime.now(timezone.utc).date().isoformat(),
    }


async def _cleanup(db, clinic_id: str):
    for coll in ("clinics", "referring_doctors", "patients",
                 "appointments", "invoices"):
        await db[coll].delete_many({"clinic_id": clinic_id})


async def _run_rollup(db, clinic_id: str):
    """Invoke the private rollup helper the /referrals/dashboard uses.
    We call it directly (no HTTP) so we don't need to seed a login user.
    """
    from routers.referrals import _dashboard_rows

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
    end = (now + timedelta(days=1)).replace(hour=23, minute=59, second=59, microsecond=0)
    return await _dashboard_rows(db, clinic_id, start, end)


def test_ha_wing_invoice_buckets_as_ha_even_when_product_type_missing():
    """The bug the user reported: HA-wing invoice with untagged lines
    was appearing as diagnostic revenue → HA payout stayed ₹0."""
    async def _test():
        client, db = _mkdb()
        seeded = await _seed(db)
        try:
            apt_id = f"APT-{uuid.uuid4().hex[:8]}"
            inv_id = f"INV-{uuid.uuid4().hex[:8]}"
            today_iso = seeded["today"]

            await db.appointments.insert_one({
                "appointment_id": apt_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "wing": "hearing_aid",
                "start_at": f"{today_iso}T10:00:00",
                "status": "in_progress",
            })
            # Paid invoice — lines carry NO `product_type` (legacy shape
            # matching what the old frontend was sending).
            await db.invoices.insert_one({
                "invoice_id": inv_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "appointment_id": apt_id,
                "status": "paid",
                "invoice_date": today_iso,
                "grand_total": 50000.0,
                "lines": [
                    {"description": "Phonak Audeo P90", "line_total": 45000.0},
                    {"description": "Custom Ear Mould", "line_total": 5000.0},
                ],
            })

            rows = await _run_rollup(db, seeded["clinic_id"])
            row = next((r for r in rows if r["doctor_id"] == seeded["doctor_id"]), None)
            assert row is not None
            # HA wing → all revenue counts as HA
            assert row["ha_sales_revenue"] == 50000.0, row
            assert row["diagnostics_revenue"] == 0.0
            # ha_patient_count=1 (Ramana), flat=₹5000/pt → payout = ₹5000
            assert row["ha_patient_count"] == 1
            assert row["ha_payout"] == 5000.0
            assert row["total_payout"] == 5000.0
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_ha_wing_invoice_with_product_type_still_works():
    """New frontend now sends product_type='Hearing Aid'. The rollup
    must still bucket it correctly (belt-and-suspenders regression)."""
    async def _test():
        client, db = _mkdb()
        seeded = await _seed(db)
        try:
            apt_id = f"APT-{uuid.uuid4().hex[:8]}"
            inv_id = f"INV-{uuid.uuid4().hex[:8]}"
            today_iso = seeded["today"]

            await db.appointments.insert_one({
                "appointment_id": apt_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "wing": "hearing_aid",
                "start_at": f"{today_iso}T10:00:00",
                "status": "in_progress",
            })
            await db.invoices.insert_one({
                "invoice_id": inv_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "appointment_id": apt_id,
                "status": "paid",
                "invoice_date": today_iso,
                "grand_total": 30000.0,
                "lines": [
                    {"description": "Signia Pure X 3", "line_total": 30000.0,
                     "product_type": "Hearing Aid"},
                ],
            })

            rows = await _run_rollup(db, seeded["clinic_id"])
            row = next((r for r in rows if r["doctor_id"] == seeded["doctor_id"]), None)
            assert row is not None
            assert row["ha_sales_revenue"] == 30000.0
            assert row["diagnostics_revenue"] == 0.0
            assert row["ha_payout"] == 5000.0
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_diagnostic_wing_invoice_stays_diagnostic():
    """Regression guard: a DIAGNOSTIC-wing invoice must not slip into
    the HA bucket just because the fallback exists."""
    async def _test():
        client, db = _mkdb()
        seeded = await _seed(db)
        try:
            apt_id = f"APT-{uuid.uuid4().hex[:8]}"
            inv_id = f"INV-{uuid.uuid4().hex[:8]}"
            today_iso = seeded["today"]

            await db.appointments.insert_one({
                "appointment_id": apt_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "wing": "diagnostic",
                "start_at": f"{today_iso}T11:00:00",
                "status": "in_progress",
            })
            await db.invoices.insert_one({
                "invoice_id": inv_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "appointment_id": apt_id,
                "status": "paid",
                "invoice_date": today_iso,
                "grand_total": 1600.0,
                "lines": [
                    {"description": "PTA", "line_total": 800.0},
                    {"description": "Impedance", "line_total": 800.0},
                ],
            })

            rows = await _run_rollup(db, seeded["clinic_id"])
            row = next((r for r in rows if r["doctor_id"] == seeded["doctor_id"]), None)
            assert row is not None
            assert row["ha_sales_revenue"] == 0.0
            assert row["diagnostics_revenue"] == 1600.0
            assert row["ha_payout"] == 0.0
            # diag_cut = 10% of 1600 = 160
            assert row["diagnostics_payout"] == 160.0
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_mixed_wing_over_multiple_appointments():
    """Realistic: one diagnostic visit + one HA fitting for the same
    patient. Both should route to their respective buckets."""
    async def _test():
        client, db = _mkdb()
        seeded = await _seed(db)
        try:
            today_iso = seeded["today"]
            for wing, amt, apt_id, inv_id in [
                ("diagnostic", 1600.0, f"APT-D-{uuid.uuid4().hex[:8]}", f"INV-D-{uuid.uuid4().hex[:8]}"),
                ("hearing_aid", 40000.0, f"APT-H-{uuid.uuid4().hex[:8]}", f"INV-H-{uuid.uuid4().hex[:8]}"),
            ]:
                await db.appointments.insert_one({
                    "appointment_id": apt_id,
                    "clinic_id": seeded["clinic_id"],
                    "patient_id": seeded["patient_id"],
                    "wing": wing,
                    "start_at": f"{today_iso}T12:00:00",
                    "status": "in_progress",
                })
                await db.invoices.insert_one({
                    "invoice_id": inv_id,
                    "clinic_id": seeded["clinic_id"],
                    "patient_id": seeded["patient_id"],
                    "appointment_id": apt_id,
                    "status": "paid",
                    "invoice_date": today_iso,
                    "grand_total": amt,
                    "lines": [{"description": f"{wing} service", "line_total": amt}],
                })

            rows = await _run_rollup(db, seeded["clinic_id"])
            row = next((r for r in rows if r["doctor_id"] == seeded["doctor_id"]), None)
            assert row is not None
            assert row["diagnostics_revenue"] == 1600.0
            assert row["ha_sales_revenue"] == 40000.0
            assert row["diagnostics_payout"] == 160.0     # 10% of 1600
            assert row["ha_payout"] == 5000.0             # flat ₹5000/patient × 1
            assert row["total_payout"] == 5160.0
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())
