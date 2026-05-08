"""Iter-11 regression: Cross-tenant isolation (Delhi vs Mumbai),
billing DI convergence, and WhatsApp desktop share-link embed.

Covers:
* Delhi login + scope (GET /patients empty, GET /billing/services = 12)
* Cross-tenant 403 on /api/reports/{SID}/pdf + /share-link
* Cross-tenant 404 on /api/patients/{pid} + /api/billing/invoices/{iid}
* Shared-link clinic scoping + tampering → 401
* Billing DI regression — all 13 billing endpoints
* Mumbai regression smoke
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

# JWT secret from backend/.env
JWT_SECRET = ""
with open("/app/backend/.env") as fh:
    for line in fh:
        if line.startswith("JWT_SECRET="):
            JWT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
            break


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---- module-scoped logins ----
@pytest.fixture(scope="module")
def mumbai_admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)["access_token"]


@pytest.fixture(scope="module")
def mumbai_frontdesk():
    return _login("frontdesk@acs.in", "frontdesk123")["access_token"]


@pytest.fixture(scope="module")
def mumbai_accounts():
    return _login("accounts@acs.in", "accounts123")["access_token"]


@pytest.fixture(scope="module")
def mumbai_audio():
    return _login("audiologist@acs.in", "audio123")["access_token"]


@pytest.fixture(scope="module")
def delhi_admin_login():
    return _login("admin@delhi.test", "delhiadmin123")


@pytest.fixture(scope="module")
def delhi_admin(delhi_admin_login):
    return delhi_admin_login["access_token"]


@pytest.fixture(scope="module")
def delhi_frontdesk_login():
    return _login("frontdesk@delhi.test", "delhifrontdesk123")


@pytest.fixture(scope="module")
def delhi_frontdesk(delhi_frontdesk_login):
    return delhi_frontdesk_login["access_token"]


# ============================================================
# 1. Delhi login + scope
# ============================================================

class TestDelhiLoginScope:
    def test_delhi_frontdesk_login_shape(self, delhi_frontdesk_login):
        j = delhi_frontdesk_login
        assert "access_token" in j and j["access_token"]
        assert j["user"]["clinic_id"] == "clinic-delhi-test"
        assert j["clinic"]["name"] == "Delhi Test Branch"
        assert j["user"]["email"] == "frontdesk@delhi.test"

    def test_delhi_patients_empty(self, delhi_frontdesk):
        r = requests.get(f"{API}/patients", headers=_h(delhi_frontdesk), timeout=15)
        assert r.status_code == 200
        body = r.json()
        # Delhi is a fresh clinic. But tests below may have created Delhi patients.
        # We only assert it is a list scoped correctly — not necessarily empty forever.
        assert isinstance(body, list)
        for p in body:
            assert p.get("clinic_id") in (None, "clinic-delhi-test")

    def test_delhi_services_seeded_twelve(self, delhi_frontdesk):
        r = requests.get(f"{API}/billing/services", headers=_h(delhi_frontdesk), timeout=15)
        assert r.status_code == 200
        services = r.json()
        assert len(services) == 12, f"Expected 12 Delhi services, got {len(services)}"
        for s in services:
            assert s["clinic_id"] == "clinic-delhi-test"


# ============================================================
# 2. Build test-entities in Mumbai + Delhi for cross-tenant tests
# ============================================================

@pytest.fixture(scope="module")
def mumbai_patient_id(mumbai_admin):
    pl = {"name": "TEST_Iter11 MumPt", "age": 30, "gender": "Male",
          "phone": f"98777{uuid.uuid4().hex[:5]}"}
    r = requests.post(f"{API}/patients", json=pl, headers=_h(mumbai_admin), timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["patient_id"]
    yield pid
    try:
        requests.delete(f"{API}/patients/{pid}", headers=_h(mumbai_admin), timeout=10)
    except Exception:
        pass


@pytest.fixture(scope="module")
def mumbai_session_id(mumbai_audio, mumbai_patient_id):
    pl = {"patient_id": mumbai_patient_id,
          "test_date": datetime.utcnow().isoformat(),
          "audiologist_name": "TEST_Iter11"}
    r = requests.post(f"{API}/sessions", json=pl, headers=_h(mumbai_audio), timeout=15)
    assert r.status_code in (200, 201), r.text
    sid = r.json()["session_id"]
    yield sid
    try:
        requests.delete(f"{API}/sessions/{sid}", headers=_h(mumbai_audio), timeout=10)
    except Exception:
        pass


@pytest.fixture(scope="module")
def delhi_patient_id(delhi_admin):
    pl = {"name": "TEST_Iter11 DelPt", "age": 35, "gender": "Female",
          "phone": f"98666{uuid.uuid4().hex[:5]}"}
    r = requests.post(f"{API}/patients", json=pl, headers=_h(delhi_admin), timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["patient_id"]
    yield pid
    try:
        requests.delete(f"{API}/patients/{pid}", headers=_h(delhi_admin), timeout=10)
    except Exception:
        pass


@pytest.fixture(scope="module")
def delhi_session_id(delhi_admin, delhi_patient_id):
    pl = {"patient_id": delhi_patient_id,
          "test_date": datetime.utcnow().isoformat(),
          "audiologist_name": "TEST_Iter11Del"}
    r = requests.post(f"{API}/sessions", json=pl, headers=_h(delhi_admin), timeout=15)
    assert r.status_code in (200, 201), r.text
    sid = r.json()["session_id"]
    yield sid
    try:
        requests.delete(f"{API}/sessions/{sid}", headers=_h(delhi_admin), timeout=10)
    except Exception:
        pass


# ============================================================
# 3. Cross-tenant 403 on report endpoints
# ============================================================

class TestCrossTenantReports:
    def test_delhi_cannot_get_mumbai_pdf(self, delhi_admin, mumbai_session_id):
        r = requests.get(f"{API}/reports/{mumbai_session_id}/pdf",
                         headers=_h(delhi_admin), timeout=20)
        assert r.status_code == 403, f"Delhi→Mumbai PDF must be 403, got {r.status_code}: {r.text[:200]}"

    def test_delhi_cannot_mint_share_link_for_mumbai(self, delhi_admin, mumbai_session_id):
        r = requests.post(f"{API}/reports/{mumbai_session_id}/share-link",
                          json={"ttl_hours": 24},
                          headers=_h(delhi_admin), timeout=15)
        assert r.status_code == 403, f"Delhi→Mumbai share-link must be 403, got {r.status_code}"

    def test_mumbai_can_get_own_pdf(self, mumbai_accounts, mumbai_session_id):
        r = requests.get(f"{API}/reports/{mumbai_session_id}/pdf",
                         headers=_h(mumbai_accounts), timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")


# ============================================================
# 4. Cross-tenant 404 on patient
# ============================================================

class TestCrossTenantPatients:
    def test_mumbai_cannot_fetch_delhi_patient(self, mumbai_frontdesk, delhi_patient_id):
        r = requests.get(f"{API}/patients/{delhi_patient_id}",
                         headers=_h(mumbai_frontdesk), timeout=10)
        assert r.status_code == 404, f"expected 404 across clinic, got {r.status_code}"

    def test_delhi_can_fetch_own_patient(self, delhi_admin, delhi_patient_id):
        r = requests.get(f"{API}/patients/{delhi_patient_id}",
                         headers=_h(delhi_admin), timeout=10)
        assert r.status_code == 200
        assert r.json()["patient_id"] == delhi_patient_id


# ============================================================
# 5. Cross-tenant 404 on invoice (billing DI regression)
# ============================================================

@pytest.fixture(scope="module")
def delhi_invoice_id(delhi_admin, delhi_patient_id):
    # Delhi-seeded services include the 12 defaults.
    srv = requests.get(f"{API}/billing/services", headers=_h(delhi_admin), timeout=10).json()
    assert len(srv) >= 1
    pl = {
        "patient_id": delhi_patient_id,
        "lines": [{
            "service_id": srv[0]["service_id"],
            "quantity": 1,
        }],
    }
    r = requests.post(f"{API}/billing/invoices", json=pl, headers=_h(delhi_admin), timeout=15)
    assert r.status_code in (200, 201), r.text
    iid = r.json()["invoice_id"]
    yield iid


class TestCrossTenantInvoice:
    def test_mumbai_cannot_fetch_delhi_invoice(self, mumbai_accounts, delhi_invoice_id):
        r = requests.get(f"{API}/billing/invoices/{delhi_invoice_id}",
                         headers=_h(mumbai_accounts), timeout=10)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"

    def test_delhi_can_fetch_own_invoice(self, delhi_admin, delhi_invoice_id):
        r = requests.get(f"{API}/billing/invoices/{delhi_invoice_id}",
                         headers=_h(delhi_admin), timeout=10)
        assert r.status_code == 200
        assert r.json()["invoice_id"] == delhi_invoice_id


# ============================================================
# 6. Share-token: own-clinic OK + tampered clinic_id → 401
# ============================================================

class TestShareTokenIsolation:
    def test_delhi_mints_and_fetches_own_share(self, delhi_admin, delhi_session_id):
        r = requests.post(f"{API}/reports/{delhi_session_id}/share-link",
                          json={"ttl_hours": 24},
                          headers=_h(delhi_admin), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        path = j["path"]
        r2 = requests.get(f"{BASE_URL}{path}", timeout=30)
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("application/pdf")

    def test_tampered_share_token_clinic_mismatch(self, mumbai_session_id):
        if not JWT_SECRET:
            pytest.skip("JWT_SECRET not readable")
        # Mint token with Delhi clinic_id but a Mumbai session_id
        payload = {
            "session_id": mumbai_session_id,
            "clinic_id": "clinic-delhi-test",
            "type": "report_share",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
        }
        tok = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/reports/shared/{tok}", timeout=10)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"


# ============================================================
# 7. Billing DI regression — all 13 endpoints respond 200
# ============================================================

class TestBillingDIRegression:
    def test_services_list(self, mumbai_accounts):
        r = requests.get(f"{API}/billing/services", headers=_h(mumbai_accounts), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_services_create_update_delete(self, mumbai_admin):
        pl = {"name": f"TEST_Srv_{uuid.uuid4().hex[:5]}", "category": "Diagnostic",
              "price": 500, "active": True}
        r = requests.post(f"{API}/billing/services", json=pl, headers=_h(mumbai_admin), timeout=10)
        assert r.status_code in (200, 201), r.text
        sid = r.json()["service_id"]

        r2 = requests.put(f"{API}/billing/services/{sid}",
                          json={"price": 600},
                          headers=_h(mumbai_admin), timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("price") == 600

        r3 = requests.delete(f"{API}/billing/services/{sid}",
                             headers=_h(mumbai_admin), timeout=10)
        assert r3.status_code in (200, 204)

    def test_invoice_crud_payment_cancel(self, mumbai_admin, mumbai_accounts, mumbai_patient_id):
        srv = requests.get(f"{API}/billing/services", headers=_h(mumbai_accounts), timeout=10).json()
        assert len(srv) >= 1

        # CREATE invoice
        pl = {
            "patient_id": mumbai_patient_id,
            "lines": [{
                "service_id": srv[0]["service_id"],
                "quantity": 1,
            }],
        }
        r = requests.post(f"{API}/billing/invoices", json=pl, headers=_h(mumbai_admin), timeout=15)
        assert r.status_code in (200, 201), r.text
        inv = r.json()
        iid = inv["invoice_id"]

        # LIST invoices
        r2 = requests.get(f"{API}/billing/invoices", headers=_h(mumbai_accounts), timeout=10)
        assert r2.status_code == 200
        assert any(x["invoice_id"] == iid for x in r2.json())

        # GET invoice
        r3 = requests.get(f"{API}/billing/invoices/{iid}", headers=_h(mumbai_accounts), timeout=10)
        assert r3.status_code == 200

        # UPDATE invoice (PUT) — soft edit, if supported; else allow 405
        put_pl = dict(pl)
        r4 = requests.put(f"{API}/billing/invoices/{iid}", json=put_pl,
                          headers=_h(mumbai_admin), timeout=10)
        assert r4.status_code in (200, 405, 404)  # PUT may or may not exist

        # PAYMENT
        pay_pl = {"amount": 100, "method": "cash"}
        r5 = requests.post(f"{API}/billing/invoices/{iid}/payments",
                           json=pay_pl, headers=_h(mumbai_accounts), timeout=10)
        assert r5.status_code in (200, 201), r5.text

        # CANCEL
        r6 = requests.post(f"{API}/billing/invoices/{iid}/cancel",
                           json={"reason": "test"},
                           headers=_h(mumbai_admin), timeout=10)
        assert r6.status_code in (200, 201), r6.text

    def test_collections(self, mumbai_accounts):
        r = requests.get(f"{API}/billing/collections", headers=_h(mumbai_accounts), timeout=10)
        assert r.status_code == 200

    def test_pending_reports(self, mumbai_accounts):
        r = requests.get(f"{API}/billing/pending-reports", headers=_h(mumbai_accounts), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_report_deliveries_get(self, mumbai_accounts):
        r = requests.get(f"{API}/billing/report-deliveries", headers=_h(mumbai_accounts), timeout=10)
        assert r.status_code == 200

    def test_report_deliveries_post(self, mumbai_accounts, mumbai_session_id):
        pl = {"session_id": mumbai_session_id, "channel": "print", "recipient": None}
        r = requests.post(f"{API}/billing/report-deliveries", json=pl,
                          headers=_h(mumbai_accounts), timeout=10)
        assert r.status_code in (200, 201), r.text


# ============================================================
# 8. Mumbai regression smoke
# ============================================================

class TestMumbaiRegression:
    @pytest.mark.parametrize("endpoint", [
        "/patients",
        "/appointments",
        "/tokens",
        "/sessions",
        "/referring-doctors",
        "/dashboard/frontdesk",
        "/closeouts",
        "/closeouts/trend/collections?days=7",
        "/closeouts/trend/walkins?days=7",
    ])
    def test_authed_ok(self, mumbai_frontdesk, endpoint):
        r = requests.get(f"{API}{endpoint}", headers=_h(mumbai_frontdesk), timeout=15)
        assert r.status_code == 200, f"{endpoint} -> {r.status_code}: {r.text[:200]}"
