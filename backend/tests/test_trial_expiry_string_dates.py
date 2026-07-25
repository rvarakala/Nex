"""Regression tests for the trial-expiry scanner.

Bug found during the launch-readiness audit (2026-07-25):
`serialize_datetime()` (used by `/public/clinic-signup` and the demo seed)
stores `trial_ends_at` as an ISO **string**, but the old scanner queried
with `{"trial_ends_at": {"$lte": datetime_now}}` — BSON type-mismatched,
so 118 stuck tenants were silently enjoying free PREMIUM forever.

These tests pin both paths (string AND date) and make sure future refactors
don't reintroduce the mismatch.

Run: `cd /app/backend && pytest tests/test_trial_expiry_string_dates.py -x -q`
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

import motor.motor_asyncio


def _run(coro):
    try:
        prev = asyncio.get_event_loop()
    except RuntimeError:
        prev = None
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        if prev is not None and not prev.is_closed():
            asyncio.set_event_loop(prev)


def _db():
    client = motor.motor_asyncio.AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


def _cid(prefix: str = "clinic-trialtest") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def test_expiry_scanner_flips_string_trial_ends_at():
    """String-typed trial_ends_at in the past → clinic must downgrade to BASIC."""
    from trial_expiry import run_trial_expiry_scan

    async def _go():
        client, db = _db()
        cid = _cid()
        past_iso = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        await db.clinics.insert_one({
            "clinic_id": cid,
            "name": "Trial-Str-Test",
            "subscription_tier": "BASIC",
            "trial_ends_at": past_iso,  # STRING
        })
        try:
            await run_trial_expiry_scan(db)
            got = await db.clinics.find_one({"clinic_id": cid}, {"_id": 0})
            assert got["subscription_tier"] == "BASIC"
            assert "trial_ends_at" not in got
            assert got.get("tier_auto_downgraded_from_trial") is True
            assert isinstance(got.get("trial_expired_at"), str)
        finally:
            await db.clinics.delete_one({"clinic_id": cid})
            client.close()

    _run(_go())


def test_expiry_scanner_flips_datetime_trial_ends_at():
    """BSON-date-typed trial_ends_at in the past → clinic must also downgrade."""
    from trial_expiry import run_trial_expiry_scan

    async def _go():
        client, db = _db()
        cid = _cid()
        past_dt = datetime.now(timezone.utc) - timedelta(days=1)
        await db.clinics.insert_one({
            "clinic_id": cid,
            "name": "Trial-DT-Test",
            "subscription_tier": "BASIC",
            "trial_ends_at": past_dt,  # native BSON date
        })
        try:
            await run_trial_expiry_scan(db)
            got = await db.clinics.find_one({"clinic_id": cid}, {"_id": 0})
            assert got["subscription_tier"] == "BASIC"
            assert "trial_ends_at" not in got
        finally:
            await db.clinics.delete_one({"clinic_id": cid})
            client.close()

    _run(_go())


def test_expiry_scanner_leaves_active_trials_alone():
    """Future trial_ends_at (either type) must NOT be touched by the scanner."""
    from trial_expiry import run_trial_expiry_scan

    async def _go():
        client, db = _db()
        cid_str = _cid("clinic-active-str")
        cid_dt = _cid("clinic-active-dt")
        future_iso = (datetime.now(timezone.utc) + timedelta(days=15)).isoformat()
        future_dt = datetime.now(timezone.utc) + timedelta(days=15)
        await db.clinics.insert_many([
            {"clinic_id": cid_str, "subscription_tier": "BASIC", "trial_ends_at": future_iso},
            {"clinic_id": cid_dt, "subscription_tier": "BASIC", "trial_ends_at": future_dt},
        ])
        try:
            await run_trial_expiry_scan(db)
            s = await db.clinics.find_one({"clinic_id": cid_str}, {"_id": 0})
            d = await db.clinics.find_one({"clinic_id": cid_dt}, {"_id": 0})
            assert "trial_ends_at" in s, "Active string trial was wrongly cleared"
            assert "trial_ends_at" in d, "Active datetime trial was wrongly cleared"
            assert s.get("tier_auto_downgraded_from_trial") is not True
            assert d.get("tier_auto_downgraded_from_trial") is not True
        finally:
            await db.clinics.delete_many({"clinic_id": {"$in": [cid_str, cid_dt]}})
            client.close()

    _run(_go())


def test_expiry_scanner_is_idempotent():
    """Running the scan twice on the same expired clinic must not double-flip."""
    from trial_expiry import run_trial_expiry_scan

    async def _go():
        client, db = _db()
        cid = _cid("clinic-idem")
        past_iso = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        await db.clinics.insert_one({
            "clinic_id": cid,
            "subscription_tier": "BASIC",
            "trial_ends_at": past_iso,
        })
        try:
            first = await run_trial_expiry_scan(db)
            second = await run_trial_expiry_scan(db)
            assert first >= 1
            assert second == 0, "second run should flip nothing — trial_ends_at was cleared"
        finally:
            await db.clinics.delete_one({"clinic_id": cid})
            client.close()

    _run(_go())
