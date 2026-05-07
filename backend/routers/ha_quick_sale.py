"""HA Quick Sale — single-form sale + fitting + invoice creator.

The classical sales flow lives in `ha_sales.py` and requires a Quotation
to exist first (with serial-item assignment, margin floor checks, etc.).
That flow is correct for clinics that want full margin governance, but it
is overkill for the common walk-in case where the front-desk just records
"Mrs Sharma bought a Phonak Bolero V70 for ₹85,000 today."

This router exposes ONE endpoint:

    POST /api/ha/quick-sale

…that takes a flat payload (HA make/model/serial, MRP, sale price,
discount, payment mode, advance/full, extended-warranty flag, notes) and
atomically writes:

  * `ha_quick_sales` doc — the source of truth for this simple flow
  * `ha_fittings`     doc — so the sale shows up on /ha/fittings
  * `invoices`         doc — so it shows up under Billing → Invoices and
    contributes to the Accounts/Revenue Dashboard

It does NOT touch `serial_items` (those are governed by the rich sale
flow's state machine). The serial number captured here is treated as a
free-text identifier the audiologist typed in.

If `payment_status="fully_paid"` we also stamp the invoice as paid so
revenue dashboards reflect it immediately.
"""
import logging
import uuid
from datetime import datetime, timezone, date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, require_roles, user_can_see_branch
from billing import _next_invoice_no
from database import get_db
from utils.numbering import next_number

router = APIRouter(prefix="/api/ha", tags=["ha-quick-sale"])
log = logging.getLogger("audinexa.ha_quick_sale")


# ─── Models ─────────────────────────────────────────────────────────

class QuickSaleIn(BaseModel):
    """Single-form HA sale input. Everything the audiologist needs in one shot."""

    # Patient + branch
    patient_id: str
    branch_id: Optional[str] = None        # default: user's primary branch

    # Hearing aid details
    brand: str = Field(..., min_length=1, max_length=80)
    model: str = Field(..., min_length=1, max_length=120)
    ha_type: Literal["BTE", "RIC", "ITE", "ITC", "CIC", "IIC", "OTHER"] = "BTE"
    serial_number: str = Field(..., min_length=1, max_length=80)
    side: Literal["left", "right", "both"] = "both"
    fitting_date: str                       # ISO YYYY-MM-DD

    # Warranty
    warranty_months: int = Field(12, ge=0, le=240)
    extended_warranty: bool = False
    extended_warranty_months: Optional[int] = Field(None, ge=0, le=240)
    extended_warranty_source: Optional[Literal["clinic", "manufacturer"]] = None

    # Pricing
    mrp: float = Field(..., ge=0)
    sale_price: float = Field(..., ge=0)    # post-discount, what the patient actually pays
    discount_amount: Optional[float] = Field(None, ge=0)
    gst_rate: float = Field(18.0, ge=0, le=28)

    # Payment
    payment_status: Literal["fully_paid", "advance_paid", "unpaid"] = "fully_paid"
    payment_mode: Optional[Literal["cash", "upi", "card", "bank_transfer", "cheque"]] = None
    payment_date: Optional[str] = None       # ISO YYYY-MM-DD when first payment landed
    advance_amount: Optional[float] = Field(None, ge=0)
    expected_payment_date: Optional[str] = None

    # Misc
    notes: Optional[str] = None


class QuickSaleOut(BaseModel):
    quick_sale_id: str
    sale_no: str
    fitting_id: str
    invoice_id: str
    invoice_no: str
    total: float
    paid: float
    balance: float
    status: str
    fitting_url: str                        # frontend deep link the UI can navigate to


# ─── Helpers ────────────────────────────────────────────────────────

def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _ensure_branch(user: dict, branch_id: Optional[str]) -> str:
    bid = branch_id or (user.get("branch_ids") or [None])[0]
    if not bid:
        raise HTTPException(400, "branch_id required (no default branch on this user)")
    if not user_can_see_branch(user, bid):
        raise HTTPException(403, "Branch access denied")
    return bid


def _calc_totals(payload: QuickSaleIn) -> dict:
    """Returns totals consistent with how Invoice rows compute (GST inclusive of sale_price)."""
    sale_price = round(float(payload.sale_price), 2)
    mrp = round(float(payload.mrp), 2)
    discount_amt = round(
        float(payload.discount_amount) if payload.discount_amount is not None else max(0.0, mrp - sale_price),
        2,
    )
    # We treat sale_price as GROSS (GST-inclusive) — most clinics quote final amount.
    # invoice_total == sale_price; tax computed back from inclusive.
    gst_rate = float(payload.gst_rate or 0)
    if gst_rate > 0:
        taxable = round(sale_price / (1 + gst_rate / 100.0), 2)
        gst_amount = round(sale_price - taxable, 2)
    else:
        taxable = sale_price
        gst_amount = 0.0
    return {
        "mrp": mrp,
        "sale_price": sale_price,
        "discount_amount": discount_amt,
        "taxable": taxable,
        "gst_rate": gst_rate,
        "gst_amount": gst_amount,
        "total": sale_price,
    }


# ─── Endpoint ───────────────────────────────────────────────────────

@router.post("/quick-sale", response_model=QuickSaleOut)
async def create_quick_sale(
    payload: QuickSaleIn,
    user=Depends(require_roles(
        "front_desk", "audiologist", "inventory_manager", "clinic_owner", "super_admin",
    )),
    db=Depends(get_db),
):
    """One-shot HA sale: writes quick-sale + fitting + invoice docs atomically."""

    # ── Validate patient ──
    branch_id = _ensure_branch(user, payload.branch_id)
    patient = await db.patients.find_one(
        {"patient_id": payload.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "patient_id": 1, "name": 1, "phone": 1, "mrd_no": 1},
    )
    if not patient:
        raise HTTPException(404, "Patient not found in this clinic")

    # ── Validate sale_price ≤ mrp (sanity) ──
    if payload.sale_price > payload.mrp + 0.5:
        raise HTTPException(400, "Sale price cannot exceed MRP")

    totals = _calc_totals(payload)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # ── Compute payment state ──
    paid = 0.0
    if payload.payment_status == "fully_paid":
        paid = totals["total"]
    elif payload.payment_status == "advance_paid":
        if not payload.advance_amount or payload.advance_amount <= 0:
            raise HTTPException(400, "advance_amount required when payment_status=advance_paid")
        if payload.advance_amount > totals["total"] + 0.5:
            raise HTTPException(400, "advance_amount cannot exceed total")
        paid = round(float(payload.advance_amount), 2)
    balance = round(totals["total"] - paid, 2)

    # ── Allocate IDs / numbers ──
    sale_no = await next_number(db, "sale", user["clinic_id"])               # SAL-YYYY-NNNN (reuses existing seq)
    invoice_no = await _next_invoice_no(db, user["clinic_id"])               # INV/YYYY/NNNNNN
    quick_sale_id = f"QSL-{uuid.uuid4().hex[:10].upper()}"
    fitting_id = f"FIT-{uuid.uuid4().hex[:10].upper()}"
    invoice_id = f"INV-{uuid.uuid4().hex[:10].upper()}"

    # ── Build & insert documents (ordered: quick_sale → fitting → invoice) ──
    quick_sale_doc = {
        "quick_sale_id": quick_sale_id,
        "sale_no": sale_no,
        "clinic_id": user["clinic_id"],
        "branch_id": branch_id,
        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name", ""),
        "patient_phone": patient.get("phone", ""),
        "mrd_no": patient.get("mrd_no", ""),
        # HA
        "brand": payload.brand.strip(),
        "model": payload.model.strip(),
        "ha_type": payload.ha_type,
        "serial_number": payload.serial_number.strip().upper(),
        "side": payload.side,
        "fitting_date": payload.fitting_date,
        # Warranty
        "warranty_months": payload.warranty_months,
        "extended_warranty": payload.extended_warranty,
        "extended_warranty_months": payload.extended_warranty_months,
        "extended_warranty_source": payload.extended_warranty_source,
        # Pricing
        "mrp": totals["mrp"],
        "sale_price": totals["sale_price"],
        "discount_amount": totals["discount_amount"],
        "gst_rate": totals["gst_rate"],
        "gst_amount": totals["gst_amount"],
        "taxable_amount": totals["taxable"],
        "total": totals["total"],
        # Payment
        "payment_status": payload.payment_status,
        "payment_mode": payload.payment_mode,
        "payment_date": payload.payment_date or (_today_iso() if payload.payment_status == "fully_paid" else None),
        "advance_amount": paid if payload.payment_status == "advance_paid" else (totals["total"] if payload.payment_status == "fully_paid" else 0.0),
        "amount_paid": paid,
        "balance_due": balance,
        "expected_payment_date": payload.expected_payment_date,
        # Linked
        "fitting_id": fitting_id,
        "invoice_id": invoice_id,
        "invoice_no": invoice_no,
        # Misc
        "notes": payload.notes or "",
        "status": "completed" if payload.payment_status == "fully_paid" else "open",
        # Audit
        "created_at": now_iso,
        "created_by": user["user_id"],
        "audiologist_name": user.get("name", ""),
    }
    await db.ha_quick_sales.insert_one(quick_sale_doc)

    # ── Lightweight Fitting record so it appears in the Fitting Ledger ──
    # NOTE: schema must match Pydantic `Fitting` model in models_ha.py so the
    # existing GET /api/ha/fittings/{id} endpoint validates and returns it.
    # FittingSerial.side accepts only left|right|single, so we map "both" → "single"
    # (single physical entry; UI can split later if you upgrade to two serials).
    fitting_serial_side = "single" if payload.side == "both" else payload.side
    visit_at = now_iso
    fitting_doc = {
        "fitting_id": fitting_id,
        "clinic_id": user["clinic_id"],
        "branch_id": branch_id,
        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name", ""),
        "audiologist_user_id": user["user_id"],
        "audiologist_name": user.get("name", ""),
        "sale_no": sale_no,
        "serials": [{
            "serial_id": payload.serial_number.strip().upper(),
            "side": fitting_serial_side,
        }],
        "status": "active",
        "first_fit_at": payload.fitting_date,
        "completed_at": None,
        "visits": [{
            "visit_id": f"FV-{uuid.uuid4().hex[:8].upper()}",
            "kind": "first_fit",
            "at": visit_at,
            "actor_user_id": user["user_id"],
            "actor_name": user.get("name", ""),
            "notes": (
                f"HA sale recorded via Quick Sale form. "
                f"Brand: {payload.brand}, Model: {payload.model}, Type: {payload.ha_type}, "
                f"Serial: {payload.serial_number}. "
                f"Side: {payload.side}. "
                f"Warranty: {payload.warranty_months} months"
                + (f" + {payload.extended_warranty_months} months extended ({payload.extended_warranty_source})"
                   if payload.extended_warranty else "")
                + "."
            ),
            "adjustments": [],
        }],
        "aided_audiogram": None,
        "rem": None,
        "notes": payload.notes or "",
        "created_by_user_id": user["user_id"],
        "created_at": now,
        "updated_at": now_iso,
        # Extra denormalised fields (Pydantic ignores extras due to extra="ignore"):
        "quick_sale_id": quick_sale_id,
        "source": "quick_sale",
        "ha_brand": payload.brand,
        "ha_model": payload.model,
        "ha_type": payload.ha_type,
        "warranty_months": payload.warranty_months,
        "extended_warranty": payload.extended_warranty,
        # Money snapshot for the Fittings table (kept in sync via mark-paid):
        "sale_total": totals["total"],
        "amount_paid": paid,
        "balance_due": balance,
        "payment_status": payload.payment_status,
        "invoice_id": invoice_id,
        "invoice_no": invoice_no,
    }
    await db.ha_fittings.insert_one(fitting_doc)

    # ── Invoice doc (slot into existing Billing module) ──
    # NOTE: shape must match Pydantic `Invoice` in models/_canonical.py.
    inv_qty = 1
    inv_unit_price = totals["taxable"]                # qty=1, so unit_price == taxable_value
    inv_taxable = totals["taxable"]
    inv_total_tax = totals["gst_amount"]
    # Simple intra-state split: 50/50 CGST+SGST. Quick-sale skips inter-state IGST detection.
    inv_cgst = round(inv_total_tax / 2.0, 2)
    inv_sgst = round(inv_total_tax - inv_cgst, 2)
    inv_line_total = round(inv_taxable + inv_total_tax, 2)
    invoice_doc = {
        "invoice_id": invoice_id,
        "invoice_no": invoice_no,
        "clinic_id": user["clinic_id"],

        "patient_id": patient["patient_id"],
        "patient_name": patient.get("name", ""),
        "patient_mobile": patient.get("phone", ""),
        "mrd": patient.get("mrd_no", ""),

        "invoice_date": now,

        "lines": [{
            "line_id": uuid.uuid4().hex[:8],
            "description": (
                f"Hearing Aid — {payload.brand} {payload.model} ({payload.ha_type}, {payload.side}) "
                f"· S/N {payload.serial_number.strip().upper()}"
            ),
            "quantity": inv_qty,
            "unit_price": inv_unit_price,
            "discount_amount": totals["discount_amount"],
            "discount_type": "flat",
            "discount_value": totals["discount_amount"],
            "is_taxable": totals["gst_rate"] > 0,
            "gst_rate": totals["gst_rate"],
            "taxable_value": inv_taxable,
            "cgst_amount": inv_cgst,
            "sgst_amount": inv_sgst,
            "igst_amount": 0.0,
            "line_total": inv_line_total,
            "product_type": "Hearing Aid",
            "make": payload.brand,
            "model": payload.model,
            "serial_numbers": [payload.serial_number.strip().upper()],
        }],

        "subtotal": inv_taxable,
        "discount_total": totals["discount_amount"],
        "cgst_total": inv_cgst,
        "sgst_total": inv_sgst,
        "igst_total": 0.0,
        "tax_total": inv_total_tax,
        "grand_total": inv_line_total,
        "rounded_total": inv_line_total,
        "round_off": 0.0,

        "paid_total": paid,
        "due_total": balance,

        "status": "paid" if payload.payment_status == "fully_paid" else (
            "partial" if payload.payment_status == "advance_paid" else "draft"
        ),

        "payments": [],
        "notes": (
            f"Auto-created from HA Quick Sale {sale_no}. Payment mode: {payload.payment_mode or '—'}."
        ),
        "created_at": now,
        "created_by_user_id": user["user_id"],

        # Extra denormalised fields (Pydantic ignores extras):
        "source": "ha_quick_sale",
        "ha_quick_sale_id": quick_sale_id,
        "ha_sale_no": sale_no,
        "fitting_id": fitting_id,
    }
    if paid > 0:
        invoice_doc["payments"] = [{
            "payment_id": f"PAY-{uuid.uuid4().hex[:8].upper()}",
            "clinic_id": user["clinic_id"],
            "invoice_id": invoice_id,
            "method": payload.payment_mode or "cash",
            "amount": paid,
            "reference": None,
            "paid_at": now,
            "received_by_user_id": user["user_id"],
            "notes": "Initial payment captured via HA Quick Sale.",
        }]
    await db.invoices.insert_one(invoice_doc)

    log.info(
        f"quick-sale created clinic={user['clinic_id']} sale_no={sale_no} "
        f"invoice_no={invoice_no} fitting={fitting_id} paid={paid} balance={balance}"
    )

    return QuickSaleOut(
        quick_sale_id=quick_sale_id,
        sale_no=sale_no,
        fitting_id=fitting_id,
        invoice_id=invoice_id,
        invoice_no=invoice_no,
        total=totals["total"],
        paid=paid,
        balance=balance,
        status=quick_sale_doc["status"],
        fitting_url="/ha/fittings",
    )


@router.get("/quick-sales")
async def list_quick_sales(
    limit: int = 50,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = {"clinic_id": user["clinic_id"]}
    if user.get("branch_ids"):
        q["branch_id"] = {"$in": user["branch_ids"]}
    rows: List[dict] = []
    cursor = db.ha_quick_sales.find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    async for r in cursor:
        rows.append(r)
    return rows


# ─── Mark balance paid (settle advance-paid sale) ─────────────────────

class MarkBalancePaidIn(BaseModel):
    """Settle the remaining balance on an advance-paid quick-sale.

    Defaults: amount = current balance_due, mode = original payment_mode,
    payment_date = today. Caller can override any of them.
    """
    amount: Optional[float] = Field(None, ge=0, description="Defaults to current balance_due")
    payment_mode: Optional[Literal["cash", "upi", "card", "bank_transfer", "cheque"]] = None
    payment_date: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None


class MarkBalancePaidOut(BaseModel):
    quick_sale_id: str
    invoice_id: str
    invoice_no: str
    total: float
    amount_paid: float
    balance_due: float
    payment_status: str
    invoice_status: str


@router.post("/quick-sales/{quick_sale_id}/mark-paid", response_model=MarkBalancePaidOut)
async def mark_balance_paid(
    quick_sale_id: str,
    payload: MarkBalancePaidIn,
    user=Depends(require_roles(
        "front_desk", "accounts", "clinic_owner", "super_admin",
    )),
    db=Depends(get_db),
):
    """Capture a follow-up payment against an advance-paid Quick Sale and roll
    the invoice + fitting denorms forward atomically."""
    qs = await db.ha_quick_sales.find_one(
        {"quick_sale_id": quick_sale_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not qs:
        raise HTTPException(404, "Quick Sale not found")
    if not user_can_see_branch(user, qs["branch_id"]):
        raise HTTPException(403, "Branch access denied")
    if qs.get("payment_status") == "fully_paid":
        raise HTTPException(409, "This sale is already fully paid.")

    current_balance = round(float(qs.get("balance_due") or 0), 2)
    if current_balance <= 0:
        raise HTTPException(409, "No outstanding balance on this sale.")

    pay_amount = round(float(payload.amount) if payload.amount is not None else current_balance, 2)
    if pay_amount <= 0:
        raise HTTPException(400, "amount must be > 0")
    if pay_amount > current_balance + 0.5:
        raise HTTPException(400, f"Payment cannot exceed balance ({current_balance:.2f})")

    pay_mode = payload.payment_mode or qs.get("payment_mode") or "cash"
    pay_date_iso = payload.payment_date or _today_iso()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    new_paid = round(float(qs.get("amount_paid") or 0) + pay_amount, 2)
    new_balance = round(float(qs.get("total") or 0) - new_paid, 2)
    fully_settled = new_balance <= 0.005
    new_payment_status = "fully_paid" if fully_settled else "advance_paid"

    # 1) Update ha_quick_sales
    await db.ha_quick_sales.update_one(
        {"quick_sale_id": quick_sale_id},
        {"$set": {
            "amount_paid": new_paid,
            "balance_due": max(0.0, new_balance),
            "payment_status": new_payment_status,
            "payment_mode": pay_mode,
            "last_payment_at": now_iso,
            "last_payment_date": pay_date_iso,
            "status": "completed" if fully_settled else "open",
        }},
    )

    # 2) Update invoice — append a Payment, recompute paid_total/due_total/status
    invoice = await db.invoices.find_one({"invoice_id": qs["invoice_id"]}, {"_id": 0})
    if invoice:
        new_payment = {
            "payment_id": f"PAY-{uuid.uuid4().hex[:8].upper()}",
            "clinic_id": user["clinic_id"],
            "invoice_id": invoice["invoice_id"],
            "method": pay_mode,
            "amount": pay_amount,
            "reference": payload.reference,
            "paid_at": now,
            "received_by_user_id": user["user_id"],
            "notes": payload.notes or "Balance settlement via Mark balance paid.",
        }
        new_inv_paid = round(float(invoice.get("paid_total") or 0) + pay_amount, 2)
        grand_total = float(invoice.get("grand_total") or invoice.get("rounded_total") or qs.get("total") or 0)
        new_inv_due = max(0.0, round(grand_total - new_inv_paid, 2))
        new_inv_status = "paid" if new_inv_due <= 0.005 else "partial"
        await db.invoices.update_one(
            {"invoice_id": invoice["invoice_id"]},
            {
                "$push": {"payments": new_payment},
                "$set": {
                    "paid_total": new_inv_paid,
                    "due_total": new_inv_due,
                    "status": new_inv_status,
                },
            },
        )
    else:
        new_inv_status = "paid" if fully_settled else "partial"
        new_inv_paid = new_paid

    # 3) Sync fitting denorm (so the Fittings table reflects new balance/status)
    await db.ha_fittings.update_one(
        {"quick_sale_id": quick_sale_id},
        {"$set": {
            "amount_paid": new_paid,
            "balance_due": max(0.0, new_balance),
            "payment_status": new_payment_status,
            "updated_at": now_iso,
        }},
    )

    # 4) Audit
    await db.audit_logs.insert_one({
        "kind": "quick_sale_balance_paid",
        "quick_sale_id": quick_sale_id,
        "invoice_id": qs.get("invoice_id"),
        "clinic_id": user["clinic_id"],
        "actor_user_id": user["user_id"],
        "actor_name": user.get("name", ""),
        "amount": pay_amount,
        "mode": pay_mode,
        "balance_after": max(0.0, new_balance),
        "fully_settled": fully_settled,
        "at": now_iso,
    })

    log.info(
        f"quick-sale balance paid clinic={user['clinic_id']} qs={quick_sale_id} "
        f"+₹{pay_amount} → paid=₹{new_paid} balance=₹{max(0.0,new_balance)} "
        f"settled={fully_settled}"
    )

    return MarkBalancePaidOut(
        quick_sale_id=quick_sale_id,
        invoice_id=qs["invoice_id"],
        invoice_no=qs.get("invoice_no") or "",
        total=float(qs.get("total") or 0),
        amount_paid=new_paid,
        balance_due=max(0.0, new_balance),
        payment_status=new_payment_status,
        invoice_status=new_inv_status,
    )
