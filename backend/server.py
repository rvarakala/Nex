from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
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
    Clinic, User, LoginRequest, OPDToken,
)
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_roles, VALID_ROLES,
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

# Expose db to dependency (used by auth.get_current_user)
app.state.db = db

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ==================== M01: AUTH ROUTES ====================

@api_router.post("/auth/login")
async def login(req: LoginRequest):
    email = req.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("active", True) or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["user_id"], user["email"], user["role"], user["clinic_id"])
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "name": user.get("name", ""),
            "role": user["role"],
            "clinic_id": user["clinic_id"],
        },
        "clinic": clinic,
    }


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    return {"user": user, "clinic": clinic}


# ==================== M01: CLINIC ROUTES ====================

@api_router.get("/clinic")
async def get_my_clinic(user=Depends(get_current_user)):
    c = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Clinic not found")
    return c


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

async def _next_mrd(clinic_id: str, mrd_prefix: str) -> str:
    """Generates a human-facing MRD like ACS-2026-001234 (6-digit annual counter per clinic)."""
    now = datetime.utcnow()
    counter = await db.counters.find_one_and_update(
        {"_id": f"mrd:{clinic_id}:{now.year}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = counter["seq"] if counter else 1
    return f"{mrd_prefix}-{now.year}-{seq:06d}"


@api_router.post("/patients", response_model=Patient)
async def create_patient(patient: PatientCreate, user=Depends(get_current_user)):
    """Create patient. Tenant-scoped. Auto-generates MRD."""
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    mrd = await _next_mrd(user["clinic_id"], clinic.get("mrd_prefix", "ACS"))
    patient_obj = Patient(**patient.model_dump(), clinic_id=user["clinic_id"], mrd=mrd)
    doc = serialize_datetime(patient_obj.model_dump())
    await db.patients.insert_one(doc)
    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": "patient.create",
        "patient_id": patient_obj.patient_id,
        "at": datetime.utcnow(),
    }))
    return patient_obj


@api_router.get("/patients/check-duplicate")
async def check_duplicate_patient(
    mobile: Optional[str] = None,
    name: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Returns potential duplicates by mobile (exact) or name (case-insensitive) within the user's clinic."""
    if not mobile and not name:
        return {"matches": []}
    import re as _re
    ors = []
    if mobile:
        ors.append({"mobile": mobile})
        ors.append({"alternate_mobile": mobile})
        ors.append({"phone": mobile})
    if name:
        ors.append({"name": {"$regex": _re.escape(name.strip()), "$options": "i"}})
    matches = await db.patients.find(
        {"clinic_id": user["clinic_id"], "$or": ors},
        {"_id": 0, "patient_id": 1, "mrd": 1, "name": 1, "mobile": 1, "age": 1, "gender": 1, "updated_at": 1},
    ).sort("updated_at", -1).limit(10).to_list(10)
    return {"matches": matches}


@api_router.get("/patients", response_model=List[Patient])
async def get_patients(search: Optional[str] = None, limit: int = 100, user=Depends(get_current_user)):
    query: dict = {"clinic_id": user["clinic_id"]}
    if search:
        import re as _re
        safe = _re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [
                {"name": rx}, {"mobile": rx}, {"alternate_mobile": rx},
                {"phone": rx}, {"patient_id": rx}, {"mrd": rx},
            ]
    patients = await db.patients.find(query, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    return [deserialize_datetime(p) for p in patients]


@api_router.get("/patients/{patient_id}", response_model=Patient)
async def get_patient(patient_id: str, user=Depends(get_current_user)):
    p = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    return deserialize_datetime(p)


@api_router.put("/patients/{patient_id}", response_model=Patient)
async def update_patient(patient_id: str, patient_update: PatientCreate, user=Depends(get_current_user)):
    existing = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    update_data = patient_update.model_dump()
    update_data["updated_at"] = datetime.utcnow()
    await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(update_data)},
    )
    updated = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    return deserialize_datetime(updated)


@api_router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str, user=Depends(get_current_user)):
    existing = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    await db.patients.delete_one({"patient_id": patient_id})
    await db.patient_notes.delete_many({"patient_id": patient_id})
    return {"message": "Patient deleted", "patient_id": patient_id}


# ==================== M01: TOKEN / QUEUE ====================

async def _next_token_no(clinic_id: str) -> int:
    """Daily-resetting token counter per clinic."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    counter = await db.counters.find_one_and_update(
        {"_id": f"token:{clinic_id}:{today}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return counter["seq"] if counter else 1


@api_router.post("/tokens")
async def issue_token(payload: dict, user=Depends(get_current_user)):
    """Issue an OPD token for a patient. Body: {patient_id, service?, priority?}."""
    pid = payload.get("patient_id")
    if not pid:
        raise HTTPException(status_code=400, detail="patient_id required")
    p = await db.patients.find_one({"patient_id": pid, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    token_no = await _next_token_no(user["clinic_id"])
    obj = OPDToken(
        clinic_id=user["clinic_id"],
        token_no=token_no,
        patient_id=pid,
        patient_name=p.get("name", ""),
        patient_mobile=p.get("mobile") or p.get("phone"),
        mrd=p.get("mrd"),
        issued_by_user_id=user["user_id"],
        service=payload.get("service"),
        priority=payload.get("priority", "normal"),
        notes=payload.get("notes"),
    )
    await db.tokens.insert_one(serialize_datetime(obj.model_dump()))
    return obj.model_dump()


@api_router.get("/tokens")
async def list_tokens(
    status: Optional[str] = None,
    today_only: bool = True,
    limit: int = 200,
    user=Depends(get_current_user),
):
    q: dict = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    if today_only:
        start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        q["issued_at"] = {"$gte": start.isoformat()}
    tokens = await db.tokens.find(q, {"_id": 0}).sort("issued_at", -1).to_list(limit)
    return [deserialize_datetime(t) for t in tokens]


@api_router.put("/tokens/{token_id}/status")
async def update_token_status(token_id: str, payload: dict, user=Depends(get_current_user)):
    new_status = payload.get("status")
    if new_status not in {"waiting", "in_consultation", "in_testing", "billing", "completed", "cancelled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    update: dict = {"status": new_status}
    if new_status in {"in_consultation", "in_testing"}:
        update["called_at"] = datetime.utcnow().isoformat()
    if new_status in {"completed", "cancelled"}:
        update["completed_at"] = datetime.utcnow().isoformat()
    res = await db.tokens.update_one(
        {"token_id": token_id, "clinic_id": user["clinic_id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Token not found")
    t = await db.tokens.find_one({"token_id": token_id}, {"_id": 0})
    return deserialize_datetime(t)


# ==================== M01: FRONT DESK DASHBOARD ====================

@api_router.get("/dashboard/frontdesk")
async def frontdesk_dashboard(user=Depends(get_current_user)):
    """KPI cards + live queue for the Front Desk Dashboard."""
    clinic_id = user["clinic_id"]
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Walk-ins today = patients created today
    walkins_today = await db.patients.count_documents({
        "clinic_id": clinic_id, "created_at": {"$gte": today_start.isoformat()},
    })
    # Returning today = tokens where patient was created BEFORE today
    all_tokens_today = await db.tokens.find(
        {"clinic_id": clinic_id, "issued_at": {"$gte": today_start.isoformat()}},
        {"_id": 0},
    ).to_list(500)

    returning_today = 0
    for t in all_tokens_today:
        p = await db.patients.find_one({"patient_id": t.get("patient_id"), "clinic_id": clinic_id}, {"_id": 0, "created_at": 1})
        if p and isinstance(p.get("created_at"), str) and p["created_at"] < today_start.isoformat():
            returning_today += 1

    waiting_now = sum(1 for t in all_tokens_today if t.get("status") == "waiting")
    in_progress = sum(1 for t in all_tokens_today if t.get("status") in {"in_consultation", "in_testing"})

    # Pending reports = sessions marked as draft (or not finalized) today
    pending_reports = await db.test_sessions.count_documents({
        "clinic_id": clinic_id,
        "report_status": {"$ne": "finalized"},
    }) if "clinic_id" in (await db.test_sessions.find_one({}) or {}) else 0

    queue = [t for t in all_tokens_today if t.get("status") in {"waiting", "in_consultation", "in_testing"}]
    queue.sort(key=lambda x: x.get("issued_at", ""))

    return {
        "kpis": {
            "walkins_today": walkins_today,
            "returning_today": returning_today,
            "appointments_today": 0,  # UC-03 in M01.B
            "waiting_now": waiting_now,
            "in_progress": in_progress,
            "collections_today": 0,   # UC-04 in M01.C
            "pending_reports": pending_reports,
        },
        "queue": [deserialize_datetime(t) for t in queue[:50]],
    }


# ==================== REFERRING DOCTORS ====================

@api_router.get("/referring-doctors", response_model=List[ReferringDoctor])
async def list_referring_doctors(search: Optional[str] = None, limit: int = 200, user=Depends(get_current_user)):
    query: dict = {"clinic_id": user["clinic_id"]}
    if search:
        import re as _re
        safe = _re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [{"name": rx}, {"specialty": rx}, {"clinic": rx}, {"phone": rx}]
    docs = await db.referring_doctors.find(query, {"_id": 0}).sort("name", 1).to_list(limit)
    return [deserialize_datetime(d) for d in docs]


@api_router.post("/referring-doctors", response_model=ReferringDoctor)
async def create_referring_doctor(doc: ReferringDoctorCreate, user=Depends(get_current_user)):
    obj_data = doc.model_dump()
    obj_data["clinic_id"] = user["clinic_id"]
    obj = ReferringDoctor(**obj_data)
    await db.referring_doctors.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@api_router.put("/referring-doctors/{doctor_id}", response_model=ReferringDoctor)
async def update_referring_doctor(doctor_id: str, payload: ReferringDoctorCreate, user=Depends(get_current_user)):
    existing = await db.referring_doctors.find_one({"doctor_id": doctor_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Referring doctor not found")
    data = payload.model_dump()
    data["updated_at"] = datetime.utcnow()
    await db.referring_doctors.update_one(
        {"doctor_id": doctor_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(data)},
    )
    updated = await db.referring_doctors.find_one({"doctor_id": doctor_id}, {"_id": 0})
    return deserialize_datetime(updated)


@api_router.delete("/referring-doctors/{doctor_id}")
async def delete_referring_doctor(doctor_id: str, user=Depends(get_current_user)):
    res = await db.referring_doctors.delete_one({"doctor_id": doctor_id, "clinic_id": user["clinic_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Referring doctor not found")
    return {"message": "Deleted", "doctor_id": doctor_id}


# ==================== PATIENT JOURNAL / CHART NOTES ====================

@api_router.get("/patient-notes", response_model=List[PatientNote])
async def list_patient_notes(patient_id: str, limit: int = 500, user=Depends(get_current_user)):
    # Verify patient belongs to this clinic
    p = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    notes = await db.patient_notes.find({"patient_id": patient_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(n) for n in notes]


@api_router.post("/patient-notes", response_model=PatientNote)
async def create_patient_note(note: PatientNoteCreate, user=Depends(get_current_user)):
    p = await db.patients.find_one({"patient_id": note.patient_id, "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    obj = PatientNote(**note.model_dump())
    await db.patient_notes.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@api_router.delete("/patient-notes/{note_id}")
async def delete_patient_note(note_id: str, user=Depends(get_current_user)):
    # Note doesn't carry clinic_id directly; guard via parent patient
    note = await db.patient_notes.find_one({"note_id": note_id}, {"_id": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    p = await db.patients.find_one({"patient_id": note.get("patient_id"), "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised")
    await db.patient_notes.delete_one({"note_id": note_id})
    return {"message": "Deleted", "note_id": note_id}


# ==================== TEST SESSION ROUTES ====================

@api_router.post("/sessions", response_model=TestSession)
async def create_test_session(session: TestSessionCreate, user=Depends(get_current_user)):
    """Create a new test session. Tenant-scoped via authenticated user."""
    p = await db.patients.find_one({"patient_id": session.patient_id, "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    session_obj = TestSession(**session.model_dump())
    doc = serialize_datetime(session_obj.model_dump())
    doc["clinic_id"] = user["clinic_id"]
    await db.test_sessions.insert_one(doc)
    return session_obj


@api_router.get("/sessions", response_model=List[TestSession])
async def get_test_sessions(patient_id: Optional[str] = None, limit: int = 100, user=Depends(get_current_user)):
    query: dict = {"clinic_id": user["clinic_id"]}
    if patient_id:
        query["patient_id"] = patient_id
    # Legacy sessions created before tenant scoping may not have clinic_id; include them if patient belongs to this clinic
    sessions = await db.test_sessions.find(query, {"_id": 0}).sort("test_date", -1).to_list(limit)
    if not sessions and patient_id:
        p = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
        if p:
            sessions = await db.test_sessions.find({"patient_id": patient_id}, {"_id": 0}).sort("test_date", -1).to_list(limit)
    return [deserialize_datetime(s) for s in sessions]


@api_router.get("/sessions/{session_id}", response_model=TestSession)
async def get_test_session(session_id: str, user=Depends(get_current_user)):
    s = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Test session not found")
    # Tenant check via patient
    p = await db.patients.find_one({"patient_id": s.get("patient_id"), "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised")
    return deserialize_datetime(s)


@api_router.put("/sessions/{session_id}", response_model=TestSession)
async def update_test_session(session_id: str, session_update: TestSessionUpdate, user=Depends(get_current_user)):
    s = await db.test_sessions.find_one({"session_id": session_id})
    if not s:
        raise HTTPException(status_code=404, detail="Test session not found")
    p = await db.patients.find_one({"patient_id": s.get("patient_id"), "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised")
    update_data = {k: v for k, v in session_update.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow()
    await db.test_sessions.update_one({"session_id": session_id}, {"$set": serialize_datetime(update_data)})
    updated = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    return deserialize_datetime(updated)


@api_router.delete("/sessions/{session_id}")
async def delete_test_session(session_id: str, user=Depends(get_current_user)):
    s = await db.test_sessions.find_one({"session_id": session_id})
    if not s:
        raise HTTPException(status_code=404, detail="Test session not found")
    p = await db.patients.find_one({"patient_id": s.get("patient_id"), "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised")
    await db.test_sessions.delete_one({"session_id": session_id})
    return {"message": "Deleted", "session_id": session_id}


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

@app.on_event("startup")
async def on_startup():
    """Create MongoDB indexes for frequently-queried fields."""
    try:
        await db.patients.create_index("patient_id", unique=True)
        await db.patients.create_index("mobile")
        await db.patients.create_index("updated_at")
        await db.referring_doctors.create_index("doctor_id", unique=True)
        await db.referring_doctors.create_index("name")
        await db.patient_notes.create_index("patient_id")
        await db.patient_notes.create_index("created_at")
        await db.test_sessions.create_index("session_id", unique=True)
        await db.test_sessions.create_index([("patient_id", 1), ("test_date", -1)])
        # M01 indexes
        await db.users.create_index("email", unique=True)
        await db.users.create_index([("clinic_id", 1), ("role", 1)])
        await db.clinics.create_index("clinic_id", unique=True)
        await db.tokens.create_index([("clinic_id", 1), ("issued_at", -1)])
        await db.tokens.create_index("token_id", unique=True)
        await db.patients.create_index([("clinic_id", 1), ("updated_at", -1)])
        await db.patients.create_index("mrd")
        logger.info("MongoDB indexes ensured")
    except Exception as e:
        logging.warning(f"Index creation skipped: {e}")

    # Seed default clinic + users
    try:
        await _seed_defaults()
    except Exception as e:
        logging.warning(f"Seeding skipped: {e}")


async def _seed_defaults():
    """Idempotently creates the default clinic + 4 demo users (super_admin, front_desk, audiologist, accounts).

    Also: backfill existing patients/referring_doctors that lack `clinic_id` so legacy records remain accessible.
    """
    clinic_id = os.environ.get("DEFAULT_CLINIC_ID", "clinic-acs-demo")
    clinic_name = os.environ.get("DEFAULT_CLINIC_NAME", "ACS Audiology Clinic")

    existing = await db.clinics.find_one({"clinic_id": clinic_id})
    if not existing:
        await db.clinics.insert_one(serialize_datetime({
            "clinic_id": clinic_id,
            "name": clinic_name,
            "city": "Mumbai",
            "state": "Maharashtra",
            "phone": "+91-22-00000000",
            "email": "clinic@acsdemo.in",
            "mrd_prefix": "ACS",
            "created_at": datetime.utcnow(),
        }))
        logger.info(f"Seeded default clinic: {clinic_id}")

    demo_users = [
        {"email": "admin@acs.in",      "password": "admin123",     "name": "Super Admin",   "role": "super_admin"},
        {"email": "frontdesk@acs.in",  "password": "frontdesk123", "name": "Front Desk",    "role": "front_desk"},
        {"email": "audiologist@acs.in","password": "audio123",     "name": "Dr. Audiologist","role": "audiologist"},
        {"email": "accounts@acs.in",   "password": "accounts123",  "name": "Accounts Team", "role": "accounts"},
    ]
    for u in demo_users:
        found = await db.users.find_one({"email": u["email"]})
        if found:
            # Keep password in sync with seed defaults (safe in demo)
            if not verify_password(u["password"], found.get("password_hash", "")):
                await db.users.update_one(
                    {"email": u["email"]},
                    {"$set": {"password_hash": hash_password(u["password"]), "clinic_id": clinic_id}},
                )
            continue
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(os.urandom(4).hex()).upper()}",
            "clinic_id": clinic_id,
            "email": u["email"],
            "name": u["name"],
            "role": u["role"],
            "active": True,
            "password_hash": hash_password(u["password"]),
            "created_at": datetime.utcnow(),
        }))
        logger.info(f"Seeded user: {u['email']} ({u['role']})")

    # Backfill legacy records missing clinic_id
    for coll in ("patients", "referring_doctors", "test_sessions"):
        try:
            await db[coll].update_many({"clinic_id": {"$exists": False}}, {"$set": {"clinic_id": clinic_id}})
            await db[coll].update_many({"clinic_id": None}, {"$set": {"clinic_id": clinic_id}})
        except Exception as e:
            logger.warning(f"Backfill skipped for {coll}: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()