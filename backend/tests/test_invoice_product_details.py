"""Regression tests for invoice product-detail fields.

Covers the new optional fields on InvoiceLineCreate:
  product_type · make · model · serial_numbers · technology_tier
"""
import time
import pytest
import requests


API = "http://localhost:8001/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner@thesoundclinic.in", "demo123")


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def patient_id(owner_token):
    r = requests.get(f"{API}/patients?limit=1", headers=_h(owner_token), timeout=10)
    r.raise_for_status()
    rows = r.json()
    assert rows, "Sandbox needs at least one patient — seed first"
    return rows[0]["patient_id"]


def test_invoice_persists_product_fields(owner_token, patient_id):
    suffix = str(int(time.time() * 1000))[-6:]
    payload = {
        "patient_id": patient_id,
        "lines": [{
            "description": f"Phonak Audeo P50-R [{suffix}]",
            "quantity": 2,
            "unit_price": 95000,
            "is_taxable": True,
            "gst_rate": 18,
            "hsn_sac": "9021",
            "product_type": "Hearing Aid",
            "make": "Phonak",
            "model": "Audeo P50-R",
            "technology_tier": "Premium",
            "serial_numbers": [f"PHN-{suffix}-01", f"PHN-{suffix}-02"],
        }],
    }
    r = requests.post(f"{API}/billing/invoices", headers=_h(owner_token), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert len(inv["lines"]) == 1
    line = inv["lines"][0]
    assert line["product_type"] == "Hearing Aid"
    assert line["make"] == "Phonak"
    assert line["model"] == "Audeo P50-R"
    assert line["technology_tier"] == "Premium"
    assert line["serial_numbers"] == [f"PHN-{suffix}-01", f"PHN-{suffix}-02"]


def test_invoice_rejects_invalid_tier(owner_token, patient_id):
    r = requests.post(
        f"{API}/billing/invoices",
        headers=_h(owner_token),
        json={"patient_id": patient_id, "lines": [{
            "description": "x", "quantity": 1, "unit_price": 100,
            "technology_tier": "Bogus",
        }]},
        timeout=10,
    )
    assert r.status_code == 422


def test_invoice_rejects_invalid_product_type(owner_token, patient_id):
    r = requests.post(
        f"{API}/billing/invoices",
        headers=_h(owner_token),
        json={"patient_id": patient_id, "lines": [{
            "description": "x", "quantity": 1, "unit_price": 100,
            "product_type": "NotARealType",
        }]},
        timeout=10,
    )
    assert r.status_code == 422


def test_invoice_without_product_fields_still_works(owner_token, patient_id):
    r = requests.post(
        f"{API}/billing/invoices",
        headers=_h(owner_token),
        json={"patient_id": patient_id, "lines": [{
            "description": "Consultation fee",
            "quantity": 1, "unit_price": 500,
        }]},
        timeout=10,
    )
    assert r.status_code == 200
    line = r.json()["lines"][0]
    # Defaults — backwards-compatible.
    assert line["product_type"] is None
    assert line["make"] is None
    assert line["model"] is None
    assert line["technology_tier"] is None
    assert line["serial_numbers"] == []


def test_serial_numbers_get_trimmed_and_blanks_dropped(owner_token, patient_id):
    """`_compute_line` strips whitespace and skips blank entries — so an
    over-allocated array (qty 1 but 3 slots, two empty) ends up with the
    actual serial only."""
    r = requests.post(
        f"{API}/billing/invoices",
        headers=_h(owner_token),
        json={"patient_id": patient_id, "lines": [{
            "description": "Single HA", "quantity": 1, "unit_price": 50000,
            "product_type": "Hearing Aid",
            "serial_numbers": ["  REAL-12345  ", "", "  "],
        }]},
        timeout=10,
    )
    assert r.status_code == 200
    line = r.json()["lines"][0]
    assert line["serial_numbers"] == ["REAL-12345"]
