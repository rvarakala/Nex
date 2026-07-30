"""Phase B — HA-wing appointment regression.

Verifies:
  * POST /api/appointments (with wing='hearing_aid' and hearing_aid_services)
    persists both fields.
  * POST /api/appointments/with-invoice with HA wing → appointment has
    wing='hearing_aid', hearing_aid_services, category='fitting'; invoice
    with 2 lines is created.
  * PUT /api/appointments/{id} can update wing + hearing_aid_services.
  * Backwards compat: omitting wing/hearing_aid_services defaults to
    diagnostic + [].
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read the frontend .env file directly.
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

EMAIL = "dltest@example.com"
PASSWORD = "TestPass@123"


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
    # Try find any existing patient; else create one.
    r = requests.get(f"{BASE_URL}/api/patients?per_page=5", headers=hdrs, timeout=15)
    if r.status_code == 200:
        body = r.json()
        if isinstance(body, list):
            items = body
        else:
            items = body.get("items") or body.get("patients") or []
        if items:
            return items[0]["patient_id"]
    payload = {"name": f"TEST HA Wing {uuid.uuid4().hex[:6]}", "age": 40, "gender": "M", "mobile": "9000000000"}
    r = requests.post(f"{BASE_URL}/api/patients", headers=hdrs, json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()["patient_id"]


@pytest.fixture(scope="module")
def audiologist_id(hdrs) -> str:
    r = requests.get(f"{BASE_URL}/api/tenant/users", headers=hdrs, timeout=15)
    if r.status_code != 200:
        # try alt route
        r = requests.get(f"{BASE_URL}/api/users", headers=hdrs, timeout=15)
    assert r.status_code == 200, r.text
    users = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    # prefer audiologist role, else clinic_owner
    for u in users:
        if u.get("role") == "audiologist":
            return u["user_id"]
    for u in users:
        if u.get("role") in ("clinic_owner", "super_admin"):
            return u["user_id"]
    pytest.skip("no user to book audiologist against")


# Use random-ish offset far in the future to avoid seeded appointment collisions.
_RUN_ID = uuid.uuid4().int % 100
def _future_slot(day_offset: int = 0, hour: int = 8, minute: int = 0) -> str:
    dt = datetime.now(timezone.utc) + timedelta(days=30 + _RUN_ID + day_offset)
    dt = dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return dt.isoformat()


_SLOT_BASE_HOUR = 8


# ---------- HA-wing create + update ---------------------------------------

class TestHAWingAppointment:
    def test_create_ha_wing_appointment(self, hdrs, patient_id, audiologist_id):
        payload = {
            "patient_id": patient_id,
            "audiologist_id": audiologist_id,
            "counterparty_type": "patient",
            "counterparty_id": patient_id,
            "service": "Hearing Aid Fitting",
            "start_at": _future_slot(0, _SLOT_BASE_HOUR, 0),
            "duration_minutes": 75,
            "visit_type": "walkin",
            "wing": "hearing_aid",
            "hearing_aid_services": ["ha_fitting", "ha_earmould"],
            "category": "fitting",
        }
        r = requests.post(f"{BASE_URL}/api/appointments", headers=hdrs, json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        apt = r.json()
        assert apt["wing"] == "hearing_aid"
        assert apt["hearing_aid_services"] == ["ha_fitting", "ha_earmould"]
        assert apt["category"] == "fitting"
        self.apt_id = apt["appointment_id"]
        # (GET-by-id endpoint doesn't exist for appointments in this app;
        # the create response already contains persisted fields.)

    def test_update_ha_wing_appointment(self, hdrs, patient_id, audiologist_id):
        # create fresh
        payload = {
            "patient_id": patient_id,
            "audiologist_id": audiologist_id,
            "counterparty_type": "patient",
            "counterparty_id": patient_id,
            "service": "HA Trial",
            "start_at": _future_slot(0, _SLOT_BASE_HOUR + 2, 0),
            "duration_minutes": 60,
            "wing": "hearing_aid",
            "hearing_aid_services": ["ha_trial"],
        }
        c = requests.post(f"{BASE_URL}/api/appointments", headers=hdrs, json=payload, timeout=15)
        assert c.status_code in (200, 201), c.text
        apt_id = c.json()["appointment_id"]

        # update: add earmould, change duration
        upd = {"hearing_aid_services": ["ha_trial", "ha_earmould"], "wing": "hearing_aid", "duration_minutes": 90}
        u = requests.put(f"{BASE_URL}/api/appointments/{apt_id}", headers=hdrs, json=upd, timeout=15)
        assert u.status_code == 200, u.text
        upd_body = u.json()
        assert set(upd_body["hearing_aid_services"]) == {"ha_trial", "ha_earmould"}
        assert upd_body["wing"] == "hearing_aid"
        assert upd_body["duration_minutes"] == 90

    def test_default_wing_backwards_compat(self, hdrs, patient_id, audiologist_id):
        # Omit wing + hearing_aid_services → defaults to diagnostic + []
        payload = {
            "patient_id": patient_id,
            "audiologist_id": audiologist_id,
            "counterparty_type": "patient",
            "counterparty_id": patient_id,
            "service": "Consultation",
            "start_at": _future_slot(1, _SLOT_BASE_HOUR, 0),
            "duration_minutes": 30,
        }
        r = requests.post(f"{BASE_URL}/api/appointments", headers=hdrs, json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        apt = r.json()
        assert apt.get("wing", "diagnostic") == "diagnostic"
        assert apt.get("hearing_aid_services", []) == []


# ---------- HA-wing atomic appointment+invoice endpoint --------------------

class TestHAWingWithInvoice:
    def test_with_invoice_ha_wing(self, hdrs, patient_id, audiologist_id):
        payload = {
            "patient_id": patient_id,
            "audiologist_id": audiologist_id,
            "service": "Hearing Aid Fitting",
            "start_at": _future_slot(1, _SLOT_BASE_HOUR, 30),
            "duration_minutes": 75,
            "visit_type": "walkin",
            "wing": "hearing_aid",
            "hearing_aid_services": ["ha_fitting", "ha_earmould"],
            "raise_invoice": True,
            "invoice_lines": [
                {"description": "Hearing Aid Fitting", "quantity": 1, "unit_price": 1500},
                {"description": "Ear Mould (custom)", "quantity": 1, "unit_price": 1200},
            ],
        }
        r = requests.post(
            f"{BASE_URL}/api/appointments/with-invoice",
            headers=hdrs, json=payload, timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        apt = body["appointment"]
        assert apt["wing"] == "hearing_aid"
        assert set(apt["hearing_aid_services"]) == {"ha_fitting", "ha_earmould"}
        assert apt["category"] == "fitting"
        inv = body["invoice"]
        assert inv and "error" not in inv, f"invoice error: {inv}"
        assert len(inv["lines"]) == 2
        # Draft total should be ~2700 (may vary if GST applies)
        assert inv["grand_total"] >= 2700 - 1

    def test_with_invoice_diagnostic_default(self, hdrs, patient_id, audiologist_id):
        payload = {
            "patient_id": patient_id,
            "audiologist_id": audiologist_id,
            "service": "PTA",
            "start_at": _future_slot(2, _SLOT_BASE_HOUR, 0),
            "duration_minutes": 30,
            "visit_type": "walkin",
            # wing/hearing_aid_services omitted
            "raise_invoice": False,
            "invoice_lines": [],
        }
        r = requests.post(
            f"{BASE_URL}/api/appointments/with-invoice",
            headers=hdrs, json=payload, timeout=15,
        )
        assert r.status_code == 200, r.text
        apt = r.json()["appointment"]
        assert apt.get("wing", "diagnostic") == "diagnostic"
        assert apt.get("category") == "consultation"
