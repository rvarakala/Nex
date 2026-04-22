"""PDF report generation + short-lived signed share-link endpoints."""
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from auth import get_current_user
from database import get_db
from pdf_generator import generate_report_pdf
from share_token import create_share_token, decode_share_token

router = APIRouter(prefix="/api")


async def _load_session_and_patient(db, session_id: str) -> tuple[dict, dict]:
    session = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Test session not found")
    patient = await db.patients.find_one({"patient_id": session.get("patient_id")}, {"_id": 0})
    if not patient:
        # Orphaned-patient fallback so the PDF still renders. Inherit session's clinic
        # so the tenant guard downstream still applies (avoids an "UNKNOWN" patient
        # bypassing clinic-mismatch checks).
        patient = {
            "patient_id": session.get("patient_id", "UNKNOWN"),
            "name": session.get("patient_name", "Unknown Patient"),
            "clinic_id": session.get("clinic_id"),
            "age": None, "gender": None, "dob": None, "phone": None,
            "referring_physician": None,
        }
    return session, patient


def _stream_pdf(session_id: str, session: dict, patient: dict) -> StreamingResponse:
    try:
        pdf_buffer = generate_report_pdf(session_id, session, patient)
        return StreamingResponse(
            pdf_buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="audiogram_report_{session_id}.pdf"'},
        )
    except Exception as e:
        logging.error(f"Error generating PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {e}")


# ---- Internal (app-authenticated) PDF fetch ----
# Kept as an alias of the old unauthenticated endpoint so existing frontend
# `axios.get(... responseType: 'blob')` calls continue to work. Auth header is
# already attached by the global axios interceptor. Patient tenant is verified.
@router.get("/reports/{session_id}/pdf")
async def generate_session_report(session_id: str,
                                  user=Depends(get_current_user), db=Depends(get_db)):
    session, patient = await _load_session_and_patient(db, session_id)
    # Tenant check — either session or patient must belong to user's clinic.
    session_clinic = session.get("clinic_id")
    patient_clinic = patient.get("clinic_id")
    if session_clinic and session_clinic != user["clinic_id"]:
        raise HTTPException(status_code=403, detail="Not authorised")
    if patient_clinic and patient_clinic != user["clinic_id"]:
        raise HTTPException(status_code=403, detail="Not authorised")
    return _stream_pdf(session_id, session, patient)


# ---- Short-lived share-link ----

@router.post("/reports/{session_id}/share-link")
async def create_report_share_link(session_id: str, request: Request,
                                   user=Depends(get_current_user), db=Depends(get_db)):
    """Mint a signed, time-limited URL that a patient can open without logging in.

    Optional body: `{"ttl_hours": <int>}` (default 168 = 7 days, max 720 = 30 days).
    Front-desk / accounts / super_admin roles only.
    """
    if user["role"] not in {"super_admin", "front_desk", "accounts", "audiologist"}:
        raise HTTPException(status_code=403, detail="Not authorised to share reports")

    session, patient = await _load_session_and_patient(db, session_id)
    session_clinic = session.get("clinic_id")
    patient_clinic = patient.get("clinic_id")
    if session_clinic and session_clinic != user["clinic_id"]:
        raise HTTPException(status_code=403, detail="Not authorised")
    if patient_clinic and patient_clinic != user["clinic_id"]:
        raise HTTPException(status_code=403, detail="Not authorised")

    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    ttl_hours = int(body.get("ttl_hours") or 168)
    token, expires_at = create_share_token(session_id, user["clinic_id"], ttl_hours=ttl_hours)

    # Path is always relative to the clinic's public frontend base URL.
    # The frontend/caller is responsible for prepending REACT_APP_BACKEND_URL so the
    # shared link uses the user-visible hostname (the backend can only see the
    # internal ingress Host header, which is not appropriate for patient-facing links).
    path = f"/api/reports/shared/{token}"

    # Audit
    await db.report_share_links.insert_one({
        "session_id": session_id,
        "clinic_id": user["clinic_id"],
        "created_by_user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires_at.isoformat(),
        "ttl_hours": ttl_hours,
    })
    return {"path": path, "token": token, "expires_at": expires_at.isoformat(), "ttl_hours": ttl_hours}


@router.get("/reports/shared/{token}")
async def get_shared_report_pdf(token: str, db=Depends(get_db)):
    """PUBLIC endpoint — validates the signed token and streams the PDF.
    Safe to include in WhatsApp / SMS / email to patients."""
    payload = decode_share_token(token)
    session_id = payload["session_id"]
    clinic_id = payload["clinic_id"]

    session, patient = await _load_session_and_patient(db, session_id)
    # Clinic re-check: if session/patient has moved clinic, refuse.
    session_clinic = session.get("clinic_id")
    patient_clinic = patient.get("clinic_id")
    if session_clinic and session_clinic != clinic_id:
        raise HTTPException(status_code=401, detail="Share link clinic mismatch")
    if patient_clinic and patient_clinic != clinic_id:
        raise HTTPException(status_code=401, detail="Share link clinic mismatch")

    return _stream_pdf(session_id, session, patient)
