"""Phase 3 HA Transactions — backend tests.

Covers:
- Quotation Studio (CRUD, margin analysis, status machine, pair rule, role gate)
- Sales (quote→sale conversion, margin gate, serial reservation, mark-paid, cancel)
- Tech-debt (unique (clinic_id, serial_no) index, relativedelta warranty, PO state
  machine via ha_procurement)
- Iter14 regression sanity
"""
import os
import uuid
import asyncio

import pytest
import requests


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


# ------------------ auth helpers ------------------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text}")
    return r.json()["access_token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin@acs.in", "admin123")


@pytest.fixture(scope="session")
def frontdesk_token():
    return _login("frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="session")
def accounts_token():
    return _login("accounts@acs.in", "accounts123")


@pytest.fixture(scope="session")
def audiologist_token():
    return _login("audiologist@acs.in", "audio123")


@pytest.fixture(scope="session")
def admin_user_id(admin_token):
    me = requests.get(f"{API}/auth/me", headers=hdr(admin_token), timeout=10).json()
    return me.get("user", me)["user_id"]


@pytest.fixture(scope="session")
def frontdesk_user_id(frontdesk_token):
    me = requests.get(f"{API}/auth/me", headers=hdr(frontdesk_token), timeout=10).json()
    return me.get("user", me)["user_id"]


@pytest.fixture(scope="session")
def mumbai_branch_id(admin_token):
    r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=10)
    assert r.status_code == 200
    prim = [b for b in r.json() if b.get("is_primary") and b.get("active", True)]
    return prim[0]["branch_id"]


@pytest.fixture(scope="session")
def mumbai_vendor_id(admin_token):
    vs = requests.get(f"{API}/vendors", headers=hdr(admin_token), timeout=10).json()
    vs = [v for v in vs if v.get("active", True)]
    if vs:
        return vs[0]["vendor_id"]
    c = requests.post(f"{API}/vendors", headers=hdr(admin_token),
                      json={"name": f"TEST_V_{uuid.uuid4().hex[:6]}", "payment_terms_days": 30}, timeout=10)
    return c.json()["vendor_id"]


@pytest.fixture(scope="session")
def a_patient(admin_token):
    # ensure at least one patient exists
    r = requests.get(f"{API}/patients?limit=1", headers=hdr(admin_token), timeout=10)
    pts = r.json()
    if pts:
        return pts[0]
    created = requests.post(f"{API}/patients", headers=hdr(admin_token),
                            json={"name": "TEST_Patient_P3", "phone": "9999900000", "gender": "male",
                                  "dob": "1970-01-01"}, timeout=10)
    return created.json()


# ------------------ shared helpers ------------------

def _new_serialised_product(admin_token, warranty_months=24, min_sell_price=80000):
    p = requests.post(f"{API}/ha/products", headers=hdr(admin_token), json={
        "brand": "TEST_Brand", "model": f"SER-{uuid.uuid4().hex[:5]}",
        "form_factor": "RIC", "warranty_months": warranty_months,
        "mrp": 120000, "cost": 50000, "min_sell_price": min_sell_price,
        "is_serialised": True,
    }, timeout=10)
    assert p.status_code == 200, p.text
    return p.json()["product_id"]


def _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, product_id, serial_no):
    """Create a PO → approve → order → GRN a single serial. Returns serial_id."""
    po = requests.post(f"{API}/ha/purchase-orders", headers=hdr(admin_token), json={
        "branch_id": mumbai_branch_id, "vendor_id": mumbai_vendor_id,
        "lines": [{"product_id": product_id, "qty": 1, "unit_cost": 50000, "gst_rate": 18}],
    }, timeout=15)
    assert po.status_code == 200, po.text
    po_no = po.json()["po_no"]
    for to in ["approved", "ordered"]:
        r = requests.post(f"{API}/ha/purchase-orders/{po_no}/status",
                          headers=hdr(admin_token), json={"to_status": to}, timeout=10)
        assert r.status_code == 200, r.text
    g = requests.post(f"{API}/ha/grns", headers=hdr(admin_token), json={
        "po_no": po_no,
        "lines": [{"product_id": product_id, "qty_received": 1, "serial_nos": [serial_no]}],
    }, timeout=15)
    assert g.status_code == 200, g.text
    # look up serial_id
    items = requests.get(f"{API}/ha/serial-items?search={serial_no}", headers=hdr(admin_token), timeout=10).json()
    assert items, f"GRN did not spawn serial for {serial_no}"
    return items[0]["serial_id"], items[0]


# ==================== QUOTATIONS ====================

class TestQuotations:
    def test_create_quotation_happy_path(self, admin_token, mumbai_branch_id, a_patient):
        pid = _new_serialised_product(admin_token, min_sell_price=80000)
        r = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id,
            "patient_id": a_patient["patient_id"],
            "is_pair": False,
            "lines": [{"product_id": pid, "side": "left", "qty": 1,
                       "unit_price": 100000, "discount_pct": 0, "gst_rate": 18}],
        }, timeout=10)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["quote_no"].startswith("QTE-2026-")
        # subtotal=100000, gst=18000, total=118000
        assert q["subtotal"] == 100000.0
        assert abs(q["gst_amount"] - 18000.0) < 0.01
        assert abs(q["total"] - 118000.0) < 0.01
        assert q["status"] == "draft"
        pytest.p3_quote_happy = q["quote_no"]
        pytest.p3_product_for_happy = pid

    def test_patient_not_found_404(self, admin_token, mumbai_branch_id):
        pid = _new_serialised_product(admin_token)
        r = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": "PAT-FAKE",
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 90000}],
        }, timeout=10)
        assert r.status_code == 404

    def test_unknown_product_400(self, admin_token, mumbai_branch_id, a_patient):
        r = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": "PRD-FAKE99", "qty": 1, "unit_price": 90000}],
        }, timeout=10)
        assert r.status_code == 400

    def test_pair_rule_left_only_400(self, admin_token, mumbai_branch_id, a_patient):
        pid = _new_serialised_product(admin_token)
        r = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "is_pair": True,
            "lines": [{"product_id": pid, "side": "left", "qty": 1, "unit_price": 90000}],
        }, timeout=10)
        assert r.status_code == 400, r.text

    def test_pair_rule_l_plus_r_ok(self, admin_token, mumbai_branch_id, a_patient):
        pid = _new_serialised_product(admin_token)
        r = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "is_pair": True,
            "lines": [
                {"product_id": pid, "side": "left", "qty": 1, "unit_price": 90000},
                {"product_id": pid, "side": "right", "qty": 1, "unit_price": 90000},
            ],
        }, timeout=10)
        assert r.status_code == 200, r.text

    def test_get_quote_margin_analysis_above_floor(self, admin_token):
        qno = pytest.p3_quote_happy
        r = requests.get(f"{API}/ha/quotations/{qno}", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "margin_analysis" in body
        ma = body["margin_analysis"]
        assert ma["below_floor_line_indexes"] == []
        assert ma["requires_approval"] is False
        assert pytest.p3_product_for_happy in ma["products"]
        prod = ma["products"][pytest.p3_product_for_happy]
        assert "min_sell_price" in prod and "mrp" in prod and "cost" in prod

    def test_get_quote_margin_analysis_below_floor(self, admin_token, mumbai_branch_id, a_patient):
        pid = _new_serialised_product(admin_token, min_sell_price=80000)
        # Price 60000 below floor 80000
        r = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 60000, "gst_rate": 18}],
        }, timeout=10)
        assert r.status_code == 200
        qno = r.json()["quote_no"]
        g = requests.get(f"{API}/ha/quotations/{qno}", headers=hdr(admin_token), timeout=10).json()
        assert 0 in g["margin_analysis"]["below_floor_line_indexes"]
        assert g["margin_analysis"]["requires_approval"] is True
        pytest.p3_quote_below_floor = qno
        pytest.p3_product_below_floor = pid

    def test_role_gate_audiologist_can_create(self, audiologist_token, mumbai_branch_id, a_patient, admin_token):
        pid = _new_serialised_product(admin_token)
        r = requests.post(f"{API}/ha/quotations", headers=hdr(audiologist_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 90000}],
        }, timeout=10)
        assert r.status_code == 200, r.text

    def test_role_gate_frontdesk_can_create(self, frontdesk_token, mumbai_branch_id, a_patient, admin_token):
        pid = _new_serialised_product(admin_token)
        r = requests.post(f"{API}/ha/quotations", headers=hdr(frontdesk_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 90000}],
        }, timeout=10)
        assert r.status_code == 200, r.text

    def test_role_gate_accounts_cannot_create(self, accounts_token, mumbai_branch_id, a_patient, admin_token):
        pid = _new_serialised_product(admin_token)
        r = requests.post(f"{API}/ha/quotations", headers=hdr(accounts_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 90000}],
        }, timeout=10)
        assert r.status_code == 403, r.text

    def test_status_legal_draft_to_sent(self, admin_token):
        qno = pytest.p3_quote_happy
        r = requests.post(f"{API}/ha/quotations/{qno}/status", headers=hdr(admin_token),
                          json={"to_status": "sent"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "sent"

    def test_status_illegal_draft_to_accepted(self, admin_token, mumbai_branch_id, a_patient):
        # Create a fresh draft quote
        pid = _new_serialised_product(admin_token)
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 90000}],
        }, timeout=10).json()
        r = requests.post(f"{API}/ha/quotations/{q['quote_no']}/status", headers=hdr(admin_token),
                          json={"to_status": "accepted"}, timeout=10)
        assert r.status_code == 409, r.text

    def test_put_rejected_on_converted(self, admin_token, mumbai_branch_id, a_patient):
        # Seed-state says QTE-2026-0001 is converted
        pid = pytest.p3_product_for_happy
        # We'll try to edit a manually-transitioned quote: move sent → accepted → covert later
        # Easier test: pick the seed QTE-2026-0001 if present
        r = requests.get(f"{API}/ha/quotations?status=converted&limit=1",
                         headers=hdr(admin_token), timeout=10)
        rows = r.json() if r.status_code == 200 else []
        if not rows:
            pytest.skip("No converted quote available to test edit-rejection")
        qno = rows[0]["quote_no"]
        upd = requests.put(f"{API}/ha/quotations/{qno}", headers=hdr(admin_token), json={
            "branch_id": rows[0]["branch_id"],
            "patient_id": rows[0]["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 90000}],
        }, timeout=10)
        assert upd.status_code == 409, upd.text


# ==================== SALES ====================

class TestSales:
    def test_sale_happy_path(self, admin_token, mumbai_branch_id, mumbai_vendor_id, a_patient):
        pid = _new_serialised_product(admin_token, min_sell_price=80000)
        serial_no = f"TEST-SN-{uuid.uuid4().hex[:8].upper()}"
        sid, _ = _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, pid, serial_no)
        # Create above-floor quote
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 100000, "gst_rate": 18}],
        }, timeout=10).json()
        qno = q["quote_no"]
        # Create sale with string-keyed assignments
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": qno, "serial_assignments": {"0": sid},
        }, timeout=15)
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["sale_no"].startswith("SAL-2026-")
        assert sale["status"] == "reserved"
        assert sale["quote_no"] == qno
        pytest.p3_sale_happy = sale["sale_no"]
        pytest.p3_sale_serial = sid

        # quote → converted + converted_sale_no
        q2 = requests.get(f"{API}/ha/quotations/{qno}", headers=hdr(admin_token), timeout=10).json()
        assert q2["status"] == "converted"
        assert q2["converted_sale_no"] == sale["sale_no"]

        # serial is RESERVED
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token), timeout=10).json()
        assert s["state"] == "RESERVED"

        # timeline has sale ref
        tl = requests.get(f"{API}/ha/serial-items/{sid}/timeline", headers=hdr(admin_token), timeout=10).json()
        assert any(ev.get("to") == "RESERVED" and
                   (ev.get("ref_doc") or {}).get("kind") == "sale" and
                   (ev.get("ref_doc") or {}).get("id") == sale["sale_no"]
                   for ev in tl["events"])

    def test_sale_below_floor_no_approval_409(self, admin_token, mumbai_branch_id, mumbai_vendor_id, a_patient):
        pid = _new_serialised_product(admin_token, min_sell_price=80000)
        serial_no = f"TEST-SN-{uuid.uuid4().hex[:8].upper()}"
        sid, _ = _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, pid, serial_no)
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 60000, "gst_rate": 18}],
        }, timeout=10).json()
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": q["quote_no"], "serial_assignments": {"0": sid},
        }, timeout=15)
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        assert detail["error"] == "margin_approval_required"
        assert 0 in detail["below_floor_line_indexes"]
        pytest.p3_bf_quote = q["quote_no"]
        pytest.p3_bf_serial = sid

    def test_sale_below_floor_frontdesk_approver_403(self, admin_token, frontdesk_user_id):
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": pytest.p3_bf_quote,
            "serial_assignments": {"0": pytest.p3_bf_serial},
            "margin_approval_user_id": frontdesk_user_id,
        }, timeout=15)
        assert r.status_code == 403, r.text

    def test_sale_below_floor_super_admin_approver_200(self, admin_token, admin_user_id):
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": pytest.p3_bf_quote,
            "serial_assignments": {"0": pytest.p3_bf_serial},
            "margin_approval_user_id": admin_user_id,
        }, timeout=15)
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["below_floor_lines"] == [0]
        assert sale["margin_approval_at"] is not None

    def test_sale_serial_not_in_stock_409(self, admin_token, mumbai_branch_id, a_patient):
        # Use the already-reserved serial from happy path
        sid = pytest.p3_sale_serial  # RESERVED now
        # build a fresh quote with matching product
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token), timeout=10).json()
        pid = s["product_id"]
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 100000, "gst_rate": 18}],
        }, timeout=10).json()
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": q["quote_no"], "serial_assignments": {"0": sid},
        }, timeout=15)
        assert r.status_code == 409, r.text
        assert "cannot reserve" in r.json()["detail"].lower()

    def test_sale_serial_product_mismatch_400(self, admin_token, mumbai_branch_id, mumbai_vendor_id, a_patient):
        pid_a = _new_serialised_product(admin_token)
        pid_b = _new_serialised_product(admin_token)
        sn = f"TEST-SN-{uuid.uuid4().hex[:8].upper()}"
        sid_a, _ = _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, pid_a, sn)
        # quote uses pid_b but we assign a serial of pid_a
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid_b, "qty": 1, "unit_price": 100000, "gst_rate": 18}],
        }, timeout=10).json()
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": q["quote_no"], "serial_assignments": {"0": sid_a},
        }, timeout=15)
        assert r.status_code == 400

    def test_sale_duplicate_serial_400(self, admin_token, mumbai_branch_id, mumbai_vendor_id, a_patient):
        pid = _new_serialised_product(admin_token)
        sn = f"TEST-SN-{uuid.uuid4().hex[:8].upper()}"
        sid, _ = _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, pid, sn)
        # pair quote (2 serialised lines) — assign same serial to both
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "is_pair": True,
            "lines": [
                {"product_id": pid, "side": "left", "qty": 1, "unit_price": 100000, "gst_rate": 18},
                {"product_id": pid, "side": "right", "qty": 1, "unit_price": 100000, "gst_rate": 18},
            ],
        }, timeout=10).json()
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": q["quote_no"], "serial_assignments": {"0": sid, "1": sid},
        }, timeout=15)
        assert r.status_code == 400, r.text
        assert "multiple lines" in r.json()["detail"].lower()

    def test_sale_missing_serial_assignment_400(self, admin_token, mumbai_branch_id, a_patient):
        pid = _new_serialised_product(admin_token)
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 100000, "gst_rate": 18}],
        }, timeout=10).json()
        r = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": q["quote_no"], "serial_assignments": {},
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_mark_paid_transitions_sold(self, admin_token, accounts_token):
        sale_no = pytest.p3_sale_happy
        sid = pytest.p3_sale_serial
        r = requests.post(f"{API}/ha/sales/{sale_no}/mark-paid", headers=hdr(accounts_token),
                          json={"invoice_no": f"INV-TEST-{uuid.uuid4().hex[:4]}"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "paid"
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token), timeout=10).json()
        assert s["state"] == "SOLD"
        # idempotent
        r2 = requests.post(f"{API}/ha/sales/{sale_no}/mark-paid", headers=hdr(accounts_token),
                           json={}, timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("already") is True

    def test_cancel_paid_sale_409(self, accounts_token):
        r = requests.post(f"{API}/ha/sales/{pytest.p3_sale_happy}/cancel",
                          headers=hdr(accounts_token), timeout=10)
        assert r.status_code == 409

    def test_cancel_reserved_sale_unreserves(self, admin_token, mumbai_branch_id, mumbai_vendor_id, a_patient, accounts_token):
        pid = _new_serialised_product(admin_token)
        sn = f"TEST-SN-{uuid.uuid4().hex[:8].upper()}"
        sid, _ = _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, pid, sn)
        q = requests.post(f"{API}/ha/quotations", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "patient_id": a_patient["patient_id"],
            "lines": [{"product_id": pid, "qty": 1, "unit_price": 100000, "gst_rate": 18}],
        }, timeout=10).json()
        sale = requests.post(f"{API}/ha/sales", headers=hdr(admin_token), json={
            "quote_no": q["quote_no"], "serial_assignments": {"0": sid},
        }, timeout=15).json()
        r = requests.post(f"{API}/ha/sales/{sale['sale_no']}/cancel",
                          headers=hdr(accounts_token), timeout=10)
        assert r.status_code == 200
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token), timeout=10).json()
        assert s["state"] == "IN_STOCK"
        # quote.converted_sale_no preserved (audit)
        q2 = requests.get(f"{API}/ha/quotations/{q['quote_no']}", headers=hdr(admin_token), timeout=10).json()
        assert q2["converted_sale_no"] == sale["sale_no"]


# ==================== TECH DEBT ====================

class TestTechDebt:
    def test_unique_serial_index_rejects_colliding_grn_409(self, admin_token, mumbai_branch_id, mumbai_vendor_id):
        pid = _new_serialised_product(admin_token)
        sn = f"TEST-DUPIDX-{uuid.uuid4().hex[:6].upper()}"
        # First GRN succeeds
        _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, pid, sn)
        # Second GRN with same serial_no under same clinic should 409 via surfaced DuplicateKeyError
        po = requests.post(f"{API}/ha/purchase-orders", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "vendor_id": mumbai_vendor_id,
            "lines": [{"product_id": pid, "qty": 1, "unit_cost": 50000, "gst_rate": 18}],
        }, timeout=15).json()
        for to in ["approved", "ordered"]:
            requests.post(f"{API}/ha/purchase-orders/{po['po_no']}/status",
                          headers=hdr(admin_token), json={"to_status": to}, timeout=10)
        g = requests.post(f"{API}/ha/grns", headers=hdr(admin_token), json={
            "po_no": po["po_no"],
            "lines": [{"product_id": pid, "qty_received": 1, "serial_nos": [sn]}],
        }, timeout=15)
        assert g.status_code == 409, g.text

    def test_warranty_calc_uses_relativedelta(self, admin_token, mumbai_branch_id, mumbai_vendor_id):
        pid = _new_serialised_product(admin_token, warranty_months=24)
        sn = f"TEST-WARR-{uuid.uuid4().hex[:6].upper()}"
        sid, row = _grn_one_serial(admin_token, mumbai_branch_id, mumbai_vendor_id, pid, sn)
        # Fetch full object to inspect warranty_end_date + received_at
        full = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token), timeout=10).json()
        assert full["warranty_end_date"] is not None
        recv = full.get("received_at") or full.get("created_at")
        wed = full["warranty_end_date"][:10]  # 'YYYY-MM-DD'
        # month/day must match received_at's month/day (relativedelta), not +720 days
        from datetime import datetime as dt
        r_dt = dt.fromisoformat(recv.replace("Z", "+00:00")) if "T" in recv else dt.fromisoformat(recv)
        w_dt = dt.fromisoformat(wed)
        assert (w_dt.month, w_dt.day) == (r_dt.month, r_dt.day), f"expected month/day match; recv={recv} wed={wed}"
        assert w_dt.year - r_dt.year == 2

    def test_po_state_machine_illegal_draft_to_received_409(self, admin_token, mumbai_branch_id, mumbai_vendor_id):
        pid = _new_serialised_product(admin_token)
        po = requests.post(f"{API}/ha/purchase-orders", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "vendor_id": mumbai_vendor_id,
            "lines": [{"product_id": pid, "qty": 1, "unit_cost": 50000, "gst_rate": 18}],
        }, timeout=15).json()
        r = requests.post(f"{API}/ha/purchase-orders/{po['po_no']}/status",
                          headers=hdr(admin_token), json={"to_status": "received"}, timeout=10)
        assert r.status_code == 409

    def test_po_state_machine_legal_draft_to_approved(self, admin_token, mumbai_branch_id, mumbai_vendor_id):
        pid = _new_serialised_product(admin_token)
        po = requests.post(f"{API}/ha/purchase-orders", headers=hdr(admin_token), json={
            "branch_id": mumbai_branch_id, "vendor_id": mumbai_vendor_id,
            "lines": [{"product_id": pid, "qty": 1, "unit_cost": 50000, "gst_rate": 18}],
        }, timeout=15).json()
        r = requests.post(f"{API}/ha/purchase-orders/{po['po_no']}/status",
                          headers=hdr(admin_token), json={"to_status": "approved"}, timeout=10)
        assert r.status_code == 200


# ==================== REGRESSION SANITY ====================

class TestRegressionIter14:
    @pytest.mark.parametrize("path", [
        "/ha/products", "/ha/serial-items", "/ha/grns", "/ha/purchase-orders",
        "/branches", "/vendors",
        "/patients", "/appointments", "/sessions",
        "/dashboard/frontdesk",
    ])
    def test_iter14_endpoints_200(self, admin_token, path):
        r = requests.get(f"{API}{path}", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"
