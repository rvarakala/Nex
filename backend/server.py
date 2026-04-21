from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from typing import List, Optional
from datetime import datetime

# Import our models
from models import (
    Patient, PatientCreate,
    TestSession, TestSessionCreate, TestSessionUpdate,
    AudiogramData, SpeechTest,
    ReferringDoctor, ReferringDoctorCreate,
    PatientNote, PatientNoteCreate,
)

# Import PDF generator
from pdf_generator import generate_report_pdf


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ==================== HELPER FUNCTIONS ====================

def serialize_datetime(obj):
    """Convert datetime objects to ISO format strings for MongoDB"""
    if isinstance(obj, dict):
        return {k: serialize_datetime(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [serialize_datetime(item) for item in obj]
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj

def deserialize_datetime(obj):
    """Convert ISO format strings back to datetime objects.
    Skips known string-typed date fields (e.g., 'dob') to avoid coercing them into datetimes.
    """
    STRING_DATE_KEYS = {"dob"}
    if isinstance(obj, dict):
        return {k: (v if k in STRING_DATE_KEYS else deserialize_datetime(v)) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [deserialize_datetime(item) for item in obj]
    elif isinstance(obj, str):
        try:
            return datetime.fromisoformat(obj)
        except:  # noqa: E722
            return obj
    return obj


# ==================== BASIC ROUTES ====================

@api_router.get("/")
async def root():
    return {"message": "ACS Audiology Management System API"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ==================== PATIENT ROUTES ====================

@api_router.post("/patients", response_model=Patient)
async def create_patient(patient: PatientCreate):
    """Create a new patient record"""
    patient_obj = Patient(**patient.model_dump())
    doc = serialize_datetime(patient_obj.model_dump())
    
    result = await db.patients.insert_one(doc)
    return patient_obj

@api_router.get("/patients", response_model=List[Patient])
async def get_patients(search: Optional[str] = None, limit: int = 100):
    """Get all patients, optionally filtered by case-insensitive search across name / mobile / patient_id."""
    query: dict = {}
    if search:
        import re as _re
        safe = _re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query = {"$or": [
                {"name": rx},
                {"mobile": rx},
                {"phone": rx},
                {"patient_id": rx},
            ]}
    patients = await db.patients.find(query, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    return [deserialize_datetime(p) for p in patients]

@api_router.get("/patients/{patient_id}", response_model=Patient)
async def get_patient(patient_id: str):
    """Get a specific patient"""
    patient = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return deserialize_datetime(patient)

@api_router.put("/patients/{patient_id}", response_model=Patient)
async def update_patient(patient_id: str, patient_update: PatientCreate):
    """Update patient information"""
    existing = await db.patients.find_one({"patient_id": patient_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    update_data = patient_update.model_dump()
    update_data['updated_at'] = datetime.utcnow()
    
    await db.patients.update_one(
        {"patient_id": patient_id},
        {"$set": serialize_datetime(update_data)}
    )
    
    updated_patient = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    return deserialize_datetime(updated_patient)


@api_router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str):
    """Delete a patient + their notes. Sessions are kept (soft archival by patient_id)."""
    existing = await db.patients.find_one({"patient_id": patient_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    await db.patients.delete_one({"patient_id": patient_id})
    await db.patient_notes.delete_many({"patient_id": patient_id})
    return {"message": "Patient deleted", "patient_id": patient_id}


# ==================== REFERRING DOCTORS ====================

@api_router.get("/referring-doctors", response_model=List[ReferringDoctor])
async def list_referring_doctors(search: Optional[str] = None, limit: int = 200):
    query: dict = {}
    if search:
        import re as _re
        safe = _re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query = {"$or": [{"name": rx}, {"specialty": rx}, {"clinic": rx}, {"phone": rx}]}
    docs = await db.referring_doctors.find(query, {"_id": 0}).sort("name", 1).to_list(limit)
    return [deserialize_datetime(d) for d in docs]


@api_router.post("/referring-doctors", response_model=ReferringDoctor)
async def create_referring_doctor(doc: ReferringDoctorCreate):
    obj = ReferringDoctor(**doc.model_dump())
    await db.referring_doctors.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@api_router.put("/referring-doctors/{doctor_id}", response_model=ReferringDoctor)
async def update_referring_doctor(doctor_id: str, payload: ReferringDoctorCreate):
    existing = await db.referring_doctors.find_one({"doctor_id": doctor_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Referring doctor not found")
    data = payload.model_dump()
    data["updated_at"] = datetime.utcnow()
    await db.referring_doctors.update_one(
        {"doctor_id": doctor_id},
        {"$set": serialize_datetime(data)}
    )
    updated = await db.referring_doctors.find_one({"doctor_id": doctor_id}, {"_id": 0})
    return deserialize_datetime(updated)


@api_router.delete("/referring-doctors/{doctor_id}")
async def delete_referring_doctor(doctor_id: str):
    res = await db.referring_doctors.delete_one({"doctor_id": doctor_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Referring doctor not found")
    return {"message": "Deleted", "doctor_id": doctor_id}


# ==================== PATIENT JOURNAL / CHART NOTES ====================

@api_router.get("/patient-notes", response_model=List[PatientNote])
async def list_patient_notes(patient_id: str, limit: int = 500):
    notes = await db.patient_notes.find({"patient_id": patient_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(n) for n in notes]


@api_router.post("/patient-notes", response_model=PatientNote)
async def create_patient_note(note: PatientNoteCreate):
    # Ensure patient exists
    p = await db.patients.find_one({"patient_id": note.patient_id})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    obj = PatientNote(**note.model_dump())
    await db.patient_notes.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@api_router.delete("/patient-notes/{note_id}")
async def delete_patient_note(note_id: str):
    res = await db.patient_notes.delete_one({"note_id": note_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Deleted", "note_id": note_id}


# ==================== TEST SESSION ROUTES ====================

@api_router.post("/sessions", response_model=TestSession)
async def create_test_session(session: TestSessionCreate):
    """Create a new test session"""
    session_obj = TestSession(**session.model_dump())
    doc = serialize_datetime(session_obj.model_dump())
    
    result = await db.test_sessions.insert_one(doc)
    return session_obj

@api_router.get("/sessions", response_model=List[TestSession])
async def get_test_sessions(patient_id: str = None, limit: int = 100):
    """Get test sessions, optionally filtered by patient_id"""
    query = {"patient_id": patient_id} if patient_id else {}
    sessions = await db.test_sessions.find(query, {"_id": 0}).sort("test_date", -1).to_list(limit)
    return [deserialize_datetime(s) for s in sessions]

@api_router.get("/sessions/{session_id}", response_model=TestSession)
async def get_test_session(session_id: str):
    """Get a specific test session"""
    session = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Test session not found")
    return deserialize_datetime(session)

@api_router.put("/sessions/{session_id}", response_model=TestSession)
async def update_test_session(session_id: str, session_update: TestSessionUpdate):
    """Update test session data"""
    existing = await db.test_sessions.find_one({"session_id": session_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Test session not found")
    
    # Only update fields that are provided (not None)
    update_data = {k: v for k, v in session_update.model_dump().items() if v is not None}
    update_data['updated_at'] = datetime.utcnow()
    
    await db.test_sessions.update_one(
        {"session_id": session_id},
        {"$set": serialize_datetime(update_data)}
    )
    
    updated_session = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    return deserialize_datetime(updated_session)

@api_router.delete("/sessions/{session_id}")
async def delete_test_session(session_id: str):
    """Delete a test session"""
    result = await db.test_sessions.delete_one({"session_id": session_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Test session not found")
    return {"message": "Test session deleted successfully"}


# ==================== CALCULATION ROUTES ====================

@api_router.post("/calculate/pta")
async def calculate_pta(audiogram: AudiogramData):
    """Calculate Pure Tone Average from audiogram data"""
    frequencies = {m.frequency: m.threshold_db for m in audiogram.ac_measurements if m.threshold_db is not None}
    
    # 3-frequency PTA (500, 1000, 2000 Hz)
    pta_3 = None
    if all(f in frequencies for f in [500, 1000, 2000]):
        pta_3 = round((frequencies[500] + frequencies[1000] + frequencies[2000]) / 3, 1)
    
    # 4-frequency PTA (500, 1000, 2000, 4000 Hz)
    pta_4 = None
    if all(f in frequencies for f in [500, 1000, 2000, 4000]):
        pta_4 = round((frequencies[500] + frequencies[1000] + frequencies[2000] + frequencies[4000]) / 4, 1)
    
    # Classify degree
    pta = pta_3 or pta_4
    degree = "unknown"
    if pta is not None:
        if pta <= 15:
            degree = "normal"
        elif pta <= 25:
            degree = "slight"
        elif pta <= 40:
            degree = "mild"
        elif pta <= 55:
            degree = "moderate"
        elif pta <= 70:
            degree = "moderately_severe"
        elif pta <= 90:
            degree = "severe"
        else:
            degree = "profound"
    
    return {
        "pta_3freq": pta_3,
        "pta_4freq": pta_4,
        "degree": degree,
        "ear": audiogram.ear
    }


# ==================== PDF REPORT GENERATION ====================

@api_router.get("/reports/{session_id}/pdf")
async def generate_session_report(session_id: str):
    """Generate PDF report for a test session"""
    # Get session data
    session = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Test session not found")
    
    # Get patient data
    patient = await db.patients.find_one({"patient_id": session['patient_id']}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    try:
        # Generate PDF
        pdf_buffer = generate_report_pdf(session_id, session, patient)
        
        # Return as streaming response
        headers = {
            'Content-Disposition': f'attachment; filename="audiogram_report_{session_id}.pdf"'
        }
        
        return StreamingResponse(
            pdf_buffer,
            media_type='application/pdf',
            headers=headers
        )
    except Exception as e:
        logging.error(f"Error generating PDF: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {str(e)}")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()