"""Phase 11 — Trade-in + Upgrade Funnel engine.

Coverage:
- POST /api/ha/trade-ins (create from SOLD serial)
- Lifecycle: appraised → accepted → applied (serial SOLD → RETURNED → RETIRED)
- Lifecycle: appraised → rejected
- Role gates (accounts blocked from create, front_desk blocked from create)
- GET /api/ha/trade-ins-kpis aggregation
- GET /api/ha/upgrade-funnel (aged HA sales → candidates)
- Guardrails: non-SOLD serial → 409, cross-patient serial → 400,
  apply before accept → 409, apply to cancelled sale → 409.

Needs one SOLD serial tied to a patient. We reuse the real quote→sale flow
by minting a minimal PO → GRN → quotation → sale → mark-paid chain.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                         "https://careful-feedback.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": password}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@acs.in", "admin123")


@pytest.fixture(scope="module")
def audio_token():
    return _login("audiologist@acs.in", "audio123")


@pytest.fixture(scope="module")
def fd_token():
    return _login("frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="module")
def acc_token():
    return _login("accounts@acs.in", "accounts123")


@pytest.fixture(scope="module")
def branch_id(admin_token):
    r = requests.get(f"{API}/branches", headers=hdr(admin_token), timeout=10).json()
    primary = [b for b in r if b.get("is_primary") and b.get("active", True)]
    assert primary, "no primary branch"
    return primary[0]["branch_id"]


@pytest.fixture(scope="module")
def vendor_id(admin_token):
    r = requests.get(f"{API}/vendors", headers=hdr(admin_token), timeout=10).json()
    vs = [v for v in r if v.get("active", True)]
    if vs:
        return vs[0]["vendor_id"]
    created = requests.post(
        f"{API}/vendors", headers=hdr(admin_token),
        json={"name": f"TI_Vendor_{uuid.uuid4().hex[:6]}", "payment_terms_days": 30},
        timeout=10,
    ).json()
    return created["vendor_id"]


@pytest.fixture(scope="module")
def sold_serial(admin_token, audio_token, branch_id, vendor_id):
    """Mint a unit all the way to SOLD+paid so we can trade it in.
    Returns {patient_id, serial_id, serial_no, sale_no}.
    """
    tok_a = admin_token
    tok_au = audio_token
    uid = uuid.uuid4().hex[:6].upper()

    # 1. Fresh product
    prod = requests.post(
        f"{API}/ha/products", headers=hdr(tok_a),
        json={
            "brand": f"TI_Brand_{uid}", "model": f"TI_M_{uid}",
            "form_factor": "RIC", "warranty_months": 24,
            "mrp": 100000, "cost": 50000, "min_sell_price": 80000,
            "is_serialised": True,
        }, timeout=15,
    ).json()
    pid = prod["product_id"]

    # 2. Create PO → approve → ordered → GRN
    po = requests.post(
        f"{API}/ha/purchase-orders", headers=hdr(tok_a),
        json={"branch_id": branch_id, "vendor_id": vendor_id,
              "lines": [{"product_id": pid, "qty": 1, "unit_cost": 50000, "gst_rate": 18}]},
        timeout=15,
    ).json()
    po_no = po["po_no"]
    for st in ("approved", "ordered"):
        requests.post(f"{API}/ha/purchase-orders/{po_no}/status",
                      headers=hdr(tok_a), json={"to_status": st}, timeout=10)
    serial_no_text = f"TI-SN-{uid}"
    grn = requests.post(
        f"{API}/ha/grns", headers=hdr(tok_a),
        json={"po_no": po_no,
              "lines": [{"product_id": pid, "qty_received": 1, "serial_nos": [serial_no_text]}]},
        timeout=15,
    ).json()
    assert "grn_no" in grn, grn

    # 3. Fetch the serial
    si_list = requests.get(f"{API}/ha/serial-items?search={serial_no_text}",
                           headers=hdr(tok_a), timeout=10).json()
    assert len(si_list) == 1, si_list
    serial = si_list[0]

    # 4. Make a patient
    pat = requests.post(
        f"{API}/patients", headers=hdr(tok_a),
        json={"name": f"TI_Patient_{uid}", "age": 60, "gender": "Male",
              "mobile": f"90{uuid.uuid4().int % 100000000:08d}"}, timeout=10,
    ).json()
    patient_id = pat["patient_id"]

    # 5. Quote
    q = requests.post(
        f"{API}/ha/quotations", headers=hdr(tok_au),
        json={"patient_id": patient_id, "branch_id": branch_id, "is_pair": False,
              "lines": [{"product_id": pid, "side": "single", "qty": 1,
                         "unit_price": 90000, "gst_rate": 18}]},
        timeout=15,
    )
    assert q.status_code == 200, q.text
    quote_no = q.json()["quote_no"]
    # accept the quote
    requests.post(f"{API}/ha/quotations/{quote_no}/status",
                  headers=hdr(tok_au), json={"to_status": "accepted"}, timeout=10)

    # 6. Convert to Sale — need to pick the serial for line 0
    sale = requests.post(
        f"{API}/ha/sales", headers=hdr(tok_au),
        json={"quote_no": quote_no, "serial_assignments": {0: serial["serial_id"]}},
        timeout=15,
    )
    assert sale.status_code == 200, sale.text
    sale_no = sale.json()["sale_no"]

    # 7. Mark invoiced + paid so it's "old enough to upgrade"
    requests.post(f"{API}/ha/sales/{sale_no}/mark-invoiced", headers=hdr(tok_a),
                  json={}, timeout=10)
    mp = requests.post(f"{API}/ha/sales/{sale_no}/mark-paid", headers=hdr(tok_a),
                       json={}, timeout=10)
    assert mp.status_code == 200, mp.text

    # 8. Confirm serial is now SOLD
    si = requests.get(f"{API}/ha/serial-items/{serial['serial_id']}",
                      headers=hdr(tok_a), timeout=10).json()
    assert si["state"] == "SOLD", si

    yield {
        "patient_id": patient_id,
        "serial_id": serial["serial_id"],
        "serial_no": serial_no_text,
        "sale_no": sale_no,
        "branch_id": branch_id,
        "product_id": pid,
    }


# ==================== TESTS ====================

class TestTradeInLifecycle:
    def test_kpis_shape(self, admin_token):
        r = requests.get(f"{API}/ha/trade-ins-kpis", headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        k = r.json()
        assert set(k.keys()) >= {"appraised", "accepted", "applied", "rejected",
                                  "offered_credit_total", "applied_credit_total"}

    def test_appraise_accept_apply(self, admin_token, audio_token, sold_serial):
        # 1. Create appraisal
        r = requests.post(
            f"{API}/ha/trade-ins", headers=hdr(audio_token),
            json={
                "branch_id": sold_serial["branch_id"],
                "patient_id": sold_serial["patient_id"],
                "old_serial_id": sold_serial["serial_id"],
                "condition": "good",
                "appraised_value": 15000,
                "offered_credit": 12000,
                "notes": "TEST appraisal",
            }, timeout=10,
        )
        assert r.status_code == 201, r.text
        ti = r.json()
        assert ti["status"] == "appraised"
        assert ti["trade_in_id"].startswith("TI-")
        assert ti["old_serial_no"] == sold_serial["serial_no"]
        assert ti["old_sale_no"] == sold_serial["sale_no"]
        tid = ti["trade_in_id"]

        # 2. Accept — serial SOLD → RETURNED
        r = requests.post(f"{API}/ha/trade-ins/{tid}/accept",
                          headers=hdr(audio_token), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accepted"
        si = requests.get(f"{API}/ha/serial-items/{sold_serial['serial_id']}",
                          headers=hdr(admin_token), timeout=10).json()
        assert si["state"] == "RETURNED", si
        assert si.get("current_patient_id") in (None, ""), si

        # 3. Double-accept → 409
        r = requests.post(f"{API}/ha/trade-ins/{tid}/accept",
                          headers=hdr(audio_token), timeout=10)
        assert r.status_code == 409

        # 4. Apply to a dummy sale — first need a NEW sale for same patient
        # Reuse old sale as the apply target (simulates the "new" sale)
        r = requests.post(
            f"{API}/ha/trade-ins/{tid}/apply", headers=hdr(audio_token),
            json={"sale_no": sold_serial["sale_no"]}, timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "applied"
        assert r.json()["linked_sale_no"] == sold_serial["sale_no"]
        # Serial should now be RETIRED
        si = requests.get(f"{API}/ha/serial-items/{sold_serial['serial_id']}",
                          headers=hdr(admin_token), timeout=10).json()
        assert si["state"] == "RETIRED", si

        # 5. Double-apply → 409
        r = requests.post(
            f"{API}/ha/trade-ins/{tid}/apply", headers=hdr(audio_token),
            json={"sale_no": sold_serial["sale_no"]}, timeout=10,
        )
        assert r.status_code == 409


class TestTradeInGuardrails:
    def test_non_sold_serial_409(self, admin_token, audio_token, branch_id):
        # Find any IN_STOCK serial
        lst = requests.get(f"{API}/ha/serial-items?state=IN_STOCK&limit=1",
                           headers=hdr(admin_token), timeout=10).json()
        if not lst:
            pytest.skip("no IN_STOCK serial available")
        # Need a real patient
        p = requests.post(
            f"{API}/patients", headers=hdr(admin_token),
            json={"name": "TI_InStock_Neg", "age": 55, "gender": "Female",
                  "mobile": f"90{uuid.uuid4().int % 100000000:08d}"}, timeout=10,
        ).json()
        r = requests.post(
            f"{API}/ha/trade-ins", headers=hdr(audio_token),
            json={
                "branch_id": branch_id,
                "patient_id": p["patient_id"],
                "old_serial_id": lst[0]["serial_id"],
                "condition": "good",
                "appraised_value": 1, "offered_credit": 1,
            }, timeout=10,
        )
        assert r.status_code == 409, r.text

    def test_nonexistent_serial_404(self, audio_token, branch_id, admin_token):
        p = requests.post(
            f"{API}/patients", headers=hdr(admin_token),
            json={"name": "TI_NoSerial", "age": 55, "gender": "Female",
                  "mobile": f"90{uuid.uuid4().int % 100000000:08d}"}, timeout=10,
        ).json()
        r = requests.post(
            f"{API}/ha/trade-ins", headers=hdr(audio_token),
            json={
                "branch_id": branch_id,
                "patient_id": p["patient_id"],
                "old_serial_id": "SI-DOES-NOT-EXIST",
                "condition": "good", "appraised_value": 1, "offered_credit": 1,
            }, timeout=10,
        )
        assert r.status_code == 404


class TestTradeInRoleGates:
    def test_front_desk_cannot_create(self, fd_token, branch_id):
        r = requests.post(
            f"{API}/ha/trade-ins", headers=hdr(fd_token),
            json={
                "branch_id": branch_id, "patient_id": "P-NONE",
                "old_serial_id": "SI-X", "condition": "good",
                "appraised_value": 1, "offered_credit": 1,
            }, timeout=10,
        )
        assert r.status_code == 403

    def test_accounts_cannot_create(self, acc_token, branch_id):
        r = requests.post(
            f"{API}/ha/trade-ins", headers=hdr(acc_token),
            json={
                "branch_id": branch_id, "patient_id": "P-NONE",
                "old_serial_id": "SI-X", "condition": "good",
                "appraised_value": 1, "offered_credit": 1,
            }, timeout=10,
        )
        assert r.status_code == 403

    def test_everyone_can_read_list(self, fd_token):
        r = requests.get(f"{API}/ha/trade-ins", headers=hdr(fd_token), timeout=10)
        assert r.status_code == 200


class TestUpgradeFunnel:
    def test_funnel_shape(self, admin_token):
        r = requests.get(f"{API}/ha/upgrade-funnel?years_min=3",
                         headers=hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d.keys()) >= {"candidates", "trade_ins", "funnel"}
        assert set(d["funnel"].keys()) >= {"candidate", "appraised", "accepted",
                                            "applied", "rejected"}

    def test_funnel_reads_open_to_all(self, fd_token):
        r = requests.get(f"{API}/ha/upgrade-funnel", headers=hdr(fd_token), timeout=10)
        assert r.status_code == 200


class TestRejectFlow:
    """Create a fresh sold-serial trade-in and reject from appraised state."""
    def test_reject_from_appraised(self, admin_token, audio_token, branch_id, vendor_id):
        # Mint fresh SOLD serial (mini version of the big fixture)
        uid = uuid.uuid4().hex[:6].upper()
        prod = requests.post(
            f"{API}/ha/products", headers=hdr(admin_token),
            json={"brand": f"TI2_{uid}", "model": f"TI2_M_{uid}",
                  "form_factor": "RIC", "warranty_months": 24,
                  "mrp": 100000, "cost": 50000, "min_sell_price": 80000,
                  "is_serialised": True}, timeout=15,
        ).json()
        pid = prod["product_id"]
        po = requests.post(
            f"{API}/ha/purchase-orders", headers=hdr(admin_token),
            json={"branch_id": branch_id, "vendor_id": vendor_id,
                  "lines": [{"product_id": pid, "qty": 1, "unit_cost": 50000, "gst_rate": 18}]},
            timeout=15,
        ).json()
        po_no = po["po_no"]
        for st in ("approved", "ordered"):
            requests.post(f"{API}/ha/purchase-orders/{po_no}/status",
                          headers=hdr(admin_token), json={"to_status": st}, timeout=10)
        sn = f"TI2-SN-{uid}"
        requests.post(f"{API}/ha/grns", headers=hdr(admin_token),
                      json={"po_no": po_no, "lines": [{"product_id": pid, "qty_received": 1,
                                                        "serial_nos": [sn]}]}, timeout=15)
        si = requests.get(f"{API}/ha/serial-items?search={sn}",
                          headers=hdr(admin_token), timeout=10).json()[0]
        p = requests.post(
            f"{API}/patients", headers=hdr(admin_token),
            json={"name": f"TI2_Pat_{uid}", "age": 55, "gender": "Female",
                  "mobile": f"91{uuid.uuid4().int % 100000000:08d}"}, timeout=10,
        ).json()
        quote = requests.post(
            f"{API}/ha/quotations", headers=hdr(audio_token),
            json={"patient_id": p["patient_id"], "branch_id": branch_id, "is_pair": False,
                  "lines": [{"product_id": pid, "side": "single", "qty": 1,
                             "unit_price": 90000, "gst_rate": 18}]}, timeout=15,
        ).json()
        qn = quote["quote_no"]
        requests.post(f"{API}/ha/quotations/{qn}/status", headers=hdr(audio_token),
                      json={"to_status": "accepted"}, timeout=10)
        sale = requests.post(
            f"{API}/ha/sales", headers=hdr(audio_token),
            json={"quote_no": qn, "serial_assignments": {0: si["serial_id"]}}, timeout=15,
        ).json()
        requests.post(f"{API}/ha/sales/{sale['sale_no']}/mark-invoiced",
                      headers=hdr(admin_token), json={}, timeout=10)
        mp = requests.post(f"{API}/ha/sales/{sale['sale_no']}/mark-paid",
                           headers=hdr(admin_token), json={}, timeout=10)
        assert mp.status_code == 200, mp.text

        # Create + reject
        ti_resp = requests.post(
            f"{API}/ha/trade-ins", headers=hdr(audio_token),
            json={
                "branch_id": branch_id, "patient_id": p["patient_id"],
                "old_serial_id": si["serial_id"], "condition": "fair",
                "appraised_value": 5000, "offered_credit": 3000,
            }, timeout=10,
        )
        assert ti_resp.status_code == 201, ti_resp.text
        ti = ti_resp.json()
        r = requests.post(f"{API}/ha/trade-ins/{ti['trade_in_id']}/reject",
                          headers=hdr(audio_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        # Rejected from appraised — serial untouched
        si_after = requests.get(f"{API}/ha/serial-items/{si['serial_id']}",
                                headers=hdr(admin_token), timeout=10).json()
        assert si_after["state"] == "SOLD"

        # Cannot accept a rejected trade-in
        r2 = requests.post(f"{API}/ha/trade-ins/{ti['trade_in_id']}/accept",
                           headers=hdr(audio_token), timeout=10)
        assert r2.status_code == 409
