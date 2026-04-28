"""Razorpay payment integration — invoice collection.

Surfaces:
  * GET  /api/billing/razorpay/config          — public Key ID for Checkout.js
                                                  (frontend needs key_id only;
                                                  the secret never leaves the
                                                  backend).
  * POST /api/billing/invoices/{id}/razorpay/order
                                                — creates a Razorpay Order for
                                                  the invoice's `due_total`,
                                                  returns {order_id, amount,
                                                  currency, key_id}.
  * POST /api/billing/invoices/{id}/razorpay/verify
                                                — verifies the signature
                                                  returned by Checkout.js's
                                                  success handler, then
                                                  records the Payment + flips
                                                  the invoice to `paid`.
  * POST /api/billing/razorpay/webhook          — async source-of-truth for
                                                  payment.captured /
                                                  payment.failed events
                                                  (covers UPI auto-collect /
                                                  NEFT where Checkout success
                                                  callback may not fire).

All amounts are in PAISE on the wire to Razorpay (multiply rupees × 100).
Tenant scoping: invoice lookups are clinic-scoped via the JWT.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import razorpay
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user
from billing import _deserialize, _serialize, _sum_invoice
from database import get_db
from models import Invoice, Payment

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["razorpay"])


# ──────────────────── client (lazy) ────────────────────


_client: Optional[razorpay.Client] = None


def _rzp() -> razorpay.Client:
    global _client
    if _client is None:
        kid = os.environ.get("RAZORPAY_KEY_ID", "").strip()
        sec = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
        if not kid or not sec:
            raise HTTPException(
                500,
                "Razorpay credentials missing on server. Set "
                "RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in backend/.env.",
            )
        _client = razorpay.Client(auth=(kid, sec))
    return _client


# ──────────────────── pydantic ─────────────────────────


class RzpConfigOut(BaseModel):
    key_id: str
    is_live: bool


class RzpOrderOut(BaseModel):
    order_id: str
    amount: int                 # paise
    amount_rupees: float        # display
    currency: str
    key_id: str
    invoice_id: str
    invoice_no: str
    patient_name: str


class RzpVerifyPayload(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


# ──────────────────── routes ───────────────────────────


@router.get("/razorpay/config", response_model=RzpConfigOut)
async def get_config(_=Depends(get_current_user)):
    """Public bits the frontend needs to bootstrap Checkout.js."""
    kid = os.environ.get("RAZORPAY_KEY_ID", "").strip()
    if not kid:
        raise HTTPException(412, "Razorpay not configured on this server.")
    return RzpConfigOut(key_id=kid, is_live=kid.startswith("rzp_live_"))


@router.post("/invoices/{invoice_id}/razorpay/order", response_model=RzpOrderOut)
async def create_order(
    invoice_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    inv = await db.invoices.find_one(
        {"invoice_id": invoice_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv.get("status") == "cancelled":
        raise HTTPException(400, "Cannot collect against a cancelled invoice")
    due = float(inv.get("due_total") or 0)
    if due <= 0.01:
        raise HTTPException(400, "Invoice has no outstanding balance")

    amount_paise = int(round(due * 100))
    # Razorpay's `receipt` field is capped at 40 chars — invoice_no ≤ 32.
    receipt = (inv.get("invoice_no") or invoice_id)[:40]
    try:
        order = _rzp().order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "payment_capture": 1,
            "notes": {
                "invoice_no": inv.get("invoice_no") or "",
                "invoice_id": invoice_id,
                "clinic_id": user["clinic_id"],
                "patient_id": inv.get("patient_id") or "",
            },
        })
    except razorpay.errors.BadRequestError as exc:
        raise HTTPException(400, f"Razorpay rejected order: {exc}") from exc
    except Exception as exc:                              # noqa: BLE001
        logger.exception("Razorpay order.create failed")
        raise HTTPException(502, f"Razorpay error: {exc}") from exc

    # Persist the order alongside the invoice so the verify step can lookup
    # the original amount + invoice without trusting the client.
    await db.razorpay_orders.insert_one({
        "order_id": order["id"],
        "invoice_id": invoice_id,
        "clinic_id": user["clinic_id"],
        "amount_paise": amount_paise,
        "status": "created",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by_user_id": user["user_id"],
    })

    return RzpOrderOut(
        order_id=order["id"],
        amount=amount_paise,
        amount_rupees=round(due, 2),
        currency="INR",
        key_id=os.environ["RAZORPAY_KEY_ID"],
        invoice_id=invoice_id,
        invoice_no=inv.get("invoice_no") or "",
        patient_name=inv.get("patient_name") or "",
    )


def _verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """HMAC-SHA256 of `order_id|payment_id` keyed with RAZORPAY_KEY_SECRET."""
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "").strip().encode()
    body = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _record_invoice_payment(
    db,
    *,
    clinic_id: str,
    invoice_id: str,
    payment_id: str,
    amount_paise: int,
    received_by_user_id: Optional[str] = None,
) -> Invoice:
    """Append a `razorpay`-method Payment to the invoice. Idempotent — if a
    payment with the same Razorpay payment_id already exists on the invoice
    we no-op (handler vs. webhook race)."""
    inv_doc = await db.invoices.find_one(
        {"invoice_id": invoice_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if not inv_doc:
        raise HTTPException(404, "Invoice not found")
    inv = Invoice(**_deserialize(inv_doc))

    # Idempotency — skip if we've already recorded this Razorpay payment.
    for existing in inv.payments:
        if existing.reference == payment_id:
            return inv

    pay = Payment(
        clinic_id=clinic_id,
        invoice_id=invoice_id,
        method="razorpay",
        amount=round(amount_paise / 100.0, 2),
        reference=payment_id,
        notes="Razorpay online payment",
        received_by_user_id=received_by_user_id or "razorpay-webhook",
    )
    await db.payments.insert_one(_serialize(pay.model_dump()))
    inv.payments.append(pay)
    _sum_invoice(inv)
    await db.invoices.update_one(
        {"invoice_id": invoice_id, "clinic_id": clinic_id},
        {"$set": _serialize({
            "payments": [p.model_dump() for p in inv.payments],
            "paid_total": inv.paid_total,
            "due_total": inv.due_total,
            "status": inv.status,
        })},
    )
    return inv


@router.post("/invoices/{invoice_id}/razorpay/verify", response_model=Invoice)
async def verify_and_record(
    invoice_id: str,
    payload: RzpVerifyPayload,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Called by Checkout.js's success handler. Verifies the signature,
    looks up the original order's stored amount (NEVER trust client-supplied
    amounts), then records the Payment."""
    if not _verify_signature(
        payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
    ):
        raise HTTPException(400, "Razorpay signature verification failed")

    order = await db.razorpay_orders.find_one(
        {"order_id": payload.razorpay_order_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not order or order["invoice_id"] != invoice_id:
        raise HTTPException(404, "Razorpay order not found for this invoice")

    inv = await _record_invoice_payment(
        db,
        clinic_id=user["clinic_id"],
        invoice_id=invoice_id,
        payment_id=payload.razorpay_payment_id,
        amount_paise=int(order["amount_paise"]),
        received_by_user_id=user["user_id"],
    )
    await db.razorpay_orders.update_one(
        {"order_id": payload.razorpay_order_id},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": payload.razorpay_payment_id,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return inv


@router.post("/razorpay/webhook")
async def webhook(request: Request, db=Depends(get_db)):
    """Razorpay → us. Source of truth for async events (UPI auto-collect,
    NEFT) where the browser's success handler may not fire.

    Signature verification is REQUIRED — request bodies must be HMAC-SHA256'd
    with `RAZORPAY_WEBHOOK_SECRET`. We compare in constant time.
    """
    raw = await request.body()
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()
    if not secret:
        # Webhook received before we configured a secret — refuse rather than
        # silently dropping events. Set RAZORPAY_WEBHOOK_SECRET in .env after
        # registering the URL on Razorpay Dashboard → Webhooks.
        logger.warning("Razorpay webhook hit but RAZORPAY_WEBHOOK_SECRET not set")
        raise HTTPException(503, "Webhook secret not configured")

    sig = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(400, "Invalid webhook signature")

    try:
        body = json.loads(raw.decode())
    except ValueError as exc:
        raise HTTPException(400, "Webhook body is not JSON") from exc

    event = body.get("event")
    payment = (body.get("payload") or {}).get("payment", {}).get("entity", {})

    if event == "payment.captured":
        notes = payment.get("notes") or {}
        invoice_id = notes.get("invoice_id")
        clinic_id = notes.get("clinic_id")
        order_id = payment.get("order_id")
        if invoice_id and clinic_id and order_id:
            order = await db.razorpay_orders.find_one(
                {"order_id": order_id, "clinic_id": clinic_id}, {"_id": 0}
            )
            amount_paise = int(payment.get("amount") or (order or {}).get("amount_paise") or 0)
            try:
                await _record_invoice_payment(
                    db,
                    clinic_id=clinic_id,
                    invoice_id=invoice_id,
                    payment_id=payment["id"],
                    amount_paise=amount_paise,
                )
                await db.razorpay_orders.update_one(
                    {"order_id": order_id},
                    {"$set": {
                        "status": "paid",
                        "razorpay_payment_id": payment["id"],
                        "captured_at": datetime.now(timezone.utc).isoformat(),
                        "via": "webhook",
                    }},
                )
            except HTTPException as exc:
                logger.warning("Webhook capture record skip: %s", exc.detail)

    # Always log the raw event for audit / future replay.
    await db.razorpay_webhook_log.insert_one({
        "event": event,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "payload": body,
    })
    return {"ok": True}
