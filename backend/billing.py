"""UC-04 Billing & Report Handover
================================
GST invoice engine with:
- Healthcare-exempt + taxable line mix (HSN/SAC aware)
- CGST/SGST split for intra-state, IGST for inter-state (based on clinic.state vs patient.state)
- Split payments (cash/upi/card/bank_transfer/insurance)
- Running counter per clinic-year (INV/2026/000001 style)
- Report delivery logging (print / whatsapp / email / in_person)
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from datetime import datetime
import re

from utils.ist import IST  # noqa: F401

from database import get_db

from models import (
    Service, ServiceCreate,
    Invoice, InvoiceCreate, InvoiceLine, InvoiceLineCreate,
    Payment, PaymentCreate,
    ReportDelivery,
    INVOICE_STATUSES,
)
from auth import get_current_user

billing_router = APIRouter(prefix="/api")


# --------------- helpers ---------------

def _serialize(obj):
    """Recursively convert datetime → ISO string for Mongo storage."""
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(x) for x in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def _deserialize(obj):
    """Recursively convert ISO strings back to datetime where possible."""
    if isinstance(obj, dict):
        return {k: _deserialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deserialize(x) for x in obj]
    if isinstance(obj, str) and len(obj) >= 19 and obj[4] == '-' and obj[10] in ('T', ' '):
        try:
            return datetime.fromisoformat(obj.replace('Z', '+00:00')).replace(tzinfo=None)
        except Exception:
            return obj
    return obj


async def _next_invoice_no(db, clinic_id: str) -> str:
    """Generates clinic-scoped annual invoice number like 'INV/2026/000123'."""
    year = datetime.utcnow().year
    key = f"invoice:{clinic_id}:{year}"
    res = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = res["seq"] if res else 1
    return f"INV/{year}/{str(seq).zfill(6)}"


def _compute_line(line_in: InvoiceLineCreate, service: Optional[dict]) -> InvoiceLine:
    """Resolve a line-create request against optional service and compute taxes."""
    name = line_in.description or (service.get("name") if service else None)
    if not name:
        raise HTTPException(status_code=400, detail="Line must have description or service_id")
    unit_price = line_in.unit_price if line_in.unit_price is not None else float(service.get("price", 0.0) if service else 0.0)
    is_taxable = line_in.is_taxable if line_in.is_taxable is not None else bool(service.get("is_taxable", False) if service else False)
    gst_rate = line_in.gst_rate if line_in.gst_rate is not None else float(service.get("gst_rate", 0.0) if service else 0.0)
    hsn = line_in.hsn_sac or (service.get("hsn_sac") if service else None)
    gst_inclusive = bool(service.get("gst_inclusive", True) if service else True)

    qty = float(line_in.quantity or 1.0)
    disc = float(line_in.discount_amount or 0.0)

    gross = qty * unit_price
    # If price is GST inclusive, back-calculate taxable value: tx = gross / (1 + rate/100)
    if is_taxable and gst_rate > 0 and gst_inclusive:
        # Apply discount to gross first, then strip GST
        net_gross = max(0.0, gross - disc)
        taxable = round(net_gross / (1 + gst_rate / 100.0), 2)
        tax_amount = round(net_gross - taxable, 2)
    elif is_taxable and gst_rate > 0:
        taxable = max(0.0, gross - disc)
        tax_amount = round(taxable * (gst_rate / 100.0), 2)
    else:
        taxable = max(0.0, gross - disc)
        tax_amount = 0.0

    # The CGST/SGST vs IGST split is decided at invoice level (intra vs inter-state).
    return InvoiceLine(
        service_id=line_in.service_id,
        description=name,
        hsn_sac=hsn,
        quantity=qty,
        unit_price=unit_price,
        discount_amount=disc,
        is_taxable=is_taxable,
        gst_rate=gst_rate,
        taxable_value=taxable,
        cgst_amount=0.0, sgst_amount=0.0, igst_amount=0.0,
        line_total=round(taxable + tax_amount, 2),
    )


def _apply_tax_split(lines: List[InvoiceLine], inter_state: bool):
    """Populate CGST/SGST or IGST per line based on intra vs inter-state."""
    for ln in lines:
        tax_total = round(ln.line_total - ln.taxable_value, 2)
        if not ln.is_taxable or tax_total <= 0:
            ln.cgst_amount = ln.sgst_amount = ln.igst_amount = 0.0
            continue
        if inter_state:
            ln.igst_amount = tax_total
            ln.cgst_amount = ln.sgst_amount = 0.0
        else:
            half = round(tax_total / 2.0, 2)
            ln.cgst_amount = half
            ln.sgst_amount = round(tax_total - half, 2)
            ln.igst_amount = 0.0


def _sum_invoice(inv: Invoice):
    """Compute invoice totals from lines + payments."""
    inv.subtotal = round(sum(ln.taxable_value for ln in inv.lines), 2)
    inv.discount_total = round(sum(ln.discount_amount for ln in inv.lines), 2)
    inv.cgst_total = round(sum(ln.cgst_amount for ln in inv.lines), 2)
    inv.sgst_total = round(sum(ln.sgst_amount for ln in inv.lines), 2)
    inv.igst_total = round(sum(ln.igst_amount for ln in inv.lines), 2)
    inv.tax_total = round(inv.cgst_total + inv.sgst_total + inv.igst_total, 2)
    inv.grand_total = round(inv.subtotal + inv.tax_total, 2)
    inv.rounded_total = round(inv.grand_total)
    inv.round_off = round(inv.rounded_total - inv.grand_total, 2)
    inv.paid_total = round(sum(p.amount for p in inv.payments), 2)
    inv.due_total = round(inv.rounded_total - inv.paid_total, 2)
    if inv.status != "cancelled":
        if inv.paid_total <= 0:
            inv.status = "draft"
        elif inv.due_total <= 0.01:
            inv.status = "paid"
        else:
            inv.status = "partial"


# --------------- SERVICE CATALOGUE ---------------

@billing_router.get("/billing/services", response_model=List[Service])
async def list_services(active_only: bool = True, search: Optional[str] = None, user=Depends(get_current_user)):
    db = _db()
    q = {"clinic_id": user["clinic_id"]}
    if active_only:
        q["active"] = True
    if search:
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        q["$or"] = [{"name": rx}, {"code": rx}, {"category": rx}]
    rows = await db.services.find(q, {"_id": 0}).sort("name", 1).to_list(500)
    return [_deserialize(r) for r in rows]


@billing_router.post("/billing/services", response_model=Service)
async def create_service(payload: ServiceCreate, user=Depends(get_current_user)):
    if user["role"] not in {"super_admin", "accounts"}:
        raise HTTPException(status_code=403, detail="Only accounts/admin can manage services")
    db = _db()
    obj = Service(clinic_id=user["clinic_id"], **payload.model_dump())
    await db.services.insert_one(_serialize(obj.model_dump()))
    return obj


@billing_router.put("/billing/services/{service_id}", response_model=Service)
async def update_service(service_id: str, payload: dict, user=Depends(get_current_user)):
    if user["role"] not in {"super_admin", "accounts"}:
        raise HTTPException(status_code=403, detail="Only accounts/admin can manage services")
    db = _db()
    existing = await db.services.find_one({"service_id": service_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Service not found")
    allowed = {"name", "code", "category", "hsn_sac", "price", "gst_rate", "gst_inclusive", "is_taxable", "active"}
    patch = {k: v for k, v in payload.items() if k in allowed}
    await db.services.update_one({"service_id": service_id}, {"$set": patch})
    updated = await db.services.find_one({"service_id": service_id}, {"_id": 0})
    return _deserialize(updated)


@billing_router.delete("/billing/services/{service_id}")
async def deactivate_service(service_id: str, user=Depends(get_current_user)):
    if user["role"] not in {"super_admin", "accounts"}:
        raise HTTPException(status_code=403, detail="Only accounts/admin can manage services")
    db = _db()
    res = await db.services.update_one(
        {"service_id": service_id, "clinic_id": user["clinic_id"]},
        {"$set": {"active": False}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"message": "Deactivated", "service_id": service_id}


# --------------- INVOICES ---------------

@billing_router.post("/billing/invoices", response_model=Invoice)
async def create_invoice(payload: InvoiceCreate, user=Depends(get_current_user)):
    db = _db()
    clinic_id = user["clinic_id"]

    # Validate + hydrate patient
    patient = await db.patients.find_one({"patient_id": payload.patient_id, "clinic_id": clinic_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0}) or {}

    # Resolve each line against service catalogue
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Invoice must have at least one line")

    resolved_lines: List[InvoiceLine] = []
    for ln in payload.lines:
        svc = None
        if ln.service_id:
            svc = await db.services.find_one(
                {"service_id": ln.service_id, "clinic_id": clinic_id}, {"_id": 0}
            )
            if not svc:
                raise HTTPException(status_code=400, detail=f"Service {ln.service_id} not found")
        resolved_lines.append(_compute_line(ln, svc))

    # Determine intra vs inter-state (CGST+SGST vs IGST)
    clinic_state = (clinic.get("state") or "").strip().lower()
    pat_state = (patient.get("state") or "").strip().lower()
    inter_state = bool(clinic_state and pat_state and clinic_state != pat_state)
    _apply_tax_split(resolved_lines, inter_state)

    invoice_no = await _next_invoice_no(db, clinic_id)
    inv = Invoice(
        clinic_id=clinic_id,
        invoice_no=invoice_no,
        patient_id=patient["patient_id"],
        patient_name=patient.get("name", ""),
        patient_mobile=patient.get("mobile") or patient.get("phone"),
        mrd=patient.get("mrd"),
        patient_address=_format_patient_address(patient),
        patient_gstin=payload.patient_gstin,
        appointment_id=payload.appointment_id,
        session_id=payload.session_id,
        lines=resolved_lines,
        notes=payload.notes,
        created_by_user_id=user["user_id"],
    )

    # Optional initial payment
    if payload.initial_payment and payload.initial_payment.amount > 0:
        pay = Payment(
            clinic_id=clinic_id,
            invoice_id=inv.invoice_id,
            method=payload.initial_payment.method,
            amount=float(payload.initial_payment.amount),
            reference=payload.initial_payment.reference,
            notes=payload.initial_payment.notes,
            received_by_user_id=user["user_id"],
        )
        inv.payments.append(pay)
        await db.payments.insert_one(_serialize(pay.model_dump()))

    _sum_invoice(inv)

    await db.invoices.insert_one(_serialize(inv.model_dump()))
    return inv


def _format_patient_address(p: dict) -> Optional[str]:
    parts = [p.get("address"), p.get("city"), p.get("state"), p.get("pincode")]
    parts = [x for x in parts if x]
    return ", ".join(parts) if parts else None


@billing_router.get("/billing/invoices", response_model=List[Invoice])
async def list_invoices(
    status: Optional[str] = None,
    patient_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
):
    db = _db()
    q: dict = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    if from_date or to_date:
        rng: dict = {}
        if from_date:
            rng["$gte"] = f"{from_date}T00:00:00"
        if to_date:
            rng["$lte"] = f"{to_date}T23:59:59"
        q["invoice_date"] = rng
    if search:
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        q["$or"] = [{"invoice_no": rx}, {"patient_name": rx}, {"mrd": rx}, {"patient_mobile": rx}]
    rows = await db.invoices.find(q, {"_id": 0}).sort("invoice_date", -1).to_list(limit)
    return [_deserialize(r) for r in rows]


@billing_router.get("/billing/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, user=Depends(get_current_user)):
    db = _db()
    inv = await db.invoices.find_one({"invoice_id": invoice_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return _deserialize(inv)


@billing_router.post("/billing/invoices/{invoice_id}/payments", response_model=Invoice)
async def add_payment(invoice_id: str, payload: PaymentCreate, user=Depends(get_current_user)):
    db = _db()
    inv_doc = await db.invoices.find_one({"invoice_id": invoice_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not inv_doc:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv_doc.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot add payment to a cancelled invoice")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be > 0")

    pay = Payment(
        clinic_id=user["clinic_id"],
        invoice_id=invoice_id,
        method=payload.method,
        amount=float(payload.amount),
        reference=payload.reference,
        notes=payload.notes,
        received_by_user_id=user["user_id"],
    )
    await db.payments.insert_one(_serialize(pay.model_dump()))

    inv = Invoice(**_deserialize(inv_doc))
    inv.payments.append(pay)
    _sum_invoice(inv)

    await db.invoices.update_one(
        {"invoice_id": invoice_id},
        {"$set": _serialize({
            "payments": [p.model_dump() for p in inv.payments],
            "paid_total": inv.paid_total,
            "due_total": inv.due_total,
            "status": inv.status,
        })},
    )
    return inv


@billing_router.post("/billing/invoices/{invoice_id}/cancel", response_model=Invoice)
async def cancel_invoice(invoice_id: str, payload: dict, user=Depends(get_current_user)):
    if user["role"] not in {"super_admin", "accounts"}:
        raise HTTPException(status_code=403, detail="Only accounts/admin can cancel invoices")
    db = _db()
    inv = await db.invoices.find_one({"invoice_id": invoice_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Already cancelled")
    reason = (payload or {}).get("reason") or "Cancelled"
    await db.invoices.update_one(
        {"invoice_id": invoice_id},
        {"$set": _serialize({
            "status": "cancelled",
            "cancelled_at": datetime.utcnow(),
            "cancelled_reason": reason,
        })},
    )
    updated = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
    return _deserialize(updated)


# --------------- DAILY COLLECTIONS SUMMARY ---------------

@billing_router.get("/billing/collections")
async def collections_summary(date: Optional[str] = None, user=Depends(get_current_user)):
    """Daily collections broken down by payment method for the given date (YYYY-MM-DD) or today."""
    db = _db()
    day = date or datetime.now(IST).strftime("%Y-%m-%d")
    q = {
        "clinic_id": user["clinic_id"],
        "paid_at": {"$gte": f"{day}T00:00:00", "$lte": f"{day}T23:59:59"},
    }
    rows = await db.payments.find(q, {"_id": 0}).to_list(1000)
    by_method: dict = {}
    total = 0.0
    for r in rows:
        m = r.get("method", "other")
        amt = float(r.get("amount", 0.0))
        by_method[m] = round(by_method.get(m, 0.0) + amt, 2)
        total += amt
    return {
        "date": day,
        "total": round(total, 2),
        "by_method": by_method,
        "payment_count": len(rows),
    }


# --------------- REPORT HANDOVER ---------------

@billing_router.get("/billing/pending-reports")
async def pending_reports(user=Depends(get_current_user)):
    """Completed test sessions that still need to be printed/handed over.
    A session is 'pending handover' if: finalised OR completed AND no ReportDelivery logged."""
    db = _db()
    clinic_id = user["clinic_id"]

    # Collect all test_sessions for this clinic
    sessions = await db.test_sessions.find(
        {"clinic_id": clinic_id},
        {"_id": 0},
    ).sort("test_date", -1).to_list(500)

    # Which session_ids have an existing delivery?
    delivered_ids = set()
    delivered_cursor = db.report_deliveries.find({"clinic_id": clinic_id}, {"_id": 0, "session_id": 1})
    async for d in delivered_cursor:
        if d.get("session_id"):
            delivered_ids.add(d["session_id"])

    pending = []
    for s in sessions:
        if s.get("session_id") in delivered_ids:
            continue
        status = s.get("report_status") or s.get("status")
        # Include sessions with ready/finalized reports; also include fresh ones if no status filter matches
        if status in {"finalized", "ready", "completed"} or not status:
            pending.append({
                "session_id": s.get("session_id"),
                "patient_id": s.get("patient_id"),
                "test_date": s.get("test_date"),
                "test_types": s.get("test_types") or [],
                "report_status": status,
            })

    # Hydrate patient name/mrd
    pids = list({p["patient_id"] for p in pending if p.get("patient_id")})
    patients = {}
    if pids:
        async for p in db.patients.find({"clinic_id": clinic_id, "patient_id": {"$in": pids}}, {"_id": 0, "patient_id": 1, "name": 1, "mrd": 1, "mobile": 1, "phone": 1, "email": 1}):
            patients[p["patient_id"]] = p
    for row in pending:
        pat = patients.get(row["patient_id"]) or {}
        row["patient_name"] = pat.get("name")
        row["mrd"] = pat.get("mrd")
        row["patient_mobile"] = pat.get("mobile") or pat.get("phone")
        row["patient_email"] = pat.get("email")

    return _deserialize(pending[:200])


@billing_router.post("/billing/report-deliveries", response_model=ReportDelivery)
async def record_delivery(payload: dict, user=Depends(get_current_user)):
    """Body: {session_id, channel, invoice_id?, recipient?, notes?}"""
    db = _db()
    session_id = payload.get("session_id")
    channel = payload.get("channel")
    if not session_id or channel not in {"print", "whatsapp", "email", "in_person"}:
        raise HTTPException(status_code=400, detail="session_id and valid channel required")

    s = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    # Tenant check via patient
    pat = await db.patients.find_one({"patient_id": s.get("patient_id"), "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not pat:
        raise HTTPException(status_code=403, detail="Not authorised")

    delivery = ReportDelivery(
        clinic_id=user["clinic_id"],
        session_id=session_id,
        patient_id=s.get("patient_id"),
        invoice_id=payload.get("invoice_id"),
        channel=channel,
        recipient=payload.get("recipient"),
        notes=payload.get("notes"),
        delivered_by_user_id=user["user_id"],
    )
    await db.report_deliveries.insert_one(_serialize(delivery.model_dump()))
    return delivery


@billing_router.get("/billing/report-deliveries", response_model=List[ReportDelivery])
async def list_deliveries(
    session_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
):
    db = _db()
    q: dict = {"clinic_id": user["clinic_id"]}
    if session_id: q["session_id"] = session_id
    if patient_id: q["patient_id"] = patient_id
    rows = await db.report_deliveries.find(q, {"_id": 0}).sort("delivered_at", -1).to_list(limit)
    return [_deserialize(r) for r in rows]


# --------------- DB accessor (backed by shared database.get_db) ---------------

def _db():
    """Return the shared MongoDB handle. Kept as a thin alias over database.get_db()
    so existing endpoint bodies (`db = _db()`) continue to work while we converge
    on FastAPI `Depends(get_db)` DI for new code."""
    return get_db()


def attach_db(_database):
    """Deprecated — kept for backward compatibility. get_db() now sources the
    handle directly from `database.py`."""
    return None


# --------------- Default service catalogue seeding ---------------

DEFAULT_SERVICES = [
    # Healthcare: GST-exempt (is_taxable=False, gst_rate=0)
    {"code": "CONSULT", "name": "Audiology Consultation", "category": "Consultation", "hsn_sac": "999312", "price": 500.0, "gst_rate": 0.0, "is_taxable": False},
    {"code": "PTA", "name": "Pure Tone Audiometry", "category": "Audiology", "hsn_sac": "999312", "price": 800.0, "gst_rate": 0.0, "is_taxable": False},
    {"code": "IMM", "name": "Immittance (Tymp + Reflex)", "category": "Audiology", "hsn_sac": "999312", "price": 600.0, "gst_rate": 0.0, "is_taxable": False},
    {"code": "OAE", "name": "Otoacoustic Emissions (OAE)", "category": "Audiology", "hsn_sac": "999312", "price": 1000.0, "gst_rate": 0.0, "is_taxable": False},
    {"code": "ABR", "name": "ABR/BERA", "category": "Audiology", "hsn_sac": "999312", "price": 2500.0, "gst_rate": 0.0, "is_taxable": False},
    {"code": "ASSR", "name": "ASSR", "category": "Audiology", "hsn_sac": "999312", "price": 3000.0, "gst_rate": 0.0, "is_taxable": False},
    {"code": "SPEECH", "name": "Speech Audiometry", "category": "Audiology", "hsn_sac": "999312", "price": 800.0, "gst_rate": 0.0, "is_taxable": False},
    {"code": "HAF", "name": "Hearing Aid Fitting", "category": "Audiology", "hsn_sac": "999312", "price": 1500.0, "gst_rate": 0.0, "is_taxable": False},
    # Hearing aids + accessories: GST-applicable (HSN 9021 = 12% typical for hearing aids; accessories 18%)
    {"code": "HA-BTE", "name": "Hearing Aid – BTE (per unit)", "category": "Hearing Aid", "hsn_sac": "9021", "price": 35000.0, "gst_rate": 12.0, "is_taxable": True, "gst_inclusive": True},
    {"code": "HA-RIC", "name": "Hearing Aid – RIC (per unit)", "category": "Hearing Aid", "hsn_sac": "9021", "price": 55000.0, "gst_rate": 12.0, "is_taxable": True, "gst_inclusive": True},
    {"code": "BATTERY", "name": "Hearing Aid Battery (pack of 6)", "category": "Accessory", "hsn_sac": "8506", "price": 300.0, "gst_rate": 18.0, "is_taxable": True, "gst_inclusive": True},
    {"code": "EARMOULD", "name": "Custom Ear Mould", "category": "Accessory", "hsn_sac": "9021", "price": 1200.0, "gst_rate": 12.0, "is_taxable": True, "gst_inclusive": True},
]


async def seed_default_services(db, clinic_id: str):
    """Idempotent seed of default service catalogue for a clinic."""
    existing_count = await db.services.count_documents({"clinic_id": clinic_id})
    if existing_count > 0:
        return 0
    inserted = 0
    for s in DEFAULT_SERVICES:
        obj = Service(clinic_id=clinic_id, **s)
        await db.services.insert_one(_serialize(obj.model_dump()))
        inserted += 1
    return inserted
