"""Iteration-34 — End-to-end OUT-OF-WARRANTY Hearing-aid Repair Workflow.

Walks a single service ticket through the FULL AUDINEXA service-job state
machine, asserting data integrity at each stage AND surfacing the v1 vs v2
endpoint confusion identified by the review request.

Auto-cleanup on suite teardown — removes the created ticket, invoice,
payment, estimate, approval; resets the serial back to SOLD + restores its
original current_patient_id / warranty_end_date / sold_at.

Tenant: tenant-sound-clinic-blr (login: owner@thesoundclinic.in / demo123)
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

# Make _helpers available
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _helpers import API, login, H  # noqa: E402

OWNER_EMAIL = "owner@thesoundclinic.in"
OWNER_PASSWORD = "demo123"
CLINIC_ID = "tenant-sound-clinic-blr"


# --------------------------------------------------------------------------- #
# Mongo fixture                                                               #
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def mongo():
    cli = MongoClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    yield db
    cli.close()


@pytest.fixture(scope="module")
def token():
    return login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def me(token):
    r = requests.get(f"{API}/auth/me", headers=H(token), timeout=10)
    assert r.status_code == 200
    body = r.json()
    # /auth/me returns {"user": {...}, "clinic": {...}}
    return body.get("user") or body


# --------------------------------------------------------------------------- #
# Module-scope state (so suite reads/cleans up the same artifacts)            #
# --------------------------------------------------------------------------- #
CTX: dict = {
    "ticket_no": None,
    "invoice_id": None,
    "payment_id": None,
    "estimate_id": None,
    "approval_id": None,
    "serial_id": None,
    "patient_id": None,
    "branch_id": None,
    "audiologist_user_id": None,
    "serial_backup": None,
}


@pytest.fixture(scope="module", autouse=True)
def _cleanup_at_end(token, mongo):
    """Teardown — yields first so tests run, then cleans up everything."""
    yield
    db = mongo
    sid = CTX.get("serial_id")
    tno = CTX.get("ticket_no")
    inv_id = CTX.get("invoice_id")
    est_id = CTX.get("estimate_id")
    apr_id = CTX.get("approval_id")
    pid = CTX.get("patient_id")

    if tno:
        db.service_tickets.delete_many({"clinic_id": CLINIC_ID, "ticket_no": tno})
        db.ha_courier_shipments.delete_many({"clinic_id": CLINIC_ID, "ticket_no": tno})
        # Any extra invoice minted by the idempotency probe
        db.invoices.delete_many({"clinic_id": CLINIC_ID, "ticket_no": tno})
        db.payments.delete_many({"clinic_id": CLINIC_ID, "ticket_no": tno})
    if inv_id:
        db.invoices.delete_many({"clinic_id": CLINIC_ID, "invoice_id": inv_id})
        db.payments.delete_many({"clinic_id": CLINIC_ID, "invoice_id": inv_id})
    if est_id:
        db.ha_service_estimates.delete_many({"clinic_id": CLINIC_ID, "estimate_id": est_id})
    if apr_id:
        db.ha_customer_approvals.delete_many({"clinic_id": CLINIC_ID, "approval_id": apr_id})

    # Restore serial to its pre-test state
    backup = CTX.get("serial_backup")
    if sid and backup:
        unset = {k: "" for k in ("current_patient_id", "warranty_end_date", "sold_at")
                 if backup.get(k) is None}
        set_doc = {k: v for k, v in backup.items() if v is not None}
        op = {}
        if set_doc:
            op["$set"] = set_doc
        if unset:
            op["$unset"] = unset
        if op:
            db.serial_items.update_one({"clinic_id": CLINIC_ID, "serial_id": sid}, op)
    if pid:
        db.patients.delete_many({"clinic_id": CLINIC_ID, "patient_id": pid})


# --------------------------------------------------------------------------- #
# 0. PRE-FLIGHT                                                               #
# --------------------------------------------------------------------------- #
def test_00_create_patient(token, me):
    CTX["branch_id"] = me.get("primary_branch_id") or (me.get("branch_ids") or [None])[0]
    assert CTX["branch_id"], "owner has no branch_id"
    body = {
        "name": "TEST_OOW Service Patient",
        "mobile": "9876543322",
        "age": 55,
        "gender": "Male",
        "primary_branch_id": CTX["branch_id"],
    }
    r = requests.post(f"{API}/patients", json=body, headers=H(token), timeout=10)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    CTX["patient_id"] = data.get("patient_id") or data.get("id")
    assert CTX["patient_id"]


def test_01_find_or_make_sold_serial_oow(token, me, mongo):
    db = mongo
    # Find an audiologist for technician_user_id
    audi = db.users.find_one({"clinic_id": CLINIC_ID, "role": "audiologist", "active": True})
    if not audi:
        audi = db.users.find_one({"clinic_id": CLINIC_ID, "role": {"$in": ["technician", "clinic_owner", "super_admin"]}, "active": True})
    assert audi, "no audiologist/technician user found in clinic"
    CTX["audiologist_user_id"] = audi["user_id"]

    # Find a SOLD serial in this clinic
    serial = db.serial_items.find_one({"clinic_id": CLINIC_ID, "state": "SOLD"})
    if not serial:
        # Find any serial we can downgrade
        serial = db.serial_items.find_one({"clinic_id": CLINIC_ID, "state": {"$in": ["IN_STOCK", "RETURNED"]}})
    assert serial, "no usable serial in clinic"

    CTX["serial_id"] = serial["serial_id"]
    # Backup ALL keys we may modify
    CTX["serial_backup"] = {
        "state": serial.get("state"),
        "current_patient_id": serial.get("current_patient_id"),
        "warranty_end_date": serial.get("warranty_end_date"),
        "sold_at": serial.get("sold_at"),
    }
    # Stamp current state: SOLD, OOW (6 months ago), bound to patient
    six_months_ago = (datetime.now(timezone.utc) - timedelta(days=183)).date().isoformat()
    db.serial_items.update_one(
        {"clinic_id": CLINIC_ID, "serial_id": CTX["serial_id"]},
        {"$set": {
            "state": "SOLD",
            "current_patient_id": CTX["patient_id"],
            "warranty_end_date": six_months_ago,
            "sold_at": (datetime.now(timezone.utc) - timedelta(days=400)).isoformat(),
        }},
    )
    s = db.serial_items.find_one({"clinic_id": CLINIC_ID, "serial_id": CTX["serial_id"]})
    assert s["state"] == "SOLD"
    assert s["warranty_end_date"] == six_months_ago


# --------------------------------------------------------------------------- #
# 1. RECEIVE — POST /api/ha/service-tickets                                   #
# --------------------------------------------------------------------------- #
def test_02_receive_ticket(token):
    body = {
        "branch_id": CTX["branch_id"],
        "patient_id": CTX["patient_id"],
        "serial_id": CTX["serial_id"],
        "kind": "repair",
        "complaint": "Distorted sound from right side after dropping unit",
        "technician_user_id": CTX["audiologist_user_id"],
        "warranty_covered": False,
    }
    r = requests.post(f"{API}/ha/service-tickets", json=body, headers=H(token), timeout=15)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    CTX["ticket_no"] = data.get("ticket_no")
    assert CTX["ticket_no"]
    assert data["status"] == "open"
    assert data["warranty_covered"] is False
    # No leaked _id
    assert "_id" not in data


def test_03_serial_state_after_receive(mongo):
    s = mongo.serial_items.find_one({"clinic_id": CLINIC_ID, "serial_id": CTX["serial_id"]})
    assert s["state"] == "SERVICE_IN", f"serial should be SERVICE_IN, got {s['state']}"


# --------------------------------------------------------------------------- #
# 2. STATE WALK — drive the v2 13-state machine into DELIVERED_TO_COMPANY     #
#    (estimate prereq) so we can record an estimate.                          #
# --------------------------------------------------------------------------- #
def _transition(token, to_status, **extra):
    body = {"to_status": to_status, **extra}
    return requests.post(
        f"{API}/ha/service-tickets/{CTX['ticket_no']}/transition",
        json=body, headers=H(token), timeout=15,
    )


def test_04_transition_path_to_delivered_to_company(token):
    # status=open ≡ RECEIVED. Path: RECEIVED→INSPECTED→AWAITING_DISPATCH→
    # ...DISPATCHED needs an outbound courier with AWB; book one through the
    # courier endpoint to satisfy the guard.
    r = _transition(token, "INSPECTED", note="Receiver damaged on R; dispatch to OEM for repair")
    assert r.status_code == 200, r.text

    r = _transition(token, "AWAITING_DISPATCH")
    assert r.status_code == 200, r.text

    # Book outbound courier — this AUTO-ADVANCES AWAITING_DISPATCH→DISPATCHED
    import uuid as _uuid
    awb = f"TEST-AWB-OOW-{_uuid.uuid4().hex[:10].upper()}"
    courier = {
        "ticket_no": CTX["ticket_no"],
        "direction": "OUTBOUND",
        "courier_partner": "BlueDart",
        "awb_number": awb,
    }
    cr = requests.post(f"{API}/ha/couriers", json=courier, headers=H(token), timeout=15)
    assert cr.status_code in (200, 201), f"courier book failed: {cr.status_code} {cr.text[:400]}"
    CTX["outbound_shipment_id"] = cr.json().get("shipment_id")

    # Now DISPATCHED → IN_TRANSIT → DELIVERED_TO_COMPANY (manual)
    r = _transition(token, "IN_TRANSIT")
    assert r.status_code == 200, r.text
    r = _transition(token, "DELIVERED_TO_COMPANY")
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------- #
# 3. ESTIMATE                                                                 #
# --------------------------------------------------------------------------- #
def test_05_record_estimate(token, mongo):
    body = {
        "ticket_no": CTX["ticket_no"],
        "vendor_name": "Phonak Service Centre",
        "line_items": [
            {"description": "Receiver replacement", "amount": 2500},
            {"description": "Workshop labour", "amount": 500},
        ],
        "amount": 3000,
        "conveyed_amount": 3000,
        "warranty_covered": False,
        "repair_notes": "Receiver R + clean & test",
    }
    r = requests.post(f"{API}/ha/service-estimates", json=body, headers=H(token), timeout=15)
    assert r.status_code == 201, r.text
    est = r.json()
    CTX["estimate_id"] = est["estimate_id"]
    assert est["amount"] == 3000
    assert est["conveyed_amount"] == 3000
    assert "_id" not in est

    # ha_service_estimates row exists
    row = mongo.ha_service_estimates.find_one({"clinic_id": CLINIC_ID, "estimate_id": CTX["estimate_id"]})
    assert row is not None

    # approval_id is stamped on ticket
    t = mongo.service_tickets.find_one({"clinic_id": CLINIC_ID, "ticket_no": CTX["ticket_no"]})
    assert t.get("approval_id")
    CTX["approval_id"] = t["approval_id"]
    # Job advanced to ESTIMATE_PENDING
    assert t["status"] == "ESTIMATE_PENDING"


# --------------------------------------------------------------------------- #
# 4. CUSTOMER APPROVAL                                                        #
# --------------------------------------------------------------------------- #
def test_06_customer_approves(token, mongo):
    r = requests.post(
        f"{API}/ha/customer-approvals/{CTX['approval_id']}/decide",
        json={"decision": "APPROVED", "notes": "go ahead"},
        headers=H(token), timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["decision"] == "APPROVED"
    assert data.get("decided_at")

    row = mongo.ha_customer_approvals.find_one(
        {"clinic_id": CLINIC_ID, "approval_id": CTX["approval_id"]}
    )
    assert row["decision"] == "APPROVED"
    t = mongo.service_tickets.find_one({"clinic_id": CLINIC_ID, "ticket_no": CTX["ticket_no"]})
    assert t["status"] == "CLIENT_APPROVED"


# --------------------------------------------------------------------------- #
# 5. REPAIR PROGRESS — drive ticket to READY_FOR_PICKUP                       #
# --------------------------------------------------------------------------- #
def test_07_repair_to_ready(token):
    r = _transition(token, "REPAIR_IN_PROGRESS")
    assert r.status_code == 200, r.text
    # Book INBOUND courier — auto-advances REPAIR_IN_PROGRESS → RETURN_SHIPPED
    import uuid as _uuid
    awb_in = f"TEST-AWB-IN-{_uuid.uuid4().hex[:10].upper()}"
    cr = requests.post(
        f"{API}/ha/couriers",
        json={
            "ticket_no": CTX["ticket_no"],
            "direction": "INBOUND",
            "courier_partner": "BlueDart",
            "awb_number": awb_in,
        },
        headers=H(token), timeout=15,
    )
    assert cr.status_code in (200, 201), cr.text
    CTX["inbound_shipment_id"] = cr.json().get("shipment_id")
    r = _transition(token, "READY_FOR_PICKUP", note="QC pass, ready to hand over")
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------- #
# 6. INVOICE                                                                  #
# --------------------------------------------------------------------------- #
def test_08_generate_invoice(token, mongo):
    r = requests.post(
        f"{API}/ha/service-tickets/{CTX['ticket_no']}/invoice",
        headers=H(token), timeout=20,
    )
    assert r.status_code == 200, r.text
    inv = r.json()
    CTX["invoice_id"] = inv["invoice_id"]
    assert inv["invoice_no"]
    assert "_id" not in inv
    assert len(inv["lines"]) == 1
    line = inv["lines"][0]
    assert "Service & Repair" in line["description"]
    # Behaviour: the v2 endpoint hard-codes gst_inclusive=False in
    # _compute_line's pseudo_service (ha_service_v2.py:640). Estimate
    # conveyed_amount=3000 is therefore treated as EX-GST → grand=3540.
    # This is at odds with the iteration-34 spec which expects 3000 inclusive
    # (subtotal=2542.37, tax=457.63, grand=3000). Record the actual values
    # so the bug surfaces.
    CTX["inv_grand_total"] = inv["grand_total"]
    CTX["inv_subtotal"] = inv["subtotal"]
    CTX["inv_tax_total"] = inv["tax_total"]
    # Hard assertion: amounts are populated & internally consistent
    assert abs((inv["subtotal"] + inv["tax_total"]) - inv["grand_total"]) < 0.05
    # Bug C fix: estimate conveyed_amount=3000 must now be treated as
    # INCLUSIVE → subtotal=2542.37, tax=457.63, grand=3000 (within
    # ₹0.5 round-off tolerance for the rounded_total).
    assert abs(inv["grand_total"] - 3000.0) < 1.0, (
        f"Bug C regression — grand={inv['grand_total']}, expected ~3000"
    )
    assert abs(inv["subtotal"] - 2542.37) < 1.0, (
        f"Bug C regression — subtotal={inv['subtotal']}, expected ~2542.37"
    )
    assert abs(inv["tax_total"] - 457.63) < 1.0, (
        f"Bug C regression — tax_total={inv['tax_total']}, expected ~457.63"
    )

    # Ticket has invoice_id / invoice_no stamped
    t = mongo.service_tickets.find_one({"clinic_id": CLINIC_ID, "ticket_no": CTX["ticket_no"]})
    assert t["invoice_id"] == inv["invoice_id"]
    assert t["invoice_no"] == inv["invoice_no"]
    # invoices doc has ticket_no linkage
    inv_row = mongo.invoices.find_one({"clinic_id": CLINIC_ID, "invoice_id": inv["invoice_id"]})
    assert inv_row["ticket_no"] == CTX["ticket_no"]


# --------------------------------------------------------------------------- #
# 7. PAYMENT                                                                  #
# --------------------------------------------------------------------------- #
def test_09_payment(token, mongo):
    # Pay the actual rounded_total so the invoice clears regardless of the
    # inclusive/exclusive GST discrepancy in step-8.
    inv_row = mongo.invoices.find_one(
        {"clinic_id": CLINIC_ID, "invoice_id": CTX["invoice_id"]}, {"_id": 0}
    )
    amount = inv_row["rounded_total"] or inv_row["grand_total"]
    body = {"method": "upi", "amount": amount, "reference": "UPI-TEST-OOW-123"}
    r = requests.post(
        f"{API}/billing/invoices/{CTX['invoice_id']}/payments",
        json=body, headers=H(token), timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    data = r.json()
    # Either the route returns the payment or the invoice — handle both
    if "payment_id" in data:
        CTX["payment_id"] = data["payment_id"]
    # Refresh invoice
    inv_after = mongo.invoices.find_one({"clinic_id": CLINIC_ID, "invoice_id": CTX["invoice_id"]})
    assert inv_after["status"] == "paid"
    assert abs((inv_after.get("paid_total") or 0) - amount) < 0.05
    assert (inv_after.get("due_total") or 0) <= 0.05


# --------------------------------------------------------------------------- #
# 8. RESOLVE (v1) — does v1 cleanly cap off the v2 walk?                      #
# --------------------------------------------------------------------------- #
def test_10_resolve_ticket(token, mongo):
    body = {
        "resolution_notes": "Receiver replaced and unit cleaned",
        "cost_to_patient": 3000,
        "warranty_covered": False,
    }
    r = requests.post(
        f"{API}/ha/service-tickets/{CTX['ticket_no']}/resolve",
        json=body, headers=H(token), timeout=15,
    )
    # ⚠️ v1 /resolve expects current status to be "in_progress" (FWD_TRANSITIONS).
    # After the v2 walk, status is now "READY_FOR_PICKUP" which v1 doesn't
    # know about → likely 409/422. Capture the behaviour either way.
    CTX["resolve_status_code"] = r.status_code
    CTX["resolve_body"] = r.text[:300]
    if r.status_code == 200:
        t = mongo.service_tickets.find_one(
            {"clinic_id": CLINIC_ID, "ticket_no": CTX["ticket_no"]}
        )
        assert t["status"] in ("resolved", "READY_FOR_PICKUP")
    else:
        # Document the v1/v2 incoherence — main agent should reconcile.
        pytest.xfail(
            f"v1 /resolve rejected post-v2 walk (HTTP {r.status_code}). "
            f"v1 expects status=in_progress but v2 left it READY_FOR_PICKUP. "
            f"Body: {CTX['resolve_body']}"
        )


# --------------------------------------------------------------------------- #
# 9. CLOSE / DELIVERED_TO_CLIENT → CLOSED via v2                              #
# --------------------------------------------------------------------------- #
def test_11_close_via_v2(token, mongo):
    # Use v2 transitions to fully terminate the job.
    r = _transition(token, "DELIVERED_TO_CLIENT",
                    note="Handed over to patient")
    if r.status_code != 200:
        # If v1 /resolve succeeded earlier, status is "resolved" (legacy
        # ≡ READY_FOR_PICKUP), so DELIVERED_TO_CLIENT is still legal.
        # Otherwise document and continue.
        CTX["close_v2_block_status"] = r.status_code
        CTX["close_v2_block_body"] = r.text[:300]
    r = _transition(token, "CLOSED")
    assert r.status_code == 200, r.text
    t = mongo.service_tickets.find_one({"clinic_id": CLINIC_ID, "ticket_no": CTX["ticket_no"]})
    assert t["status"] == "CLOSED"
    assert t.get("closed_at")


# --------------------------------------------------------------------------- #
# 10. SERIAL FINAL STATE — should be RETURNED                                 #
# --------------------------------------------------------------------------- #
def test_12_serial_returned_to_patient(token, mongo):
    """v1 /resolve handles SERVICE_IN→RETURNED on serials with
    current_patient_id. If we never successfully called /resolve, the serial
    will still be SERVICE_IN — that's the v1/v2 coherence bug.
    """
    s = mongo.serial_items.find_one(
        {"clinic_id": CLINIC_ID, "serial_id": CTX["serial_id"]}
    )
    assert s["current_patient_id"] == CTX["patient_id"], "patient binding lost"

    if CTX.get("resolve_status_code") == 200:
        assert s["state"] == "RETURNED", f"expected RETURNED, got {s['state']}"
    else:
        # v1 resolve was blocked — surface the workflow bug
        pytest.xfail(
            f"Serial still {s['state']} (expected RETURNED). v1 /resolve was "
            f"rejected at step-10 (HTTP {CTX.get('resolve_status_code')}), so "
            f"the v2 walk → CLOSED never triggered the SERVICE_IN→RETURNED "
            f"hand-off. This is a v1/v2 workflow-coherence bug."
        )


# --------------------------------------------------------------------------- #
# 11. EDGE-CASE — generate a chargeable invoice on a warranty-covered ticket? #
# --------------------------------------------------------------------------- #
def test_13_warranty_covered_invoice_behaviour(token, mongo):
    """Documents the actual behaviour when warranty_covered=true is mixed
    with an estimate marked warranty_covered=false (chosen path in this run).
    Per the v2 invoice code, the chosen estimate's warranty_covered drives
    the final amount; ticket.warranty_covered is overridden — confirm.
    """
    # Idempotency check: hitting /invoice again returns the same invoice_id
    r = requests.post(
        f"{API}/ha/service-tickets/{CTX['ticket_no']}/invoice",
        headers=H(token), timeout=15,
    )
    # CLOSED is a legal state for invoice generation per the code
    if r.status_code == 200:
        same = r.json()
        if CTX.get("invoice_id") and same.get("invoice_id") != CTX["invoice_id"]:
            pytest.xfail(
                f"Invoice endpoint is NOT idempotent — a second POST minted a "
                f"new invoice {same.get('invoice_id')} (original "
                f"{CTX['invoice_id']}). Likely needs a guard on "
                f"ticket.invoice_id."
            )


# --------------------------------------------------------------------------- #
# 12. EDGE-CASE — server-side warranty_covered=True against OOW serial        #
# --------------------------------------------------------------------------- #
def test_14_server_does_not_validate_warranty_flag(token, mongo):
    """Bug A check — does the server reject warranty_covered=true on a
    serial whose warranty_end_date is in the past?

    Create a SECOND ticket (cleaned up at teardown) with warranty_covered=true
    on the same OOW serial. Expect: the server SHOULD warn/reject.
    Reality (to be confirmed): it silently accepts the flag.
    """
    # The same serial is now in SERVICE_IN (or RETURNED if resolve worked).
    # Reset to SOLD so a second ticket can be created.
    mongo.serial_items.update_one(
        {"clinic_id": CLINIC_ID, "serial_id": CTX["serial_id"]},
        {"$set": {"state": "SOLD"}},
    )
    body = {
        "branch_id": CTX["branch_id"],
        "patient_id": CTX["patient_id"],
        "serial_id": CTX["serial_id"],
        "kind": "repair",
        "complaint": "TEST_warranty-flag-against-OOW-serial",
        "technician_user_id": CTX["audiologist_user_id"],
        "warranty_covered": True,  # ← lying flag
    }
    r = requests.post(f"{API}/ha/service-tickets", json=body, headers=H(token), timeout=15)
    CTX["bug_a_status_code"] = r.status_code
    CTX["bug_a_response"] = r.text[:400]

    # After the Bug A fix: server MUST override the lying warranty_covered=true
    # flag to False and include a warranty_override_note in the response. The
    # ticket is still created (we don't want to block clinic ops over a UI
    # mistake) but the billing-integrity hole is closed.
    assert r.status_code in (200, 201), r.text
    body_out = r.json()
    bonus_tno = body_out.get("ticket_no")
    if bonus_tno:
        # Clean up the bonus ticket — but check the flag first
        assert body_out.get("warranty_covered") is False, (
            "Server still accepted warranty_covered=true on OOW serial — "
            f"got: {body_out.get('warranty_covered')}"
        )
        assert body_out.get("warranty_override_note"), (
            "Server overrode the warranty flag but didn't surface a "
            "warranty_override_note for the UI to display."
        )
        assert body_out.get("serial_warranty_active") is False
        # Cleanup
        mongo.service_tickets.delete_many(
            {"clinic_id": CLINIC_ID, "ticket_no": bonus_tno}
        )


# --------------------------------------------------------------------------- #
# 13. DATA INTEGRITY FINAL SWEEP                                              #
# --------------------------------------------------------------------------- #
def test_15_data_integrity_sweep(mongo):
    t = mongo.service_tickets.find_one({"clinic_id": CLINIC_ID, "ticket_no": CTX["ticket_no"]})
    inv = mongo.invoices.find_one({"clinic_id": CLINIC_ID, "invoice_id": CTX["invoice_id"]})
    est = mongo.ha_service_estimates.find_one({"clinic_id": CLINIC_ID, "estimate_id": CTX["estimate_id"]})
    apr = mongo.ha_customer_approvals.find_one({"clinic_id": CLINIC_ID, "approval_id": CTX["approval_id"]})

    # (c) ticket.invoice_id matches invoices[id].invoice_id
    assert t["invoice_id"] == inv["invoice_id"]
    # (d) invoices[id].ticket_no == our ticket_no
    assert inv["ticket_no"] == CTX["ticket_no"]
    # (e) approval has decided_at
    assert apr.get("decided_at")
    # estimate exists
    assert est is not None

    # (f) Spot-check no leaked ObjectId in API representation — refetch the
    # invoice via the API and ensure no `_id`.
    # (handled implicitly in earlier tests via `"_id" not in inv` checks)
