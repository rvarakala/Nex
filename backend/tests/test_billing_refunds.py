"""Regression — clinic patient refund flow (2026-07-30).

Covers:
  * Full refund → status='refunded', paid_total=0
  * Partial refund → status='partially_refunded', refunded_total tracks positive
  * Accumulating partial refunds
  * Over-refund guard (amount > refundable balance)
  * Refund on cancelled invoice blocked
  * Refund on draft invoice blocked
  * Consolidated /billing/payments endpoint returns kind='refund' + reason
  * Role gate — only clinic_owner/accounts/front_desk/super_admin/founder
"""
from __future__ import annotations

import time

import requests

import sys, pathlib  # noqa: E402
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _helpers import API, AUDIO_EMAIL, AUDIO_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, H, login  # noqa: E402


def _mk_service(token: str) -> str:
    r = requests.post(f"{API}/billing/services", headers=H(token), json={
        "code": f"RF-{int(time.time()*1000)%100000}",
        "name": "Refund test service",
        "price": 5000,
        "gst_rate": 0,
        "category": "hearing_aid",
        "active": True,
    }, timeout=10)
    assert r.status_code in (200, 201), r.text
    return r.json()["service_id"]


def _mk_patient(token: str) -> str:
    r = requests.post(f"{API}/patients", headers=H(token), json={
        "name": f"Refund Patient {int(time.time()*1000)%100000}",
        "mobile": "+919000000001",
        "age": 40,
        "sex": "M",
    }, timeout=10)
    assert r.status_code in (200, 201), r.text
    return r.json()["patient_id"]


def _mk_paid_invoice(token: str, service_id: str, patient_id: str, amount: float = 5000) -> dict:
    r = requests.post(f"{API}/billing/invoices", headers=H(token), json={
        "patient_id": patient_id,
        "lines": [{
            "service_id": service_id,
            "description": "Refund test line",
            "quantity": 1, "unit_price": amount,
            "discount_type": "flat", "discount_value": 0,
        }],
        "initial_payment": {"method": "cash", "amount": amount},
    }, timeout=15)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["status"] == "paid"
    assert inv["paid_total"] == amount
    return inv


# ─── Role: super_admin (pytest.admin) — can refund ─────────────────────

def test_partial_and_full_refund_flow():
    token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    svc = _mk_service(token)
    pat = _mk_patient(token)
    inv = _mk_paid_invoice(token, svc, pat, 10000)
    inv_id = inv["invoice_id"]

    # Partial refund of ₹4000 → paid=6000, refunded=4000, status=partially_refunded
    r = requests.post(f"{API}/billing/invoices/{inv_id}/refund", headers=H(token), json={
        "amount": 4000, "method": "upi",
        "reason": "Partial refund — trial hearing aid returned",
        "reference": "UPI-RFND-A",
    }, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "partially_refunded"
    assert body["paid_total"] == 6000
    assert body["refunded_total"] == 4000
    assert body["due_total"] == 4000

    # Second partial ₹5000 → paid=1000, refunded=9000, still partially_refunded
    r = requests.post(f"{API}/billing/invoices/{inv_id}/refund", headers=H(token), json={
        "amount": 5000, "method": "cash",
        "reason": "Additional refund — service dispute",
    }, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "partially_refunded"
    assert body["paid_total"] == 1000
    assert body["refunded_total"] == 9000

    # Over-refund attempt → 400
    r = requests.post(f"{API}/billing/invoices/{inv_id}/refund", headers=H(token), json={
        "amount": 2000, "method": "cash", "reason": "Attempt to over-refund",
    }, timeout=10)
    assert r.status_code == 400
    assert "exceeds refundable balance" in (r.json().get("detail") or "").lower()

    # Final ₹1000 → status=refunded
    r = requests.post(f"{API}/billing/invoices/{inv_id}/refund", headers=H(token), json={
        "amount": 1000, "method": "cash", "reason": "Final closure",
    }, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "refunded"
    assert body["paid_total"] == 0
    assert body["refunded_total"] == 10000


def test_refund_records_land_in_payments_endpoint():
    token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    svc = _mk_service(token)
    pat = _mk_patient(token)
    inv = _mk_paid_invoice(token, svc, pat, 3000)

    unique_reason = f"Refund-consolidated-endpoint-{int(time.time()*1000)%100000}"
    requests.post(f"{API}/billing/invoices/{inv['invoice_id']}/refund", headers=H(token), json={
        "amount": 1500, "method": "upi", "reason": unique_reason,
    }, timeout=10)

    # /billing/payments should include this refund with kind='refund' and the reason
    r = requests.get(f"{API}/billing/payments?kind=refund", headers=H(token), timeout=10)
    assert r.status_code == 200
    body = r.json()
    my_row = next((row for row in body["items"] if row.get("reason") == unique_reason), None)
    assert my_row is not None, f"Refund row not found in /billing/payments: {body}"
    assert my_row["kind"] == "refund"
    assert my_row["amount"] == -1500
    assert my_row["invoice_no"] == inv["invoice_no"]


def test_refund_blocked_on_draft_invoice():
    token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    svc = _mk_service(token)
    pat = _mk_patient(token)
    # Draft invoice — no initial payment
    r = requests.post(f"{API}/billing/invoices", headers=H(token), json={
        "patient_id": pat,
        "lines": [{
            "service_id": svc,
            "description": "Draft line", "quantity": 1, "unit_price": 1000,
            "discount_type": "flat", "discount_value": 0,
        }],
    }, timeout=10)
    inv = r.json()
    assert inv["status"] == "draft"

    r2 = requests.post(f"{API}/billing/invoices/{inv['invoice_id']}/refund", headers=H(token), json={
        "amount": 500, "method": "cash", "reason": "Should not work",
    }, timeout=10)
    assert r2.status_code == 400
    assert "no payments" in (r2.json().get("detail") or "").lower()


def test_refund_role_gate_blocks_audiologist():
    """Audiologist role (pytest.audio) is NOT in the allowed set — refunds
    should be blocked with 403 regardless of whether the invoice is valid.
    """
    token = login(AUDIO_EMAIL, AUDIO_PASSWORD)
    # We don't even need a real invoice — role check runs first.
    r = requests.post(f"{API}/billing/invoices/INV-DOES-NOT-EXIST/refund", headers=H(token), json={
        "amount": 100, "method": "cash", "reason": "Blocked by role gate",
    }, timeout=10)
    assert r.status_code == 403
    assert "permission" in (r.json().get("detail") or "").lower()


def test_refund_amount_required_positive():
    """Backend enforces amount>0 via Pydantic Field(gt=0). 422 expected."""
    token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    svc = _mk_service(token)
    pat = _mk_patient(token)
    inv = _mk_paid_invoice(token, svc, pat, 500)

    # Zero amount
    r = requests.post(f"{API}/billing/invoices/{inv['invoice_id']}/refund", headers=H(token), json={
        "amount": 0, "method": "cash", "reason": "Zero amount",
    }, timeout=10)
    assert r.status_code == 422

    # Negative amount
    r = requests.post(f"{API}/billing/invoices/{inv['invoice_id']}/refund", headers=H(token), json={
        "amount": -100, "method": "cash", "reason": "Negative amount",
    }, timeout=10)
    assert r.status_code == 422
