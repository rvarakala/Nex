"""Razorpay — AUDINEXA SUBSCRIPTION billing.

This router handles AUDINEXA's own subscription invoices (the `tenant_invoices`
collection) — i.e. clinics paying Audinexa for the SaaS. It is NOT used for
patient-facing invoices.

Surfaces:
  * GET  /api/billing/razorpay/config
            Public Key ID for Checkout.js bootstrap.
  * POST /api/billing/tenant-invoices/{id}/razorpay/order
            Owner of the clinic that owns this invoice (or super_admin /
            founder) creates a Razorpay Order against the invoice's
            `grand_total`. Returns order_id + amount + key for Checkout.
  * POST /api/billing/tenant-invoices/{id}/razorpay/verify
            Checkout.js handler hits this with the signature triple. We
            verify, mark the tenant invoice paid, persist payment_id.
  * POST /api/billing/tenant-invoices/{id}/refund
            super_admin / founder only. Refunds (full or partial) via
            Razorpay's Refunds API; flips invoice status → "refunded" or
            "partially_refunded".
  * POST /api/billing/razorpay/webhook
            Async source of truth for payment.captured / payment.failed
            (covers UPI auto-collect / NEFT). Signature-verified against
            RAZORPAY_WEBHOOK_SECRET.
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
from pydantic import BaseModel, Field

from auth import get_current_user, require_roles
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["razorpay"])

OWNER_ROLES = ("clinic_owner", "super_admin", "founder")
REFUND_ROLES = ("super_admin", "founder")


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
    clinic_name: str
    tier: str
    duration: str


class RzpVerifyPayload(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class RefundPayload(BaseModel):
    amount: Optional[float] = Field(default=None, description="₹ amount to refund. Omit for full refund.")
    speed: str = Field(default="normal", pattern="^(normal|optimum)$")
    notes: Optional[str] = None


# ──────────────────── tenant invoice helpers ───────────


async def _get_tenant_invoice(db, invoice_id: str, *, clinic_id: Optional[str] = None) -> dict:
    """Lookup a tenant invoice. If `clinic_id` is supplied (clinic owner
    making a payment), enforce that the invoice belongs to their clinic."""
    q = {"invoice_id": invoice_id}
    if clinic_id:
        q["clinic_id"] = clinic_id
    inv = await db.tenant_invoices.find_one(q, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Tenant invoice not found")
    return inv


def _can_pay(user: dict, invoice: dict) -> bool:
    """Owners pay their own invoices; super_admin / founder can pay any."""
    if user.get("role") in {"super_admin", "founder"}:
        return True
    if user.get("role") == "clinic_owner" and user.get("clinic_id") == invoice.get("clinic_id"):
        return True
    return False


# ──────────────────── routes ───────────────────────────


@router.get("/razorpay/config", response_model=RzpConfigOut)
async def get_config(_=Depends(get_current_user)):
    """Public bits the frontend needs to bootstrap Checkout.js."""
    kid = os.environ.get("RAZORPAY_KEY_ID", "").strip()
    if not kid:
        raise HTTPException(412, "Razorpay not configured on this server.")
    return RzpConfigOut(key_id=kid, is_live=kid.startswith("rzp_live_"))


@router.post("/tenant-invoices/{invoice_id}/razorpay/order", response_model=RzpOrderOut)
async def create_order(
    invoice_id: str,
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    inv = await _get_tenant_invoice(db, invoice_id)
    if not _can_pay(user, inv):
        raise HTTPException(403, "Not authorised to pay this invoice")
    if inv.get("status") in {"paid", "refunded"}:
        raise HTTPException(400, f"Invoice is already {inv['status']}")
    if inv.get("status") == "cancelled":
        raise HTTPException(400, "Cannot collect against a cancelled invoice")

    grand = float(inv.get("grand_total") or 0)
    if grand <= 0.01:
        raise HTTPException(400, "Invoice has no outstanding amount")

    amount_paise = int(round(grand * 100))
    receipt = invoice_id[:40]
    try:
        order = _rzp().order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "payment_capture": 1,
            "notes": {
                "tenant_invoice_id": invoice_id,
                "clinic_id": inv["clinic_id"],
                "tier": inv.get("tier", ""),
                "duration": inv.get("duration", ""),
            },
        })
    except razorpay.errors.BadRequestError as exc:
        raise HTTPException(400, f"Razorpay rejected order: {exc}") from exc
    except Exception as exc:                              # noqa: BLE001
        logger.exception("Razorpay order.create failed for tenant invoice %s", invoice_id)
        raise HTTPException(502, f"Razorpay error: {exc}") from exc

    await db.razorpay_orders.insert_one({
        "order_id": order["id"],
        "tenant_invoice_id": invoice_id,
        "clinic_id": inv["clinic_id"],
        "amount_paise": amount_paise,
        "status": "created",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by_user_id": user["user_id"],
    })

    return RzpOrderOut(
        order_id=order["id"],
        amount=amount_paise,
        amount_rupees=round(grand, 2),
        currency="INR",
        key_id=os.environ["RAZORPAY_KEY_ID"],
        invoice_id=invoice_id,
        clinic_name=inv.get("clinic_name") or "",
        tier=inv.get("tier") or "",
        duration=inv.get("duration") or "",
    )


def _verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """HMAC-SHA256 of `order_id|payment_id` keyed with RAZORPAY_KEY_SECRET."""
    secret = os.environ.get("RAZORPAY_KEY_SECRET", "").strip().encode()
    body = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _mark_tenant_invoice_paid(
    db,
    *,
    invoice_id: str,
    payment_id: str,
    via: str = "checkout",
) -> dict:
    """Idempotent mark-paid. Returns the updated invoice dict (no _id)."""
    now = datetime.now(timezone.utc).isoformat()
    # Only flip pending → paid; if already paid, return current row unchanged.
    r = await db.tenant_invoices.find_one_and_update(
        {"invoice_id": invoice_id, "status": "pending"},
        {"$set": {
            "status": "paid",
            "paid_at": now,
            "payment_method": "razorpay",
            "payment_ref": payment_id,
            "razorpay_payment_id": payment_id,
            "paid_via": via,
        }},
        projection={"_id": 0},
        return_document=True,
    )
    if r is None:
        # already paid OR doesn't exist; return current state for idempotency
        cur = await db.tenant_invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
        if not cur:
            raise HTTPException(404, "Tenant invoice not found")
        return cur
    return r


@router.post("/tenant-invoices/{invoice_id}/razorpay/verify")
async def verify_and_record(
    invoice_id: str,
    payload: RzpVerifyPayload,
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    if not _verify_signature(
        payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
    ):
        raise HTTPException(400, "Razorpay signature verification failed")

    order = await db.razorpay_orders.find_one(
        {"order_id": payload.razorpay_order_id}, {"_id": 0},
    )
    if not order or order.get("tenant_invoice_id") != invoice_id:
        raise HTTPException(404, "Razorpay order not found for this invoice")

    inv = await _get_tenant_invoice(db, invoice_id)
    if not _can_pay(user, inv):
        raise HTTPException(403, "Not authorised to pay this invoice")

    updated = await _mark_tenant_invoice_paid(
        db,
        invoice_id=invoice_id,
        payment_id=payload.razorpay_payment_id,
        via="checkout",
    )
    await db.razorpay_orders.update_one(
        {"order_id": payload.razorpay_order_id},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": payload.razorpay_payment_id,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return updated


@router.post("/tenant-invoices/{invoice_id}/refund")
async def refund_tenant_invoice(
    invoice_id: str,
    payload: RefundPayload,
    user=Depends(require_roles(*REFUND_ROLES)),
    db=Depends(get_db),
):
    """Refund a paid tenant invoice — full or partial.

    * `amount` omitted → full refund of the invoice's grand_total.
    * `amount` < grand_total → partial refund; status flips to
      `partially_refunded`. Repeated partials are additive (Razorpay tracks
      remaining capacity).
    * Idempotency: if the requested amount has already been fully refunded,
      we no-op and return the current invoice.
    """
    inv = await _get_tenant_invoice(db, invoice_id)
    if inv.get("status") not in {"paid", "partially_refunded"}:
        raise HTTPException(400, f"Cannot refund invoice in '{inv.get('status')}' state")
    payment_id = inv.get("razorpay_payment_id") or inv.get("payment_ref")
    if not payment_id:
        raise HTTPException(400, "This invoice has no Razorpay payment to refund")

    grand = float(inv.get("grand_total") or 0)
    already_refunded = float(inv.get("refunded_total") or 0)
    refundable = round(grand - already_refunded, 2)
    if refundable <= 0.01:
        return inv  # already fully refunded — idempotent return

    requested = float(payload.amount) if payload.amount is not None else refundable
    if requested <= 0:
        raise HTTPException(400, "Refund amount must be greater than zero")
    if requested > refundable + 0.01:
        raise HTTPException(
            400,
            f"Refund amount ₹{requested:.2f} exceeds refundable balance "
            f"₹{refundable:.2f} (already refunded ₹{already_refunded:.2f}).",
        )

    amount_paise = int(round(requested * 100))
    try:
        refund = _rzp().payment.refund(payment_id, {
            "amount": amount_paise,
            "speed": payload.speed,
            "notes": {
                "tenant_invoice_id": invoice_id,
                "reason": (payload.notes or "")[:200],
                "initiated_by": user.get("user_id") or "",
            },
        })
    except razorpay.errors.BadRequestError as exc:
        raise HTTPException(400, f"Razorpay rejected refund: {exc}") from exc
    except Exception as exc:                              # noqa: BLE001
        logger.exception("Razorpay refund failed for invoice %s", invoice_id)
        raise HTTPException(502, f"Razorpay refund error: {exc}") from exc

    new_total = round(already_refunded + requested, 2)
    new_status = "refunded" if new_total >= grand - 0.01 else "partially_refunded"
    now = datetime.now(timezone.utc).isoformat()

    refund_history = list(inv.get("refunds") or [])
    refund_history.append({
        "refund_id": refund.get("id"),
        "amount": requested,
        "speed": refund.get("speed_processed") or payload.speed,
        "status": refund.get("status") or "processed",
        "notes": payload.notes,
        "refunded_at": now,
        "refunded_by_user_id": user["user_id"],
    })

    r = await db.tenant_invoices.find_one_and_update(
        {"invoice_id": invoice_id},
        {"$set": {
            "status": new_status,
            "refunded_total": new_total,
            "refunds": refund_history,
            "last_refunded_at": now,
        }},
        projection={"_id": 0},
        return_document=True,
    )
    return r


@router.post("/tenant-invoices/{invoice_id}/razorpay/reconcile")
async def reconcile_payment(
    invoice_id: str,
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    """Pull-mode reconciliation for cases where the success-handler never
    fired (UPI QR, UPI Collect, NEFT) — i.e. the patient paid through their
    own app on their phone, not in the browser. Without a webhook (or while
    the webhook is being configured) we can still query Razorpay directly
    for any payments against the original order and mark the invoice paid.

    Idempotent. Safe to call repeatedly — if no captured payment exists yet
    we return `{matched: false}` and the caller can retry later.
    """
    inv = await _get_tenant_invoice(db, invoice_id)
    if not _can_pay(user, inv):
        raise HTTPException(403, "Not authorised")
    if inv.get("status") in {"paid", "refunded", "partially_refunded"}:
        return {"matched": True, "already": True, "invoice": inv}

    # Find every Razorpay order we ever created for this invoice.
    orders_cursor = db.razorpay_orders.find(
        {"tenant_invoice_id": invoice_id}, {"_id": 0},
    )
    orders = [r async for r in orders_cursor]
    if not orders:
        return {"matched": False, "reason": "No Razorpay order created for this invoice yet."}

    captured: Optional[dict] = None
    for o in orders:
        try:
            res = _rzp().order.payments(o["order_id"])
        except Exception as exc:                            # noqa: BLE001
            logger.warning("Razorpay order.payments lookup failed for %s: %s", o["order_id"], exc)
            continue
        for p in (res.get("items") or []):
            if p.get("status") == "captured":
                captured = {**p, "_audinexa_order_id": o["order_id"]}
                break
        if captured:
            break

    if not captured:
        return {
            "matched": False,
            "reason": (
                "Razorpay reports no captured payment yet against this invoice's order. "
                "If you just paid via UPI QR, please wait 30–60 seconds and try Refresh again."
            ),
        }

    updated = await _mark_tenant_invoice_paid(
        db,
        invoice_id=invoice_id,
        payment_id=captured["id"],
        via="reconcile",
    )
    await db.razorpay_orders.update_one(
        {"order_id": captured["_audinexa_order_id"]},
        {"$set": {
            "status": "paid",
            "razorpay_payment_id": captured["id"],
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "via": "reconcile",
        }},
    )
    return {"matched": True, "invoice": updated, "razorpay_payment_id": captured["id"]}


@router.post("/razorpay/webhook")
async def webhook(request: Request, db=Depends(get_db)):
    """Async source of truth — fires on payment.captured / payment.failed
    even when the browser closes before Checkout's success handler runs."""
    raw = await request.body()
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()
    if not secret:
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
        ten_invoice_id = notes.get("tenant_invoice_id")
        if ten_invoice_id:
            try:
                await _mark_tenant_invoice_paid(
                    db,
                    invoice_id=ten_invoice_id,
                    payment_id=payment["id"],
                    via="webhook",
                )
                if order_id := payment.get("order_id"):
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
                logger.warning("Webhook capture skipped: %s", exc.detail)

    await db.razorpay_webhook_log.insert_one({
        "event": event,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "payload": body,
    })
    return {"ok": True}
