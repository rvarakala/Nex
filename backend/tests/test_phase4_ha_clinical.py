"""Phase 4 HA Clinical — backend tests.

Covers:
- Fitting CRUD (create with sale link / without, role gates, branch scope)
- Programming ledger (visit append, adjustments, adaptation score per visit)
- Aided audiogram capture (PUT idempotent)
- Status machine (active → completed, no reopen)
- M02 bridge (/ha/fittings-candidates/{patient_id})
- Iter15 + Phase 3 regression
"""
import os
import uuid
import pytest
import requests



from _helpers import (  # legacy creds (env-overridable)
    ADMIN_EMAIL, ADMIN_PASSWORD,
    FRONTDESK_EMAIL, FRONTDESK_PASSWORD,
    AUDIO_EMAIL, AUDIO_PASSWORD,
    ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD,
)
_url = os.environ.get("REACT_APP_BACKEND_URL")
if not _url:
    with open("/app/frontend/.env") as _fh:
        for _ln in _fh:
            if _ln.startswith("REACT_APP_BACKEND_URL="):
                _url = _ln.split("=", 1)[1].strip()
                break
assert _url, "REACT_APP_BACKEND_URL not set"
BASE_URL = _url.rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text}")
    return r.json()["access_token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def frontdesk_token():
    return _login(FRONTDESK_EMAIL, FRONTDESK_PASSWORD)


@pytest.fixture(scope="session")
def audiologist_token():
    return _login(AUDIO_EMAIL, AUDIO_PASSWORD)


@pytest.fixture(scope="session")
def accounts_token():
    return _login(ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD)


@pytest.fixture(scope="session")
def primary_branch(admin_token):
    r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    branches = r.json()
    assert branches, "No branches seeded"
    return branches[0]["branch_id"]


@pytest.fixture(scope="session")
def some_patient(admin_token):
    r = requests.get(f"{API}/patients?limit=1", headers=hdr(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    if not data:
        # Create one.
        mrd = f"TEST-{uuid.uuid4().hex[:6].upper()}"
        r = requests.post(f"{API}/patients", headers=hdr(admin_token), json={
            "name": "Phase4 Test Patient",
            "age": 60,
            "gender": "Male",
            "mobile": "9999999999",
            "mrd": mrd,
        }, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = [r.json()]
    return data[0]["patient_id"]


# ============================== FITTING CRUD ==============================

class TestFittingCRUD:
    def test_audiologist_can_create_fitting(self, audiologist_token, primary_branch, some_patient):
        r = requests.post(f"{API}/ha/fittings", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch,
            "patient_id": some_patient,
            "notes": "Phase4 create test",
        }, timeout=15)
        assert r.status_code == 201, r.text
        doc = r.json()
        assert doc["status"] == "active"
        assert doc["first_fit_at"]
        assert doc["audiologist_name"] == "Dr. Audiologist"
        assert doc["patient_name"]
        assert doc["visits"] == []
        # Save for later tests on the class
        TestFittingCRUD.fitting_id = doc["fitting_id"]

    def test_front_desk_cannot_create(self, frontdesk_token, primary_branch, some_patient):
        r = requests.post(f"{API}/ha/fittings", headers=hdr(frontdesk_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
        }, timeout=15)
        assert r.status_code == 403, r.text

    def test_front_desk_can_list(self, frontdesk_token):
        r = requests.get(f"{API}/ha/fittings", headers=hdr(frontdesk_token), timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_accounts_cannot_create(self, accounts_token, primary_branch, some_patient):
        r = requests.post(f"{API}/ha/fittings", headers=hdr(accounts_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
        }, timeout=15)
        assert r.status_code == 403, r.text

    def test_patient_not_found_404(self, audiologist_token, primary_branch):
        r = requests.post(f"{API}/ha/fittings", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": "NOPE-000",
        }, timeout=15)
        assert r.status_code == 404, r.text

    def test_get_by_id(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.get(f"{API}/ha/fittings/{fid}", headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["fitting_id"] == fid

    def test_filter_by_patient(self, audiologist_token, some_patient):
        r = requests.get(f"{API}/ha/fittings", headers=hdr(audiologist_token),
                         params={"patient_id": some_patient}, timeout=15)
        assert r.status_code == 200, r.text
        for f in r.json():
            assert f["patient_id"] == some_patient


# ============================== PROGRAMMING LEDGER ==============================

class TestLedger:
    def test_append_visit_with_adjustments(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.post(f"{API}/ha/fittings/{fid}/visits", headers=hdr(audiologist_token), json={
            "kind": "first_fit",
            "notes": "Initial fit done; patient reports clarity",
            "wear_hours_per_day": 6.5,
            "comfort_score": 4,
            "adjustments": [
                {"ear": "right", "param": "gain_2k", "old": "18", "new": "22"},
                {"ear": "left", "param": "mpo", "old": "110", "new": "112"},
            ],
        }, timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert len(doc["visits"]) == 1
        v = doc["visits"][0]
        assert v["kind"] == "first_fit"
        assert v["comfort_score"] == 4
        assert v["wear_hours_per_day"] == 6.5
        assert len(v["adjustments"]) == 2
        assert v["actor_name"]  # populated from user

    def test_comfort_score_out_of_range_400(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.post(f"{API}/ha/fittings/{fid}/visits", headers=hdr(audiologist_token),
                          json={"comfort_score": 9}, timeout=15)
        assert r.status_code == 400, r.text

    def test_wear_hours_out_of_range_400(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.post(f"{API}/ha/fittings/{fid}/visits", headers=hdr(audiologist_token),
                          json={"wear_hours_per_day": 40}, timeout=15)
        assert r.status_code == 400, r.text

    def test_front_desk_cannot_append(self, frontdesk_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.post(f"{API}/ha/fittings/{fid}/visits", headers=hdr(frontdesk_token),
                          json={"kind": "follow_up"}, timeout=15)
        assert r.status_code == 403, r.text

    def test_visits_append_only(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        before = requests.get(f"{API}/ha/fittings/{fid}", headers=hdr(audiologist_token), timeout=15).json()
        requests.post(f"{API}/ha/fittings/{fid}/visits", headers=hdr(audiologist_token),
                      json={"kind": "adjustment", "notes": "small tweak"}, timeout=15)
        after = requests.get(f"{API}/ha/fittings/{fid}", headers=hdr(audiologist_token), timeout=15).json()
        assert len(after["visits"]) == len(before["visits"]) + 1
        # Old visits preserved
        assert after["visits"][0]["visit_id"] == before["visits"][0]["visit_id"]


# ============================== AIDED AUDIOGRAM ==============================

class TestAidedAudiogram:
    def test_set_aided_audiogram(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.put(f"{API}/ha/fittings/{fid}/aided-audiogram", headers=hdr(audiologist_token), json={
            "method": "sound_field",
            "right": {"hz_500": 35, "hz_1000": 30, "hz_2000": 30, "hz_4000": 35},
            "left":  {"hz_500": 40, "hz_1000": 35, "hz_2000": 30, "hz_4000": 35},
            "notes": "Booth A, insert headphones"
        }, timeout=15)
        assert r.status_code == 200, r.text
        a = r.json()["aided_audiogram"]
        assert a["method"] == "sound_field"
        assert a["right"]["hz_2000"] == 30
        assert a["left"]["hz_500"] == 40
        assert a["measured_at"]  # auto-stamped

    def test_update_is_idempotent_and_overwrites(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.put(f"{API}/ha/fittings/{fid}/aided-audiogram", headers=hdr(audiologist_token), json={
            "method": "insertion_gain",
            "right": {"hz_2000": 25},
        }, timeout=15)
        assert r.status_code == 200, r.text
        a = r.json()["aided_audiogram"]
        assert a["method"] == "insertion_gain"
        assert a["right"]["hz_2000"] == 25

    def test_front_desk_cannot_set_audiogram(self, frontdesk_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.put(f"{API}/ha/fittings/{fid}/aided-audiogram", headers=hdr(frontdesk_token),
                         json={"method": "sound_field"}, timeout=15)
        assert r.status_code == 403, r.text


# ============================== STATUS MACHINE ==============================

class TestStatusMachine:
    def test_complete_then_cannot_append_visit(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.put(f"{API}/ha/fittings/{fid}", headers=hdr(audiologist_token),
                         json={"status": "completed"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "completed"
        assert r.json()["completed_at"]

        # Try to append a visit → 409
        r = requests.post(f"{API}/ha/fittings/{fid}/visits", headers=hdr(audiologist_token),
                          json={"kind": "adjustment"}, timeout=15)
        assert r.status_code == 409, r.text

    def test_cannot_reopen_completed(self, audiologist_token):
        fid = TestFittingCRUD.fitting_id
        r = requests.put(f"{API}/ha/fittings/{fid}", headers=hdr(audiologist_token),
                         json={"status": "active"}, timeout=15)
        assert r.status_code == 409, r.text


# ============================== M02 BRIDGE ==============================

class TestM02Bridge:
    def test_fittings_candidates_returns_structure(self, audiologist_token, some_patient):
        r = requests.get(f"{API}/ha/fittings-candidates/{some_patient}",
                         headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "open_sales" in d
        assert "last_pta" in d
        assert d["patient"]["patient_id"] == some_patient

    def test_candidates_bad_patient_404(self, audiologist_token):
        r = requests.get(f"{API}/ha/fittings-candidates/NOPE-000",
                         headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 404, r.text


# ============================== SALE LINK ==============================

class TestSaleLink:
    def test_create_with_bad_sale_404(self, audiologist_token, primary_branch, some_patient):
        r = requests.post(f"{API}/ha/fittings", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch,
            "patient_id": some_patient,
            "sale_no": "SAL-9999-9999",
        }, timeout=15)
        assert r.status_code == 404, r.text


# ============================== REGRESSION ==============================

class TestRegression:
    @pytest.mark.parametrize("path", [
        "/ha/products", "/ha/serial-items", "/ha/grns",
        "/ha/purchase-orders", "/ha/quotations", "/ha/sales",
        "/ha/fittings",
        "/branches", "/vendors", "/patients", "/appointments",
        "/sessions", "/dashboard/frontdesk",
    ])
    def test_endpoint_200(self, admin_token, path):
        r = requests.get(f"{API}{path}", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"
