"""Iteration 22 — HA inline serials + demo stock + trial source gate + 'both' side.

Covers the 5 user-reported bugs from iter22:
1. POST/GET /ha/products/{id}/serials (inline serial add from Catalogue form)
2. POST /ha/serial-items/{id}/mark-demo and /unmark-demo (pool flip)
3. GET /ha/demo-stock (aggregated demo-pool view)
4. Quotation side accepts 'both'
5. Trial create requires notes when any picked serial is non-demo (source='external')
6. Tenant isolation (Delhi user cannot touch Mumbai products / see Mumbai demos)
7. Regression: existing all-demo trial flow still works (source='demo')
"""
from __future__ import annotations

import os
import uuid
from datetime import date, timedelta

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
BASE_URL = _url.rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---- session-scope logins ----
@pytest.fixture(scope="session")
def admin_token(): return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def audiologist_token(): return _login(AUDIO_EMAIL, AUDIO_PASSWORD)


@pytest.fixture(scope="session")
def frontdesk_token(): return _login(FRONTDESK_EMAIL, FRONTDESK_PASSWORD)


@pytest.fixture(scope="session")
def accounts_token(): return _login(ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD)


@pytest.fixture(scope="session")
def delhi_admin_token(): return _login("admin@delhi.test", "delhiadmin123")


@pytest.fixture(scope="session")
def primary_branch(admin_token):
    r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()[0]["branch_id"]


@pytest.fixture(scope="session")
def delhi_branch(delhi_admin_token):
    r = requests.get(f"{API}/branches", headers=hdr(delhi_admin_token), timeout=15)
    if r.status_code != 200 or not r.json():
        pytest.skip("no delhi branch available")
    return r.json()[0]["branch_id"]


@pytest.fixture(scope="session")
def some_patient(admin_token):
    r = requests.get(f"{API}/patients?limit=1", headers=hdr(admin_token), timeout=15)
    return r.json()[0]["patient_id"]


def _create_product(admin_token, *, serialised=True, brand=None):
    brand = brand or f"TESTIter22-{uuid.uuid4().hex[:6]}"
    payload = {
        "brand": brand, "model": "M-Serial",
        "form_factor": "RIC", "mrp": 50000, "cost": 30000, "min_sell_price": 35000,
        "is_serialised": serialised,
    }
    r = requests.post(f"{API}/ha/products", headers=hdr(admin_token),
                      json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()["product_id"]


# ==================== (1) Serials inline add ====================


class TestProductSerialsInline:
    def test_add_serials_happy(self, admin_token, primary_branch):
        pid = _create_product(admin_token)
        sn1 = f"SN-{uuid.uuid4().hex[:8].upper()}"
        sn2 = f"SN-{uuid.uuid4().hex[:8].upper()}"
        r = requests.post(f"{API}/ha/products/{pid}/serials", headers=hdr(admin_token), json=[
            {"serial_no": sn1, "branch_id": primary_branch, "pool": "saleable"},
            {"serial_no": sn2, "branch_id": primary_branch, "pool": "demo",
             "warranty_end_date": "2027-01-01", "grn_no": "GRN-TEST-22"},
        ], timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["inserted"] == 2
        assert {s["serial_no"] for s in body["serials"]} == {sn1, sn2}
        # State + pool sanity
        pools = {s["serial_no"]: s["pool"] for s in body["serials"]}
        assert pools[sn1] == "saleable"
        assert pools[sn2] == "demo"
        for s in body["serials"]:
            assert s["state"] == "IN_STOCK"

        # GET should list both
        g = requests.get(f"{API}/ha/products/{pid}/serials",
                         headers=hdr(admin_token), timeout=15)
        assert g.status_code == 200
        all_sns = {s["serial_no"] for s in g.json()}
        assert sn1 in all_sns and sn2 in all_sns

    def test_duplicate_rejected_409(self, admin_token, primary_branch):
        pid = _create_product(admin_token)
        sn = f"DUP-{uuid.uuid4().hex[:8].upper()}"
        p = [{"serial_no": sn, "branch_id": primary_branch}]
        r1 = requests.post(f"{API}/ha/products/{pid}/serials",
                           headers=hdr(admin_token), json=p, timeout=15)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{API}/ha/products/{pid}/serials",
                           headers=hdr(admin_token), json=p, timeout=15)
        assert r2.status_code == 409, r2.text
        assert sn in r2.text

    def test_non_serialised_rejected_400(self, admin_token, primary_branch):
        pid = _create_product(admin_token, serialised=False)
        r = requests.post(f"{API}/ha/products/{pid}/serials",
                          headers=hdr(admin_token),
                          json=[{"serial_no": f"SN-{uuid.uuid4().hex[:6]}",
                                 "branch_id": primary_branch}],
                          timeout=15)
        assert r.status_code == 400, r.text
        assert "serialised" in r.text.lower()

    def test_cross_tenant_403(self, delhi_admin_token, admin_token, primary_branch):
        # Create a Mumbai product
        pid = _create_product(admin_token)
        # Delhi admin tries to add serials to it (should 404/403 — product not found
        # for delhi scope, so 404 from tenant lookup is also acceptable;
        # spec says 403 but 404 is also OK as it proves isolation).
        r = requests.post(f"{API}/ha/products/{pid}/serials",
                          headers=hdr(delhi_admin_token),
                          json=[{"serial_no": f"SN-{uuid.uuid4().hex[:6]}",
                                 "branch_id": "any"}],
                          timeout=15)
        assert r.status_code in (403, 404), r.text


# ==================== (2+3) Demo pool & Demo Stock ====================


class TestDemoStock:
    def _seed_demo_unit(self, admin_token, primary_branch):
        pid = _create_product(admin_token)
        sn = f"DEMO-{uuid.uuid4().hex[:8].upper()}"
        r = requests.post(f"{API}/ha/products/{pid}/serials",
                          headers=hdr(admin_token),
                          json=[{"serial_no": sn, "branch_id": primary_branch,
                                 "pool": "saleable"}],
                          timeout=15)
        assert r.status_code == 200, r.text
        return r.json()["serials"][0]["serial_id"], pid, sn

    def test_mark_demo_flow(self, admin_token, primary_branch):
        sid, pid, sn = self._seed_demo_unit(admin_token, primary_branch)
        r = requests.post(f"{API}/ha/serial-items/{sid}/mark-demo",
                          headers=hdr(admin_token), json={}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["pool"] == "demo"
        # Idempotent
        r2 = requests.post(f"{API}/ha/serial-items/{sid}/mark-demo",
                           headers=hdr(admin_token), json={}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["pool"] == "demo"

    def test_unmark_demo(self, admin_token, primary_branch):
        sid, pid, sn = self._seed_demo_unit(admin_token, primary_branch)
        requests.post(f"{API}/ha/serial-items/{sid}/mark-demo",
                      headers=hdr(admin_token), json={}, timeout=15)
        r = requests.post(f"{API}/ha/serial-items/{sid}/unmark-demo",
                          headers=hdr(admin_token), json={}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["pool"] == "saleable"
        # Second call should 409 (not in demo anymore)
        r2 = requests.post(f"{API}/ha/serial-items/{sid}/unmark-demo",
                           headers=hdr(admin_token), json={}, timeout=15)
        assert r2.status_code == 409

    def test_mark_demo_role_gated(self, accounts_token, admin_token, primary_branch):
        sid, _, _ = self._seed_demo_unit(admin_token, primary_branch)
        r = requests.post(f"{API}/ha/serial-items/{sid}/mark-demo",
                          headers=hdr(accounts_token), json={}, timeout=15)
        assert r.status_code == 403, r.text

    def test_demo_stock_list(self, admin_token, primary_branch):
        sid, pid, sn = self._seed_demo_unit(admin_token, primary_branch)
        requests.post(f"{API}/ha/serial-items/{sid}/mark-demo",
                      headers=hdr(admin_token), json={}, timeout=15)
        r = requests.get(f"{API}/ha/demo-stock", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        # Must contain our just-flipped serial
        match = [x for x in rows if x["serial_id"] == sid]
        assert match, f"seeded demo serial {sn} missing from demo-stock response"
        m = match[0]
        assert m["pool"] == "demo"
        assert m["product"]["product_id"] == pid
        assert m["product"].get("brand")
        # All rows must be pool=demo
        assert all(r["pool"] == "demo" for r in rows)

    def test_demo_stock_tenant_isolation(self, delhi_admin_token, admin_token, primary_branch):
        # Seed Mumbai demo
        sid, _, _ = self._seed_demo_unit(admin_token, primary_branch)
        requests.post(f"{API}/ha/serial-items/{sid}/mark-demo",
                      headers=hdr(admin_token), json={}, timeout=15)
        # Delhi user must not see it
        r = requests.get(f"{API}/ha/demo-stock",
                         headers=hdr(delhi_admin_token), timeout=15)
        assert r.status_code == 200, r.text
        for row in r.json():
            assert row["serial_id"] != sid, "Mumbai demo leaked into Delhi tenant"


# ==================== (4) Quotation side='both' ====================


class TestQuotationBothSide:
    def test_create_quotation_with_both(self, admin_token, primary_branch,
                                        some_patient):
        pid = _create_product(admin_token)
        payload = {
            "branch_id": primary_branch,
            "patient_id": some_patient,
            "lines": [{
                "product_id": pid,
                "side": "both",
                "qty": 2, "unit_price": 50000,
                "gst_rate": 18.0,
            }],
        }
        r = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token),
                          json=payload, timeout=15)
        # 200/201 — pass; 400/422 validation fail would prove the regression.
        assert r.status_code in (200, 201), (
            f"Quotation with side='both' was rejected: {r.status_code} {r.text[:400]}"
        )
        j = r.json()
        assert j["lines"][0]["side"] == "both"


# ==================== (5) Trial source gate ====================


class TestTrialSourceGate:
    def _add_serial(self, admin_token, primary_branch, pool="saleable"):
        pid = _create_product(admin_token)
        sn = f"TR-{uuid.uuid4().hex[:8].upper()}"
        r = requests.post(f"{API}/ha/products/{pid}/serials",
                          headers=hdr(admin_token),
                          json=[{"serial_no": sn, "branch_id": primary_branch,
                                 "pool": pool}],
                          timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["serials"][0]["serial_id"]
        return sid, sn

    def test_trial_demo_pool_succeeds_source_demo(self, audiologist_token, admin_token,
                                                  primary_branch, some_patient):
        sid, sn = self._add_serial(admin_token, primary_branch, pool="saleable")
        # Flip to demo
        r = requests.post(f"{API}/ha/serial-items/{sid}/mark-demo",
                          headers=hdr(admin_token), json={}, timeout=15)
        assert r.status_code == 200

        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid, "side": "single"}],
            "return_date": (date.today() + timedelta(days=7)).isoformat(),
        }, timeout=15)
        assert r.status_code == 201, r.text
        assert r.json().get("source") == "demo"
        # cleanup
        requests.post(f"{API}/ha/trials/{r.json()['trial_no']}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)

    def test_trial_saleable_no_notes_rejected(self, audiologist_token, admin_token,
                                              primary_branch, some_patient):
        sid, sn = self._add_serial(admin_token, primary_branch, pool="saleable")
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid, "side": "single"}],
            "return_date": (date.today() + timedelta(days=7)).isoformat(),
            # notes omitted on purpose
        }, timeout=15)
        assert r.status_code == 400, r.text
        assert "instrument source" in r.text.lower() or "notes" in r.text.lower()

    def test_trial_saleable_with_notes_succeeds_source_external(
        self, audiologist_token, admin_token, primary_branch, some_patient,
    ):
        sid, sn = self._add_serial(admin_token, primary_branch, pool="saleable")
        r = requests.post(f"{API}/ha/trials", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "serials": [{"serial_id": sid, "side": "single"}],
            "return_date": (date.today() + timedelta(days=7)).isoformat(),
            "notes": "Loaner unit from Phonak rep for Iter22 test",
        }, timeout=15)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body.get("source") == "external"
        assert "Phonak" in (body.get("notes") or "")
        # cleanup
        requests.post(f"{API}/ha/trials/{body['trial_no']}/return",
                      headers=hdr(audiologist_token), json={}, timeout=15)


# ==================== (6) Regression: inventory board + serial-items list ====================


class TestRegression:
    def test_serial_items_list_still_works(self, admin_token):
        r = requests.get(f"{API}/ha/serial-items?limit=5",
                         headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_branches_list(self, admin_token):
        r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 1
