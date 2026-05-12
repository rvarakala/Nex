"""Regression tests for the 2 fixes shipped 2026-05-09:

  1. `GET /api/ha/serial-items` now accepts `current_patient_id` query param
     and filters server-side (was being silently dropped before).
  2. `POST /api/ha/service-tickets/{n}/transition` to DISPATCHED is now
     blocked unless an Outbound courier shipment with an AWB exists for
     the ticket.

  The fixture seeds a tiny self-contained scenario inside `clinic-pytest-suite`
  so we don't depend on the demo tenant having specific data.
"""
from __future__ import annotations
import os
import uuid
import requests
import pytest

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H  # noqa: E402

ADMIN_CLINIC = os.environ.get("TEST_ADMIN_CLINIC_ID", "clinic-pytest-suite")


@pytest.fixture(scope="module")
def admin_token():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


def _post(path, headers, body):
    # `API` already includes the `/api` prefix; callers pass path without it.
    r = requests.post(f"{API}{path}", json=body, headers=headers, timeout=10)
    r.raise_for_status()
    return r.json()


def _get(path, headers, params=None):
    r = requests.get(f"{API}{path}", headers=headers, params=params, timeout=10)
    r.raise_for_status()
    return r.json()


def test_serial_items_filters_by_current_patient_id(admin_token):
    """Smoke test the filter — caller passes a fake patient_id and expects
    an empty list, not the full clinic serial inventory."""
    h = H(admin_token)
    fake_pid = f"PT-DOES-NOT-EXIST-{uuid.uuid4().hex[:6]}"
    rows = _get("/ha/serial-items", h, params={"current_patient_id": fake_pid, "limit": 50})
    assert isinstance(rows, list)
    # Must be empty — proves server-side filter is wired (previously returned
    # everything because the query param was silently ignored).
    assert rows == [], (
        f"Expected zero serial items for unknown patient_id, got {len(rows)}"
    )


def test_dispatched_transition_requires_outbound_awb(admin_token):
    """Create a service ticket, push it through INSPECTED → AWAITING_DISPATCH,
    then verify that the AWAITING_DISPATCH → DISPATCHED transition is
    blocked with 422 when no outbound courier is booked.
    """
    h = H(admin_token)

    # ── Pick / create a branch + patient inside the pytest tenant
    branches = _get("/branches", h)
    assert branches, "Tenant needs at least one branch"
    branch_id = branches[0]["branch_id"]

    # Use the bootstrap patient seeded by conftest
    patients = _get("/patients", h, params={"limit": 5})
    assert patients, "Tenant needs at least one patient"
    patient_id = patients[0]["patient_id"]

    # ── Create a service ticket
    ticket = _post(
        "/ha/service-tickets",
        h,
        {
            "branch_id": branch_id,
            "patient_id": patient_id,
            "kind": "repair",
            "complaint": "Test ticket — pytest dispatch-AWB guard regression",
            "warranty_covered": False,
        },
    )
    tn = ticket["ticket_no"]
    assert tn

    # ── Push RECEIVED → INSPECTED
    _post(f"/ha/service-tickets/{tn}/transition", h, {"to_status": "INSPECTED", "note": "Tested OK"})
    # INSPECTED → AWAITING_DISPATCH
    _post(f"/ha/service-tickets/{tn}/transition", h, {"to_status": "AWAITING_DISPATCH"})

    # ── Attempt AWAITING_DISPATCH → DISPATCHED without booking a courier
    r = requests.post(
        f"{API}/ha/service-tickets/{tn}/transition",
        json={"to_status": "DISPATCHED"},
        headers=h, timeout=10,
    )
    assert r.status_code == 422, f"Expected 422 (AWB required), got {r.status_code}: {r.text}"
    assert "outbound" in r.text.lower() or "awb" in r.text.lower() or "tracking" in r.text.lower(), (
        f"Error message must mention outbound/AWB: {r.text}"
    )

    # ── Now book an outbound shipment with an AWB
    awb = f"PYT-{uuid.uuid4().hex[:8].upper()}"
    _post(
        "/ha/couriers",
        h,
        {
            "ticket_no": tn,
            "direction": "OUTBOUND",
            "courier_partner": "Bluedart",
            "awb_number": awb,
        },
    )

    # ── Ticket should have auto-advanced to DISPATCHED via the courier booking
    cur = _get(f"/ha/service-tickets/{tn}", h)
    assert cur["status"] in ("DISPATCHED", "IN_TRANSIT"), (
        f"After booking outbound courier, status should be DISPATCHED, got {cur['status']}"
    )
