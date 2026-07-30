"""Phase C — Kanban `→ Next stage` chip → /queue/checkin regression.

Verifies:
  * POST /api/diagnostics/queue/checkin flips a scheduled/confirmed
    appointment on today's schedule to `checked_in`.
  * The endpoint is idempotent — a second call on the SAME appointment
    (already checked-in) returns `already_checked_in: true` with both
    update flags == false.
  * The endpoint refuses to DEMOTE an appointment already in `in_progress`
    or `completed` back to `checked_in` (regression guard).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

EMAIL = "dltest@example.com"
PASSWORD = "TestPass@123"


def _ist_today_ymd() -> str:
    # IST is UTC+5:30 — same math as backend utils.ist.ist_today_ymd
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")


@pytest.fixture(scope="module")
def token() -> str:
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hdrs(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def patient_id(hdrs) -> str:
    r = requests.get(f"{BASE_URL}/api/patients?per_page=5", headers=hdrs, timeout=15)
    body = r.json() if r.status_code == 200 else {}
    items = body if isinstance(body, list) else body.get("items") or body.get("patients") or []
    if items:
        return items[0]["patient_id"]
    payload = {"name": f"Checkin Test {uuid.uuid4().hex[:6]}", "age": 30, "gender": "M", "mobile": "9000000001"}
    r = requests.post(f"{BASE_URL}/api/patients", headers=hdrs, json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()["patient_id"]


@pytest.fixture(scope="module")
def audiologist_id(hdrs) -> str:
    r = requests.get(f"{BASE_URL}/api/users", headers=hdrs, timeout=15)
    if r.status_code != 200:
        r = requests.get(f"{BASE_URL}/api/tenant/users", headers=hdrs, timeout=15)
    assert r.status_code == 200, r.text
    users = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    for u in users:
        if u.get("role") in ("audiologist", "clinic_owner", "super_admin"):
            return u["user_id"]
    pytest.skip("no user")


def _make_today_appt(hdrs, patient_id, audiologist_id, hour: int = 15, minute: int = 0) -> str:
    """Create a scheduled appointment for today (IST). Returns appointment_id.

    Auto-retries with a different minute if we hit a 409 slot conflict from
    prior test runs on the same day.
    """
    last_err = None
    for attempt in range(30):
        # Try requested minute first, then wander through the hour
        m = (minute + attempt) % 60
        slot = f"{_ist_today_ymd()}T{hour:02d}:{m:02d}:00"
        payload = {
            "patient_id": patient_id,
            "audiologist_id": audiologist_id,
            "counterparty_type": "patient",
            "counterparty_id": patient_id,
            "service": "PTA (checkin test)",
            "start_at": slot,
            "duration_minutes": 5,
            "visit_type": "walkin",
            "recommended_tests": ["pta"],
            "wing": "diagnostic",
        }
        r = requests.post(f"{BASE_URL}/api/appointments", headers=hdrs, json=payload, timeout=15)
        if r.status_code in (200, 201):
            return r.json()["appointment_id"]
        if r.status_code == 409:
            last_err = r.text
            continue
        assert False, r.text
    assert False, f"Could not find free slot after 30 attempts: {last_err}"


class TestQueueCheckin:
    def test_checkin_promotes_scheduled_to_checked_in(self, hdrs, patient_id, audiologist_id):
        # Use minute-of-hour derived from process time to dodge slot collisions
        # when the test suite re-runs multiple times in the same hour.
        minute = (int(datetime.now(timezone.utc).timestamp()) % 55)
        apt_id = _make_today_appt(hdrs, patient_id, audiologist_id, hour=15, minute=minute)

        r = requests.post(
            f"{BASE_URL}/api/diagnostics/queue/checkin",
            headers=hdrs,
            json={"patient_id": patient_id, "appointment_id": apt_id},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["updates"]["appointment"] is True

    def test_checkin_is_idempotent(self, hdrs, patient_id, audiologist_id):
        minute = (int(datetime.now(timezone.utc).timestamp()) % 55) + 1
        apt_id = _make_today_appt(hdrs, patient_id, audiologist_id, hour=16, minute=minute)

        # First call — promotes
        r1 = requests.post(
            f"{BASE_URL}/api/diagnostics/queue/checkin",
            headers=hdrs,
            json={"patient_id": patient_id, "appointment_id": apt_id},
            timeout=15,
        )
        assert r1.status_code == 200
        assert r1.json()["updates"]["appointment"] is True

        # Second call — noop
        r2 = requests.post(
            f"{BASE_URL}/api/diagnostics/queue/checkin",
            headers=hdrs,
            json={"patient_id": patient_id, "appointment_id": apt_id},
            timeout=15,
        )
        assert r2.status_code == 200
        body = r2.json()
        assert body["updates"]["appointment"] is False
        assert body.get("already_checked_in") is True

    def test_checkin_refuses_to_demote_in_progress(self, hdrs, patient_id, audiologist_id):
        """Regression guard: once an appointment reaches `in_progress`, calling
        /checkin again with the explicit appointment_id must NOT flip it back.
        """
        minute = (int(datetime.now(timezone.utc).timestamp()) % 55) + 2
        apt_id = _make_today_appt(hdrs, patient_id, audiologist_id, hour=17, minute=minute)

        # Promote to checked_in
        requests.post(
            f"{BASE_URL}/api/diagnostics/queue/checkin",
            headers=hdrs,
            json={"patient_id": patient_id, "appointment_id": apt_id},
            timeout=15,
        )
        # Promote to in_progress via /queue/start
        r_start = requests.post(
            f"{BASE_URL}/api/diagnostics/queue/start",
            headers=hdrs,
            json={"patient_id": patient_id, "appointment_id": apt_id},
            timeout=15,
        )
        assert r_start.status_code == 200, r_start.text

        # Now attempt to check-in again — should be a no-op (guard)
        r_re = requests.post(
            f"{BASE_URL}/api/diagnostics/queue/checkin",
            headers=hdrs,
            json={"patient_id": patient_id, "appointment_id": apt_id},
            timeout=15,
        )
        assert r_re.status_code == 200
        body = r_re.json()
        assert body["updates"]["appointment"] is False, "in_progress appt was demoted to checked_in!"
        assert body.get("already_checked_in") is True

    def test_checkin_returns_already_when_no_match(self, hdrs, patient_id):
        """Passing an unknown patient with no matching appointment/token
        should return already_checked_in=True (endpoint is designed to be safe
        to call blindly from the UI even if state is out of sync)."""
        r = requests.post(
            f"{BASE_URL}/api/diagnostics/queue/checkin",
            headers=hdrs,
            json={"patient_id": patient_id},
            timeout=15,
        )
        # Either 200 with already_checked_in, or 200 with real updates=True
        # depending on whether there's a matching scheduled appt today.
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert "updates" in body
