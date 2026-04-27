"""Service Pipeline auto-advance + Inspection notes + Service Report regression.

Covers user-reported bugs (2026-04-27):
  1. "Book shipment fails" — booking shipment didn't auto-advance pipeline,
     leaving ticket stuck at AWAITING_DISPATCH so users thought it failed.
  2. "Inspection notes" capture missing in pipeline UI.
  3. "Print report at end" — Job Card PDF was a basic intake card; users want
     a comprehensive Service Report at terminal states.
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
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def patient_id(auth_headers):
    r = requests.get(f"{API}/patients?limit=1", headers=auth_headers)
    return r.json()[0]["patient_id"]


@pytest.fixture(scope="module")
def branch_id(auth_headers):
    r = requests.get(f"{API}/branches", headers=auth_headers)
    return r.json()[0]["branch_id"]


def _new_ticket(headers, patient_id, branch_id, kind="repair", complaint="Pipeline regression"):
    r = requests.post(f"{API}/ha/service-tickets", headers=headers, json={
        "branch_id": branch_id, "patient_id": patient_id, "kind": kind,
        "complaint": complaint, "warranty_covered": False,
    })
    assert r.status_code == 201, r.text
    return r.json()["ticket_no"]


def test_inspection_notes_persisted(auth_headers, patient_id, branch_id):
    """Transition with note + to_status=INSPECTED stores inspection_notes on ticket."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    r = requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                      json={"to_status": "INSPECTED",
                            "note": "Receiver crackling, mic dead — replaceable parts"})
    assert r.status_code == 200
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["inspection_notes"] == "Receiver crackling, mic dead — replaceable parts"
    assert t["status"] == "INSPECTED"


def test_outbound_shipment_auto_advances_to_dispatched(auth_headers, patient_id, branch_id):
    """Booking OUTBOUND shipment at AWAITING_DISPATCH auto-advances to DISPATCHED."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "INSPECTED", "note": "ok"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "AWAITING_DISPATCH"})

    awb = f"AWB-AUTO-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno, "direction": "OUTBOUND", "courier_partner": "Bluedart",
        "awb_number": awb, "dispatch_date": "2026-04-26", "to_address": "Phonak Mumbai",
    })
    assert r.status_code == 201, r.text
    shid = r.json()["shipment_id"]

    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["status"] == "DISPATCHED", f"expected DISPATCHED, got {t['status']}"
    assert t["dispatched_at"]
    assert t["outbound_shipment_id"] == shid


def test_inbound_shipment_auto_advances_to_return_shipped(auth_headers, patient_id, branch_id):
    """Booking INBOUND at REPAIR_IN_PROGRESS auto-advances to RETURN_SHIPPED."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    # Walk to REPAIR_IN_PROGRESS quickly
    for st in ("INSPECTED", "AWAITING_DISPATCH"):
        requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                      json={"to_status": st, "note": "ok"})
    awb1 = f"AWB-OUT-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno, "direction": "OUTBOUND", "courier_partner": "Bluedart",
        "awb_number": awb1, "dispatch_date": "2026-04-26",
    })
    shid = r.json()["shipment_id"]
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "IN_TRANSIT"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=auth_headers,
                  json={"to_status": "PICKED_UP"})
    requests.post(f"{API}/ha/couriers/{shid}/status", headers=auth_headers,
                  json={"to_status": "DELIVERED"})  # auto → DELIVERED_TO_COMPANY
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "REPAIR_IN_PROGRESS"})

    awb2 = f"AWB-IN-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno, "direction": "INBOUND", "courier_partner": "Delhivery",
        "awb_number": awb2, "dispatch_date": "2026-04-30",
    })
    assert r.status_code == 201
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["status"] == "RETURN_SHIPPED", f"expected RETURN_SHIPPED, got {t['status']}"
    assert t["return_shipped_at"]
    assert t["inbound_shipment_id"] == r.json()["shipment_id"]


def test_outbound_shipment_no_advance_when_not_at_awaiting(auth_headers, patient_id, branch_id):
    """If a courier is booked at the wrong state (e.g. RECEIVED), DON'T auto-advance."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    awb = f"AWB-NOPE-{int(time.time()*1000)}"
    r = requests.post(f"{API}/ha/couriers", headers=auth_headers, json={
        "ticket_no": tno, "direction": "OUTBOUND", "courier_partner": "DTDC",
        "awb_number": awb, "dispatch_date": "2026-04-26",
    })
    assert r.status_code == 201
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    # Status should still be RECEIVED (no auto-advance for unexpected booking)
    assert t["status"] in ("RECEIVED", "open"), f"expected unchanged, got {t['status']}"


def test_service_report_pdf_at_terminal(auth_headers, patient_id, branch_id):
    """Job Card endpoint returns a Service Report PDF at terminal states."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    # Walk full happy path
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "INSPECTED", "note": "tested receiver"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "READY_FOR_PICKUP"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "DELIVERED_TO_CLIENT", "note": "Handed over"})
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "CLOSED"})

    r = requests.get(f"{API}/ha/service-tickets/{tno}/job-card.pdf", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"
    assert "service-report" in r.headers.get("content-disposition", "")
    assert len(r.content) > 2500
