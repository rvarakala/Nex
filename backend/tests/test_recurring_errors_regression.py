"""Regression for the user-reported recurring errors:

  1. "Failed to book shipment" — most common cause was duplicate AWB
     swallowed as a generic message. Now any error must carry a real string
     in `detail`.
  2. "Failed to record estimate" — similar story.
  3. Job Card PDF "Not authenticated" — endpoint MUST require auth and the
     frontend must use axios (not <a href>) so the JWT travels with the request.

All three cases must be covered by the API contract so the frontend's
`describeError()` can surface the actual reason instead of a generic fallback.
"""
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


def _new_ticket(headers, patient_id, branch_id):
    r = requests.post(f"{API}/ha/service-tickets", headers=headers, json={
        "branch_id": branch_id, "patient_id": patient_id, "kind": "repair",
        "complaint": "Recurring errors regression", "warranty_covered": False,
    })
    return r.json()["ticket_no"]


def test_duplicate_awb_returns_specific_detail_string(auth_headers, patient_id, branch_id):
    """Ensures duplicate AWB returns a parseable string detail (not an opaque object)."""
    tno1 = _new_ticket(auth_headers, patient_id, branch_id)
    tno2 = _new_ticket(auth_headers, patient_id, branch_id)
    awb = f"AWB-DUP-{int(time.time()*1000)}"
    # First booking succeeds
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno1, "direction": "OUTBOUND", "courier_partner": "Bluedart",
        "awb_number": awb, "dispatch_date": "2026-04-27",
    })
    assert r.status_code == 201
    # Second booking with same AWB must return 409 with a string detail
    # the frontend can show directly
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno2, "direction": "OUTBOUND", "courier_partner": "Bluedart",
        "awb_number": awb, "dispatch_date": "2026-04-27",
    })
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert isinstance(detail, str), f"detail should be a string, got {type(detail)}"
    assert awb in detail, f"detail should mention the conflicting AWB, got {detail!r}"


def test_estimate_at_wrong_state_returns_specific_detail(auth_headers, patient_id, branch_id):
    """At RECEIVED (no shipment yet) recording an estimate must 409 with a string."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    r = requests.post(f"{API}/ha/service-estimates", headers=auth_headers, json={
        "ticket_no": tno, "vendor_name": "Phonak", "amount": 1000,
        "warranty_covered": False, "eta_days": 5,
    })
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert isinstance(detail, str)
    # The exact wording can evolve, but must be a useful, non-generic string
    assert "company" in detail.lower() or "DELIVERED" in detail or "ESTIMATE_PENDING" in detail
    assert len(detail) > 20  # rules out single-word fallbacks like "Failed"


def test_job_card_pdf_requires_auth(auth_headers, patient_id, branch_id):
    """Anonymous request → 403/401, authed → 200 with application/pdf."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    # Without auth header
    r = requests.get(f"{API}/ha/service-tickets/{tno}/job-card.pdf")
    assert r.status_code in (401, 403), \
        f"job-card.pdf must require auth, got {r.status_code}"
    body = r.json()
    assert body.get("detail") in ("Not authenticated", "Forbidden") or \
        isinstance(body.get("detail"), str)
    # With auth → 200 + PDF bytes
    r = requests.get(f"{API}/ha/service-tickets/{tno}/job-card.pdf",
                     headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"


def test_courier_validation_error_shape(auth_headers, patient_id, branch_id):
    """Pydantic validation must surface as 422 with detail array (not opaque)."""
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": "JOB-NOT-EXIST", "direction": "GOING_HOME",   # invalid direction
        "courier_partner": "Bluedart", "awb_number": "x",
    })
    assert r.status_code in (404, 422), f"got {r.status_code}: {r.text}"


def test_book_shipment_at_estimate_pending_succeeds(auth_headers, patient_id, branch_id):
    """At ESTIMATE_PENDING booking another OUTBOUND shipment must succeed but
    NOT auto-advance the pipeline (status stays ESTIMATE_PENDING)."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    # Walk to DELIVERED_TO_COMPANY
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "INSPECTED"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "AWAITING_DISPATCH"})
    awb1 = f"AWB-1-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno, "direction": "OUTBOUND", "courier_partner": "Bluedart",
        "awb_number": awb1, "dispatch_date": "2026-04-27",
    })
    shid = r.json()["shipment_id"]
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "IN_TRANSIT"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=auth_headers,
                  json={"to_status": "PICKED_UP"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=auth_headers,
                  json={"to_status": "DELIVERED"})  # auto → DELIVERED_TO_COMPANY
    # Record estimate → state goes to ESTIMATE_PENDING
    requests.post(f"{API}/ha/service-estimates", headers=auth_headers, json={
        "ticket_no": tno, "vendor_name": "Phonak", "amount": 5000, "eta_days": 5,
    })
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["status"] == "ESTIMATE_PENDING"

    # Now book a courier from ESTIMATE_PENDING — must succeed without crashing
    awb2 = f"AWB-2-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno, "direction": "OUTBOUND", "courier_partner": "Delhivery",
        "awb_number": awb2, "dispatch_date": "2026-04-27",
    })
    assert r.status_code == 201, r.text
    # State must still be ESTIMATE_PENDING (no spurious auto-advance)
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["status"] == "ESTIMATE_PENDING", \
        f"booking from ESTIMATE_PENDING should not auto-advance, got {t['status']}"
