"""Report handover lifecycle endpoints (Pending → Printed → Handed Over).

PDF generation already lives in `routers/reports.py`; this sibling router is
about the *operational* workflow downstream of a rendered PDF — who printed
it, whether the bill is paid, when reception physically handed over the
report, etc.

Lifecycle
---------
    draft
      │  audiologist clicks "Test Completed" in the Diagnostics left panel
      ▼
    test_completed           ← appears in Reports → Pending tab
      │  audiologist / reception clicks "Print Report"  (also hit from the PDF route)
      ▼
    printed                  ← appears in Reports → Ready for Handover tab
      │  reception clicks "Mark Handed Over" (requires invoice paid)
      ▼
    completed                ← appears in Reports → Completed tab

Every transition stamps actor + timestamp on the test_session doc; `handover`
additionally writes a `report_deliveries` row (existing collection referenced
by closeout + data-export).
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


# Statuses visible in each UI tab
TAB_TO_STATUSES: Dict[str, List[str]] = {
    "pending":    ["test_completed"],
    "ready":      ["printed"],
    "completed":  ["handed_over", "completed"],
    "all":        ["test_completed", "printed", "handed_over", "completed"],
}


def _invoice_paid(inv: Optional[Dict[str, Any]]) -> bool:
    if not inv:
        return False
    if inv.get("due_total") is not None:
        return float(inv.get("due_total") or 0) <= 0.01
    return (inv.get("status") or "").lower() in ("paid", "refunded")


# ---------- lifecycle actions ---------------------------------------------
class HandoverRequest(BaseModel):
    channel: Literal["print", "whatsapp", "email", "in_person"] = "print"
    recipient: Optional[str] = None
    notes: Optional[str] = None
    bypass_bill_check: bool = False


@router.post("/sessions/{session_id}/complete-test")
async def complete_test(session_id: str,
                        user=Depends(get_current_user), db=Depends(get_db)):
    """Audiologist marks the test battery finished — moves session to Pending Reports."""
    await _get_session_tenant_scoped(db, session_id, user["clinic_id"])
    now = datetime.now(timezone.utc)
    update = {
        "report_status": "test_completed",
        "test_completed_at": now,
        "test_completed_by_user_id": user["user_id"],
        "status": "completed",
        "updated_at": now,
    }
    await db.test_sessions.update_one(
        {"session_id": session_id}, {"$set": serialize_datetime(update)}
    )
    return {"ok": True, "session_id": session_id, "report_status": "test_completed"}


@router.post("/sessions/{session_id}/mark-printed")
async def mark_printed(session_id: str,
                       user=Depends(get_current_user), db=Depends(get_db)):
    """Called whenever the PDF is printed. Idempotent — won't regress terminal states."""
    s = await _get_session_tenant_scoped(db, session_id, user["clinic_id"])
    cur = s.get("report_status") or "draft"
    if cur in ("handed_over", "completed"):
        return {"ok": True, "session_id": session_id,
                "report_status": cur, "note": "already delivered"}
    now = datetime.now(timezone.utc)
    update = {
        "report_status": "printed",
        "printed_at": now,
        "updated_at": now,
    }
    if cur == "draft":
        # Implicit "Test Completed" stamp if the audiologist skipped the button.
        update["test_completed_at"] = now
        update["test_completed_by_user_id"] = user["user_id"]
        update["status"] = "completed"
    await db.test_sessions.update_one(
        {"session_id": session_id}, {"$set": serialize_datetime(update)}
    )
    return {"ok": True, "session_id": session_id, "report_status": "printed"}


@router.post("/sessions/{session_id}/handover")
async def handover(session_id: str, payload: HandoverRequest,
                   user=Depends(get_current_user), db=Depends(get_db)):
    """Reception marks the report as handed over. Requires invoice paid unless bypassed."""
    s = await _get_session_tenant_scoped(db, session_id, user["clinic_id"])

    # Find the invoice that covers this specific session. We deliberately DON'T
    # fall back to a patient-wide lookup — an old paid invoice must not unlock
    # handover of a new, unpaid session. If the session has no linked invoice
    # at all (e.g. comped / insurance-covered), accounts must explicitly bypass.
    inv = await db.invoices.find_one(
        {"clinic_id": user["clinic_id"], "session_id": session_id,
         "status": {"$nin": ["cancelled"]}},
        {"_id": 0},
        sort=[("invoice_date", -1)],
    )

    privileged = user.get("role") in ("super_admin", "founder", "accounts")
    if not payload.bypass_bill_check and not _invoice_paid(inv):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Report cannot be handed over until the invoice is fully paid.",
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
    status: Literal["pending", "ready", "completed", "all"] = "pending",
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 25,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Patient-wise list of diagnostic sessions filtered by report lifecycle stage."""
    page = max(1, page)
    per_page = max(1, min(100, per_page))

    statuses = TAB_TO_STATUSES.get(status, TAB_TO_STATUSES["pending"])
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
    if session_ids:
        async for inv in db.invoices.find(
            {"clinic_id": user["clinic_id"], "session_id": {"$in": session_ids},
             "status": {"$ne": "cancelled"}},
            {"_id": 0, "invoice_id": 1, "invoice_no": 1, "session_id": 1,
             "due_total": 1, "grand_total": 1, "status": 1},
        ):
            inv_by_session.setdefault(inv["session_id"], inv)

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
        inv = inv_by_session.get(s["session_id"])
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
    """Badge count — sessions awaiting print or handover (excludes completed)."""
    q = {"clinic_id": user["clinic_id"],
         "report_status": {"$in": ["test_completed", "printed"]}}
    n = await db.test_sessions.count_documents(q)
    return {"pending": n}
