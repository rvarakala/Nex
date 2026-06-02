"""Regression — Invoice.payments must tolerate legacy embedded payments
that don't carry redundant `clinic_id` / `invoice_id` / `method` fields.

Triggered the prod incident `DATA_HEALTH: invoices schema drift`
(10/66 invoices = 84.8% healthy) on 2026-06-02.
"""
import pytest
from pydantic import ValidationError

from models._canonical import Invoice, Payment


def test_payment_without_redundant_fields_validates():
    """Bare-minimum payment (amount only) — must validate."""
    p = Payment.model_validate({"amount": 1500.0})
    assert p.amount == 1500.0
    assert p.clinic_id is None
    assert p.invoice_id is None
    assert p.method is None


def test_payment_with_legacy_method_validates():
    """Old rows with method but missing clinic/invoice id."""
    p = Payment.model_validate({"amount": 500, "method": "cash", "reference": "MNL-7"})
    assert p.method == "cash"


def test_payment_with_string_paid_at_tolerates():
    """Legacy paid_at stored as ISO string (not datetime)."""
    p = Payment.model_validate({"amount": 100, "paid_at": "2026-01-15T10:30:00"})
    # Doesn't raise — the Union[str, datetime] handles it.
    assert p.paid_at is not None


def test_invoice_with_legacy_payments_validates():
    """Recreate the exact prod incident: invoice with 1 legacy payment
    missing clinic_id + invoice_id. Must NOT raise."""
    invoice_doc = {
        "invoice_id": "INV-LEGACY-TEST",
        "clinic_id": "tenant-test",
        "invoice_no": "INV/2026/TEST",
        "patient_id": "PAT-1",
        "patient_name": "Test Patient",
        "items": [{
            "description": "HA Fitting", "hsn": "9021",
            "qty": 1, "unit_price": 1500, "discount_pct": 0,
            "taxable": 1500, "gst_rate": 18,
            "cgst": 135, "sgst": 135, "igst": 0,
            "tax_amount": 270, "total": 1770,
        }],
        "subtotal": 1500, "discount_total": 0,
        "cgst_total": 135, "sgst_total": 135, "igst_total": 0,
        "tax_total": 270, "grand_total": 1770, "rounded_total": 1770,
        "round_off": 0, "paid_total": 1770, "due_total": 0,
        "status": "paid",
        "invoice_date": "2024-01-15T00:00:00",
        # The actual bug: payment lacks clinic_id + invoice_id.
        "payments": [
            {"payment_id": "PAY-LEG-1", "amount": 1770, "method": "cash"},
        ],
    }
    inv = Invoice.model_validate(invoice_doc)
    assert inv.invoice_id == "INV-LEGACY-TEST"
    assert len(inv.payments) == 1
    assert inv.payments[0].amount == 1770
