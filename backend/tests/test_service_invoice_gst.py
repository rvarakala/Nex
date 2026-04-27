"""Service Job → auto-generated GST invoice (18%, SAC 9985) at handover."""
from __future__ import annotations

import os
import time

import pytest
import requests

API = (
    os.environ.get("API_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
)
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@acs.in")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def patient_id(auth_headers):
    return requests.get(f"{API}/patients?limit=1", headers=auth_headers).json()[0]["patient_id"]


@pytest.fixture(scope="module")
def branch_id(auth_headers):
    return requests.get(f"{API}/branches", headers=auth_headers).json()[0]["branch_id"]


def _walk_to_ready(headers, patient_id, branch_id, *,
                   conveyed=4500, discount=500, vendor_amount=4000):
    """Build a ticket and walk it to READY_FOR_PICKUP with an approved
    estimate (conveyed=4500, discount=500 → final 4000)."""
    tno = requests.post(f"{API}/ha/service-tickets", headers=headers, json={
        "branch_id": branch_id, "patient_id": patient_id, "kind": "repair",
        "complaint": "Auto-invoice test", "warranty_covered": False,
    }).json()["ticket_no"]
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "INSPECTED"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "AWAITING_DISPATCH"})
    awb1 = f"AWB-INV-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=headers, json={
        "ticket_no": tno, "direction": "OUTBOUND", "courier_partner": "Bluedart",
        "awb_number": awb1, "dispatch_date": "2026-04-27",
    })
    shid = r.json()["shipment_id"]
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "IN_TRANSIT"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=headers,
                  json={"to_status": "PICKED_UP"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=headers,
                  json={"to_status": "DELIVERED"})
    requests.post(f"{API}/ha/service-estimates", headers=headers, json={
        "ticket_no": tno, "vendor_name": "Phonak", "amount": vendor_amount,
        "conveyed_amount": conveyed, "discount": discount,
        "warranty_covered": False, "eta_days": 5,
    })
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=headers).json()
    appid = t["approval_id"]
    requests.post(f"{API}/ha/customer-approvals/{appid}/decide", headers=headers,
                  json={"decision": "APPROVED", "contact_number": "9999999999"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "REPAIR_IN_PROGRESS"})
    awb2 = f"AWB-IN-INV-{int(time.time()*1000)}"
    requests.post(f"{API}/ha/couriers", headers=headers, json={
        "ticket_no": tno, "direction": "INBOUND", "courier_partner": "Delhivery",
        "awb_number": awb2, "dispatch_date": "2026-04-30",
    })
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "READY_FOR_PICKUP"})
    return tno


def test_generate_invoice_at_ready_with_18_percent_gst(auth_headers, patient_id, branch_id):
    tno = _walk_to_ready(auth_headers, patient_id, branch_id,
                          conveyed=4500, discount=500)
    r = requests.post(f"{API}/ha/service-tickets/{tno}/invoice",
                      headers=auth_headers)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["ticket_no"] == tno
    assert inv["invoice_no"].startswith("INV/")
    # Single line, ₹4000 base, 18% GST = ₹720, total ₹4720
    assert len(inv["lines"]) == 1
    line = inv["lines"][0]
    assert line["gst_rate"] == 18.0
    assert line["hsn_sac"] == "9985"
    assert line["taxable_value"] == 4000.0
    # Tax: split between cgst+sgst (intra-state) OR igst (inter-state).
    # In our seed both clinic and patient default state = same → cgst+sgst
    line_tax = line["cgst_amount"] + line["sgst_amount"] + line["igst_amount"]
    assert round(line_tax, 2) == 720.0
    assert inv["subtotal"] == 4000.0
    assert inv["tax_total"] == 720.0
    assert inv["grand_total"] == 4720.0
    assert inv["rounded_total"] == 4720
    # Patient details copied
    assert inv["patient_id"] == patient_id
    # Description carries the ticket number
    assert tno in line["description"]


def test_generate_invoice_is_idempotent(auth_headers, patient_id, branch_id):
    tno = _walk_to_ready(auth_headers, patient_id, branch_id, conveyed=2000, discount=0)
    r1 = requests.post(f"{API}/ha/service-tickets/{tno}/invoice", headers=auth_headers)
    assert r1.status_code == 200
    inv1 = r1.json()
    # Second call returns the SAME invoice
    r2 = requests.post(f"{API}/ha/service-tickets/{tno}/invoice", headers=auth_headers)
    assert r2.status_code == 200
    inv2 = r2.json()
    assert inv2["invoice_id"] == inv1["invoice_id"]
    assert inv2["invoice_no"] == inv1["invoice_no"]
    # Ticket has the link stamped
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["invoice_id"] == inv1["invoice_id"]
    assert t["invoice_no"] == inv1["invoice_no"]


def test_warranty_covered_invoice_is_zero_rupees(auth_headers, patient_id, branch_id):
    """Even warranty repairs deserve an invoice (paper trail) but ₹0."""
    tno = requests.post(f"{API}/ha/service-tickets", headers=auth_headers, json={
        "branch_id": branch_id, "patient_id": patient_id, "kind": "repair",
        "complaint": "Warranty test", "warranty_covered": True,
    }).json()["ticket_no"]
    # Walk straight to READY (no estimate needed for warranty)
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "INSPECTED"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "READY_FOR_PICKUP"})

    r = requests.post(f"{API}/ha/service-tickets/{tno}/invoice", headers=auth_headers)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["grand_total"] == 0.0
    assert inv["status"] == "paid"     # auto-marked paid (₹0 due)
    assert inv["lines"][0]["gst_rate"] == 0.0


def test_generate_invoice_blocked_at_non_terminal_states(auth_headers, patient_id, branch_id):
    tno = requests.post(f"{API}/ha/service-tickets", headers=auth_headers, json={
        "branch_id": branch_id, "patient_id": patient_id, "kind": "repair",
        "complaint": "blocked test", "warranty_covered": False,
    }).json()["ticket_no"]
    # At RECEIVED — can't bill yet
    r = requests.post(f"{API}/ha/service-tickets/{tno}/invoice", headers=auth_headers)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert isinstance(detail, str)
    assert "Ready" in detail or "ready" in detail or "Closed" in detail.lower()


def test_generated_invoice_shows_in_billing_list(auth_headers, patient_id, branch_id):
    tno = _walk_to_ready(auth_headers, patient_id, branch_id, conveyed=1000, discount=0)
    r = requests.post(f"{API}/ha/service-tickets/{tno}/invoice", headers=auth_headers)
    inv_id = r.json()["invoice_id"]
    # Pull the generic billing list and confirm presence
    listing = requests.get(f"{API}/billing/invoices?limit=200", headers=auth_headers).json()
    items = listing if isinstance(listing, list) else listing.get("items", [])
    found = next((i for i in items if i["invoice_id"] == inv_id), None)
    assert found is not None, "Auto-generated invoice should appear in the billing list"
    assert found["ticket_no"] == tno
