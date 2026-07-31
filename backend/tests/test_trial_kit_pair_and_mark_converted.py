"""Regression: trial Pair/Kit sides + mark-converted flow.

2026-07-31 UX rework:
  • Trial side dropdown expanded to Single/Left/Right/Pair/Kit.
  • Pair or Kit trials MUST carry exactly 2 physical serial numbers.
  • New endpoint `POST /trials/{trial_no}/mark-converted` closes the
    trial as CONVERTED and returns the demo unit(s) to Demo Stock
    (pool=demo · state=IN_STOCK) — because demo units are NEVER sold;
    a fresh Saleable Stock unit is sold via QuickHASaleModal.
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


async def _seed(db):
    suffix = uuid.uuid4().hex[:8]
    cid = f"clinic-triage-{suffix}"
    branch_id = f"BR-{suffix}"
    pid_left = f"PT-{suffix}"
    prod_id = f"PRD-{suffix}"
    sid_a = f"SI-{suffix}-A"
    sid_b = f"SI-{suffix}-B"

    await db.clinics.insert_one({
        "clinic_id": cid, "name": f"Test {suffix}", "subscription_tier": "PREMIUM",
    })
    await db.branches.insert_one({
        "clinic_id": cid, "branch_id": branch_id, "name": "HQ", "active": True,
    })
    await db.patients.insert_one({
        "clinic_id": cid, "patient_id": pid_left, "name": "Test Kit Patient",
    })
    await db.ha_products.insert_one({
        "clinic_id": cid, "product_id": prod_id, "brand": "TestCo",
        "model": "K1", "form_factor": "RIC", "mrp": 100000, "sale_unit": "kit",
    })
    for sid in (sid_a, sid_b):
        await db.serial_items.insert_one({
            "clinic_id": cid, "serial_id": sid, "branch_id": branch_id,
            "product_id": prod_id, "serial_no": sid,
            "state": "IN_STOCK", "pool": "demo",
            "source_kind": "vendor",
        })
    return {
        "clinic_id": cid, "branch_id": branch_id, "patient_id": pid_left,
        "product_id": prod_id, "serial_ids": [sid_a, sid_b],
    }


async def _cleanup(db, cid):
    for coll in ("clinics", "branches", "patients", "ha_products",
                 "serial_items", "ha_trials", "ha_sales", "serial_events"):
        await db[coll].delete_many({"clinic_id": cid})


def test_trial_side_accepts_pair_and_kit():
    """The TrialSerial model must accept side='pair' and side='kit'."""
    from models_ha import TrialSerial
    for side in ("single", "left", "right", "pair", "kit"):
        s = TrialSerial(serial_id="SI-X", side=side)
        assert s.side == side


def test_trial_side_rejects_unknown():
    """Regression guard — arbitrary strings must still fail."""
    from models_ha import TrialSerial
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        TrialSerial(serial_id="SI-X", side="middle")


def test_mark_converted_returns_demo_unit_to_stock():
    """End-to-end: issue a Kit trial → mark-converted → demo units
    flip back to `pool=demo · state=IN_STOCK`."""
    async def _test():
        client, db = _mkdb()
        s = await _seed(db)
        try:
            # Flag demo serials as TRIAL_OUT (mimic issued trial state).
            trial_no = f"TRL-TEST-{uuid.uuid4().hex[:6]}"
            await db.serial_items.update_many(
                {"serial_id": {"$in": s["serial_ids"]}},
                {"$set": {"state": "TRIAL_OUT", "current_patient_id": s["patient_id"]}},
            )
            await db.ha_trials.insert_one({
                "clinic_id": s["clinic_id"], "trial_no": trial_no,
                "patient_id": s["patient_id"], "patient_name": "Test Kit Patient",
                "branch_id": s["branch_id"], "status": "active",
                "serials": [
                    {"serial_id": s["serial_ids"][0], "side": "kit"},
                    {"serial_id": s["serial_ids"][1], "side": "kit"},
                ],
                "start_date": "2026-07-30", "expected_return_date": "2026-08-07",
                "created_at": datetime.now(timezone.utc),
            })

            # Invoke the new mark-converted handler directly.
            from routers.ha_trials import mark_trial_converted, MarkConvertedIn
            user = {"user_id": "U-T", "clinic_id": s["clinic_id"],
                    "role": "clinic_owner", "branch_scope": None}
            payload = MarkConvertedIn(sale_no="HA-TEST-99", note="pytest close")
            result = await mark_trial_converted(trial_no, payload, user=user, db=db)

            assert result["status"] == "converted"
            assert result["converted_sale_no"] == "HA-TEST-99"
            # Both demo serials must be back to IN_STOCK + pool=demo.
            async for r in db.serial_items.find({"serial_id": {"$in": s["serial_ids"]}}):
                assert r["state"] == "IN_STOCK", r
                assert r["pool"] == "demo"
                assert r.get("current_patient_id") is None
        finally:
            await _cleanup(db, s["clinic_id"])
            client.close()
    _run(_test())


def test_mark_converted_rejects_closed_trial():
    """Cannot mark a trial that's already returned/lost/converted."""
    async def _test():
        client, db = _mkdb()
        s = await _seed(db)
        try:
            trial_no = f"TRL-CLOSED-{uuid.uuid4().hex[:6]}"
            await db.ha_trials.insert_one({
                "clinic_id": s["clinic_id"], "trial_no": trial_no,
                "patient_id": s["patient_id"], "patient_name": "X",
                "branch_id": s["branch_id"], "status": "returned",
                "serials": [], "start_date": "2026-07-30",
                "expected_return_date": "2026-08-07",
                "created_at": datetime.now(timezone.utc),
            })
            from routers.ha_trials import mark_trial_converted, MarkConvertedIn
            from fastapi import HTTPException
            import pytest
            user = {"user_id": "U-T", "clinic_id": s["clinic_id"],
                    "role": "clinic_owner", "branch_scope": None}
            with pytest.raises(HTTPException) as exc:
                await mark_trial_converted(trial_no, MarkConvertedIn(), user=user, db=db)
            assert exc.value.status_code == 409
        finally:
            await _cleanup(db, s["clinic_id"])
            client.close()
    _run(_test())
