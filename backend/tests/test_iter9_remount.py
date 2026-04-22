"""Iter 9 — Verify router remount (patients, appointments, tokens) + ClinicPulse trend endpoint.

Previously routers were extracted but not mounted → 404s. This test ensures they now
respond correctly and full CRUD + dashboard/queue flow works end-to-end.
"""
import os
from datetime import datetime, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
CLINIC_ID = "clinic-acs-demo"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def fd_token():
    return _login("frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="module")
def acc_token():
    return _login("accounts@acs.in", "accounts123")


@pytest.fixture(scope="module")
def fd_headers(fd_token):
    return {"Authorization": f"Bearer {fd_token}"}


@pytest.fixture(scope="module")
def acc_headers(acc_token):
    return {"Authorization": f"Bearer {acc_token}"}


# ---------------- Patients router (newly mounted) ----------------
class TestPatientsRouter:
    def test_list_patients(self, fd_headers):
        r = requests.get(f"{API}/patients", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_check_duplicate_empty(self, fd_headers):
        r = requests.get(f"{API}/patients/check-duplicate", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert r.json() == {"matches": []}

    def test_patient_crud_and_get(self, fd_headers):
        payload = {
            "name": "TEST_Iter9 Patient",
            "age": 34,
            "gender": "Male",
            "mobile": "9988776611",
            "address": "TEST",
        }
        r = requests.post(f"{API}/patients", headers=fd_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data.get("mrd", "").startswith("ACS-")
        pid = data["patient_id"]

        # GET /patients/{id}
        r2 = requests.get(f"{API}/patients/{pid}", headers=fd_headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["patient_id"] == pid

        # check-duplicate by mobile
        r3 = requests.get(f"{API}/patients/check-duplicate",
                          headers=fd_headers, params={"mobile": "9988776611"}, timeout=15)
        assert r3.status_code == 200
        assert any(m["patient_id"] == pid for m in r3.json()["matches"])

        # cleanup
        requests.delete(f"{API}/patients/{pid}", headers=fd_headers, timeout=15)


# ---------------- Appointments router (newly mounted) ----------------
class TestAppointmentsRouter:
    def test_services_catalog(self, fd_headers):
        r = requests.get(f"{API}/appointments/services", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert "services" in r.json()
        assert len(r.json()["services"]) > 0

    def test_users_audiologist_role(self, fd_headers):
        r = requests.get(f"{API}/users", headers=fd_headers, params={"role": "audiologist"}, timeout=15)
        assert r.status_code == 200
        aus = r.json()
        assert isinstance(aus, list) and len(aus) >= 1
        assert all(u["role"] == "audiologist" for u in aus)

    def test_list_appointments(self, fd_headers):
        r = requests.get(f"{API}/appointments", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_appointments_slots(self, fd_headers):
        # grab audiologist id
        users = requests.get(f"{API}/users", headers=fd_headers, params={"role": "audiologist"}, timeout=15).json()
        aud_id = users[0]["user_id"]
        today = datetime.utcnow().date().isoformat()
        r = requests.get(f"{API}/appointments/slots", headers=fd_headers,
                         params={"audiologist_id": aud_id, "date": today, "duration_minutes": 30}, timeout=15)
        assert r.status_code == 200
        assert "slots" in r.json() and "busy" in r.json()

    def test_appointment_create_update_cancel(self, fd_headers):
        # create a scratch patient
        pres = requests.post(f"{API}/patients", headers=fd_headers, json={
            "name": "TEST_Appt Patient", "age": 40, "gender": "Female", "mobile": "9000011122"
        }, timeout=15)
        assert pres.status_code == 200, pres.text
        pid = pres.json()["patient_id"]

        aud = requests.get(f"{API}/users", headers=fd_headers, params={"role": "audiologist"}, timeout=15).json()[0]
        # pick a time far in future to avoid overlaps
        start = (datetime.utcnow() + timedelta(days=7)).replace(microsecond=0).isoformat()
        create_body = {
            "patient_id": pid,
            "audiologist_id": aud["user_id"],
            "service": "Audiometry",
            "start_at": start,
            "duration_minutes": 30,
            "priority": "normal",
        }
        r = requests.post(f"{API}/appointments", headers=fd_headers, json=create_body, timeout=15)
        assert r.status_code == 200, r.text
        appt = r.json()
        assert appt["patient_id"] == pid
        aid = appt["appointment_id"]

        # update
        r2 = requests.put(f"{API}/appointments/{aid}", headers=fd_headers,
                          json={"notes": "TEST updated"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("notes") == "TEST updated"

        # cancel
        r3 = requests.post(f"{API}/appointments/{aid}/cancel", headers=fd_headers,
                           json={"reason": "test"}, timeout=15)
        assert r3.status_code == 200

        # cleanup patient
        requests.delete(f"{API}/patients/{pid}", headers=fd_headers, timeout=15)


# ---------------- Tokens router + dashboard + public queue ----------------
class TestTokensRouter:
    def test_list_tokens(self, fd_headers):
        r = requests.get(f"{API}/tokens", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_public_queue_no_auth(self):
        r = requests.get(f"{API}/queue/public/{CLINIC_ID}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "now_serving" in body and "next_up" in body and "clinic" in body

    def test_public_queue_404_unknown(self):
        r = requests.get(f"{API}/queue/public/does-not-exist", timeout=15)
        assert r.status_code == 404

    def test_frontdesk_dashboard(self, fd_headers):
        r = requests.get(f"{API}/dashboard/frontdesk", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "kpis" in body and "queue" in body
        for k in ("walkins_today", "returning_today", "appointments_today",
                  "waiting_now", "in_progress", "collections_today", "pending_reports"):
            assert k in body["kpis"], f"missing KPI {k}"

    def test_token_issue_and_status(self, fd_headers):
        # create patient for token
        pres = requests.post(f"{API}/patients", headers=fd_headers,
                             json={"name": "TEST_Token P", "age": 22, "gender": "Male", "mobile": "9111122223"},
                             timeout=15)
        pid = pres.json()["patient_id"]
        t = requests.post(f"{API}/tokens", headers=fd_headers,
                          json={"patient_id": pid, "service": "Audiometry"}, timeout=15)
        assert t.status_code == 200, t.text
        tok = t.json()
        assert tok["token_no"] >= 1
        tid = tok["token_id"]

        # advance
        r = requests.put(f"{API}/tokens/{tid}/status", headers=fd_headers,
                         json={"status": "in_testing"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "in_testing"

        # complete
        r2 = requests.put(f"{API}/tokens/{tid}/status", headers=fd_headers,
                          json={"status": "completed"}, timeout=15)
        assert r2.status_code == 200

        # cleanup
        requests.delete(f"{API}/patients/{pid}", headers=fd_headers, timeout=15)


# ---------------- Closeouts trend (ClinicPulse) ----------------
class TestClinicPulseTrend:
    def test_trend_requires_auth(self):
        r = requests.get(f"{API}/closeouts/trend/collections", timeout=15)
        assert r.status_code in (401, 403)

    def test_trend_default_shape(self, acc_headers):
        r = requests.get(f"{API}/closeouts/trend/collections",
                         headers=acc_headers, params={"days": 14}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("series", "this_week_total", "last_week_total", "wow_delta_pct", "days"):
            assert k in body, f"missing key {k}"
        assert body["days"] == 14
        assert isinstance(body["series"], list)
        assert len(body["series"]) == 14
        for item in body["series"]:
            assert "date" in item and "total" in item

    def test_trend_via_frontdesk_role(self, fd_headers):
        # front desk should also be able to read (ClinicPulse uses logged-in user)
        r = requests.get(f"{API}/closeouts/trend/collections",
                         headers=fd_headers, params={"days": 14}, timeout=15)
        assert r.status_code == 200


# ---------------- Regression smoke — other critical endpoints ----------------
class TestRegressionSmoke:
    def test_auth_me(self, fd_headers):
        r = requests.get(f"{API}/auth/me", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "frontdesk@acs.in"

    def test_billing_services_list(self, fd_headers):
        r = requests.get(f"{API}/billing/services", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_closeouts_list(self, acc_headers):
        r = requests.get(f"{API}/closeouts", headers=acc_headers, timeout=15)
        assert r.status_code == 200

    def test_referring_doctors(self, fd_headers):
        r = requests.get(f"{API}/referring-doctors", headers=fd_headers, timeout=15)
        assert r.status_code == 200

    def test_waitlist(self, fd_headers):
        r = requests.get(f"{API}/waitlist", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_reminders_list(self, fd_headers):
        r = requests.get(f"{API}/reminders", headers=fd_headers, timeout=15)
        assert r.status_code == 200
