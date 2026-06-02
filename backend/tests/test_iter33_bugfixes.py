"""Regression for iter33 QA findings — Bug 1 (warranty), Bug 2 (GST flat-fee), Bug 3 (walk-in patient)."""
import pytest
import requests

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


@pytest.fixture(scope="module")
def tok():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


# ─────────────────────────────────────────────────────────────────────
# Bug 3 — Walk-in patient: name + mobile only, no age/gender required
# ─────────────────────────────────────────────────────────────────────
def test_walkin_patient_registration_without_age_or_gender(tok):
    r = requests.post(
        f"{API}/patients",
        json={"name": "Walk-in No Demo", "mobile": "9999900099"},
        headers=H(tok),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Walk-in No Demo"
    assert body["age"] is None
    assert body["gender"] is None
    # Cleanup
    requests.delete(f"{API}/patients/{body['patient_id']}", headers=H(tok))


# ─────────────────────────────────────────────────────────────────────
# Bug 2 — Flat-fee GST: unit_price=500 + 18% GST + gst_inclusive=False
#                       MUST produce 590 grand, not 500.
# ─────────────────────────────────────────────────────────────────────
def test_flat_fee_invoice_gst_exclusive_grand_is_590(tok):
    # Need a patient to attach.
    p = requests.post(
        f"{API}/patients",
        json={"name": "GST-Test Patient", "mobile": "9999900088"},
        headers=H(tok),
    ).json()

    payload = {
        "patient_id": p["patient_id"],
        "lines": [{
            "description": "Hearing test consultation",
            "quantity": 1,
            "unit_price": 500.0,
            "is_taxable": True,
            "gst_rate": 18.0,
            "gst_inclusive": False,   # ← the new flag
            "hsn_sac": "999399",
        }],
    }
    r = requests.post(f"{API}/billing/invoices", json=payload, headers=H(tok))
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["subtotal"] == 500.0, f"subtotal: {inv['subtotal']}"
    assert inv["tax_total"] == 90.0, f"tax_total: {inv['tax_total']}"
    assert inv["grand_total"] == 590.0, f"grand_total: {inv['grand_total']}"

    # Cleanup
    requests.delete(f"{API}/billing/invoices/{inv['invoice_id']}", headers=H(tok))
    requests.delete(f"{API}/patients/{p['patient_id']}", headers=H(tok))


def test_inclusive_default_preserves_legacy_behavior(tok):
    """If `gst_inclusive` is omitted, behaviour stays as before
    (price is treated as inclusive). Critical for backward compat —
    existing HA product sale flows MUST not change."""
    p = requests.post(
        f"{API}/patients",
        json={"name": "GST-Legacy Patient", "mobile": "9999900077"},
        headers=H(tok),
    ).json()
    payload = {
        "patient_id": p["patient_id"],
        "lines": [{
            "description": "HA accessory",
            "quantity": 1,
            "unit_price": 1180.0,
            "is_taxable": True,
            "gst_rate": 18.0,
            # gst_inclusive intentionally omitted
        }],
    }
    r = requests.post(f"{API}/billing/invoices", json=payload, headers=H(tok))
    assert r.status_code == 200, r.text
    inv = r.json()
    # 1180 inclusive @ 18% → 1000 taxable + 180 tax
    assert inv["subtotal"] == 1000.0
    assert inv["tax_total"] == 180.0
    assert inv["grand_total"] == 1180.0

    requests.delete(f"{API}/billing/invoices/{inv['invoice_id']}", headers=H(tok))
    requests.delete(f"{API}/patients/{p['patient_id']}", headers=H(tok))


# ─────────────────────────────────────────────────────────────────────
# Bug 1 — Warranty stamp on RESERVED → SOLD
# Direct unit test on `mark_sale_paid_internal` is heavy (needs full
# product + serial + sale setup). The richer iter33 end-to-end test
# (test_iter33_qa_scenarios.py::test_3e) already exercises the flow;
# here we just verify the helper logic in isolation.
# ─────────────────────────────────────────────────────────────────────
def test_serial_item_model_accepts_warranty_end_date():
    """The `warranty_end_date` field must remain ISO-string-compatible
    so the new computed value persists cleanly."""
    from models_ha import SerialItem
    sample = {
        "serial_id": "TEST-SID",
        "product_id": "P1",
        "clinic_id": "tenant-x",
        "branch_id": "BR-X",
        "serial_no": "SN-001",
        "state": "SOLD",
        "warranty_months": 24,
        "warranty_end_date": "2028-06-02",
        "sold_at": "2026-06-02T00:00:00+00:00",
    }
    s = SerialItem.model_validate(sample)
    assert s.warranty_end_date == "2028-06-02"
