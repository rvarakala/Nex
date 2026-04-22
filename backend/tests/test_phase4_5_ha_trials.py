"""Phase 4.5 HA Trials — backend tests (catch-up per user's original 7-phase plan).

Covers:
- Trial CRUD (create with state transition IN_STOCK → TRIAL_OUT)
- Lifecycle (active → extended → returned; active → converted; active → lost)
- Serial state guard rails (only IN_STOCK can be trialled)
- KPIs (active / overdue / converted / returned / lost)
- Role gates
- Overdue filter
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests


_url = os.environ.get("REACT_APP_BACKEND_URL")
if not _url:
    with open("/app/frontend/.env") as _fh:
        for _ln in _fh:
            if _ln.startswith("REACT_APP_BACKEND_URL="):
                _url = _ln.split("=", 1)[1].strip()
                break
BASE_URL = _url.rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}")
    return r.json()["access_token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token(): return _login("admin@acs.in", "admin123")


@pytest.fixture(scope="session")
def audiologist_token(): return _login("audiologist@acs.in", "audio123")


@pytest.fixture(scope="session")
def frontdesk_token(): return _login("frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="session")
def accounts_token(): return _login("accounts@acs.in", "accounts123")


@pytest.fixture(scope="session")
def primary_branch(admin_token):
    r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=15)
    return r.json()[0]["branch_id"]


@pytest.fixture(scope="session")
def some_patient(admin_token):
    r = requests.get(f"{API}/patients?limit=1", headers=hdr(admin_token), timeout=15)
    return r.json()[0]["patient_id"]


def _fresh_serial(admin_token):
    """Find an IN_STOCK serial (or skip if none)."""
    r = requests.get(f"{API}/ha/serial-items?state=IN_STOCK&limit=5",
                     headers=hdr(admin_token), timeout=15)
    rows = r.json()
    if not rows:
        pytest.skip("no IN_STOCK serials available for trial test")
    return rows[0]["serial_id"]


def _iso(d): return d.isoformat()


# ==================== CREATE ====================

class TestTrialCreate:
    def test_audiologist_create(self, audiologist_token, primary_branch, some_patient, admin_token):
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid, "side": "single"}],
            "return_date": _iso(date.today() + timedelta(days=10)),
            "deposit_amount": 2000,
            "accessories_given": ["Dome M x2"],
            "notes": "pytest happy path",
        }, timeout=15)
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["status"] == "active"
        assert t["trial_no"].startswith("TRIAL-")
        assert t["patient_name"]

        # Serial should now be TRIAL_OUT
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token)).json()
        assert s["state"] == "TRIAL_OUT"
        assert s.get("current_patient_id") == some_patient

        # Clean up: return
        requests.post(f"{API}/ha/trials/{t['trial_no']}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)

    def test_frontdesk_can_create(self, frontdesk_token, primary_branch, some_patient, admin_token):
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(frontdesk_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=7)),
        }, timeout=15)
        assert r.status_code == 201, r.text
        # Clean up
        requests.post(f"{API}/ha/trials/{r.json()['trial_no']}/return",
                      headers=hdr(frontdesk_token), json={}, timeout=15)

    def test_accounts_cannot_create(self, accounts_token, primary_branch, some_patient, admin_token):
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(accounts_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=7)),
        }, timeout=15)
        assert r.status_code == 403, r.text

    def test_empty_serials_400(self, audiologist_token, primary_branch, some_patient):
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [],
            "return_date": _iso(date.today() + timedelta(days=7)),
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_return_before_start_400(self, audiologist_token, primary_branch, some_patient, admin_token):
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "start_date": _iso(date.today()),
            "return_date": _iso(date.today() - timedelta(days=1)),
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_duplicate_serial_in_request_400(self, audiologist_token, primary_branch, some_patient, admin_token):
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}, {"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=7)),
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_serial_not_in_stock_409(self, audiologist_token, primary_branch, some_patient, admin_token):
        # Create a trial first, then try to trial the same serial again → it's TRIAL_OUT now.
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=7)),
        }, timeout=15)
        assert r.status_code == 201
        tno = r.json()["trial_no"]
        r2 = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=7)),
        }, timeout=15)
        assert r2.status_code == 409, r2.text
        # clean
        requests.post(f"{API}/ha/trials/{tno}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)


# ==================== EXTEND / RETURN / LOST ====================

class TestTrialLifecycle:
    def setup_method(self, method):
        self.cleanup = None

    def _mint(self, audiologist_token, primary_branch, some_patient, admin_token, days=10):
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=days)),
        }, timeout=15)
        assert r.status_code == 201, r.text
        return r.json(), sid

    def test_extend_flow(self, audiologist_token, primary_branch, some_patient, admin_token):
        t, sid = self._mint(audiologist_token, primary_branch, some_patient, admin_token, days=5)
        new_ret = _iso(date.today() + timedelta(days=20))
        r = requests.post(f"{API}/ha/trials/{t['trial_no']}/extend",
                          headers=hdr(audiologist_token), json={"return_date": new_ret}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "extended"
        assert r.json()["return_date"] == new_ret
        # cleanup
        requests.post(f"{API}/ha/trials/{t['trial_no']}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)

    def test_extend_earlier_date_400(self, audiologist_token, primary_branch, some_patient, admin_token):
        t, sid = self._mint(audiologist_token, primary_branch, some_patient, admin_token, days=20)
        earlier = _iso(date.today() + timedelta(days=5))
        r = requests.post(f"{API}/ha/trials/{t['trial_no']}/extend",
                          headers=hdr(audiologist_token), json={"return_date": earlier}, timeout=15)
        assert r.status_code == 400, r.text
        # cleanup
        requests.post(f"{API}/ha/trials/{t['trial_no']}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)

    def test_return_flow(self, audiologist_token, primary_branch, some_patient, admin_token):
        t, sid = self._mint(audiologist_token, primary_branch, some_patient, admin_token)
        r = requests.post(f"{API}/ha/trials/{t['trial_no']}/return",
                          headers=hdr(audiologist_token), json={}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "returned"
        assert r.json()["actual_return_date"]
        # serial back to IN_STOCK
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token)).json()
        assert s["state"] == "IN_STOCK"
        assert s.get("current_patient_id") is None

    def test_lost_flow(self, audiologist_token, primary_branch, some_patient, admin_token):
        t, sid = self._mint(audiologist_token, primary_branch, some_patient, admin_token)
        r = requests.post(f"{API}/ha/trials/{t['trial_no']}/lost",
                         headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "lost"
        # serial → DAMAGED
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token)).json()
        assert s["state"] == "DAMAGED"

    def test_cannot_return_already_returned(self, audiologist_token, primary_branch, some_patient, admin_token):
        t, _ = self._mint(audiologist_token, primary_branch, some_patient, admin_token)
        requests.post(f"{API}/ha/trials/{t['trial_no']}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)
        r = requests.post(f"{API}/ha/trials/{t['trial_no']}/return",
                          headers=hdr(audiologist_token), json={}, timeout=15)
        assert r.status_code == 409, r.text


# ==================== CONVERT → SALE ====================

class TestTrialConvert:
    def test_convert_mints_sale_and_sells_serial(self, audiologist_token, primary_branch, some_patient, admin_token):
        sid = _fresh_serial(admin_token)
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=14)),
        }, timeout=15)
        assert r.status_code == 201
        tno = r.json()["trial_no"]

        r = requests.post(f"{API}/ha/trials/{tno}/convert",
                          headers=hdr(audiologist_token), json={
                              "unit_prices": [120000], "discount_pct": 0, "gst_rate": 18,
                          }, timeout=15)
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["sale_no"].startswith("SAL-")
        assert sale["status"] == "reserved"
        assert abs(sale["total"] - 120000 * 1.18) < 0.01
        # serial is SOLD
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token)).json()
        assert s["state"] == "SOLD"
        # trial linked back
        t = requests.get(f"{API}/ha/trials/{tno}", headers=hdr(audiologist_token)).json()
        assert t["status"] == "converted"
        assert t["converted_sale_no"] == sale["sale_no"]

    def test_convert_length_mismatch_400(self, audiologist_token, primary_branch, some_patient, admin_token):
        sid = _fresh_serial(admin_token)
        tno = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid}],
            "return_date": _iso(date.today() + timedelta(days=7)),
        }, timeout=15).json()["trial_no"]

        r = requests.post(f"{API}/ha/trials/{tno}/convert",
                          headers=hdr(audiologist_token), json={
                              "unit_prices": [100, 200], "gst_rate": 18,
                          }, timeout=15)
        assert r.status_code == 400, r.text
        # cleanup
        requests.post(f"{API}/ha/trials/{tno}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)


# ==================== KPIs + FILTERS ====================

class TestKpisAndFilters:
    def test_kpis_endpoint(self, audiologist_token):
        r = requests.get(f"{API}/ha/trials-kpis", headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d.keys()) >= {"active", "overdue", "converted", "returned", "lost"}
        for v in d.values():
            assert isinstance(v, int)

    def test_filter_by_status(self, audiologist_token):
        r = requests.get(f"{API}/ha/trials?status=returned", headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        for t in r.json():
            assert t["status"] == "returned"

    def test_overdue_filter(self, audiologist_token):
        r = requests.get(f"{API}/ha/trials?overdue=true", headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        today = date.today().isoformat()
        for t in r.json():
            assert t["status"] in {"active", "extended"}
            assert t["return_date"] < today


# ==================== REGRESSION ====================

class TestRegression:
    @pytest.mark.parametrize("path", [
        "/ha/products", "/ha/serial-items", "/ha/trials", "/ha/trials-kpis",
        "/ha/quotations", "/ha/sales", "/ha/fittings",
        "/branches", "/vendors",
    ])
    def test_endpoint_200(self, admin_token, path):
        r = requests.get(f"{API}{path}", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"{path} → {r.status_code}"
