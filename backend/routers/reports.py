"""PDF report generation endpoint. Extracted from server.py."""
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from pdf_generator import generate_report_pdf

router = APIRouter(prefix="/api")
_DB = None


def attach_db(database):
    global _DB
    _DB = database


def _db():
    if _DB is None:
        raise RuntimeError("reports router: DB not attached")
    return _DB


@router.get("/reports/{session_id}/pdf")
async def generate_session_report(session_id: str):
    """Generate PDF report for a test session. Currently unauthenticated to support
    patient-facing short-link sharing; callers with a session_id own the report."""
    db = _db()
    session = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Test session not found")

    # Orphaned-patient fallback so the PDF still renders
    patient = await db.patients.find_one({"patient_id": session['patient_id']}, {"_id": 0})
    if not patient:
        patient = {
            "patient_id": session.get('patient_id', 'UNKNOWN'),
            "name": session.get('patient_name', 'Unknown Patient'),
            "age": None, "gender": None, "dob": None, "phone": None,
            "referring_physician": None,
        }

    try:
        pdf_buffer = generate_report_pdf(session_id, session, patient)
        return StreamingResponse(
            pdf_buffer,
            media_type='application/pdf',
            headers={'Content-Disposition': f'attachment; filename="audiogram_report_{session_id}.pdf"'},
        )
    except Exception as e:
        logging.error(f"Error generating PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {e}")
