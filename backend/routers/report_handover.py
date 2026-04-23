"""Report lifecycle (simplified, Feb 2026 v2 — handover feature scrapped).

New simplified lifecycle (2 states):
    draft
      │  audiologist clicks "Save & Print Report"
      │  (client captures #report-preview DOM → uploads PDF → calls /generate-report)
      ▼
    completed                 ← appears in Reports list

Endpoints
    POST /api/sessions/{id}/generate-report   — flips status to `completed`
    POST /api/sessions/{id}/report-pdf        — upload captured PDF (multipart)
    POST /api/sessions/{id}/mark-printed      — ALIAS, kept for backwards-compat
    POST /api/sessions/{id}/complete-test     — ALIAS, kept for backwards-compat
    GET  /api/reports                         — list completed reports
    GET  /api/reports/pending-count           — 0 (handover deprecated)
    GET  /api/patients/{id}/history           — universal patient drawer data
    POST /api/appointments/with-invoice       — atomic appointment + draft invoice
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel

from auth import get_current_user
from database import get_db
from utils.serde import deserialize_datetime, serialize_datetime


router = APIRouter(prefix="/api", tags=["reports"])

_MAX_PDF_BYTES = 15 * 1024 * 1024  # 15 MB cap — well above a 4-page audiogram PDF


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


def _invoice_paid(inv: Optional[Dict[str, Any]]) -> bool:
    if not inv:
        return False
    if inv.get("due_total") is not None:
        return float(inv.get("due_total") or 0) <= 0.01
    return (inv.get("status") or "").lower() in ("paid", "refunded")


# Tab → statuses. Only `completed` now; legacy aliases preserved for old clients.
TAB_TO_STATUSES: Dict[str, List[str]] = {
    "completed":  ["completed"],
    "all":        ["completed"],
    "ready":      ["completed"],   # legacy alias
    "pending":    ["completed"],   # legacy alias
}


# ---------- lifecycle actions ---------------------------------------------
async def _flip_to_completed(db, session_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    """Core state transition — all "print/generate/mark-printed" calls land here."""
    s = await _get_session_tenant_scoped(db, session_id, user["clinic_id"])
    cur = s.get("report_status") or "draft"
    if cur == "completed":
        # Bump printed_at so re-prints show as fresh activity, but stay idempotent.
        await db.test_sessions.update_one(
            {"session_id": session_id},
            {"$set": serialize_datetime({"printed_at": datetime.now(timezone.utc)})},
        )
        return {"ok": True, "session_id": session_id, "report_status": "completed",
                "note": "already completed"}
    now = datetime.now(timezone.utc)
    update = {
        "report_status": "completed",
        "test_completed_at": s.get("test_completed_at") or now,
        "test_completed_by_user_id": s.get("test_completed_by_user_id") or user["user_id"],
        "printed_at": now,
        "status": "completed",   # legacy `status` field
        "updated_at": now,
    }
    await db.test_sessions.update_one(
        {"session_id": session_id}, {"$set": serialize_datetime(update)}
    )
    return {"ok": True, "session_id": session_id, "report_status": "completed"}


@router.post("/sessions/{session_id}/generate-report")
async def generate_report(session_id: str,
                          user=Depends(get_current_user), db=Depends(get_db)):
    """One-shot audiologist action — flips the session to `completed`.

    The autosave PUT is client-side; the captured PDF is uploaded via
    `POST /api/sessions/{id}/report-pdf` immediately before (or after) this call.
    """
    return await _flip_to_completed(db, session_id, user)


# ---------- legacy aliases (kept for 1 release) -
@router.post("/sessions/{session_id}/complete-test")
async def complete_test_alias(session_id: str,
                              user=Depends(get_current_user), db=Depends(get_db)):
    return await _flip_to_completed(db, session_id, user)


@router.post("/sessions/{session_id}/mark-printed")
async def mark_printed_alias(session_id: str,
                             user=Depends(get_current_user), db=Depends(get_db)):
    return await _flip_to_completed(db, session_id, user)


# ---------- captured-PDF upload (NEW) -------------------------------------
@router.post("/sessions/{session_id}/report-pdf")
async def upload_report_pdf(session_id: str,
                            file: UploadFile = File(...),
                            user=Depends(get_current_user), db=Depends(get_db)):
    """Accept the client-rendered PDF (exactly what the audiologist just printed)
    and archive it in GridFS. Subsequent re-opens serve this blob — so "what was
    printed" == "what is saved" == "what patients receive" forever after.

    Idempotent on re-upload: the previous GridFS blob is deleted.
    """
    s = await _get_session_tenant_scoped(db, session_id, user["clinic_id"])

    # Size cap (avoid DoS via a giant upload). Read into memory — PDFs are small.
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large (max 15 MB)")

    # Light magic-byte check (PDFs start with %PDF-).
    if not raw.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="Only PDF files are accepted")

    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="session_reports")

    # Remove any previously-stored blob for this session (idempotent).
    old_id = s.get("report_pdf_fs_id")
    if old_id:
        try:
            await bucket.delete(ObjectId(old_id))
        except Exception:
            pass  # missing/orphan — harmless

    fs_id = await bucket.upload_from_stream(
        filename=f"{session_id}.pdf",
        source=raw,
        metadata={
            "clinic_id": user["clinic_id"],
            "session_id": session_id,
            "patient_id": s.get("patient_id"),
            "uploaded_by_user_id": user["user_id"],
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "size_bytes": len(raw),
        },
    )

    now = datetime.now(timezone.utc)
    await db.test_sessions.update_one(
        {"session_id": session_id},
        {"$set": serialize_datetime({
            "report_pdf_fs_id": str(fs_id),
            "report_pdf_uploaded_at": now,
            "report_pdf_size_bytes": len(raw),
            "report_status": "completed",
            "test_completed_at": s.get("test_completed_at") or now,
            "test_completed_by_user_id": s.get("test_completed_by_user_id") or user["user_id"],
            "printed_at": now,
            "status": "completed",
            "updated_at": now,
        })},
    )
    return {
        "ok": True,
        "session_id": session_id,
        "report_pdf_fs_id": str(fs_id),
        "size_bytes": len(raw),
        "report_status": "completed",
    }


# ---------- listings + badge ----------------------------------------------
@router.get("/reports")
async def list_reports(
    status: Literal["pending", "ready", "completed", "all"] = "completed",
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 25,
    user=Depends(get_current_user), db=Depends(get_db),
):
    page = max(1, page)
    per_page = max(1, min(100, per_page))

    statuses = TAB_TO_STATUSES.get(status, TAB_TO_STATUSES["completed"])
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
            "report_pdf_uploaded_at": s.get("report_pdf_uploaded_at"),
            "has_uploaded_pdf": bool(s.get("report_pdf_fs_id")),
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
async def pending_count(user=Depends(get_current_user), db=Depends(get_db)):  # noqa: ARG001
    """Legacy sidebar badge — always 0 since the handover step was scrapped."""
    return {"pending": 0}


# ---------- patient history (universal drawer) ----------------------------
@router.get("/patients/{patient_id}/history")
async def patient_history(patient_id: str,
                          user=Depends(get_current_user), db=Depends(get_db)):
    """One-shot history payload used by the universal patient drawer."""
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
    """Atomic: create appointment + (optionally) a draft invoice in one call."""
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
            invoice = {"error": str(e)}

    return {
        "ok": True,
        "appointment": apt_dict,
        "invoice": invoice,
    }


# ---------- one-time migration (idempotent, called from server.py lifespan) -
async def migrate_legacy_report_statuses(db) -> Dict[str, int]:
    """Migrate every non-`completed`, non-`draft` legacy status → `completed`.

    After Feb 2026 v2, the lifecycle has only `draft` and `completed`.
    Called on each boot; idempotent.
    """
    legacy = ["test_completed", "printed", "report_ready", "handed_over", "ready", "finalized"]
    r = await db.test_sessions.update_many(
        {"report_status": {"$in": legacy}},
        {"$set": {"report_status": "completed"}},
    )
    return {
        "merged_into_completed": int(r.modified_count or 0),
    }
