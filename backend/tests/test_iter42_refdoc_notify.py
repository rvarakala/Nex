"""Iteration 42 — ReferringDoctor notify flags + notification audit log wiring.

Covers:
  • POST /api/referring-doctors with notify_on_diag/notify_on_ha
  • PUT   /api/referring-doctors/{id} toggling the flags
  • GET   /api/referring-doctors echoes the flags
  • Session mark-printed fires schedule_notify → referral_notifications row
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

API = (os.environ.get("API_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
)).rstrip("/") + "/api"

OWNER_EMAIL = "owner@thesoundclinic.in"
OWNER_PASSWORD = "demo123"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def owner_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("access_token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def clinic_id(owner_headers):
    r = requests.get(f"{API}/auth/me", headers=owner_headers, timeout=10)
    assert r.status_code == 200, r.text
    return r.json().get("clinic_id") or r.json().get("user", {}).get("clinic_id")


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# ── 3a. CRUD with notify flags ───────────────────────────────

def test_create_referring_doctor_with_notify_flags(owner_headers):
    payload = {
        "name": f"Dr. Notify QA {uuid.uuid4().hex[:6]}",
        "phone": "9998887777",
        "notify_on_diag": True,
        "notify_on_ha": False,
    }
    r = requests.post(f"{API}/referring-doctors", json=payload,
                      headers=owner_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["notify_on_diag"] is True
    assert body["notify_on_ha"] is False
    doctor_id = body["doctor_id"]

    # PUT flip
    upd = {**payload, "notify_on_diag": False, "notify_on_ha": True}
    r2 = requests.put(f"{API}/referring-doctors/{doctor_id}",
                      json=upd, headers=owner_headers, timeout=15)
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["notify_on_diag"] is False
    assert b2["notify_on_ha"] is True

    # GET list echoes new fields
    r3 = requests.get(f"{API}/referring-doctors",
                      headers=owner_headers, timeout=15)
    assert r3.status_code == 200
    row = next((d for d in r3.json() if d["doctor_id"] == doctor_id), None)
    assert row is not None
    assert row.get("notify_on_diag") is False
    assert row.get("notify_on_ha") is True

    # Cleanup
    r4 = requests.delete(f"{API}/referring-doctors/{doctor_id}",
                         headers=owner_headers, timeout=15)
    assert r4.status_code == 200


# ── 3c. mark-printed fires audit-log entry ───────────────────

def test_session_mark_printed_creates_notification_audit(owner_headers, clinic_id, mongo_db):
    """Create a doctor + a patient linked to that doctor, create a session,
    call mark-printed, then poll referral_notifications for the audit row."""
    if not clinic_id:
        pytest.skip("clinic_id unavailable")

    # 1) Doctor with notify_on_diag=True
    dr_payload = {
        "name": f"Dr. Notify Trig {uuid.uuid4().hex[:6]}",
        "phone": "9998887777",
        "notify_on_diag": True,
        "notify_on_ha": False,
    }
    r = requests.post(f"{API}/referring-doctors", json=dr_payload,
                      headers=owner_headers, timeout=15)
    assert r.status_code == 200, r.text
    doctor_id = r.json()["doctor_id"]

    try:
        # 2) Patient linked to this doctor
        patient_payload = {
            "name": f"TEST_NotifyPatient {uuid.uuid4().hex[:6]}",
            "age": 40,
            "gender": "male",
            "mobile": "9000000001",
            "referring_doctor_id": doctor_id,
        }
        rp = requests.post(f"{API}/patients", json=patient_payload,
                           headers=owner_headers, timeout=15)
        assert rp.status_code in (200, 201), rp.text
        patient = rp.json()
        patient_id = patient.get("patient_id") or patient.get("id")
        assert patient_id

        # 3) Create a session (test_session)
        sess_payload = {
            "patient_id": patient_id,
            "test_date": datetime.now(timezone.utc).date().isoformat(),
            "audiologist_id": "any",
            "audiologist_name": "QA",
            "recommended_tests": ["PTA"],
        }
        rs = requests.post(f"{API}/sessions", json=sess_payload,
                           headers=owner_headers, timeout=15)
        assert rs.status_code in (200, 201), rs.text
        session_id = rs.json().get("session_id") or rs.json().get("id")
        assert session_id

        # snapshot count before
        before_count = mongo_db.referral_notifications.count_documents(
            {"clinic_id": clinic_id, "patient_id": patient_id, "stream": "diagnostics"}
        )

        # 4) mark-printed
        rm = requests.post(f"{API}/sessions/{session_id}/mark-printed",
                           headers=owner_headers, timeout=15)
        assert rm.status_code == 200, rm.text

        # 5) Poll referral_notifications for the audit entry (fire-and-forget)
        found = None
        deadline = time.time() + 5
        while time.time() < deadline:
            found = mongo_db.referral_notifications.find_one(
                {"clinic_id": clinic_id, "patient_id": patient_id,
                 "stream": "diagnostics"},
                sort=[("created_at", -1)],
            )
            if found and (before_count == 0 or found):
                # ensure it's fresh
                count_now = mongo_db.referral_notifications.count_documents(
                    {"clinic_id": clinic_id, "patient_id": patient_id, "stream": "diagnostics"}
                )
                if count_now > before_count:
                    break
            time.sleep(0.3)

        assert found is not None, "no referral_notifications row was created"
        assert found["stream"] == "diagnostics"
        # status should be one of the expected values (MSG91 may be mocked)
        assert found.get("status") in {"sent", "failed", "queued_no_provider",
                                        "skipped", "error"}, found

    finally:
        # Cleanup doctor
        requests.delete(f"{API}/referring-doctors/{doctor_id}",
                        headers=owner_headers, timeout=15)


# ── 1. Appointments accept referring_doctor_id ───────────────

def test_appointment_accepts_referring_doctor_id(owner_headers):
    """POST /api/appointments with referring_doctor_id + visit_type=referral
    should be accepted (model has the field). We don't need to actually
    schedule a valid slot — we just verify the payload shape is accepted
    (or rejected on business-logic, not on unknown field)."""
    # Find any doctor
    docs = requests.get(f"{API}/referring-doctors",
                        headers=owner_headers, timeout=15).json()
    if not docs:
        pytest.skip("no referring doctors seeded")
    doctor_id = docs[0]["doctor_id"]

    # find a patient
    ps = requests.get(f"{API}/patients", headers=owner_headers,
                      params={"per_page": 1}, timeout=15)
    if ps.status_code != 200:
        pytest.skip("cannot list patients")
    items = ps.json()
    if isinstance(items, dict):
        items = items.get("items") or items.get("patients") or []
    if not items:
        pytest.skip("no patients")
    patient_id = items[0].get("patient_id") or items[0].get("id")

    payload = {
        "patient_id": patient_id,
        "audiologist_id": "any",
        "service": "Consultation",
        "start_at": "2099-01-01T10:00:00+05:30",
        "duration_minutes": 30,
        "visit_type": "referral",
        "referring_doctor_id": doctor_id,
        "counterparty_type": "patient",
        "counterparty_id": patient_id,
    }
    r = requests.post(f"{API}/appointments", json=payload,
                      headers=owner_headers, timeout=15)
    # Accept 200/201 or a 4xx that's NOT a validation error on referring_doctor_id
    assert r.status_code in (200, 201, 400, 404, 409, 422), r.text
    if r.status_code == 422:
        # ensure the failure is not because referring_doctor_id is unknown
        assert "referring_doctor_id" not in r.text.lower(), r.text
    if r.status_code in (200, 201):
        body = r.json()
        # cleanup appointment if created
        aid = body.get("appointment_id") or body.get("id")
        if aid:
            requests.delete(f"{API}/appointments/{aid}",
                            headers=owner_headers, timeout=15)
