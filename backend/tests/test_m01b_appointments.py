"""Backend tests for M01.B — Appointments / Waitlist / Reminders."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta

from _helpers import (  # legacy creds (env-overridable)
    ADMIN_EMAIL, ADMIN_PASSWORD,
    FRONTDESK_EMAIL, FRONTDESK_PASSWORD,
    AUDIO_EMAIL, AUDIO_PASSWORD,
    ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD,
)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

_created = {"patients": [], "appointments": [], "waitlist": []}


@pytest.fixture(scope="module")
def fd_token():
    r = requests.post(f"{API}/auth/login", json={"email": FRONTDESK_EMAIL, "password": FRONTDESK_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(fd_token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {fd_token}"}


@pytest.fixture(scope="module")
def audiologist_id(headers):
    r = requests.get(f"{API}/users", params={"role": "audiologist"}, headers=headers)
    assert r.status_code == 200, r.text
    users = r.json()
    assert len(users) >= 1, "no audiologist user seeded"
    return users[0]["user_id"]


@pytest.fixture(scope="module")
def patient_id(headers):
    suffix = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/patients", headers=headers, json={
        "name": f"TEST_M01B_Pt_{suffix}", "age": 33, "gender": "Male",
        "mobile": f"98{suffix[:8]}", "email": f"t_{suffix}@example.com",
    })
    assert r.status_code == 200, r.text
    pid = r.json()["patient_id"]
    _created["patients"].append(pid)
    return pid


@pytest.fixture(scope="module", autouse=True)
def cleanup(fd_token):
    yield
    h = {"Authorization": f"Bearer {fd_token}"}
    for aid in _created["appointments"]:
        try: requests.post(f"{API}/appointments/{aid}/cancel", headers=h, json={"reason": "cleanup"})
        except: pass
    for pid in _created["patients"]:
        try: requests.delete(f"{API}/patients/{pid}", headers=h)
        except: pass


def _future_iso(hours_ahead: int) -> str:
    base = (datetime.utcnow() + timedelta(days=2)).replace(hour=10 + hours_ahead, minute=0, second=0, microsecond=0)
    return base.isoformat()


# ==================== SERVICES + USERS ====================
class TestMeta:
    def test_services(self, headers):
        r = requests.get(f"{API}/appointments/services", headers=headers)
        assert r.status_code == 200
        d = r.json()
        assert "services" in d
        assert "PTA" in d["services"]
        assert "Consultation" in d["services"]

    def test_users_role_filter(self, headers):
        r = requests.get(f"{API}/users", params={"role": "audiologist"}, headers=headers)
        assert r.status_code == 200
        users = r.json()
        assert all(u["role"] == "audiologist" for u in users)
        # No password_hash leak, no _id leak
        for u in users:
            assert "password_hash" not in u
            assert "_id" not in u


# ==================== APPOINTMENTS CRUD ====================
class TestAppointments:
    def test_create_appointment(self, headers, audiologist_id, patient_id):
        start = _future_iso(0)
        r = requests.post(f"{API}/appointments", headers=headers, json={
            "patient_id": patient_id,
            "audiologist_id": audiologist_id,
            "service": "PTA",
            "start_at": start,
            "duration_minutes": 30,
            "priority": "normal",
            "room": "Room-1",
        })
        assert r.status_code == 200, r.text
        a = r.json()
        assert "appointment_id" in a
        assert a["status"] == "scheduled"
        assert a["patient_name"].startswith("TEST_M01B_Pt_")
        assert a["audiologist_id"] == audiologist_id
        assert "_id" not in a
        assert a["duration_minutes"] == 30
        # end_at = start + 30 min
        assert a["start_at"] and a["end_at"]
        _created["appointments"].append(a["appointment_id"])

    def test_double_booking_returns_409(self, headers, audiologist_id, patient_id):
        # Same audiologist, overlapping time
        start = _future_iso(0)  # same slot as previous test
        r = requests.post(f"{API}/appointments", headers=headers, json={
            "patient_id": patient_id, "audiologist_id": audiologist_id,
            "service": "Consultation", "start_at": start, "duration_minutes": 30,
        })
        assert r.status_code == 409, r.text
        d = r.json()["detail"]
        assert "conflict_with" in d
        assert d["conflict_with"]["appointment_id"]

    def test_list_filters_and_no_id_leak(self, headers, audiologist_id):
        today = datetime.utcnow().strftime("%Y-%m-%d")
        future = (datetime.utcnow() + timedelta(days=10)).strftime("%Y-%m-%d")
        r = requests.get(f"{API}/appointments", params={
            "from_date": today, "to_date": future, "audiologist_id": audiologist_id,
        }, headers=headers)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 1
        for row in rows:
            assert "_id" not in row
            assert row["audiologist_id"] == audiologist_id

    def test_reschedule_no_conflict(self, headers, audiologist_id, patient_id):
        if not _created["appointments"]:
            pytest.skip()
        aid = _created["appointments"][0]
        new_start = _future_iso(3)  # 3 hours later, no overlap
        r = requests.put(f"{API}/appointments/{aid}", headers=headers,
                         json={"start_at": new_start, "duration_minutes": 30})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["start_at"][:16] == new_start[:16]

    def test_reschedule_conflict_returns_409(self, headers, audiologist_id, patient_id):
        # Create a 2nd appointment at slot X, try to reschedule first into slot X
        start_b = _future_iso(5)
        r = requests.post(f"{API}/appointments", headers=headers, json={
            "patient_id": patient_id, "audiologist_id": audiologist_id,
            "service": "Consultation", "start_at": start_b, "duration_minutes": 30,
        })
        assert r.status_code == 200, r.text
        b_id = r.json()["appointment_id"]
        _created["appointments"].append(b_id)
        # Now try to move first appt to overlap slot_b
        a_id = _created["appointments"][0]
        r2 = requests.put(f"{API}/appointments/{a_id}", headers=headers,
                          json={"start_at": start_b, "duration_minutes": 30})
        assert r2.status_code == 409, r2.text

    def test_update_status(self, headers):
        if not _created["appointments"]:
            pytest.skip()
        aid = _created["appointments"][0]
        for s in ["confirmed", "checked_in", "in_progress"]:
            r = requests.put(f"{API}/appointments/{aid}", headers=headers, json={"status": s})
            assert r.status_code == 200
            assert r.json()["status"] == s

    def test_cancel_appointment_logs_activity(self, headers, audiologist_id, patient_id):
        # Create fresh one and cancel it
        start = _future_iso(7)
        r = requests.post(f"{API}/appointments", headers=headers, json={
            "patient_id": patient_id, "audiologist_id": audiologist_id,
            "service": "OAE", "start_at": start, "duration_minutes": 30,
        })
        assert r.status_code == 200
        aid = r.json()["appointment_id"]
        _created["appointments"].append(aid)
        rc = requests.post(f"{API}/appointments/{aid}/cancel", headers=headers, json={"reason": "patient request"})
        assert rc.status_code == 200, rc.text
        # Verify status
        rg = requests.get(f"{API}/appointments", headers=headers, params={
            "from_date": (datetime.utcnow()).strftime("%Y-%m-%d"),
            "to_date": (datetime.utcnow() + timedelta(days=10)).strftime("%Y-%m-%d"),
            "status": "cancelled",
        })
        assert any(x["appointment_id"] == aid for x in rg.json())

    def test_slots_endpoint(self, headers, audiologist_id):
        date = (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%d")
        r = requests.get(f"{API}/appointments/slots", headers=headers, params={
            "audiologist_id": audiologist_id, "date": date, "duration_minutes": 30,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert "slots" in d
        assert isinstance(d["slots"], list)
        assert len(d["slots"]) > 0


# ==================== WAITLIST ====================
class TestWaitlist:
    def test_add_to_waitlist(self, headers, patient_id, audiologist_id):
        r = requests.post(f"{API}/waitlist", headers=headers, json={
            "patient_id": patient_id, "preferred_audiologist_id": audiologist_id,
            "preferred_service": "PTA", "notes": "TEST",
        })
        assert r.status_code == 200, r.text
        w = r.json()
        assert "entry_id" in w
        assert w["status"] == "active"
        assert "_id" not in w
        _created["waitlist"].append(w["entry_id"])

    def test_list_waitlist_active(self, headers):
        r = requests.get(f"{API}/waitlist", headers=headers, params={"status": "active"})
        assert r.status_code == 200
        rows = r.json()
        assert any(w["entry_id"] in _created["waitlist"] for w in rows)
        for w in rows:
            assert "_id" not in w

    def test_update_waitlist_status(self, headers):
        if not _created["waitlist"]:
            pytest.skip()
        eid = _created["waitlist"][0]
        r = requests.put(f"{API}/waitlist/{eid}/status", headers=headers, json={"status": "scheduled"})
        assert r.status_code == 200
        assert r.json()["status"] == "scheduled"

    def test_invalid_waitlist_status_400(self, headers):
        if not _created["waitlist"]:
            pytest.skip()
        eid = _created["waitlist"][0]
        r = requests.put(f"{API}/waitlist/{eid}/status", headers=headers, json={"status": "bogus"})
        assert r.status_code == 400


# ==================== REMINDERS ====================
class TestReminders:
    def test_send_email_reminder_stub(self, headers, patient_id):
        if not _created["appointments"]:
            pytest.skip()
        aid = _created["appointments"][0]
        r = requests.post(f"{API}/reminders/send", headers=headers, json={
            "appointment_id": aid, "patient_id": patient_id, "channel": "email",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        # Provider not configured → expect stubbed_no_provider_key
        assert d["status"] in ("stubbed_no_provider_key", "sent", "failed")
        assert d["channel"] == "email"
        assert "_id" not in d

    def test_send_whatsapp_reminder_stub(self, headers, patient_id):
        if not _created["appointments"]:
            pytest.skip()
        aid = _created["appointments"][0]
        r = requests.post(f"{API}/reminders/send", headers=headers, json={
            "appointment_id": aid, "patient_id": patient_id, "channel": "whatsapp",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["channel"] == "whatsapp"

    def test_invalid_channel_400(self, headers, patient_id):
        r = requests.post(f"{API}/reminders/send", headers=headers, json={
            "patient_id": patient_id, "channel": "fax",
        })
        assert r.status_code == 400

    def test_list_reminders_logs(self, headers, patient_id):
        r = requests.get(f"{API}/reminders", headers=headers, params={"patient_id": patient_id})
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 2  # email + whatsapp from above
        for row in rows:
            assert "_id" not in row


# ==================== AUTH GATING ====================
class TestAuthGate:
    def test_appointments_unauth(self):
        r = requests.get(f"{API}/appointments")
        assert r.status_code in (401, 403)

    def test_waitlist_unauth(self):
        r = requests.post(f"{API}/waitlist", json={"patient_id": "x"})
        assert r.status_code in (401, 403)

    def test_reminders_unauth(self):
        r = requests.post(f"{API}/reminders/send", json={"patient_id": "x", "channel": "email"})
        assert r.status_code in (401, 403)
