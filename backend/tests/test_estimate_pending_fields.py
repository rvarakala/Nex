"""Estimate Pending — Conveyed amount / Discount / Conveyed by + Approval contact_number."""
from __future__ import annotations

import os
import time

import pytest
import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
API = (
    os.environ.get("API_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
)
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", ADMIN_EMAIL)
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", ADMIN_PASSWORD)


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


def _walk_to_delivered_to_company(headers, patient_id, branch_id):
    """Helper: build a ticket and walk it to DELIVERED_TO_COMPANY (where the
    first estimate becomes legal)."""
    tno = requests.post(f"{API}/ha/service-tickets", headers=headers, json={
        "branch_id": branch_id, "patient_id": patient_id, "kind": "repair",
        "complaint": "Estimate fields test", "warranty_covered": False,
    }).json()["ticket_no"]
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "INSPECTED", "note": "ok"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "AWAITING_DISPATCH"})
    awb = f"AWB-EST-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=headers, json={
        "ticket_no": tno, "direction": "OUTBOUND", "courier_partner": "Bluedart",
        "awb_number": awb, "dispatch_date": "2026-04-27",
    })
    shid = r.json()["shipment_id"]
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=headers,
                  json={"to_status": "IN_TRANSIT"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=headers,
                  json={"to_status": "PICKED_UP"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=headers,
                  json={"to_status": "DELIVERED"})
    return tno


def test_estimate_persists_conveyed_amount_discount_and_conveyed_by(auth_headers, patient_id, branch_id):
    tno = _walk_to_delivered_to_company(auth_headers, patient_id, branch_id)
    r = requests.post(f"{API}/ha/service-estimates", headers=auth_headers, json={
        "ticket_no": tno, "vendor_name": "Phonak Mumbai",
        "amount": 4000, "conveyed_amount": 4500, "discount": 500,
        "warranty_covered": False, "eta_days": 5,
        "repair_notes": "Receiver swap",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["amount"] == 4000.0
    assert body["conveyed_amount"] == 4500.0
    assert body["discount"] == 500.0
    assert body["conveyed_by_name"]                       # auto-stamped
    assert body["conveyed_at"]                            # auto-stamped
    assert body["conveyed_by_user_id"]


def test_estimate_without_conveyed_amount_skips_conveyed_stamp(auth_headers, patient_id, branch_id):
    """If conveyed_amount + discount are both omitted, conveyed_* fields stay None."""
    tno = _walk_to_delivered_to_company(auth_headers, patient_id, branch_id)
    r = requests.post(f"{API}/ha/service-estimates", headers=auth_headers, json={
        "ticket_no": tno, "vendor_name": "Phonak", "amount": 2000,
        "warranty_covered": False, "eta_days": 4,
    })
    assert r.status_code == 201
    body = r.json()
    assert body["conveyed_amount"] is None
    assert body["discount"] is None
    assert body["conveyed_by_name"] is None
    assert body["conveyed_at"] is None


def test_approval_decide_persists_contact_number_and_notes(auth_headers, patient_id, branch_id):
    tno = _walk_to_delivered_to_company(auth_headers, patient_id, branch_id)
    requests.post(f"{API}/ha/service-estimates", headers=auth_headers, json={
        "ticket_no": tno, "vendor_name": "Phonak", "amount": 3000,
        "conveyed_amount": 3300, "discount": 300, "eta_days": 4,
    })
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    appid = t["approval_id"]
    r = requests.post(f"{API}/ha/customer-approvals/{appid}/decide", headers=auth_headers, json={
        "decision": "APPROVED", "contact_number": "+91 98765 43210",
        "notes": "Patient confirmed via phone, proceed with repair",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == "APPROVED"
    assert body["contact_number"] == "+91 98765 43210"
    assert body["notes"] == "Patient confirmed via phone, proceed with repair"
    assert body["decided_by_name"]
    assert body["decided_at"]


def test_approval_decide_without_contact_still_works(auth_headers, patient_id, branch_id):
    """Backward-compat: prior callers that didn't pass contact_number still succeed."""
    tno = _walk_to_delivered_to_company(auth_headers, patient_id, branch_id)
    requests.post(f"{API}/ha/service-estimates", headers=auth_headers, json={
        "ticket_no": tno, "vendor_name": "Phonak", "amount": 3000, "eta_days": 4,
    })
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    appid = t["approval_id"]
    r = requests.post(f"{API}/ha/customer-approvals/{appid}/decide", headers=auth_headers, json={
        "decision": "REJECTED", "notes": "Too expensive",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["decision"] == "REJECTED"
    assert body["contact_number"] is None
    assert body["notes"] == "Too expensive"
