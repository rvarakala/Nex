"""Iteration 39 tests:
- P0: /api/availability/slots and /api/appointments/slots must return 200 (previously 500)
- Feature 2 backend: /api/csv-exports/* endpoints (subscribe / list / delete / send-now)
- Role gate: front_desk gets 403 on subscribe / send-now
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
OWNER = {"email": "owner@thesoundclinic.in", "password": "demo123"}
FRONT_DESK = {"email": "meera@thesoundclinic.in", "password": "demo123"}
STAFF_ID = "USR-4968EF7C"
DATE = "2026-07-01"


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def owner_client():
    return _login(OWNER)


@pytest.fixture(scope="module")
def front_desk_client():
    try:
        return _login(FRONT_DESK)
    except AssertionError:
        pytest.skip("front_desk login not available")


# ─────────── P0 slot endpoints ───────────

class TestSlotEndpoints:
    def test_availability_slots_returns_200(self, owner_client):
        r = owner_client.get(
            f"{BASE_URL}/api/availability/slots",
            params={"staff_id": STAFF_ID, "date": DATE,
                    "duration_minutes": 30, "override": "false"},
            timeout=30,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "slots" in body, f"missing slots key: {body}"
        assert isinstance(body["slots"], list)

    def test_appointments_slots_returns_200(self, owner_client):
        r = owner_client.get(
            f"{BASE_URL}/api/appointments/slots",
            params={"audiologist_id": STAFF_ID, "date": DATE,
                    "duration_minutes": 30},
            timeout=30,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "slots" in body, f"missing slots key: {body}"
        assert isinstance(body["slots"], list)


# ─────────── CSV export subscriptions ───────────

class TestCsvExports:
    def test_list_initial(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/csv-exports/subscriptions", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_subscribe_patients_and_persist(self, owner_client):
        # Clean slate
        owner_client.delete(f"{BASE_URL}/api/csv-exports/subscribe/patients", timeout=30)

        r = owner_client.post(
            f"{BASE_URL}/api/csv-exports/subscribe",
            json={"kind": "patients"}, timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        body = r.json()
        assert body["kind"] == "patients"
        assert body["active"] is True
        assert "@" in body["email"]

        # Verify persistence via list
        r2 = owner_client.get(f"{BASE_URL}/api/csv-exports/subscriptions", timeout=30)
        assert r2.status_code == 200
        kinds = [s["kind"] for s in r2.json() if s.get("active")]
        assert "patients" in kinds

    def test_subscribe_is_idempotent(self, owner_client):
        r1 = owner_client.post(
            f"{BASE_URL}/api/csv-exports/subscribe",
            json={"kind": "patients"}, timeout=30,
        )
        r2 = owner_client.post(
            f"{BASE_URL}/api/csv-exports/subscribe",
            json={"kind": "patients"}, timeout=30,
        )
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["sub_id"] == r2.json()["sub_id"]

    def test_subscribe_invoices(self, owner_client):
        owner_client.delete(f"{BASE_URL}/api/csv-exports/subscribe/invoices", timeout=30)
        r = owner_client.post(
            f"{BASE_URL}/api/csv-exports/subscribe",
            json={"kind": "invoices"}, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["kind"] == "invoices"

    def test_unsubscribe(self, owner_client):
        # Ensure it exists first
        owner_client.post(
            f"{BASE_URL}/api/csv-exports/subscribe",
            json={"kind": "invoices"}, timeout=30,
        )
        r = owner_client.delete(
            f"{BASE_URL}/api/csv-exports/subscribe/invoices", timeout=30,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Verify gone from list
        rl = owner_client.get(f"{BASE_URL}/api/csv-exports/subscriptions", timeout=30)
        kinds = [s["kind"] for s in rl.json() if s.get("active")]
        assert "invoices" not in kinds

    def test_send_now_patients_no_500(self, owner_client):
        r = owner_client.post(
            f"{BASE_URL}/api/csv-exports/send-now",
            json={"kind": "patients"}, timeout=60,
        )
        # ZeptoMail broken in preview -> status='error' is expected, no 500
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        body = r.json()
        for key in ("ok", "status", "provider", "to", "kind"):
            assert key in body, f"missing key {key} in {body}"
        assert body["kind"] == "patients"

    def test_send_now_invoices_no_500(self, owner_client):
        r = owner_client.post(
            f"{BASE_URL}/api/csv-exports/send-now",
            json={"kind": "invoices"}, timeout=60,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body["kind"] == "invoices"
        assert "status" in body

    def test_invalid_kind_400(self, owner_client):
        r = owner_client.post(
            f"{BASE_URL}/api/csv-exports/subscribe",
            json={"kind": "bogus"}, timeout=30,
        )
        # Pydantic Literal validation -> 422 typical; manual check -> 400
        assert r.status_code in (400, 422)


# ─────────── Role gate (front_desk) ───────────

class TestRoleGate:
    def test_front_desk_cannot_subscribe(self, front_desk_client):
        r = front_desk_client.post(
            f"{BASE_URL}/api/csv-exports/subscribe",
            json={"kind": "patients"}, timeout=30,
        )
        assert r.status_code == 403, f"expected 403 for front_desk, got {r.status_code}: {r.text[:200]}"

    def test_front_desk_cannot_send_now(self, front_desk_client):
        r = front_desk_client.post(
            f"{BASE_URL}/api/csv-exports/send-now",
            json={"kind": "patients"}, timeout=30,
        )
        assert r.status_code == 403

    def test_front_desk_can_list_own_subs(self, front_desk_client):
        # list endpoint has no _require_role -> should be 200 with []
        r = front_desk_client.get(
            f"{BASE_URL}/api/csv-exports/subscriptions", timeout=30,
        )
        assert r.status_code == 200
