"""Iter-10 regression: perf aggregation, router splits (sessions / ref_docs),
and the new short-lived share-link endpoints.

Covers:
* /api/closeouts/trend/collections + /walkins  (shape + IST bucketing + aggregation parity)
* /api/dashboard/frontdesk (returning_today after N+1 → bulk-fetch refactor)
* /api/sessions CRUD + /api/calculate/pta (routers/sessions.py)
* /api/referring-doctors CRUD + /api/patient-notes CRUD (routers/ref_docs.py)
* /api/reports/{session_id}/share-link + /api/reports/shared/{token} + auth-gated PDF
* Regression smoke on extracted routers.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import requests


from _helpers import (  # legacy creds (env-overridable)
    ADMIN_EMAIL, ADMIN_PASSWORD,
    FRONTDESK_EMAIL, FRONTDESK_PASSWORD,
    AUDIO_EMAIL, AUDIO_PASSWORD,
    ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD,
)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

# Load JWT secret straight from backend/.env the same way the server does
with open("/app/backend/.env") as fh:
    for line in fh:
        if line.startswith("JWT_SECRET="):
            JWT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
            break
    else:
        JWT_SECRET = ""


# --------------------------- fixtures ---------------------------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def accounts_token():
    return _login(ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD)


@pytest.fixture(scope="module")
def frontdesk_token():
    return _login(FRONTDESK_EMAIL, FRONTDESK_PASSWORD)


@pytest.fixture(scope="module")
def audiologist_token():
    return _login(AUDIO_EMAIL, AUDIO_PASSWORD)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============== 1. PERF: /closeouts/trend/* aggregation ==============

class TestTrendAggregation:
    def test_collections_trend_shape(self, accounts_token):
        r = requests.get(f"{API}/closeouts/trend/collections?days=14", headers=_h(accounts_token), timeout=20)
        assert r.status_code == 200
        j = r.json()
        for k in ("series", "this_week_total", "last_week_total", "wow_delta_pct", "days", "kind"):
            assert k in j, f"missing key {k}"
        assert j["kind"] == "collections"
        assert j["days"] == 14
        assert isinstance(j["series"], list) and len(j["series"]) == 14
        for s in j["series"]:
            assert "date" in s and "value" in s and "total" in s
            # back-compat alias
            assert s["value"] == s["total"]
            # date is YYYY-MM-DD
            datetime.strptime(s["date"], "%Y-%m-%d")

    def test_walkins_trend_shape(self, accounts_token):
        r = requests.get(f"{API}/closeouts/trend/walkins?days=14", headers=_h(accounts_token), timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert j["kind"] == "walkins"
        assert len(j["series"]) == 14
        # walk-in counts must be non-negative integers
        for s in j["series"]:
            assert isinstance(s["value"], (int, float))
            assert s["value"] >= 0

    def test_collections_trend_this_week_matches_series_sum(self, accounts_token):
        # invariant: this_week_total == sum of last 7 series values
        r = requests.get(f"{API}/closeouts/trend/collections?days=14", headers=_h(accounts_token), timeout=20)
        j = r.json()
        last7 = sum(s["value"] for s in j["series"][-7:])
        assert round(last7, 2) == round(j["this_week_total"], 2)

    def test_trend_requires_auth(self):
        r = requests.get(f"{API}/closeouts/trend/collections?days=7", timeout=10)
        assert r.status_code in (401, 403)


# ============== 2. /api/dashboard/frontdesk bulk fetch ==============

class TestFrontdeskDashboard:
    def test_frontdesk_returns_shape(self, frontdesk_token):
        r = requests.get(f"{API}/dashboard/frontdesk", headers=_h(frontdesk_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "kpis" in j and "queue" in j
        for k in ("walkins_today", "returning_today", "appointments_today",
                  "waitlist_active", "waiting_now", "in_progress",
                  "collections_today", "pending_reports"):
            assert k in j["kpis"], f"missing KPI {k}"
        assert isinstance(j["kpis"]["returning_today"], int)
        assert j["kpis"]["returning_today"] >= 0


# ============== 3. routers/sessions.py ==============

@pytest.fixture(scope="module")
def test_patient_id(admin_token):
    """Create a patient for session tests; clean up at teardown."""
    payload = {
        "name": "TEST_Iter10 SessionPt",
        "age": 45, "gender": "Male",
        "phone": f"99999{uuid.uuid4().hex[:5]}",
    }
    r = requests.post(f"{API}/patients", json=payload, headers=_h(admin_token), timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["patient_id"]
    yield pid
    try:
        requests.delete(f"{API}/patients/{pid}", headers=_h(admin_token), timeout=10)
    except Exception:
        pass


class TestSessionsRouter:
    def test_sessions_crud(self, audiologist_token, test_patient_id):
        payload = {
            "patient_id": test_patient_id,
            "test_date": datetime.utcnow().isoformat(),
            "audiologist_name": "TEST_Iter10 Audiologist",
            "chief_complaint": "iter10 session",
        }
        # CREATE
        r = requests.post(f"{API}/sessions", json=payload, headers=_h(audiologist_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        sid = r.json()["session_id"]

        # GET one
        r = requests.get(f"{API}/sessions/{sid}", headers=_h(audiologist_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["session_id"] == sid

        # LIST by patient
        r = requests.get(f"{API}/sessions?patient_id={test_patient_id}", headers=_h(audiologist_token), timeout=10)
        assert r.status_code == 200
        assert any(s["session_id"] == sid for s in r.json())

        # UPDATE
        r = requests.put(f"{API}/sessions/{sid}", json={"chief_complaint": "updated"},
                         headers=_h(audiologist_token), timeout=10)
        assert r.status_code == 200
        assert r.json().get("chief_complaint") == "updated"

        # DELETE
        r = requests.delete(f"{API}/sessions/{sid}", headers=_h(audiologist_token), timeout=10)
        assert r.status_code == 200

        # verify gone
        r = requests.get(f"{API}/sessions/{sid}", headers=_h(audiologist_token), timeout=10)
        assert r.status_code == 404

    def test_calculate_pta(self, audiologist_token):
        body = {
            "ear": "right",
            "ac_measurements": [
                {"frequency": 500, "threshold_db": 30, "masking": False, "no_response": False},
                {"frequency": 1000, "threshold_db": 40, "masking": False, "no_response": False},
                {"frequency": 2000, "threshold_db": 50, "masking": False, "no_response": False},
                {"frequency": 4000, "threshold_db": 60, "masking": False, "no_response": False},
            ],
        }
        r = requests.post(f"{API}/calculate/pta", json=body, headers=_h(audiologist_token), timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["pta_3freq"] == 40.0           # (30+40+50)/3
        assert j["pta_4freq"] == 45.0           # (30+40+50+60)/4
        assert j["degree"] in {"mild", "moderate"}  # PTA 40 → "mild" per cutoffs
        assert j["ear"] == "right"


# ============== 4. routers/ref_docs.py ==============

class TestRefDocsRouter:
    def test_ref_doctors_crud(self, admin_token):
        payload = {
            "name": f"TEST_Dr_Iter10_{uuid.uuid4().hex[:6]}",
            "specialty": "ENT", "clinic": "Test Clinic", "phone": "9000011111",
        }
        r = requests.post(f"{API}/referring-doctors", json=payload, headers=_h(admin_token), timeout=10)
        assert r.status_code in (200, 201), r.text
        did = r.json()["doctor_id"]

        r = requests.get(f"{API}/referring-doctors?search=TEST_Dr_Iter10", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        assert any(d["doctor_id"] == did for d in r.json())

        r = requests.put(f"{API}/referring-doctors/{did}",
                         json={**payload, "specialty": "Neuro"}, headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["specialty"] == "Neuro"

        r = requests.delete(f"{API}/referring-doctors/{did}", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200

    def test_patient_notes_crud(self, admin_token, test_patient_id):
        payload = {
            "patient_id": test_patient_id,
            "text": "iter10 chart notes",
            "audiologist": "TEST_Iter10",
        }
        r = requests.post(f"{API}/patient-notes", json=payload, headers=_h(admin_token), timeout=10)
        assert r.status_code in (200, 201), r.text
        nid = r.json()["note_id"]

        r = requests.get(f"{API}/patient-notes?patient_id={test_patient_id}", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        assert any(n["note_id"] == nid for n in r.json())

        r = requests.delete(f"{API}/patient-notes/{nid}", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200


# ============== 5. Report share-links + auth-gated PDF ==============

@pytest.fixture(scope="module")
def seeded_session_id(admin_token, test_patient_id):
    payload = {
        "patient_id": test_patient_id,
        "test_date": datetime.utcnow().isoformat(),
        "audiologist_name": "TEST_Iter10",
    }
    r = requests.post(f"{API}/sessions", json=payload, headers=_h(admin_token), timeout=15)
    assert r.status_code in (200, 201), r.text
    sid = r.json()["session_id"]
    yield sid
    try:
        requests.delete(f"{API}/sessions/{sid}", headers=_h(admin_token), timeout=10)
    except Exception:
        pass


class TestReportShareLinks:
    def test_pdf_requires_auth(self, seeded_session_id):
        # Was anonymous — now must be 401.
        r = requests.get(f"{API}/reports/{seeded_session_id}/pdf", timeout=15, allow_redirects=False)
        assert r.status_code in (401, 403), f"expected auth-gated, got {r.status_code}"

    def test_pdf_with_auth_ok(self, accounts_token, seeded_session_id):
        r = requests.get(f"{API}/reports/{seeded_session_id}/pdf", headers=_h(accounts_token), timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert len(r.content) > 100  # real PDF bytes

    def test_share_link_mint(self, accounts_token, seeded_session_id):
        r = requests.post(f"{API}/reports/{seeded_session_id}/share-link",
                          json={"ttl_hours": 24}, headers=_h(accounts_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("path", "token", "expires_at", "ttl_hours"):
            assert k in j
        assert j["path"].startswith("/api/reports/shared/")
        assert j["ttl_hours"] == 24
        assert j["token"] and len(j["token"]) > 20

        # GET shared PDF (unauth)
        r2 = requests.get(f"{BASE_URL}{j['path']}", timeout=30)
        assert r2.status_code == 200, r2.text[:300]
        assert r2.headers.get("content-type", "").startswith("application/pdf")

    def test_share_link_invalid_token(self):
        r = requests.get(f"{API}/reports/shared/not-a-real-jwt", timeout=10)
        assert r.status_code == 401

    def test_share_link_expired(self, seeded_session_id):
        if not JWT_SECRET:
            pytest.skip("JWT_SECRET not readable")
        # Mint an already-expired token using the same secret/algo/type the server expects.
        payload = {
            "session_id": seeded_session_id,
            "clinic_id": "clinic-pytest-suite",
            "type": "report_share",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
            "iat": datetime.now(timezone.utc) - timedelta(hours=2),
        }
        tok = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/reports/shared/{tok}", timeout=10)
        assert r.status_code == 410, f"expected 410 expired, got {r.status_code}: {r.text[:200]}"


# ============== 6. Regression smoke: extracted routers still serve ==============

class TestRouterRegression:
    @pytest.mark.parametrize("endpoint", [
        "/patients",
        "/appointments",
        "/tokens",
        "/billing/services",
        "/closeouts",
        "/referring-doctors",
        "/waitlist",
        "/reminders",
        "/auth/me",
    ])
    def test_authed_endpoints_ok(self, admin_token, endpoint):
        r = requests.get(f"{API}{endpoint}", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200, f"{endpoint} -> {r.status_code} {r.text[:200]}"

    def test_public_queue_ok(self):
        r = requests.get(f"{API}/queue/public/clinic-pytest-suite", timeout=10)
        assert r.status_code == 200
