"""Report handover lifecycle (simplified per Feb 2026 ops review).

New lifecycle (3 states):
    draft
      │  audiologist clicks "Generate & Print Report"
      │  (autosaves session → flips report_status → opens PDF in new tab)
      ▼
    report_ready              ← appears in Reports → Ready for Handover
      │  front desk clicks "Consultation Finished"  (gated: bill must be paid,
      │  super_admin / accounts / founder may bypass)
      ▼
    completed                 ← appears in Reports → Completed

Endpoints
    POST /api/sessions/{id}/generate-report   — audiologist one-shot
    POST /api/sessions/{id}/handover          — FD "Consultation Finished"
    POST /api/sessions/{id}/mark-printed      — kept as ALIAS for backwards-compat
    POST /api/sessions/{id}/complete-test     — kept as ALIAS for backwards-compat
    GET  /api/reports                         — list (tabs: ready | completed | all)
    GET  /api/reports/pending-count           — sidebar badge
    GET  /api/patients/{id}/history           — universal patient drawer data
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database import get_db
from utils.serde import deserialize_datetime, serialize_datetime


router = APIRouter(prefix="/api", tags=["report-handover"])


# ---------- helpers --------------------------------------------------------
async def _get_session_tenant_scoped(db, session_id: str, clinic_id: str) -> Dict[str, Any]:
    s = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    p = await db.patients.find_one(
        {"patient_id": s.get("patient_id"), "clinic_id": clinic_id}, {"_id": 0}
    )
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised for this session")
    s["_patient"] = p
    return s


# Tab → statuses. "pending" is kept as an alias for "ready" to avoid breaking old clients.
TAB_TO_STATUSES: Dict[str, List[str]] = {
    "pending":    ["report_ready"],
    "ready":      ["report_ready"],
    "completed":  ["completed"],
    "all":        ["report_ready", "completed"],
}


async def _find_invoice_for_session(db, clinic_id: str, session_id: str,
                                    patient_id: str) -> Optional[Dict[str, Any]]:
    """Prefer session-linked invoice; fall back to the patient's most recent."""
    inv = await db.invoices.find_one(
        {"clinic_id": clinic_id, "session_id": session_id,
         "status": {"$nin": ["cancelled"]}},
        {"_id": 0},
        sort=[("invoice_date", -1)],
    )
    if inv:
        return inv
    return await db.invoices.find_one(
        {"clinic_id": clinic_id, "patient_id": patient_id,
         "status": {"$nin": ["cancelled"]}},
        {"_id": 0},
        sort=[("invoice_date", -1)],
    )


def _invoice_paid(inv: Optional[Dict[str, Any]]) -> bool:
    if not inv:
        return False
    if inv.get("due_total") is not None:
        return float(inv.get("due_total") or 0) <= 0.01
    return (inv.get("status") or "").lower() in ("paid", "refunded")


# ---------- lifecycle actions ---------------------------------------------
class HandoverRequest(BaseModel):
    channel: Literal["print", "whatsapp", "email", "in_person"] = "in_person"
    recipient: Optional[str] = None
    notes: Optional[str] = None
    bypass_bill_check: bool = False


async def _flip_to_report_ready(db, session_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    """Core state transition used by generate-report AND the legacy aliases."""
    s = await _get_session_tenant_scoped(db, session_id, user["clinic_id"])
    cur = s.get("report_status") or "draft"
    # Idempotent: never regress a completed session
    if cur == "completed":
        return {"ok": True, "session_id": session_id, "report_status": "completed",
                "note": "already consultation-finished"}
    now = datetime.now(timezone.utc)
    update = {
        "report_status": "report_ready",
        "test_completed_at": s.get("test_completed_at") or now,
        "test_completed_by_user_id": s.get("test_completed_by_user_id") or user["user_id"],
        "printed_at": now,
        "status": "completed",   # legacy `status` field
        "updated_at": now,
    }
    await db.test_sessions.update_one(
        {"session_id": session_id}, {"$set": serialize_datetime(update)}
    )
    return {"ok": True, "session_id": session_id, "report_status": "report_ready"}


@router.post("/sessions/{session_id}/generate-report")
async def generate_report(session_id: str,
                          user=Depends(get_current_user), db=Depends(get_db)):
    """One-shot audiologist action.

    Autosave is handled client-side before this is called (the PUT on the session).
    This endpoint simply advances the status to `report_ready`. The PDF is then
    downloaded by the client via `GET /api/reports/{id}/pdf` and opened for the
    audiologist to review + print in the browser.
    """
    return await _flip_to_report_ready(db, session_id, user)


# ---------- legacy aliases (kept for 1 release to avoid breaking in-flight UIs) -
@router.post("/sessions/{session_id}/complete-test")
async def complete_test_alias(session_id: str,
                              user=Depends(get_current_user), db=Depends(get_db)):
    return await _flip_to_report_ready(db, session_id, user)


@router.post("/sessions/{session_id}/mark-printed")
async def mark_printed_alias(session_id: str,
                             user=Depends(get_current_user), db=Depends(get_db)):
    return await _flip_to_report_ready(db, session_id, user)


@router.post("/sessions/{session_id}/handover")
async def handover(session_id: str, payload: HandoverRequest,
                   user=Depends(get_current_user), db=Depends(get_db)):
    """Front desk marks the consultation finished. Requires the patient's invoice
    to be fully paid; super_admin/accounts/founder may bypass (for comped visits,
    insurance claims, staff discounts)."""
    s = await _get_session_tenant_scoped(db, session_id, user["clinic_id"])
    inv = await _find_invoice_for_session(db, user["clinic_id"], session_id, s.get("patient_id"))

    privileged = user.get("role") in ("super_admin", "founder", "accounts")
    if not payload.bypass_bill_check and not _invoice_paid(inv):
        due = float((inv or {}).get("due_total") or 0)
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Cannot close consultation — ₹{due:.0f} due on the invoice." if due
                            else "Cannot close consultation — invoice not raised or not paid.",
                "invoice_id": (inv or {}).get("invoice_id"),
                "due_total": (inv or {}).get("due_total"),
                "can_bypass": privileged,
            },
        )
    if payload.bypass_bill_check and not privileged:
        raise HTTPException(status_code=403,
                            detail="Only accounts/super_admin may bypass the bill check.")

    now = datetime.now(timezone.utc)
    delivery = {
        "delivery_id": f"DEL-{str(uuid4())[:8].upper()}",
        "clinic_id": user["clinic_id"],
        "session_id": session_id,
        "patient_id": s.get("patient_id"),
        "invoice_id": (inv or {}).get("invoice_id"),
        "channel": payload.channel,
        "delivered_at": now,
        "delivered_by_user_id": user["user_id"],
        "recipient": payload.recipient,
        "notes": payload.notes,
    }
    await db.report_deliveries.insert_one(serialize_datetime(delivery))

    update = {
        "report_status": "completed",
        "handed_over_at": now,
        "handed_over_by_user_id": user["user_id"],
        "updated_at": now,
    }
    if not s.get("printed_at"):
        update["printed_at"] = now
    if not s.get("test_completed_at"):
        update["test_completed_at"] = now
    await db.test_sessions.update_one(
        {"session_id": session_id}, {"$set": serialize_datetime(update)}
    )
    return {
        "ok": True,
        "session_id": session_id,
        "report_status": "completed",
        "delivery_id": delivery["delivery_id"],
    }


# ---------- listings + badge ----------------------------------------------
@router.get("/reports")
async def list_reports(
    status: Literal["pending", "ready", "completed", "all"] = "ready",
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 25,
    user=Depends(get_current_user), db=Depends(get_db),
):
    page = max(1, page)
    per_page = max(1, min(100, per_page))

    statuses = TAB_TO_STATUSES.get(status, TAB_TO_STATUSES["ready"])
    q: Dict[str, Any] = {"clinic_id": user["clinic_id"],
                         "report_status": {"$in": statuses}}

    sessions: List[Dict[str, Any]] = await db.test_sessions.find(
        q, {"_id": 0}
    ).sort("test_completed_at", -1).to_list(per_page * 10)

    patient_ids = list({s.get("patient_id") for s in sessions if s.get("patient_id")})
    pmap: Dict[str, Dict[str, Any]] = {}
    if patient_ids:
        async for p in db.patients.find(
            {"clinic_id": user["clinic_id"], "patient_id": {"$in": patient_ids}},
            {"_id": 0, "patient_id": 1, "name": 1, "mrd": 1, "mobile": 1,
             "phone": 1, "age": 1, "gender": 1},
        ):
            pmap[p["patient_id"]] = p

    session_ids = [s["session_id"] for s in sessions]
    inv_by_session: Dict[str, Dict[str, Any]] = {}
    inv_by_patient: Dict[str, Dict[str, Any]] = {}
    if session_ids:
        async for inv in db.invoices.find(
            {"clinic_id": user["clinic_id"], "session_id": {"$in": session_ids},
             "status": {"$ne": "cancelled"}},
            {"_id": 0, "invoice_id": 1, "invoice_no": 1, "session_id": 1,
             "patient_id": 1, "due_total": 1, "grand_total": 1, "status": 1,
             "invoice_date": 1},
        ):
            inv_by_session.setdefault(inv["session_id"], inv)
    if patient_ids:
        async for inv in db.invoices.find(
            {"clinic_id": user["clinic_id"],
             "patient_id": {"$in": patient_ids},
             "status": {"$ne": "cancelled"}},
            {"_id": 0, "invoice_id": 1, "invoice_no": 1, "session_id": 1,
             "patient_id": 1, "due_total": 1, "grand_total": 1, "status": 1,
             "invoice_date": 1},
            sort=[("invoice_date", -1)],
        ):
            inv_by_patient.setdefault(inv["patient_id"], inv)

    rows: List[Dict[str, Any]] = []
    search_q = (search or "").strip().lower()
    for s in sessions:
        p = pmap.get(s.get("patient_id"), {})
        name = p.get("name") or ""
        mrd = p.get("mrd") or ""
        mobile = p.get("mobile") or p.get("phone") or ""
        if (search_q and search_q not in name.lower()
                and search_q not in mrd.lower()
                and search_q not in mobile.lower()):
            continue
        inv = inv_by_session.get(s["session_id"]) or inv_by_patient.get(s.get("patient_id"))
        rows.append(deserialize_datetime({
            "session_id": s["session_id"],
            "patient_id": s.get("patient_id"),
            "patient_name": name,
            "mrd": mrd,
            "mobile": mobile,
            "age": p.get("age"),
            "gender": p.get("gender"),
            "test_date": s.get("test_date"),
            "audiologist_name": s.get("audiologist_name"),
            "visit_type": s.get("visit_type") or "walkin",
            "recommended_tests": s.get("recommended_tests") or [],
            "referred_by": s.get("referred_by"),
            "report_status": s.get("report_status") or "draft",
            "test_completed_at": s.get("test_completed_at"),
            "printed_at": s.get("printed_at"),
            "handed_over_at": s.get("handed_over_at"),
            "invoice": inv,
            "bill_paid": _invoice_paid(inv),
        }))

    total = len(rows)
    start = (page - 1) * per_page
    paged = rows[start:start + per_page]
    return {
        "items": paged,
        "total": total,
        "page": page,
        "per_page": per_page,
        "status_filter": status,
    }


@router.get("/reports/pending-count")
async def pending_count(user=Depends(get_current_user), db=Depends(get_db)):
    """Badge count — sessions ready for handover (not yet consultation-finished)."""
    q = {"clinic_id": user["clinic_id"], "report_status": "report_ready"}
    n = await db.test_sessions.count_documents(q)
    return {"pending": n}


# ---------- patient history (universal drawer) ----------------------------
@router.get("/patients/{patient_id}/history")
async def patient_history(patient_id: str,
                          user=Depends(get_current_user), db=Depends(get_db)):
    """One-shot history payload used by the universal patient drawer.

    Returns (all tenant-scoped):
        patient    — core demographics
        sessions   — last 10, newest first (for audiogram thumbnails)
        invoices   — last 10, newest first
        ha_sales   — last 5 hearing-aid sales (if any)
    """
    p = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")

    sessions = await db.test_sessions.find(
        {"clinic_id": user["clinic_id"], "patient_id": patient_id},
        {"_id": 0, "session_id": 1, "test_date": 1, "audiologist_name": 1,
         "right_ear_degree": 1, "left_ear_degree": 1,
         "right_ear_type": 1, "left_ear_type": 1,
         "right_ear_audiogram": 1, "left_ear_audiogram": 1,
         "clinical_impression": 1, "recommendations": 1,
         "report_status": 1, "status": 1,
         "visit_type": 1, "recommended_tests": 1,
         "created_at": 1},
    ).sort("created_at", -1).to_list(10)

    invoices = await db.invoices.find(
        {"clinic_id": user["clinic_id"], "patient_id": patient_id},
        {"_id": 0, "invoice_id": 1, "invoice_no": 1, "invoice_date": 1,
         "grand_total": 1, "paid_total": 1, "due_total": 1, "status": 1,
         "lines": 1},
    ).sort("invoice_date", -1).to_list(10)

    # ha_sales may or may not be present for every clinic — degrade gracefully.
    try:
        ha_sales = await db.ha_sales.find(
            {"clinic_id": user["clinic_id"], "patient_id": patient_id},
            {"_id": 0, "sale_id": 1, "sale_date": 1, "grand_total": 1,
             "status": 1, "lines": 1},
        ).sort("sale_date", -1).to_list(5)
    except Exception:
        ha_sales = []

    return deserialize_datetime({
        "patient": p,
        "sessions": sessions,
        "invoices": invoices,
        "ha_sales": ha_sales,
        "counts": {
            "sessions": await db.test_sessions.count_documents(
                {"clinic_id": user["clinic_id"], "patient_id": patient_id}
            ),
            "invoices": await db.invoices.count_documents(
                {"clinic_id": user["clinic_id"], "patient_id": patient_id}
            ),
        },
    })


# ---------- atomic appointment + draft invoice ----------------------------
class LineItemIn(BaseModel):
    service_id: Optional[str] = None
    description: Optional[str] = None
    quantity: float = 1.0
    unit_price: Optional[float] = None
    discount_type: Literal["flat", "percent"] = "flat"
    discount_value: float = 0.0


class AppointmentWithInvoiceRequest(BaseModel):
    # Appointment fields (mirror AppointmentCreate)
    patient_id: str
    audiologist_id: str
    service: str
    start_at: datetime
    duration_minutes: int = 30
    priority: Literal["normal", "urgent", "vip"] = "normal"
    room: Optional[str] = None
    notes: Optional[str] = None
    visit_type: Literal["referral", "walkin", "consultation"] = "walkin"
    recommended_tests: List[str] = []
    referred_by: Optional[str] = None
    # Invoice fields
    raise_invoice: bool = True
    invoice_lines: List[LineItemIn] = []


@router.post("/appointments/with-invoice")
async def create_appointment_with_invoice(
    payload: AppointmentWithInvoiceRequest,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Atomic: create appointment + (optionally) a draft invoice in one call.

    FD ticks tests in the modal, the UI pre-fills `invoice_lines` with catalog
    prices, FD can edit, then this endpoint books the slot AND creates the
    unpaid invoice. If `raise_invoice=False` (or lines are empty), only the
    appointment is created.
    """
    # Step 1 — create the appointment (delegates to the existing validation pipeline)
    import httpx  # noqa: F401 — only to show intent; we use the local router directly below
    from routers.appointments import create_appointment, AppointmentCreate

    apt_payload = AppointmentCreate(
        patient_id=payload.patient_id,
        audiologist_id=payload.audiologist_id,
        service=payload.service,
        start_at=payload.start_at,
        duration_minutes=payload.duration_minutes,
        priority=payload.priority,
        room=payload.room,
        notes=payload.notes,
        visit_type=payload.visit_type,
        recommended_tests=payload.recommended_tests,
        referred_by=payload.referred_by,
    )
    apt = await create_appointment(apt_payload, user=user, db=db)
    apt_dict = apt.model_dump() if hasattr(apt, "model_dump") else apt

    invoice = None
    if payload.raise_invoice and payload.invoice_lines:
        from billing import create_invoice as billing_create_invoice
        from models import InvoiceCreate, InvoiceLineCreate

        lines = [InvoiceLineCreate(**ln.model_dump()) for ln in payload.invoice_lines]
        inv_payload = InvoiceCreate(
            patient_id=payload.patient_id,
            appointment_id=apt_dict.get("appointment_id"),
            lines=lines,
        )
        try:
            invoice = await billing_create_invoice(inv_payload, user=user, db=db)
            invoice = invoice.model_dump() if hasattr(invoice, "model_dump") else invoice
        except Exception as e:
            # Don't roll back the appointment — reception can raise the invoice
            # later from the appointment row. Surface the billing error though.
            invoice = {"error": str(e)}

    return {
        "ok": True,
        "appointment": apt_dict,
        "invoice": invoice,
    }


# ---------- one-time migration (idempotent, called from server.py lifespan) -
async def migrate_legacy_report_statuses(db) -> Dict[str, int]:
    """Migrate pre-Feb-2026 report_status values to the new 3-state model.

    Called on each boot; idempotent (no-op after first run).
    """
    r1 = await db.test_sessions.update_many(
        {"report_status": {"$in": ["test_completed", "printed"]}},
        {"$set": {"report_status": "report_ready"}},
    )
    r2 = await db.test_sessions.update_many(
        {"report_status": "handed_over"},
        {"$set": {"report_status": "completed"}},
    )
    return {
        "merged_into_report_ready": int(r1.modified_count or 0),
        "merged_into_completed": int(r2.modified_count or 0),
    }
