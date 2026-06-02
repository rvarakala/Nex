"""Phase 14 — Clinical workflow extensions for hearing-aid service flow.

Covers:
- repair_location field on ServiceTicketCreate (IN_CLINIC vs VENDOR)
- AWB-later courier booking (PENDING_AWB → PATCH /couriers/{id}/awb → BOOKED)
- Loaner state machine (IN_STOCK → ON_LOAN → IN_STOCK)
- Loaner refundable deposit lifecycle
- mark-return-unrepaired flag + auto-created inbound courier shell
- Service Note PDF endpoint
"""
import os

import pytest
import requests
from pymongo import MongoClient

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


@pytest.fixture(scope="module")
def tok():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def mongo():
    cli = MongoClient(os.environ["MONGO_URL"])
    return cli[os.environ["DB_NAME"]]


@pytest.fixture(scope="module")
def ctx(tok, mongo):
    """Bootstrap shared test ctx: a clinic, branch, patient, SOLD serial
    (the unit going in for service), and a separate IN_STOCK serial
    (the loaner candidate).

    NB: pytest passes the same dict instance to every test that depends
    on this fixture (scope='module' → cached). Tests can mutate it
    safely — `ctx['ticket_no'] = ...` in test_01 is visible to test_02.
    Re-binding `ctx = ...` would NOT propagate; only in-place mutation does.
    """
    me = requests.get(f"{API}/auth/me", headers=H(tok)).json()
    clinic_id = me["user"]["clinic_id"]
    branch_id = (me["user"].get("branch_ids") or [None])[0]
    if not branch_id:
        br = mongo.branches.find_one({"clinic_id": clinic_id}, {"_id": 0})
        branch_id = br["branch_id"] if br else None

    # Patient
    p = requests.post(
        f"{API}/patients",
        json={"name": "Phase14 Patient", "mobile": "9988007700", "age": 60, "gender": "Female"},
        headers=H(tok),
    ).json()

    # Pick a SOLD serial that's already bound to this patient
    sold = mongo.serial_items.find_one(
        {"clinic_id": clinic_id, "state": "SOLD"}, {"_id": 0, "serial_id": 1, "patient_id": 1},
    )
    if not sold:
        pytest.skip("No SOLD serial in this clinic — seed inventory first")
    sold_sid = sold["serial_id"]
    # Force-bind to our patient for the test
    mongo.serial_items.update_one(
        {"serial_id": sold_sid},
        {"$set": {"current_patient_id": p["patient_id"]}},
    )

    # Pick (or coerce) an IN_STOCK loaner
    in_stock = mongo.serial_items.find_one(
        {"clinic_id": clinic_id, "state": "IN_STOCK", "serial_id": {"$ne": sold_sid}},
        {"_id": 0, "serial_id": 1},
    )
    if not in_stock:
        pytest.skip("No IN_STOCK serial available as loaner — seed inventory")
    loaner_sid = in_stock["serial_id"]

    return {
        "tok": tok,
        "clinic_id": clinic_id,
        "branch_id": branch_id,
        "patient_id": p["patient_id"],
        "sold_sid": sold_sid,
        "loaner_sid": loaner_sid,
        "ticket_no": None,
        "outbound_shipment_id": None,
    }


def test_01_create_ticket_with_repair_location_vendor(ctx, tok):
    body = {
        "branch_id": ctx["branch_id"],
        "patient_id": ctx["patient_id"],
        "serial_id": ctx["sold_sid"],
        "kind": "repair",
        "complaint": "No sound from right channel — suspected receiver failure",
        "warranty_covered": False,
        "repair_location": "VENDOR",
    }
    r = requests.post(f"{API}/ha/service-tickets", json=body, headers=H(tok))
    assert r.status_code in (200, 201), r.text
    out = r.json()
    assert out["repair_location"] == "VENDOR"
    ctx["ticket_no"] = out["ticket_no"]


def test_02_issue_loaner_with_deposit(ctx, tok, mongo):
    r = requests.post(
        f"{API}/ha/service-tickets/{ctx['ticket_no']}/loaner/issue",
        json={"loaner_serial_id": ctx["loaner_sid"], "deposit_amount": 2000},
        headers=H(tok),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deposit_amount"] == 2000.0
    # Loaner serial flipped IN_STOCK → ON_LOAN
    s = mongo.serial_items.find_one({"serial_id": ctx["loaner_sid"]}, {"_id": 0, "state": 1})
    assert s["state"] == "ON_LOAN", f"expected ON_LOAN, got {s['state']}"


def test_03_book_courier_without_awb_pending(ctx, tok, mongo):
    """Courier guy promised AWB tomorrow. Reception books with awb=None."""
    body = {
        "ticket_no": ctx["ticket_no"],
        "direction": "OUTBOUND",
        "courier_partner": "Bluedart",
        "awb_number": None,
        "from_address": "Clinic",
        "to_address": "Manufacturer",
    }
    r = requests.post(f"{API}/ha/couriers", json=body, headers=H(tok))
    assert r.status_code in (200, 201), r.text
    sh = r.json()
    assert sh["status"] == "PENDING_AWB"
    assert sh["awb_number"] is None
    ctx["outbound_shipment_id"] = sh["shipment_id"]


def test_04_patch_awb_flips_status_to_booked(ctx, tok, mongo):
    r = requests.patch(
        f"{API}/ha/couriers/{ctx['outbound_shipment_id']}/awb",
        json={"awb_number": "BD-2026-001234", "courier_partner": "Bluedart"},
        headers=H(tok),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["awb_number"] == "BD-2026-001234"
    assert body["status"] == "BOOKED"


def test_05_patch_awb_rejects_duplicate(ctx, tok, mongo):
    """A second OUTBOUND shipment cannot reuse the same AWB."""
    body = {
        "ticket_no": ctx["ticket_no"],
        "direction": "OUTBOUND",
        "courier_partner": "DTDC",
        "awb_number": None,
        "from_address": "X",
        "to_address": "Y",
    }
    r = requests.post(f"{API}/ha/couriers", json=body, headers=H(tok))
    second_sid = r.json()["shipment_id"]
    r2 = requests.patch(
        f"{API}/ha/couriers/{second_sid}/awb",
        json={"awb_number": "BD-2026-001234"},
        headers=H(tok),
    )
    assert r2.status_code == 409, r2.text
    # Cleanup
    mongo.ha_courier_shipments.delete_one({"shipment_id": second_sid})


def test_06_service_note_pdf_renders(ctx, tok):
    r = requests.get(
        f"{API}/ha/service-tickets/{ctx['ticket_no']}/service-note.pdf",
        headers=H(tok),
    )
    assert r.status_code == 200, r.text[:200]
    assert r.headers.get("content-type", "").startswith("application/pdf")
    # PDF magic bytes
    assert r.content[:4] == b"%PDF"
    assert len(r.content) > 1500  # sanity — not a 1-byte stub


def test_07_loaner_return_refunds_deposit(ctx, tok, mongo):
    r = requests.post(
        f"{API}/ha/service-tickets/{ctx['ticket_no']}/loaner/return",
        json={"forfeit_deposit": False},
        headers=H(tok),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "loaner_deposit_refunded_at" in body
    # Loaner serial flipped back ON_LOAN → IN_STOCK
    s = mongo.serial_items.find_one({"serial_id": ctx["loaner_sid"]}, {"_id": 0, "state": 1})
    assert s["state"] == "IN_STOCK", f"expected IN_STOCK, got {s['state']}"


def test_08_mark_return_unrepaired_creates_inbound_shell(ctx, tok, mongo):
    r = requests.post(
        f"{API}/ha/service-tickets/{ctx['ticket_no']}/mark-return-unrepaired",
        headers=H(tok),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inbound_shipment_id"]
    sh = mongo.ha_courier_shipments.find_one(
        {"shipment_id": body["inbound_shipment_id"]}, {"_id": 0},
    )
    assert sh["direction"] == "INBOUND"
    assert sh["status"] == "PENDING_AWB"
    assert sh["awb_number"] is None
    t = mongo.service_tickets.find_one(
        {"ticket_no": ctx["ticket_no"]}, {"_id": 0},
    )
    assert t["return_unrepaired"] is True
    assert t["cost_to_patient"] == 0.0
    assert t["warranty_covered"] is False


def test_99_cleanup(ctx, mongo):
    """Test housekeeping — undo all DB writes."""
    if ctx.get("ticket_no"):
        mongo.service_tickets.delete_many({"ticket_no": ctx["ticket_no"]})
        mongo.ha_courier_shipments.delete_many({"ticket_no": ctx["ticket_no"]})
    if ctx.get("patient_id"):
        mongo.patients.delete_one({"patient_id": ctx["patient_id"]})
    # Reset loaner serial back to IN_STOCK (defensive — test_07 should
    # have done this, but better safe than sorry for the next run)
    if ctx.get("loaner_sid"):
        mongo.serial_items.update_one(
            {"serial_id": ctx["loaner_sid"]},
            {"$set": {"state": "IN_STOCK"}},
        )
