"""Phase 2 HA Core Inventory — backend tests.

Covers:
- Products CRUD + filters + role gate
- SerialItems list / summary / get / timeline / transition
- Accessory stock adjust (positive / negative / below-zero reject)
- Purchase Orders create + status transitions (legal/illegal)
- GRN happy path (serialised + accessory in same PO), warranty calc,
  PO auto-move to received / partial_received
- GRN validations (dup-serial clinic, dup-serial-same-line, serial count ≠ qty,
  GRN against draft/closed/cancelled PO)
- Cross-tenant isolation (Delhi admin vs Mumbai)
"""
import os
import uuid

import pytest
import requests

_url = os.environ.get("REACT_APP_BACKEND_URL")
if not _url:
    # fall back to frontend/.env
    try:
        with open("/app/frontend/.env") as _fh:
            for _line in _fh:
                if _line.startswith("REACT_APP_BACKEND_URL="):
                    _url = _line.split("=", 1)[1].strip()
                    break
    except Exception:
        pass
assert _url, "REACT_APP_BACKEND_URL not set"
BASE_URL = _url.rstrip("/")
API = f"{BASE_URL}/api"


# -------------- auth fixtures --------------

def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin@acs.in", "admin123")


@pytest.fixture(scope="session")
def frontdesk_token():
    return _login("frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="session")
def delhi_admin_token():
    return _login("admin@delhi.test", "delhiadmin123")


@pytest.fixture(scope="session")
def audiologist_token():
    return _login("audiologist@acs.in", "audio123")


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def mumbai_branch_id(admin_token):
    r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    primary = [b for b in r.json() if b.get("is_primary") and b.get("active", True)]
    assert primary, "no primary Mumbai branch found"
    return primary[0]["branch_id"]


@pytest.fixture(scope="session")
def mumbai_vendor_id(admin_token):
    # Try to list vendors; if none, create one
    r = requests.get(f"{API}/vendors", headers=hdr(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    vs = [v for v in r.json() if v.get("active", True)]
    if vs:
        return vs[0]["vendor_id"]
    created = requests.post(
        f"{API}/vendors",
        headers=hdr(admin_token),
        json={"name": f"TEST_Vendor_{uuid.uuid4().hex[:6]}", "payment_terms_days": 30},
        timeout=10,
    )
    assert created.status_code == 200, created.text
    return created.json()["vendor_id"]


# ======================================================
# PRODUCTS
# ======================================================

class TestProducts:
    def test_list_products(self, admin_token):
        r = requests.get(f"{API}/ha/products", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_create_serialised_product(self, admin_token):
        pload = {
            "brand": f"TEST_Brand_{uuid.uuid4().hex[:4]}",
            "model": "P90-Test",
            "form_factor": "RIC",
            "tech_tier": "premium",
            "warranty_months": 24,
            "mrp": 120000,
            "cost": 60000,
            "min_sell_price": 90000,
            "is_serialised": True,
        }
        r = requests.post(f"{API}/ha/products", headers=hdr(admin_token), json=pload, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["brand"] == pload["brand"]
        assert data["is_serialised"] is True
        assert data["warranty_months"] == 24
        # Persistence: fetch by id
        g = requests.get(f"{API}/ha/products/{data['product_id']}", headers=hdr(admin_token), timeout=10)
        assert g.status_code == 200
        assert g.json()["model"] == "P90-Test"
        # cleanup soft-delete
        requests.delete(f"{API}/ha/products/{data['product_id']}", headers=hdr(admin_token), timeout=10)

    def test_create_accessory_product(self, admin_token):
        pload = {
            "brand": f"TEST_Acc_{uuid.uuid4().hex[:4]}",
            "model": "Dome-10mm",
            "form_factor": "accessory",
            "warranty_months": 0,
            "is_serialised": False,
            "mrp": 100, "cost": 40,
        }
        r = requests.post(f"{API}/ha/products", headers=hdr(admin_token), json=pload, timeout=10)
        assert r.status_code == 200, r.text
        pid = r.json()["product_id"]
        assert r.json()["is_serialised"] is False
        # filter by is_serialised=false
        lst = requests.get(
            f"{API}/ha/products?is_serialised=false", headers=hdr(admin_token), timeout=10,
        )
        assert lst.status_code == 200
        assert any(p["product_id"] == pid for p in lst.json())
        requests.delete(f"{API}/ha/products/{pid}", headers=hdr(admin_token), timeout=10)

    def test_update_product(self, admin_token):
        c = requests.post(
            f"{API}/ha/products", headers=hdr(admin_token),
            json={"brand": "TEST_B", "model": "A", "is_serialised": True, "mrp": 100, "cost": 50, "min_sell_price": 80},
            timeout=10,
        )
        pid = c.json()["product_id"]
        u = requests.put(
            f"{API}/ha/products/{pid}", headers=hdr(admin_token),
            json={"brand": "TEST_B", "model": "A2", "is_serialised": True, "mrp": 150, "cost": 50, "min_sell_price": 80},
            timeout=10,
        )
        assert u.status_code == 200, u.text
        assert u.json()["model"] == "A2"
        assert u.json()["mrp"] == 150
        requests.delete(f"{API}/ha/products/{pid}", headers=hdr(admin_token), timeout=10)

    def test_soft_delete_product(self, admin_token):
        c = requests.post(
            f"{API}/ha/products", headers=hdr(admin_token),
            json={"brand": "TEST_D", "model": "X", "is_serialised": True},
            timeout=10,
        )
        pid = c.json()["product_id"]
        d = requests.delete(f"{API}/ha/products/{pid}", headers=hdr(admin_token), timeout=10)
        assert d.status_code == 200
        # Filter active=true should exclude it
        lst = requests.get(f"{API}/ha/products?active=true", headers=hdr(admin_token), timeout=10)
        assert not any(p["product_id"] == pid for p in lst.json())

    def test_create_product_role_gate_frontdesk_403(self, frontdesk_token):
        r = requests.post(
            f"{API}/ha/products", headers=hdr(frontdesk_token),
            json={"brand": "TEST_FD", "model": "Z", "is_serialised": True},
            timeout=10,
        )
        assert r.status_code == 403, r.text


# ======================================================
# SERIAL ITEMS
# ======================================================

class TestSerialItems:
    def test_list_serial_items(self, admin_token):
        r = requests.get(f"{API}/ha/serial-items", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_summary(self, admin_token, mumbai_branch_id):
        r = requests.get(
            f"{API}/ha/serial-items/by-branch-summary?branch_id={mumbai_branch_id}",
            headers=hdr(admin_token), timeout=10,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "total" in d and "by_state" in d and "by_pool" in d
        assert isinstance(d["by_state"], dict)

    def test_filters(self, admin_token, mumbai_branch_id):
        r = requests.get(
            f"{API}/ha/serial-items?branch_id={mumbai_branch_id}&state=IN_STOCK",
            headers=hdr(admin_token), timeout=10,
        )
        assert r.status_code == 200
        for it in r.json():
            assert it["state"] == "IN_STOCK"

    def test_get_and_timeline(self, admin_token):
        items = requests.get(f"{API}/ha/serial-items?limit=1", headers=hdr(admin_token), timeout=10).json()
        if not items:
            pytest.skip("no serial items seeded")
        sid = items[0]["serial_id"]
        g = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token), timeout=10)
        assert g.status_code == 200
        t = requests.get(f"{API}/ha/serial-items/{sid}/timeline", headers=hdr(admin_token), timeout=10)
        assert t.status_code == 200
        body = t.json()
        assert "serial" in body and "events" in body
        assert isinstance(body["events"], list)

    def test_cross_tenant_404(self, admin_token, delhi_admin_token):
        items = requests.get(f"{API}/ha/serial-items?limit=1", headers=hdr(admin_token), timeout=10).json()
        if not items:
            pytest.skip("no mumbai serial to cross-check")
        sid = items[0]["serial_id"]
        r = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(delhi_admin_token), timeout=10)
        assert r.status_code in (403, 404), r.text

    def test_illegal_transition_409(self, admin_token):
        items = requests.get(
            f"{API}/ha/serial-items?state=IN_STOCK&limit=1", headers=hdr(admin_token), timeout=10,
        ).json()
        if not items:
            pytest.skip("no IN_STOCK serial for transition test")
        sid = items[0]["serial_id"]
        # Illegal: IN_STOCK → RETIRED (not in ALLOWED_TRANSITIONS)
        r = requests.post(
            f"{API}/ha/serial-items/{sid}/transition",
            headers=hdr(admin_token), json={"to_state": "RETIRED"}, timeout=10,
        )
        assert r.status_code == 409, r.text
        # No audit row added for illegal attempt — timeline count stable
        tl1 = requests.get(f"{API}/ha/serial-items/{sid}/timeline", headers=hdr(admin_token), timeout=10).json()
        # sanity: events list should not contain (IN_STOCK → RETIRED)
        assert not any(e.get("to") == "RETIRED" and e.get("from") == "IN_STOCK" for e in tl1["events"])


# ======================================================
# ACCESSORY STOCK
# ======================================================

class TestAccessoryStock:
    def test_list(self, admin_token):
        r = requests.get(f"{API}/ha/accessory-stock", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200

    def test_adjust_positive_and_below_zero(self, admin_token):
        rows = requests.get(f"{API}/ha/accessory-stock", headers=hdr(admin_token), timeout=10).json()
        if not rows:
            pytest.skip("no accessory stock seeded")
        sku = rows[0]
        # +2
        r = requests.post(
            f"{API}/ha/accessory-stock/{sku['sku_id']}/adjust",
            headers=hdr(admin_token), json={"delta": 2, "reason": "TEST add"}, timeout=10,
        )
        assert r.status_code == 200, r.text
        new_qty = r.json()["qty_on_hand"]
        # -2 to restore
        r2 = requests.post(
            f"{API}/ha/accessory-stock/{sku['sku_id']}/adjust",
            headers=hdr(admin_token), json={"delta": -2, "reason": "TEST remove"}, timeout=10,
        )
        assert r2.status_code == 200
        assert r2.json()["qty_on_hand"] == new_qty - 2
        # reject below zero
        huge = -(new_qty - 2 + 1000)
        r3 = requests.post(
            f"{API}/ha/accessory-stock/{sku['sku_id']}/adjust",
            headers=hdr(admin_token), json={"delta": huge, "reason": "TEST below zero"}, timeout=10,
        )
        assert r3.status_code == 409, r3.text


# ======================================================
# PURCHASE ORDERS & GRN
# ======================================================

@pytest.fixture(scope="class")
def ser_product(admin_token):
    r = requests.post(
        f"{API}/ha/products", headers=hdr(admin_token),
        json={
            "brand": "TEST_Phonak", "model": f"TestP-{uuid.uuid4().hex[:4]}",
            "form_factor": "RIC", "warranty_months": 24,
            "mrp": 100000, "cost": 50000, "min_sell_price": 80000,
            "is_serialised": True,
        }, timeout=10,
    )
    assert r.status_code == 200, r.text
    pid = r.json()["product_id"]
    yield pid
    requests.delete(f"{API}/ha/products/{pid}", headers=hdr(admin_token), timeout=10)


@pytest.fixture(scope="class")
def acc_product(admin_token):
    r = requests.post(
        f"{API}/ha/products", headers=hdr(admin_token),
        json={
            "brand": "TEST_Acc", "model": f"Dome-{uuid.uuid4().hex[:4]}",
            "form_factor": "accessory", "warranty_months": 0,
            "mrp": 100, "cost": 40, "min_sell_price": 80,
            "is_serialised": False,
        }, timeout=10,
    )
    assert r.status_code == 200, r.text
    pid = r.json()["product_id"]
    yield pid
    requests.delete(f"{API}/ha/products/{pid}", headers=hdr(admin_token), timeout=10)


class TestPOandGRN:
    def test_po_create_totals_and_number(self, admin_token, mumbai_branch_id, mumbai_vendor_id, ser_product, acc_product):
        payload = {
            "branch_id": mumbai_branch_id,
            "vendor_id": mumbai_vendor_id,
            "lines": [
                {"product_id": ser_product, "qty": 2, "unit_cost": 50000, "gst_rate": 18},
                {"product_id": acc_product, "qty": 10, "unit_cost": 40, "gst_rate": 18},
            ],
            "notes": "TEST PO",
        }
        r = requests.post(f"{API}/ha/purchase-orders", headers=hdr(admin_token), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["status"] == "draft"
        assert po["po_no"].startswith("PO-")
        # subtotal = 100000 + 400 = 100400, gst = 18072, total = 118472
        assert po["subtotal"] == 100400.0
        assert po["gst_amount"] == 18072.0
        assert abs(po["total"] - 118472.0) < 0.01
        # Stash po_no for later tests on instance
        pytest.po_for_grn = po["po_no"]

    def test_po_frontdesk_403(self, frontdesk_token, mumbai_branch_id, mumbai_vendor_id, ser_product):
        r = requests.post(
            f"{API}/ha/purchase-orders", headers=hdr(frontdesk_token),
            json={
                "branch_id": mumbai_branch_id, "vendor_id": mumbai_vendor_id,
                "lines": [{"product_id": ser_product, "qty": 1, "unit_cost": 10, "gst_rate": 18}],
            }, timeout=10,
        )
        assert r.status_code == 403

    def test_po_unknown_product_400(self, admin_token, mumbai_branch_id, mumbai_vendor_id):
        r = requests.post(
            f"{API}/ha/purchase-orders", headers=hdr(admin_token),
            json={
                "branch_id": mumbai_branch_id, "vendor_id": mumbai_vendor_id,
                "lines": [{"product_id": "PRD-FAKE999", "qty": 1, "unit_cost": 10, "gst_rate": 18}],
            }, timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_po_unknown_vendor_404(self, admin_token, mumbai_branch_id, ser_product):
        r = requests.post(
            f"{API}/ha/purchase-orders", headers=hdr(admin_token),
            json={
                "branch_id": mumbai_branch_id, "vendor_id": "VND-FAKE999",
                "lines": [{"product_id": ser_product, "qty": 1, "unit_cost": 10, "gst_rate": 18}],
            }, timeout=10,
        )
        assert r.status_code == 404

    def test_grn_against_draft_rejects_409(self, admin_token, ser_product):
        po_no = getattr(pytest, "po_for_grn", None)
        if not po_no:
            pytest.skip("no po created")
        r = requests.post(
            f"{API}/ha/grns", headers=hdr(admin_token),
            json={"po_no": po_no, "lines": [{"product_id": ser_product, "qty_received": 1, "serial_nos": ["TEST-SN-X"]}]},
            timeout=10,
        )
        assert r.status_code == 409

    def test_status_transitions_legal(self, admin_token):
        po_no = pytest.po_for_grn
        for to in ["approved", "ordered"]:
            r = requests.post(
                f"{API}/ha/purchase-orders/{po_no}/status",
                headers=hdr(admin_token), json={"to_status": to}, timeout=10,
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == to

    def test_status_transition_illegal_409(self, admin_token):
        po_no = pytest.po_for_grn
        # ordered → draft is illegal
        r = requests.post(
            f"{API}/ha/purchase-orders/{po_no}/status",
            headers=hdr(admin_token), json={"to_status": "draft"}, timeout=10,
        )
        assert r.status_code == 409

    def test_grn_serial_count_mismatch_400(self, admin_token, ser_product):
        po_no = pytest.po_for_grn
        r = requests.post(
            f"{API}/ha/grns", headers=hdr(admin_token),
            json={"po_no": po_no, "lines": [
                {"product_id": ser_product, "qty_received": 2, "serial_nos": ["TEST-SN-A"]},
            ]},
            timeout=10,
        )
        assert r.status_code == 400

    def test_grn_duplicate_serials_same_line_400(self, admin_token, ser_product):
        po_no = pytest.po_for_grn
        r = requests.post(
            f"{API}/ha/grns", headers=hdr(admin_token),
            json={"po_no": po_no, "lines": [
                {"product_id": ser_product, "qty_received": 2, "serial_nos": ["TEST-DUP", "TEST-DUP"]},
            ]}, timeout=10,
        )
        assert r.status_code == 400

    def test_grn_happy_path_partial_then_full(self, admin_token, ser_product, acc_product):
        po_no = pytest.po_for_grn
        sn1 = f"TEST-SN-{uuid.uuid4().hex[:6].upper()}"
        sn2 = f"TEST-SN-{uuid.uuid4().hex[:6].upper()}"
        # First GRN: receive only 1 of 2 serials + 5 of 10 accessory → partial
        r1 = requests.post(
            f"{API}/ha/grns", headers=hdr(admin_token),
            json={"po_no": po_no, "lines": [
                {"product_id": ser_product, "qty_received": 1, "serial_nos": [sn1]},
                {"product_id": acc_product, "qty_received": 5},
            ]}, timeout=15,
        )
        assert r1.status_code == 200, r1.text
        grn1 = r1.json()
        assert grn1["grn_no"].startswith("GRN-")
        # PO should now be partial_received
        po1 = requests.get(f"{API}/ha/purchase-orders/{po_no}", headers=hdr(admin_token), timeout=10).json()
        assert po1["status"] == "partial_received", po1

        # serial item spawned with IN_STOCK + warranty_end set
        lst = requests.get(
            f"{API}/ha/serial-items?search={sn1}", headers=hdr(admin_token), timeout=10,
        ).json()
        assert len(lst) == 1 and lst[0]["state"] == "IN_STOCK" and lst[0]["pool"] == "saleable"
        assert lst[0]["warranty_end_date"] is not None
        assert lst[0]["grn_no"] == grn1["grn_no"]
        # timeline has (new) → IN_STOCK event
        tl = requests.get(
            f"{API}/ha/serial-items/{lst[0]['serial_id']}/timeline",
            headers=hdr(admin_token), timeout=10,
        ).json()
        assert any(e.get("from") == "(new)" and e.get("to") == "IN_STOCK" for e in tl["events"])

        # Duplicate serial in same clinic → 409
        dup = requests.post(
            f"{API}/ha/grns", headers=hdr(admin_token),
            json={"po_no": po_no, "lines": [
                {"product_id": ser_product, "qty_received": 1, "serial_nos": [sn1]},
            ]}, timeout=10,
        )
        assert dup.status_code == 409, dup.text

        # Second GRN: receive remaining 1 serial + 5 accessory → PO status = received
        r2 = requests.post(
            f"{API}/ha/grns", headers=hdr(admin_token),
            json={"po_no": po_no, "lines": [
                {"product_id": ser_product, "qty_received": 1, "serial_nos": [sn2]},
                {"product_id": acc_product, "qty_received": 5},
            ]}, timeout=15,
        )
        assert r2.status_code == 200, r2.text
        po2 = requests.get(f"{API}/ha/purchase-orders/{po_no}", headers=hdr(admin_token), timeout=10).json()
        assert po2["status"] == "received", po2

    def test_grn_against_closed_po_409(self, admin_token, ser_product):
        po_no = pytest.po_for_grn
        # Move received → closed
        c = requests.post(
            f"{API}/ha/purchase-orders/{po_no}/status",
            headers=hdr(admin_token), json={"to_status": "closed"}, timeout=10,
        )
        assert c.status_code == 200
        # Attempt GRN against closed
        r = requests.post(
            f"{API}/ha/grns", headers=hdr(admin_token),
            json={"po_no": po_no, "lines": [
                {"product_id": ser_product, "qty_received": 1, "serial_nos": ["TEST-SN-LATE"]},
            ]}, timeout=10,
        )
        assert r.status_code == 409

    def test_cross_tenant_po_read(self, delhi_admin_token):
        po_no = getattr(pytest, "po_for_grn", None)
        if not po_no:
            pytest.skip()
        r = requests.get(f"{API}/ha/purchase-orders/{po_no}", headers=hdr(delhi_admin_token), timeout=10)
        assert r.status_code in (403, 404)


# ======================================================
# Regression sanity — iter13 still green
# ======================================================

class TestRegression:
    def test_branches_list(self, admin_token):
        r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_vendors_list(self, admin_token):
        r = requests.get(f"{API}/vendors", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200

    def test_patients_list(self, admin_token):
        r = requests.get(f"{API}/patients?limit=5", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200

    def test_auth_me_has_branch_ids(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200
        body = r.json()
        user = body.get("user", body)
        assert "branch_ids" in user
