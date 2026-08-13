"""Regression: Custom HA Orders — bespoke IIC/CIC/ITC/ITE quick-book flow.

Feb 2026 — clinic asked us to support custom-made hearing aids alongside
ear moulds. Same "book + auto-invoice + status ribbon" pattern, but with
per-ear specs (vent, shell colour, faceplate colour, receiver power) and
a dual-target delivery choice (external vendor OR another branch — used
by branches placing requests with the head office that owns the vendor
relationship).

These tests lock in the invoice math + per-ear spec persistence + the
delivery-target validation so a future refactor can't silently break
either path.
"""
import os
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://referral-payout-lab.preview.emergentagent.com",
).rstrip("/")
EMAIL = "owner@thesoundclinic.in"
PASSWORD = "demo123"


def _sess():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _first_patient(s):
    r = s.get(f"{BASE_URL}/api/patients?limit=1", timeout=15)
    d = r.json()
    d = d.get("items", d) if isinstance(d, dict) else d
    return d[0]["patient_id"]


def _first_vendor(s):
    r = s.get(f"{BASE_URL}/api/vendors?active=true", timeout=15)
    d = r.json() or []
    if not d:
        # Seed a temp vendor so the test doesn't depend on tenant fixtures.
        r = s.post(f"{BASE_URL}/api/vendors",
                   json={"name": "PyTest Custom-HA Vendor"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        return r.json()["vendor_id"]
    return d[0]["vendor_id"]


def _first_branch(s):
    r = s.get(f"{BASE_URL}/api/branches", timeout=15)
    d = r.json() or []
    return d[0]["branch_id"] if d else None


def test_custom_ha_vendor_target_with_advance_generates_partial_invoice():
    """Vendor-target order with per-ear specs must persist all specs and
    generate a PARTIAL invoice with correct math."""
    s = _sess()
    pid = _first_patient(s)
    vid = _first_vendor(s)
    r = s.post(f"{BASE_URL}/api/ha/custom-ha-orders", json={
        "patient_id": pid, "side": "both", "shell_type": "CIC",
        "vent_size_left": "1.5mm", "vent_size_right": "IROS",
        "shell_colour_left": "Skin", "shell_colour_right": "Skin",
        "receiver_power_left": "P", "receiver_power_right": "M",
        "brand": "Phonak", "model": "Virto B90",
        "features": ["telecoil", "push_button"],
        "delivery_target": "vendor", "vendor_id": vid,
        "expected_delivery_date": "2026-09-15",
        "total_amount": 120000, "advance_amount": 30000,
        "payment_mode": "upi", "gst_rate": 18,
    }, timeout=15)
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["status"] == "sent_to_vendor"
    assert order["shell_type"] == "CIC"
    assert order["vent_size_left"] == "1.5mm"
    assert order["vent_size_right"] == "IROS"
    assert order["receiver_power_left"] == "P"
    assert order["receiver_power_right"] == "M"
    assert order["brand"] == "Phonak"
    assert "telecoil" in order["features"]
    assert order["balance_due"] == 90000
    assert order["vendor_id"] == vid

    inv = s.get(f"{BASE_URL}/api/billing/invoices/{order['invoice_id']}", timeout=15).json()
    assert inv["status"] == "partial"
    assert inv["grand_total"] == 120000
    assert inv["paid_total"] == 30000
    assert inv["due_total"] == 90000


def test_custom_ha_branch_target_requires_target_branch_id():
    """Branch delivery target without target_branch_id must be rejected."""
    s = _sess()
    pid = _first_patient(s)
    r = s.post(f"{BASE_URL}/api/ha/custom-ha-orders", json={
        "patient_id": pid, "side": "left", "shell_type": "ITE",
        "delivery_target": "branch",
        "total_amount": 80000, "advance_amount": 0,
    }, timeout=15)
    assert r.status_code == 400
    assert "target_branch_id" in r.text.lower()


def test_custom_ha_vendor_target_requires_vendor_id():
    """Vendor delivery target without vendor_id must be rejected."""
    s = _sess()
    pid = _first_patient(s)
    r = s.post(f"{BASE_URL}/api/ha/custom-ha-orders", json={
        "patient_id": pid, "side": "both", "shell_type": "IIC",
        "delivery_target": "vendor",
        "total_amount": 60000, "advance_amount": 0,
    }, timeout=15)
    assert r.status_code == 400
    assert "vendor_id" in r.text.lower()


def test_custom_ha_advance_over_total_rejected():
    """Guardrail: over-payment at booking is a data-entry mistake."""
    s = _sess()
    pid = _first_patient(s)
    vid = _first_vendor(s)
    r = s.post(f"{BASE_URL}/api/ha/custom-ha-orders", json={
        "patient_id": pid, "side": "both", "shell_type": "ITC",
        "delivery_target": "vendor", "vendor_id": vid,
        "total_amount": 50000, "advance_amount": 80000,
    }, timeout=15)
    assert r.status_code == 400


def test_custom_ha_status_transition_appends_history():
    """PATCH /status must move the status AND append to `history`."""
    s = _sess()
    pid = _first_patient(s)
    vid = _first_vendor(s)
    r = s.post(f"{BASE_URL}/api/ha/custom-ha-orders", json={
        "patient_id": pid, "side": "right", "shell_type": "CIC",
        "delivery_target": "vendor", "vendor_id": vid,
        "total_amount": 90000, "advance_amount": 10000,
    }, timeout=15)
    order_id = r.json()["order_id"]

    r = s.patch(f"{BASE_URL}/api/ha/custom-ha-orders/{order_id}/status",
                json={"status": "arrived", "note": "Received from Phonak"}, timeout=15)
    assert r.status_code == 200
    updated = r.json()
    assert updated["status"] == "arrived"
    assert len(updated["history"]) >= 2
    assert updated["history"][-1]["status"] == "arrived"


def test_ear_mould_per_ear_vent_persists_when_side_both():
    """Regression: Ear Moulds should store per-ear vent sizes when side=both
    so audiogram-driven prescriptions with different vents on each ear
    (e.g. 1.5mm left, IROS right) don't lose data at booking."""
    s = _sess()
    pid = _first_patient(s)
    r = s.post(f"{BASE_URL}/api/ha/ear-moulds", json={
        "patient_id": pid, "side": "both", "material": "silicone",
        "vent_size_left": "1.5mm", "vent_size_right": "IROS",
        "total_amount": 5000, "advance_amount": 1000,
    }, timeout=15)
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["vent_size_left"] == "1.5mm"
    assert order["vent_size_right"] == "IROS"
    # Invoice description must mention both vents so the tax-invoice print
    # captures the prescription for the patient.
    inv = s.get(f"{BASE_URL}/api/billing/invoices/{order['invoice_id']}", timeout=15).json()
    desc = inv["lines"][0]["description"]
    assert "1.5mm" in desc
    assert "IROS" in desc
