"""Phase 10 — Service Revenue analytics tile + Loaner Allocation module.

Covers:
* GET /api/ha/analytics/service-revenue (shape + role gate)
* POST/GET /api/ha/loaners lifecycle + KPIs
* Loaner return transitions (IN_STOCK and DAMAGED)
* Guardrails (409 on non-IN_STOCK, 400 on past date, role gates)
"""
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
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                _url = ln.split("=", 1)[1].strip()
                break
BASE_URL = _url.rstrip("/")
API = f"{BASE_URL}/api"


# ---------- helpers ----------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.text}")
    return r.json()["access_token"]


def hdr(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def admin_token(): return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def frontdesk_token(): return _login(FRONTDESK_EMAIL, FRONTDESK_PASSWORD)


@pytest.fixture(scope="session")
def audio_token(): return _login(AUDIO_EMAIL, AUDIO_PASSWORD)


@pytest.fixture(scope="session")
def accounts_token(): return _login(ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD)


@pytest.fixture(scope="session")
def admin_context(admin_token):
    me = requests.get(f"{API}/auth/me", headers=hdr(admin_token), timeout=15).json()
    branches = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=15).json()
    if not branches:
        pytest.skip("no branches in seed")
    branch_id = branches[0].get("branch_id") or branches[0].get("id")
    return {"user": me, "branch_id": branch_id}


@pytest.fixture(scope="session")
def patient_id(admin_token):
    r = requests.get(f"{API}/patients", headers=hdr(admin_token), timeout=15)
    r.raise_for_status()
    rows = r.json()
    rows = rows if isinstance(rows, list) else rows.get("items") or []
    if not rows:
        pytest.skip("no patients in seed")
    return rows[0].get("patient_id") or rows[0].get("id")


def _make_serial(admin_token, branch_id):
    """Create a product + vendor + PO + GRN so we have an IN_STOCK serial to test with."""
    # Ensure at least one product exists
    p_list = requests.get(f"{API}/ha/products", headers=hdr(admin_token), timeout=15).json()
    if p_list:
        product_id = p_list[0]["product_id"]
    else:
        p = requests.post(
            f"{API}/ha/products",
            headers=hdr(admin_token),
            json={"brand": "TEST_Loaner", "model": "LN-1", "mrp": 50000, "cost": 30000, "min_sell_price": 40000},
            timeout=15,
        )
        p.raise_for_status()
        product_id = p.json()["product_id"]

    v_list = requests.get(f"{API}/vendors", headers=hdr(admin_token), timeout=15).json()
    if v_list:
        vendor_id = v_list[0]["vendor_id"]
    else:
        v = requests.post(
            f"{API}/vendors", headers=hdr(admin_token),
            json={"name": "TEST_Vendor"}, timeout=15,
        )
        v.raise_for_status()
        vendor_id = v.json()["vendor_id"]

    po = requests.post(
        f"{API}/ha/purchase-orders", headers=hdr(admin_token),
        json={
            "branch_id": branch_id, "vendor_id": vendor_id,
            "lines": [{"product_id": product_id, "qty": 1, "unit_cost": 30000, "gst_rate": 18}],
        },
        timeout=15,
    )
    assert po.status_code in (200, 201), po.text
    po_no = po.json()["po_no"]
    for to in ["approved", "ordered"]:
        r = requests.post(f"{API}/ha/purchase-orders/{po_no}/status",
                          headers=hdr(admin_token), json={"to_status": to}, timeout=10)
        assert r.status_code == 200, r.text

    sn = f"TEST-LN-{uuid.uuid4().hex[:10].upper()}"
    grn = requests.post(
        f"{API}/ha/grns", headers=hdr(admin_token),
        json={
            "po_no": po_no,
            "lines": [{"product_id": product_id, "qty_received": 1, "serial_nos": [sn]}],
        },
        timeout=15,
    )
    assert grn.status_code in (200, 201), grn.text
    items = requests.get(f"{API}/ha/serial-items?search={sn}", headers=hdr(admin_token), timeout=15).json()
    rows = items if isinstance(items, list) else items.get("items") or []
    for it in rows:
        if it.get("serial_no") == sn:
            return it["serial_id"]
    pytest.skip(f"failed to mint IN_STOCK serial for loaner tests (sn={sn})")


# ================== SERVICE REVENUE ==================

class TestServiceRevenue:
    def test_shape(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/service-revenue", headers=hdr(admin_token),
                         params={"days": 90}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["window_days"] == 90
        assert set(data["totals"].keys()) >= {"paid_revenue", "warranty_tickets", "total_tickets"}
        assert isinstance(data["by_kind"], list)
        assert isinstance(data["by_technician"], list)

    def test_role_gate_frontdesk_403(self, frontdesk_token):
        r = requests.get(f"{API}/ha/analytics/service-revenue", headers=hdr(frontdesk_token),
                         params={"days": 90}, timeout=15)
        assert r.status_code == 403, r.text

    def test_role_gate_audiologist_403(self, audio_token):
        r = requests.get(f"{API}/ha/analytics/service-revenue", headers=hdr(audio_token),
                         params={"days": 90}, timeout=15)
        assert r.status_code == 403, r.text

    def test_role_gate_accounts_200(self, accounts_token):
        r = requests.get(f"{API}/ha/analytics/service-revenue", headers=hdr(accounts_token),
                         params={"days": 30}, timeout=15)
        assert r.status_code == 200, r.text


# ================== LOANER LIFECYCLE ==================

class TestLoaners:
    def test_create_list_kpis_and_return_in_stock(self, admin_token, admin_context, patient_id):
        branch_id = admin_context["branch_id"]
        serial_id = _make_serial(admin_token, branch_id)

        # CREATE
        expected = (date.today() + timedelta(days=7)).isoformat()
        r = requests.post(
            f"{API}/ha/loaners", headers=hdr(admin_token),
            json={
                "branch_id": branch_id, "patient_id": patient_id,
                "serial_id": serial_id, "expected_return_date": expected,
                "notes": "TEST_loaner",
            }, timeout=15,
        )
        assert r.status_code == 201, r.text
        loaner = r.json()
        assert loaner["status"] == "active"
        assert loaner["serial_id"] == serial_id
        loaner_id = loaner["loaner_id"]

        # Verify serial → LOANER
        ser = requests.get(f"{API}/ha/serial-items/{serial_id}", headers=hdr(admin_token), timeout=15).json()
        assert ser["state"] == "LOANER"

        # LIST
        lst = requests.get(f"{API}/ha/loaners", headers=hdr(admin_token), timeout=15).json()
        assert any(x["loaner_id"] == loaner_id for x in lst)

        # KPIs
        k = requests.get(f"{API}/ha/loaners-kpis", headers=hdr(admin_token), timeout=15).json()
        assert set(k.keys()) == {"active", "overdue", "returned", "damaged"}
        assert k["active"] >= 1

        # RETURN clean
        r = requests.post(
            f"{API}/ha/loaners/{loaner_id}/return", headers=hdr(admin_token),
            json={"damaged": False}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "returned"

        # Verify serial back to IN_STOCK
        ser = requests.get(f"{API}/ha/serial-items/{serial_id}", headers=hdr(admin_token), timeout=15).json()
        assert ser["state"] == "IN_STOCK"

    def test_return_damaged(self, admin_token, admin_context, patient_id):
        branch_id = admin_context["branch_id"]
        serial_id = _make_serial(admin_token, branch_id)
        expected = (date.today() + timedelta(days=3)).isoformat()
        r = requests.post(
            f"{API}/ha/loaners", headers=hdr(admin_token),
            json={"branch_id": branch_id, "patient_id": patient_id,
                  "serial_id": serial_id, "expected_return_date": expected},
            timeout=15,
        )
        assert r.status_code == 201, r.text
        loaner_id = r.json()["loaner_id"]

        rr = requests.post(
            f"{API}/ha/loaners/{loaner_id}/return", headers=hdr(admin_token),
            json={"damaged": True, "notes": "TEST broken"}, timeout=15,
        )
        assert rr.status_code == 200, rr.text
        assert rr.json()["status"] == "damaged"

        ser = requests.get(f"{API}/ha/serial-items/{serial_id}", headers=hdr(admin_token), timeout=15).json()
        assert ser["state"] == "DAMAGED"

    def test_guardrail_non_in_stock_serial_409(self, admin_token, admin_context, patient_id):
        branch_id = admin_context["branch_id"]
        serial_id = _make_serial(admin_token, branch_id)
        expected = (date.today() + timedelta(days=5)).isoformat()

        # Issue once
        r1 = requests.post(
            f"{API}/ha/loaners", headers=hdr(admin_token),
            json={"branch_id": branch_id, "patient_id": patient_id,
                  "serial_id": serial_id, "expected_return_date": expected},
            timeout=15,
        )
        assert r1.status_code == 201, r1.text

        # Issue again → 409 (serial is LOANER, not IN_STOCK)
        r2 = requests.post(
            f"{API}/ha/loaners", headers=hdr(admin_token),
            json={"branch_id": branch_id, "patient_id": patient_id,
                  "serial_id": serial_id, "expected_return_date": expected},
            timeout=15,
        )
        assert r2.status_code == 409, r2.text

    def test_guardrail_past_date_400(self, admin_token, admin_context, patient_id):
        branch_id = admin_context["branch_id"]
        serial_id = _make_serial(admin_token, branch_id)
        past = (date.today() - timedelta(days=1)).isoformat()
        r = requests.post(
            f"{API}/ha/loaners", headers=hdr(admin_token),
            json={"branch_id": branch_id, "patient_id": patient_id,
                  "serial_id": serial_id, "expected_return_date": past},
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_accounts_role_blocked_from_create(self, accounts_token, admin_token, admin_context, patient_id):
        branch_id = admin_context["branch_id"]
        serial_id = _make_serial(admin_token, branch_id)
        expected = (date.today() + timedelta(days=5)).isoformat()
        r = requests.post(
            f"{API}/ha/loaners", headers=hdr(accounts_token),
            json={"branch_id": branch_id, "patient_id": patient_id,
                  "serial_id": serial_id, "expected_return_date": expected},
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_frontdesk_can_create(self, frontdesk_token, admin_token, admin_context, patient_id):
        branch_id = admin_context["branch_id"]
        serial_id = _make_serial(admin_token, branch_id)
        expected = (date.today() + timedelta(days=4)).isoformat()
        r = requests.post(
            f"{API}/ha/loaners", headers=hdr(frontdesk_token),
            json={"branch_id": branch_id, "patient_id": patient_id,
                  "serial_id": serial_id, "expected_return_date": expected},
            timeout=15,
        )
        assert r.status_code == 201, r.text

    def test_audiologist_can_create(self, audio_token, admin_token, admin_context, patient_id):
        branch_id = admin_context["branch_id"]
        serial_id = _make_serial(admin_token, branch_id)
        expected = (date.today() + timedelta(days=4)).isoformat()
        r = requests.post(
            f"{API}/ha/loaners", headers=hdr(audio_token),
            json={"branch_id": branch_id, "patient_id": patient_id,
                  "serial_id": serial_id, "expected_return_date": expected},
            timeout=15,
        )
        assert r.status_code == 201, r.text
