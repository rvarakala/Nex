"""HA Sales — Phase 3.

A Sale is created from an accepted Quotation. Creation:
  1. Validates serial-assignments: each serialised quote line must map to an
     IN_STOCK SerialItem of the same product, in an accessible branch.
  2. Computes per-line margin vs product.min_sell_price. If any line is below
     the floor, requires `margin_approval_user_id` pointing at a
     clinic_owner / super_admin — else 409 with the below-floor indexes.
  3. Atomically moves all assigned serials IN_STOCK → RESERVED (writes audit
     rows via transition_serial).
  4. Flips the source quotation to 'converted' and stores sale_no there.

Lifecycle:  reserved → invoiced → paid   (any → cancelled, which unreserves).
"""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import (
    Sale, SaleCreate, SaleLine,
)
from utils.ha_states import transition_serial
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime

router = APIRouter(prefix="/api/ha")


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


@router.get("/sales", response_model=None)
async def list_sales(
    status: Optional[str] = None,
    patient_id: Optional[str] = None,
    limit: int = 100,
    cursor: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """List HA sales. See get_patients() in routers/patients.py for the
    legacy-array vs paginated-envelope contract."""
    from utils.pagination import cursor_clause, next_cursor_for

    q = _branch_scope(user)
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id

    paginated = cursor is not None
    if paginated and cursor:
        clause = cursor_clause("created_at", "sale_no", cursor)
        if clause:
            q.update(clause)

    cap = max(1, min(int(limit or 50), 500))
    rows = await (
        db.ha_sales.find(q, {"_id": 0})
        .sort([("created_at", -1), ("sale_no", -1)])
        .to_list(cap)
    )
    items = [deserialize_datetime(r) for r in rows]
    if paginated:
        nxt = next_cursor_for(rows, "created_at", "sale_no", cap)
        return {"items": items, "next_cursor": nxt, "has_more": nxt is not None}
    return items


@router.get("/sales/{sale_no}", response_model=Sale)
async def get_sale(sale_no: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await db.ha_sales.find_one(
        {"sale_no": sale_no, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Sale not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    return deserialize_datetime(row)


_TECH_TIER_MAP = {
    "essential": "Essential",
    "standard": "Standard",
    "advanced": "Advanced",
    "premium": "Premium",
    "basic": "Basic",
}


@router.get("/sales/{sale_no}/invoice-prefill")
async def invoice_prefill(
    sale_no: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Returns a structured prefill payload for the Create Invoice form so that
    HA product details (make/model/serial/tier) auto-populate when generating
    an invoice from a sale. Read-only; does NOT create the invoice."""
    return await _build_invoice_prefill(db, user, sale_no)


async def _build_invoice_prefill(db, user: dict, sale_no: str) -> dict:
    """Shared prefill builder used by `/sales/{sale_no}/invoice-prefill` (read-only)
    and `/sales/{sale_no}/auto-invoice` (creates the invoice atomically)."""
    sale = await db.ha_sales.find_one(
        {"sale_no": sale_no, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if not user_can_see_branch(user, sale["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if sale.get("invoice_no"):
        return {
            "already_invoiced": True,
            "invoice_no": sale["invoice_no"],
            "sale_no": sale_no,
        }

    # Patient summary
    patient = await db.patients.find_one(
        {"patient_id": sale["patient_id"], "clinic_id": user["clinic_id"]},
        {"_id": 0, "patient_id": 1, "first_name": 1, "last_name": 1, "mobile": 1, "mrd": 1},
    ) or {}
    pname = (patient.get("first_name", "") + " " + patient.get("last_name", "")).strip() \
        or sale.get("patient_name") or ""

    # Bulk-fetch products + serials referenced by all lines
    product_ids = sorted({ln.get("product_id") for ln in sale["lines"] if ln.get("product_id")})
    serial_ids  = sorted({ln.get("serial_id")  for ln in sale["lines"] if ln.get("serial_id")})

    products = {
        p["product_id"]: p async for p in db.ha_products.find(
            {"product_id": {"$in": product_ids}, "clinic_id": user["clinic_id"]},
            {"_id": 0, "product_id": 1, "brand": 1, "model": 1, "tech_tier": 1, "gst_rate": 1, "hsn": 1},
        )
    }
    serials = {
        s["serial_id"]: s async for s in db.serial_items.find(
            {"serial_id": {"$in": serial_ids}, "clinic_id": user["clinic_id"]},
            {"_id": 0, "serial_id": 1, "serial_no": 1},
        )
    }

    lines_out = []
    for ln in sale["lines"]:
        prod = products.get(ln.get("product_id"), {})
        srl  = serials.get(ln.get("serial_id"))
        brand = prod.get("brand") or ""
        model = prod.get("model") or ""
        tier  = _TECH_TIER_MAP.get((prod.get("tech_tier") or "").lower())
        qty   = int(ln.get("qty") or 1)
        unit  = float(ln.get("unit_price") or 0)
        disc_pct = float(ln.get("discount_pct") or 0)
        gst_rate = float(ln.get("gst_rate") or prod.get("gst_rate") or 18)

        serial_numbers = [srl["serial_no"]] if srl and srl.get("serial_no") else []
        # Pad serial slots up to qty so the form has the right number of inputs.
        while len(serial_numbers) < qty:
            serial_numbers.append("")

        desc_bits = [b for b in [brand, model] if b]
        description = " ".join(desc_bits) or "Hearing Aid"
        if tier:
            description = f"{description} ({tier})"

        lines_out.append({
            "service_id": None,
            "description": description,
            "quantity": qty,
            "unit_price": unit,
            "discount_type": "percent" if disc_pct else "flat",
            "discount_value": disc_pct if disc_pct else 0,
            "is_taxable": True,
            "gst_rate": gst_rate,
            "hsn_sac": prod.get("hsn") or "9021",
            "product_type": "Hearing Aid",
            "make": brand,
            "model": model,
            "serial_numbers": serial_numbers,
            "technology_tier": tier,
        })

    return {
        "already_invoiced": False,
        "sale_no": sale_no,
        "patient": {
            "patient_id": sale["patient_id"],
            "name": pname,
            "mobile": patient.get("mobile"),
            "mrd": patient.get("mrd"),
        },
        "trade_in_credit": float(sale.get("trade_in_credit") or 0),
        "trade_in_id": sale.get("trade_in_id"),
        "lines": lines_out,
        "notes": f"Generated from HA sale {sale_no}"
                 + (f" (quote {sale['quote_no']})" if sale.get("quote_no") else ""),
    }


@router.post("/sales/{sale_no}/auto-invoice")
async def auto_invoice_from_sale(
    sale_no: str,
    user=Depends(require_roles(
        "front_desk", "audiologist", "inventory_manager", "clinic_owner", "accounts",
    )),
    db=Depends(get_db),
):
    """One-click invoice generation from a sale.

    Behaviour:
      • Idempotent — if the sale already has an invoice, returns it (no dup).
      • Otherwise builds an InvoiceCreate payload from the prefill and calls
        billing.create_invoice() so the invoice goes through the same tax/audit
        pipeline as a manually-typed invoice (incl. CGST/SGST vs IGST split).
      • Returns `{ invoice_id, invoice_no, sale_no, status }` so the frontend
        can route straight to `/billing/invoices/{invoice_id}` and Print.
    """
    prefill = await _build_invoice_prefill(db, user, sale_no)

    # Idempotent re-entry: surface the existing invoice the same way as a
    # fresh create, so the caller can navigate to the detail page.
    if prefill.get("already_invoiced"):
        inv = await db.invoices.find_one(
            {"invoice_no": prefill["invoice_no"], "clinic_id": user["clinic_id"]},
            {"_id": 0, "invoice_id": 1, "invoice_no": 1, "status": 1},
        )
        if inv:
            return {
                "invoice_id": inv["invoice_id"],
                "invoice_no": inv["invoice_no"],
                "sale_no": sale_no,
                "status": inv.get("status"),
                "already_invoiced": True,
            }
        raise HTTPException(
            status_code=409,
            detail=f"Sale {sale_no} marked invoiced as {prefill['invoice_no']} but invoice missing",
        )

    # Build the InvoiceCreate payload from the prefill output. Imported lazily
    # because billing depends on routers/* and we want to avoid a cycle at
    # module-load time.
    from billing import create_invoice
    from models._canonical import InvoiceCreate, InvoiceLineCreate

    line_models = [
        InvoiceLineCreate(
            service_id=ln.get("service_id"),
            description=ln["description"],
            quantity=ln["quantity"],
            unit_price=ln["unit_price"],
            discount_type=ln.get("discount_type", "flat"),
            discount_value=ln.get("discount_value", 0),
            is_taxable=ln.get("is_taxable", True),
            gst_rate=ln.get("gst_rate", 18),
            hsn_sac=ln.get("hsn_sac", "9021"),
            product_type=ln.get("product_type"),
            make=ln.get("make"),
            model=ln.get("model"),
            serial_numbers=ln.get("serial_numbers", []),
            technology_tier=ln.get("technology_tier"),
        )
        for ln in prefill["lines"]
    ]
    payload = InvoiceCreate(
        patient_id=prefill["patient"]["patient_id"],
        lines=line_models,
        notes=prefill.get("notes"),
        from_sale_no=sale_no,
    )

    # Reuse the existing create_invoice path so tax-split, payment, audit,
    # and ha_sales back-link logic stay in ONE place.
    inv = await create_invoice(payload, user=user, db=db)

    return {
        "invoice_id": inv.invoice_id,
        "invoice_no": inv.invoice_no,
        "sale_no": sale_no,
        "status": inv.status,
        "already_invoiced": False,
    }


@router.post("/sales", response_model=Sale)
async def create_sale_from_quote(
    payload: SaleCreate,
    user=Depends(require_roles("front_desk", "audiologist", "inventory_manager", "clinic_owner")),
    db=Depends(get_db),
):
    """Convert an accepted Quotation into a Sale: assigns physical units,
    reserves them, runs margin-floor guardrail, links back to the quote."""

    quote = await db.quotations.find_one(
        {"quote_no": payload.quote_no, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not quote:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not user_can_see_branch(user, quote["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if quote["status"] not in {"accepted", "draft", "sent"}:
        # Allow direct conversion from draft/sent to cover walk-in "skip the email" flow,
        # but block converted/cancelled/rejected/expired.
        raise HTTPException(status_code=409, detail=f"Cannot convert a {quote['status']} quotation")

    # Load products (needed for is_serialised check + min_sell_price margin guard)
    product_ids = list({ln["product_id"] for ln in quote["lines"]})
    products = {
        p["product_id"]: p async for p in db.ha_products.find(
            {"product_id": {"$in": product_ids}, "clinic_id": user["clinic_id"]}, {"_id": 0},
        )
    }

    # ----- Serial assignment validation -----
    serial_assignments: dict[int, str] = {int(k): v for k, v in (payload.serial_assignments or {}).items()}
    chosen_serial_ids: list[str] = []
    serial_line_idx: dict[str, int] = {}  # serial_id → quote line index

    sale_lines: list[SaleLine] = []
    below_floor: list[int] = []

    for i, ql in enumerate(quote["lines"]):
        p = products.get(ql["product_id"])
        if not p:
            raise HTTPException(status_code=400, detail=f"Quote line {i}: product no longer exists")

        line_serial_id: Optional[str] = None
        if p["is_serialised"]:
            if i not in serial_assignments:
                raise HTTPException(
                    status_code=400,
                    detail=f"Quote line {i} ({p['brand']} {p['model']}) is serialised — provide a serial_id in serial_assignments",
                )
            line_serial_id = serial_assignments[i]
            # Double-booking check within this sale
            if line_serial_id in chosen_serial_ids:
                raise HTTPException(status_code=400, detail=f"Serial {line_serial_id} assigned to multiple lines")
            chosen_serial_ids.append(line_serial_id)
            serial_line_idx[line_serial_id] = i

        # Margin check (post-discount unit price vs min_sell_price)
        floor = float(p.get("min_sell_price") or 0)
        net_unit = ql["unit_price"] * (1 - (ql.get("discount_pct") or 0) / 100.0)
        if floor > 0 and net_unit < floor - 1e-6:
            below_floor.append(i)

        sale_lines.append(SaleLine(
            product_id=ql["product_id"],
            serial_id=line_serial_id,
            side=ql.get("side") or "single",
            qty=ql["qty"],
            unit_price=ql["unit_price"],
            discount_pct=ql.get("discount_pct") or 0.0,
            gst_rate=ql.get("gst_rate") or 0.0,
        ))

    # ----- Margin approval gate -----
    if below_floor and not payload.margin_approval_user_id:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "margin_approval_required",
                "below_floor_line_indexes": below_floor,
                "message": "One or more lines priced below min_sell_price. Provide margin_approval_user_id (clinic_owner or super_admin).",
            },
        )
    if below_floor and payload.margin_approval_user_id:
        approver = await db.users.find_one(
            {"user_id": payload.margin_approval_user_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "role": 1},
        )
        if not approver or approver["role"] not in {"super_admin", "clinic_owner"}:
            raise HTTPException(status_code=403, detail="Margin approver must be clinic_owner or super_admin")

    # ----- Load & validate assigned serial items (all must be IN_STOCK, in-clinic) -----
    if chosen_serial_ids:
        serial_rows = await db.serial_items.find(
            {"serial_id": {"$in": chosen_serial_ids}, "clinic_id": user["clinic_id"]},
            {"_id": 0},
        ).to_list(len(chosen_serial_ids))
        by_id = {s["serial_id"]: s for s in serial_rows}
        missing = set(chosen_serial_ids) - set(by_id)
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown serials: {sorted(missing)}")
        for sid, s in by_id.items():
            if s["state"] != "IN_STOCK":
                raise HTTPException(status_code=409, detail=f"Serial {s['serial_no']} is {s['state']}, cannot reserve")
            if not user_can_see_branch(user, s["branch_id"]):
                raise HTTPException(status_code=403, detail=f"Serial {s['serial_no']} is in another branch")
            # serial's product must match the quote-line product
            i = serial_line_idx[sid]
            ql_product = quote["lines"][i]["product_id"]
            if s["product_id"] != ql_product:
                raise HTTPException(
                    status_code=400,
                    detail=f"Serial {s['serial_no']} is product {s['product_id']} but quote line {i} expects {ql_product}",
                )

    # ----- All validation passed — mint sale, reserve serials, link quote -----
    # Recompute totals from the sale lines to stay consistent with the model.
    sub = disc = gst = 0.0
    for ln in sale_lines:
        gross = round(ln.qty * ln.unit_price, 2)
        d = round(gross * (ln.discount_pct or 0) / 100.0, 2)
        net = round(gross - d, 2)
        g = round(net * (ln.gst_rate or 0) / 100.0, 2)
        sub += gross; disc += d; gst += g

    # ----- Optional: apply a trade-in credit -----
    trade_in_credit = 0.0
    trade_in_doc = None
    if payload.trade_in_id:
        trade_in_doc = await db.ha_trade_ins.find_one(
            {"clinic_id": user["clinic_id"], "trade_in_id": payload.trade_in_id},
            {"_id": 0},
        )
        if not trade_in_doc:
            raise HTTPException(status_code=404, detail="Trade-in not found")
        if trade_in_doc["patient_id"] != quote["patient_id"]:
            raise HTTPException(
                status_code=400,
                detail="Trade-in belongs to a different patient than the quotation",
            )
        if trade_in_doc["status"] != "accepted":
            raise HTTPException(
                status_code=409,
                detail=f"Trade-in is {trade_in_doc['status']}, must be 'accepted' (old HA handed over) to apply",
            )
        # Already linked to a different open sale?
        if trade_in_doc.get("linked_sale_no"):
            raise HTTPException(
                status_code=409,
                detail=f"Trade-in already linked to sale {trade_in_doc['linked_sale_no']}",
            )
        trade_in_credit = float(trade_in_doc.get("offered_credit") or 0)
        # Credit reduces the net bill — stack on top of line-level discounts
        disc += trade_in_credit

    total = round(sub - disc + gst, 2)
    if total < 0:
        # Trade-in credit shouldn't exceed the sale itself; block rather than
        # silently issue a negative invoice.
        raise HTTPException(
            status_code=400,
            detail=f"Trade-in credit ₹{trade_in_credit} exceeds sale total — reduce credit or add more lines",
        )

    sale_no = await next_number(db, "sale", user["clinic_id"])
    now = datetime.now(timezone.utc).isoformat()

    sale = Sale(
        sale_no=sale_no,
        clinic_id=user["clinic_id"],
        branch_id=quote["branch_id"],
        patient_id=quote["patient_id"],
        patient_name=quote.get("patient_name"),
        quote_no=payload.quote_no,
        is_pair=bool(quote.get("is_pair")),
        lines=sale_lines,
        subtotal=round(sub, 2), discount_amount=round(disc, 2), gst_amount=round(gst, 2), total=total,
        status="reserved",
        below_floor_lines=below_floor,
        margin_approval_user_id=payload.margin_approval_user_id,
        margin_approval_at=now if below_floor else None,
        trade_in_id=payload.trade_in_id,
        trade_in_credit=round(trade_in_credit, 2),
        created_by_user_id=user["user_id"],
    )
    await db.ha_sales.insert_one(serialize_datetime(sale.model_dump()))

    # Link the trade-in doc back to the sale so it cannot be double-applied.
    if trade_in_doc:
        await db.ha_trade_ins.update_one(
            {"clinic_id": user["clinic_id"], "trade_in_id": payload.trade_in_id},
            {"$set": {"linked_sale_no": sale_no}},
        )

    # Reserve serials one by one (each writes its own audit row).
    for sid in chosen_serial_ids:
        await transition_serial(
            db, sid, "RESERVED",
            actor_user_id=user["user_id"],
            ref_doc={"kind": "sale", "id": sale_no},
            note=f"Reserved on sale {sale_no}",
        )

    # Link back to quote & mark converted.
    await db.quotations.update_one(
        {"quote_no": payload.quote_no, "clinic_id": user["clinic_id"]},
        {"$set": {"status": "converted", "converted_sale_no": sale_no}},
    )
    return sale


@router.post("/sales/{sale_no}/mark-paid")
async def mark_sale_paid(
    sale_no: str, payload: dict,
    user=Depends(require_roles("front_desk", "accounts", "clinic_owner")),
    db=Depends(get_db),
):
    """Once the patient has paid the linked invoice, call this to transition
    every assigned serial RESERVED → SOLD and mark the sale 'paid'.
    Body: {invoice_no?: str}  — invoice_no is stored for the audit trail."""
    return await mark_sale_paid_internal(
        db, user["clinic_id"], sale_no,
        actor_user_id=user["user_id"],
        invoice_no=(payload or {}).get("invoice_no"),
        verify_branch_access=user,
    )


async def mark_sale_paid_internal(
    db, clinic_id: str, sale_no: str, *, actor_user_id: str,
    invoice_no: Optional[str] = None, verify_branch_access: Optional[dict] = None,
) -> dict:
    """Reusable helper. Used by:
      * the manual `/sales/{sale_no}/mark-paid` endpoint (front-desk button), and
      * the **auto-flip** that fires from `billing.add_payment` when the linked
        invoice transitions to `status='paid'` so the entire Quote→Sale→Invoice
        →Paid funnel is one click for accounting.
    Idempotent — calling on an already-paid sale returns `{already: True}`.
    """
    sale = await db.ha_sales.find_one(
        {"sale_no": sale_no, "clinic_id": clinic_id}, {"_id": 0},
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if verify_branch_access is not None and not user_can_see_branch(verify_branch_access, sale["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if sale["status"] == "paid":
        return {"sale_no": sale_no, "status": "paid", "already": True}
    if sale["status"] not in {"reserved", "invoiced"}:
        raise HTTPException(status_code=409, detail=f"Cannot mark-paid a {sale['status']} sale")

    serials = [ln["serial_id"] for ln in sale["lines"] if ln.get("serial_id")]
    for sid in serials:
        s = await db.serial_items.find_one(
            {"serial_id": sid},
            {"_id": 0, "state": 1, "serial_no": 1, "product_id": 1,
             "warranty_months": 1, "warranty_end_date": 1},
        )
        if not s:
            continue
        if s["state"] == "RESERVED":
            await transition_serial(
                db, sid, "SOLD",
                actor_user_id=actor_user_id,
                ref_doc={"kind": "sale", "id": sale_no},
                note=f"Sold via {sale_no}",
            )
            # Stamp current_patient_id, sold_at, and warranty_end_date so
            # Service Tickets / warranty / AMC can find this unit by
            # patient + know its warranty status. Mirrors ha_quick_sale
            # behaviour. `warranty_end_date` is preserved if already set
            # (e.g. stamped at GRN); otherwise computed from
            # `serial.warranty_months` or the parent product.
            sold_at = datetime.now(timezone.utc)
            patch: dict = {
                "updated_at": sold_at.isoformat(),
                "sold_at": sold_at.isoformat(),
            }
            if sale.get("patient_id"):
                patch["current_patient_id"] = sale["patient_id"]
            if not s.get("warranty_end_date"):
                months = s.get("warranty_months")
                if months is None and s.get("product_id"):
                    prod = await db.ha_products.find_one(
                        {"product_id": s["product_id"]},
                        {"_id": 0, "warranty_months": 1},
                    )
                    if prod:
                        months = prod.get("warranty_months")
                if isinstance(months, int) and months > 0:
                    # +N months ≈ +30N days (calendar arithmetic without
                    # pulling in `dateutil`). Acceptable error window:
                    # ~1 day per 24-month warranty.
                    end = sold_at + timedelta(days=30 * months)
                    patch["warranty_end_date"] = end.date().isoformat()
                    if "warranty_months" not in s or s["warranty_months"] != months:
                        patch["warranty_months"] = months
            await db.serial_items.update_one(
                {"serial_id": sid},
                {"$set": patch},
            )
        elif s["state"] == "SOLD":
            # Already sold — still backfill current_patient_id + warranty
            # if missing (handles legacy sales that pre-date this fix).
            backfill: dict = {}
            if sale.get("patient_id"):
                backfill["current_patient_id"] = sale["patient_id"]
            if not s.get("warranty_end_date"):
                months = s.get("warranty_months")
                if months is None and s.get("product_id"):
                    prod = await db.ha_products.find_one(
                        {"product_id": s["product_id"]},
                        {"_id": 0, "warranty_months": 1},
                    )
                    if prod:
                        months = prod.get("warranty_months")
                if isinstance(months, int) and months > 0:
                    sold_at = datetime.now(timezone.utc)
                    backfill["warranty_end_date"] = (
                        sold_at + timedelta(days=30 * months)
                    ).date().isoformat()
            if backfill:
                backfill["updated_at"] = datetime.now(timezone.utc).isoformat()
                await db.serial_items.update_one(
                    {"serial_id": sid},
                    {"$set": backfill},
                )
            continue  # already sold (idempotent)
        else:
            raise HTTPException(
                status_code=409,
                detail=f"Serial {s['serial_no']} is {s['state']}, expected RESERVED",
            )

    upd = {"status": "paid"}
    if invoice_no:
        upd["invoice_no"] = invoice_no
    await db.ha_sales.update_one({"sale_no": sale_no}, {"$set": upd})

    # Fire the referring-doctor thank-you WhatsApp iff the doctor opted in
    # for the HA-sales stream. Fire-and-forget — never blocks mark-paid.
    try:
        from services.ref_docs_notify import schedule_notify
        pid = sale.get("patient_id")
        if pid:
            schedule_notify(db, clinic_id, pid, "ha_sales")
    except Exception:  # noqa: BLE001
        pass

    # ---- Finalise linked trade-in: old serial RETURNED → RETIRED + status=applied
    if sale.get("trade_in_id"):
        ti = await db.ha_trade_ins.find_one(
            {"clinic_id": clinic_id, "trade_in_id": sale["trade_in_id"]},
            {"_id": 0, "status": 1, "old_serial_id": 1},
        )
        if ti and ti["status"] == "accepted":
            try:
                await transition_serial(
                    db, ti["old_serial_id"], "RETIRED",
                    actor_user_id=actor_user_id,
                    ref_doc={"kind": "trade_in", "id": sale["trade_in_id"]},
                    note=f"Trade-in applied via paid sale {sale_no}",
                )
            except HTTPException:
                # Serial may already have moved (e.g. manual admin); don't block mark-paid
                pass
            now_iso = datetime.now(timezone.utc).isoformat()
            await db.ha_trade_ins.update_one(
                {"clinic_id": clinic_id, "trade_in_id": sale["trade_in_id"]},
                {"$set": {"status": "applied", "applied_at": now_iso,
                          "linked_sale_no": sale_no}},
            )
    return {"sale_no": sale_no, "status": "paid"}


@router.post("/sales/{sale_no}/cancel")
async def cancel_sale(
    sale_no: str,
    user=Depends(require_roles("accounts", "clinic_owner", "inventory_manager")),
    db=Depends(get_db),
):
    """Unreserve every assigned serial RESERVED → IN_STOCK, flip sale to
    'cancelled'. Refunds are handled via the existing billing module."""
    sale = await db.ha_sales.find_one(
        {"sale_no": sale_no, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if not user_can_see_branch(user, sale["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if sale["status"] in {"cancelled", "paid"}:
        raise HTTPException(status_code=409, detail=f"Cannot cancel a {sale['status']} sale")

    for ln in sale["lines"]:
        sid = ln.get("serial_id")
        if not sid:
            continue
        s = await db.serial_items.find_one({"serial_id": sid}, {"_id": 0, "state": 1})
        if s and s["state"] == "RESERVED":
            await transition_serial(
                db, sid, "IN_STOCK",
                actor_user_id=user["user_id"],
                ref_doc={"kind": "sale", "id": sale_no},
                note=f"Unreserved — sale {sale_no} cancelled",
            )

    await db.ha_sales.update_one(
        {"sale_no": sale_no},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc).isoformat()}},
    )
    # Detach trade-in (if any) so the clinic can re-apply it to a new sale
    # without re-appraising. Trade-in itself stays in 'accepted' state.
    if sale.get("trade_in_id"):
        await db.ha_trade_ins.update_one(
            {"clinic_id": user["clinic_id"], "trade_in_id": sale["trade_in_id"],
             "status": "accepted"},
            {"$set": {"linked_sale_no": None}},
        )
    # If this sale came from a converted quote, we do NOT flip the quote back —
    # quote.converted_sale_no still references the cancelled sale for audit.
    return {"sale_no": sale_no, "status": "cancelled"}
