"""Regression — Patient model must tolerate legacy DB data.

Production error fingerprint `b5ce81b3ad38` family:
- `anniversary_date` / `dob` stored as raw `datetime` (instead of ISO string)
- `age` stored as `None`
- `gender` stored as a non-canonical string like `"M"` / `"F"`

Strict Patient model would 500 on any of these. We now coerce / relax.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


@pytest.fixture(scope="module")
def admin_token():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def db_handle():
    cli = MongoClient(os.environ["MONGO_URL"])
    return cli[os.environ["DB_NAME"]]


def _create_legacy_patient(token, db, *, ann_as_datetime: bool = True,
                            age_none: bool = True, gender_garbage: bool = True):
    """Create a clean patient via the API, then mutate it directly in
    Mongo to simulate the legacy bad state."""
    payload = {"name": "Legacy Anniversary Patient",
               "mobile": "9990000099", "age": 41, "gender": "Female"}
    r = requests.post(f"{API}/patients", json=payload, headers=H(token))
    assert r.status_code == 200, r.text
    pid = r.json()["patient_id"]

    update: dict = {}
    if ann_as_datetime:
        update["anniversary_date"] = datetime(2022, 2, 27, 0, 0, tzinfo=timezone.utc)
    if age_none:
        update["age"] = None
    if gender_garbage:
        update["gender"] = "M"
    if update:
        db.patients.update_one({"patient_id": pid}, {"$set": update})
    return pid


def test_list_endpoint_tolerates_legacy_anniversary_datetime(admin_token, db_handle):
    """Repro of prod error fingerprint b5ce81b3ad38 — exactly the case
    that fired the email alert."""
    _create_legacy_patient(admin_token, db_handle)
    # The list endpoint (no cursor → legacy array shape) must NOT crash.
    r = requests.get(f"{API}/patients?limit=200", headers=H(admin_token))
    assert r.status_code == 200, r.text


def test_list_endpoint_with_cursor_mode_also_tolerates(admin_token, db_handle):
    _create_legacy_patient(admin_token, db_handle, ann_as_datetime=True,
                           age_none=True, gender_garbage=False)
    r = requests.get(f"{API}/patients?cursor=&limit=10", headers=H(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body


def test_detail_endpoint_tolerates_legacy_patient(admin_token, db_handle):
    pid = _create_legacy_patient(admin_token, db_handle)
    r = requests.get(f"{API}/patients/{pid}", headers=H(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    # anniversary_date should now be a string (the model coerces it)
    if body.get("anniversary_date"):
        assert isinstance(body["anniversary_date"], str)
    # age=None survives as null (no longer 500)
    # gender=garbage survives (no longer enum-locked)


def test_patient_dates_backfill_endpoint_works(admin_token, db_handle):
    """Founder runs the dates backfill; rows with datetime fields get
    rewritten to ISO strings."""
    # Need founder, not admin, for this endpoint.
    from _helpers import FOUNDER_EMAIL, FOUNDER_PASSWORD
    ftok = login(FOUNDER_EMAIL, FOUNDER_PASSWORD)

    _create_legacy_patient(admin_token, db_handle, ann_as_datetime=True,
                           age_none=False, gender_garbage=False)

    # Dry-run first
    r1 = requests.post(
        f"{API}/admin/v2/backfill/patient-dates",
        json={"apply": False}, headers=H(ftok),
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["dry_run"] is True
    assert r1.json()["candidates"] >= 1

    # Apply
    r2 = requests.post(
        f"{API}/admin/v2/backfill/patient-dates",
        json={"apply": True}, headers=H(ftok),
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["dry_run"] is False
    assert r2.json()["backfilled"] >= 1

    # Re-running should now find 0 candidates (idempotent).
    r3 = requests.post(
        f"{API}/admin/v2/backfill/patient-dates",
        json={"apply": True}, headers=H(ftok),
    )
    assert r3.status_code == 200
    assert r3.json()["backfilled"] == 0
