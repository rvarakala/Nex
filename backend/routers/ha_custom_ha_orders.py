"""Custom Hearing Aid Orders — bespoke IIC / CIC / ITC / ITE workflow (Feb 2026).

Custom hearing aids are patient-specific: the audiologist takes an
impression, fills a Custom Order Form (per-ear vent, colour, receiver
power, shell type, brand/model, features), and ships that spec to
either:

  · a vendor / manufacturer (Phonak, Signia, Starkey, GN, …), OR
  · another branch (head office / main branch that owns the vendor
    relationship — Phase 2 of Multi-Clinic).

Money math mirrors Ear Moulds:
  · one linked invoice is generated on booking
  · advance may be 0 (booking on credit), partial, or full
  · balance chases the patient via the shared payment endpoint

Status ribbon:
    impression_pending → sent_to_vendor → dispatched
                                        → arrived
                                        → delivered
                                        → cancelled

Fields captured are a **leaner Indian-market subset** of the classic
Starkey/Audibel PDF form — full audiogram + faceplate/receiver detail
are captured as free-form notes / attachments to keep the modal quick.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, require_roles, user_can_see_branch
from database import get_db
from utils.serde import deserialize_datetime

router = APIRouter(prefix="/api/ha", tags=["ha-custom-ha-orders"])


# ── Types ─────────────────────────────────────────────────────────────
Side = Literal["left", "right", "both"]
ShellType = Literal["IIC", "CIC", "ITC", "ITE"]
DeliveryTarget = Literal["vendor", "branch"]
CustomHAStatus = Literal[
    "impression_pending", "sent_to_vendor", "dispatched",
    "arrived", "delivered", "cancelled",
]


class CustomHAOrderCreate(BaseModel):
    patient_id: str
    side: Side
    shell_type: ShellType

    # Per-ear specs — only the ear(s) matching `side` need to be filled.
    vent_size_left: Optional[str] = None
    vent_size_right: Optional[str] = None
    shell_colour_left: Optional[str] = None
    shell_colour_right: Optional[str] = None
    faceplate_colour_left: Optional[str] = None
    faceplate_colour_right: Optional[str] = None
    receiver_power_left: Optional[str] = None       # e.g. 'M', 'P', 'HP', 'SP'
    receiver_power_right: Optional[str] = None

    # Free-text brand + model (per user preference — no dropdown lock-in).
    brand: Optional[str] = None
    model: Optional[str] = None
    warranty_months: int = 24
    features: List[str] = Field(default_factory=list)   # e.g. ["telecoil","push_button","directional"]

    # Delivery target — vendor (from Vendors master) OR another branch.
    delivery_target: DeliveryTarget = "vendor"
    vendor_id: Optional[str] = None
    target_branch_id: Optional[str] = None
    expected_delivery_date: Optional[str] = None   # YYYY-MM-DD

    # Financials.
    total_amount: float = Field(ge=0)
    advance_amount: float = Field(0, ge=0)
    payment_mode: str = "cash"
    gst_rate: float = 18
    notes: Optional[str] = None
    branch_id: Optional[str] = None                # source branch


class CustomHAStatusIn(BaseModel):
    status: CustomHAStatus
    note: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────
def _new_order_no() -> str:
    year = datetime.now(timezone.utc).year
    return f"CHA/{year}/{uuid.uuid4().hex[:6].upper()}"


def _new_invoice_no() -> str:
    year = datetime.now(timezone.utc).year
    return f"INV/{year}/{uuid.uuid4().hex[:6].upper()}"


def _build_line_desc(payload: CustomHAOrderCreate) -> str:
    """Renders a printable description that survives PDF invoice
    generation. Only includes the ear(s) selected in `side`."""
    bits = [f"Custom {payload.shell_type} — {payload.side.title()}"]
    if payload.brand or payload.model:
        bits.append(f"{payload.brand or ''} {payload.model or ''}".strip())

    def _ear(label: str, vent, shell, faceplate, receiver):
        parts = []
        if vent:      parts.append(f"vent {vent}")
        if shell:     parts.append(f"shell {shell}")
        if faceplate: parts.append(f"faceplate {faceplate}")
        if receiver:  parts.append(f"receiver {receiver}")
        return f"{label}: " + ", ".join(parts) if parts else None

    if payload.side in ("left", "both"):
        line = _ear("L", payload.vent_size_left, payload.shell_colour_left,
                    payload.faceplate_colour_left, payload.receiver_power_left)
        if line: bits.append(line)
    if payload.side in ("right", "both"):
        line = _ear("R", payload.vent_size_right, payload.shell_colour_right,
                    payload.faceplate_colour_right, payload.receiver_power_right)
        if line: bits.append(line)
    if payload.features:
        bits.append("features: " + ", ".join(payload.features))
    if payload.expected_delivery_date:
        bits.append(f"expected {payload.expected_delivery_date}")
    return " · ".join(bits)


# ── Endpoints ─────────────────────────────────────────────────────────
@router.post("/custom-ha-orders")
async def create_custom_ha_order(
    payload: CustomHAOrderCreate,
    user=Depends(require_roles(
        "front_desk", "audiologist", "clinic_owner", "accounts", "super_admin",
    )),
    db=Depends(get_db),
):
    """Book a bespoke IIC/CIC/ITC/ITE order + linked invoice in ONE call.

    - `delivery_target='vendor'` → `vendor_id` must resolve to an active
      vendor in this clinic's Vendors master.
    - `delivery_target='branch'` → `target_branch_id` is the receiving
      branch (typically the head office that owns the vendor
      relationship for the group).
    """
    patient = await db.patients.find_one(
        {"patient_id": payload.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "patient_id": 1, "name": 1, "mobile": 1, "branch_id": 1},
    )
    if not patient:
        raise HTTPException(404, "Patient not found in this clinic")

    branch_id = payload.branch_id or patient.get("branch_id") or user.get("branch_ids", [None])[0]
    if branch_id and not user_can_see_branch(user, branch_id):
        raise HTTPException(403, "Branch access denied")

    if payload.advance_amount > payload.total_amount + 0.5:
        raise HTTPException(400, "Advance cannot exceed total")

    # Resolve delivery target so we can denormalise a display name.
    vendor_name: Optional[str] = None
    target_branch_name: Optional[str] = None
    if payload.delivery_target == "vendor":
        if not payload.vendor_id:
            raise HTTPException(400, "vendor_id is required when delivery_target='vendor'")
        vendor = await db.vendors.find_one(
            {"vendor_id": payload.vendor_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "name": 1},
        )
        if not vendor:
            raise HTTPException(404, "Vendor not found in this clinic")
        vendor_name = vendor.get("name")
    else:  # branch
        if not payload.target_branch_id:
            raise HTTPException(400, "target_branch_id is required when delivery_target='branch'")
        if payload.target_branch_id == branch_id:
            raise HTTPException(400, "Requesting branch cannot equal the target branch")
        tb = await db.branches.find_one(
            {"branch_id": payload.target_branch_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "name": 1},
        )
        if not tb:
            raise HTTPException(404, "Target branch not found in this clinic")
        target_branch_name = tb.get("name")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    order_id = f"CHA-{uuid.uuid4().hex[:10].upper()}"
    order_no = _new_order_no()

    # ── Invoice (reuses shared collection, math matches HA quick sale) ──
    total = round(float(payload.total_amount), 2)
    gst_rate = float(payload.gst_rate or 0)
    taxable = round(total / (1 + gst_rate / 100.0), 2) if gst_rate else total
    tax_total = round(total - taxable, 2)
    cgst = round(tax_total / 2, 2)
    sgst = round(tax_total - cgst, 2)

    invoice_id = f"INV-{uuid.uuid4().hex[:10].upper()}"
    invoice_no = _new_invoice_no()
    paid = round(float(payload.advance_amount), 2)
    balance = round(total - paid, 2)
    # Invoice model's `status` Literal only accepts draft/paid/partial/…
    # No advance → "draft"; some advance → "partial"; full → "paid".
    inv_status = ("paid" if balance <= 0
                  else ("partial" if paid > 0 else "draft"))

    line_desc = _build_line_desc(payload)

    invoice_doc = {
        "invoice_id": invoice_id,
        "invoice_no": invoice_no,
        "clinic_id": user["clinic_id"],
        "branch_id": branch_id,
        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name"),
        "patient_mobile": patient.get("mobile"),
        "invoice_date": now,
        "due_date": None,
        "status": inv_status,
        "lines": [{
            "line_id": f"LN-{uuid.uuid4().hex[:8].upper()}",
            "description": line_desc,
            "qty": 1,
            "unit_price": total,
            "discount_amount": 0.0,
            "taxable_value": taxable,
            "gst_rate": gst_rate,
            "cgst_rate": gst_rate / 2 if gst_rate else 0,
            "sgst_rate": gst_rate / 2 if gst_rate else 0,
            "igst_rate": 0,
            "cgst_amount": cgst,
            "sgst_amount": sgst,
            "igst_amount": 0,
            "line_total": total,
        }],
        "subtotal": total,
        "discount_total": 0.0,
        "tax_total": tax_total,
        "grand_total": total,
        "rounded_total": total,
        "paid_total": paid,
        "due_total": balance,
        "payments": [] if paid == 0 else [{
            "payment_id": f"PMT-{uuid.uuid4().hex[:8].upper()}",
            "amount": paid,
            "method": payload.payment_mode,
            "paid_at": now,
            "reference": None,
            "kind": "payment",
            "received_by_user_id": user["user_id"],
            "notes": "Advance on custom HA booking",
        }],
        "notes": (
            f"Custom HA Order {order_no}. "
            + (payload.notes or "")
            + f" · Delivery target: {payload.delivery_target}"
            + (f" ({vendor_name})" if vendor_name else "")
            + (f" ({target_branch_name})" if target_branch_name else "")
        ).strip(),
        "created_at": now,
        "created_by_user_id": user["user_id"],
    }
    await db.invoices.insert_one(invoice_doc)

    # ── Order doc ──
    order_doc = {
        "order_id": order_id,
        "order_no": order_no,
        "clinic_id": user["clinic_id"],
        "branch_id": branch_id,
        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name"),
        "patient_mobile": patient.get("mobile"),
        "side": payload.side,
        "shell_type": payload.shell_type,
        "vent_size_left": payload.vent_size_left,
        "vent_size_right": payload.vent_size_right,
        "shell_colour_left": payload.shell_colour_left,
        "shell_colour_right": payload.shell_colour_right,
        "faceplate_colour_left": payload.faceplate_colour_left,
        "faceplate_colour_right": payload.faceplate_colour_right,
        "receiver_power_left": payload.receiver_power_left,
        "receiver_power_right": payload.receiver_power_right,
        "brand": payload.brand,
        "model": payload.model,
        "warranty_months": payload.warranty_months,
        "features": payload.features,
        "delivery_target": payload.delivery_target,
        "vendor_id": payload.vendor_id,
        "vendor_name": vendor_name,
        "target_branch_id": payload.target_branch_id,
        "target_branch_name": target_branch_name,
        "expected_delivery_date": payload.expected_delivery_date,
        # Freshly booked orders default to "sent_to_vendor" (or branch)
        # when target is set, otherwise the impression is still pending.
        "status": "sent_to_vendor",
        "history": [{
            "at": now_iso,
            "status": "booked",
            "actor_user_id": user["user_id"],
            "note": "Order booked via custom HA quick-book flow",
        }],
        "invoice_id": invoice_id,
        "invoice_no": invoice_no,
        "total_amount": total,
        "advance_amount": paid,
        "balance_due": balance,
        "notes": payload.notes,
        "created_at": now,
        "created_by_user_id": user["user_id"],
        "updated_at": now_iso,
    }
    await db.custom_ha_orders.insert_one(order_doc)

    return deserialize_datetime({k: v for k, v in order_doc.items() if k != "_id"})


@router.get("/custom-ha-orders")
async def list_custom_ha_orders(
    status: Optional[CustomHAStatus] = None,
    patient_id: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q: dict = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    branch_ids = user.get("branch_ids") or []
    if branch_ids and user.get("role") != "super_admin":
        q["$or"] = [
            {"branch_id": {"$in": branch_ids}},
            {"branch_id": {"$in": [None]}},
        ]
    rows = await db.custom_ha_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.patch("/custom-ha-orders/{order_id}/status")
async def update_custom_ha_status(
    order_id: str,
    payload: CustomHAStatusIn,
    user=Depends(require_roles(
        "front_desk", "audiologist", "clinic_owner", "accounts", "super_admin",
    )),
    db=Depends(get_db),
):
    order = await db.custom_ha_orders.find_one(
        {"order_id": order_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Custom HA order not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    history_entry = {
        "at": now_iso,
        "status": payload.status,
        "actor_user_id": user["user_id"],
        "note": payload.note or None,
    }
    await db.custom_ha_orders.update_one(
        {"order_id": order_id, "clinic_id": user["clinic_id"]},
        {"$set": {"status": payload.status, "updated_at": now_iso},
         "$push": {"history": history_entry}},
    )
    updated = await db.custom_ha_orders.find_one(
        {"order_id": order_id}, {"_id": 0},
    )
    return deserialize_datetime(updated)
