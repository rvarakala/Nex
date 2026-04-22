from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone, timedelta

# IST helpers — shared module (single source of truth)
from utils.ist import IST, ist_day_start_utc, ist_today_ymd, ist_next_day_start_utc  # noqa: F401

# Import our models
from models import (
    Patient, PatientCreate,
    TestSession, TestSessionCreate, TestSessionUpdate,
    AudiogramData, SpeechTest,
    ReferringDoctor, ReferringDoctorCreate,
    PatientNote, PatientNoteCreate,
    Clinic, User, LoginRequest, OPDToken,
    Appointment, AppointmentCreate,
    WaitlistEntry, WaitlistCreate,
    CancellationLog,
    APPOINTMENT_SERVICES,
    Service, ServiceCreate,
    Invoice, InvoiceCreate, InvoiceLine, InvoiceLineCreate,
    Payment, PaymentCreate,
    ReportDelivery,
    PAYMENT_METHODS, INVOICE_STATUSES,
)
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_roles, VALID_ROLES,
)
from reminders import dispatch_reminder
import billing as billing_module
import closeout as closeout_module

# Import PDF generator
from pdf_generator import generate_report_pdf


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection (single source; shared with routers via Depends(get_db))
from database import client, db, get_db  # noqa: E402

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """FastAPI lifespan: replaces deprecated on_event('startup'/'shutdown') handlers.
    Startup: creates MongoDB indexes, seeds default clinic/users/services, cleans stale UTC-keyed token counters.
    Shutdown: closes MongoDB client connection.
    """
    _log = logging.getLogger(__name__)
    try:
        # ---- indexes ----
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
        # M01.B appointment indexes
        await db.appointments.create_index("appointment_id", unique=True)
        await db.appointments.create_index([("clinic_id", 1), ("start_at", 1)])
        await db.appointments.create_index([("clinic_id", 1), ("audiologist_id", 1), ("start_at", 1)])
        await db.waitlist.create_index("entry_id", unique=True)
        await db.waitlist.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.reminder_logs.create_index([("clinic_id", 1), ("sent_at", -1)])
        await db.cancellation_logs.create_index([("clinic_id", 1), ("cancelled_at", -1)])
        # M01.C billing indexes
        await db.services.create_index("service_id", unique=True)
        await db.services.create_index([("clinic_id", 1), ("active", 1), ("name", 1)])
        await db.invoices.create_index("invoice_id", unique=True)
        await db.invoices.create_index([("clinic_id", 1), ("invoice_date", -1)])
        await db.invoices.create_index([("clinic_id", 1), ("patient_id", 1)])
        await db.invoices.create_index("invoice_no")
        await db.payments.create_index("payment_id", unique=True)
        await db.payments.create_index([("clinic_id", 1), ("paid_at", -1)])
        await db.payments.create_index("invoice_id")
        await db.report_deliveries.create_index("delivery_id", unique=True)
        await db.report_deliveries.create_index([("clinic_id", 1), ("session_id", 1)])
        _log.info("MongoDB indexes ensured")

        # ---- seed defaults (clinic, users, services) — idempotent ----
        await _seed_defaults()

        # ---- one-time cleanup of stale UTC-keyed token counters ----
        # After the IST migration, old `token:{clinic}:{YYYY-MM-DD}` counter docs keyed on UTC date
        # (e.g., yesterday's UTC date when we crossed IST midnight) are functionally obsolete.
        # Drop anything that isn't today's IST-YMD. Counters auto-regenerate on next issuance.
        try:
            today_ymd = ist_today_ymd()
            cleanup = await db.counters.delete_many({
                "$and": [
                    {"_id": {"$regex": r"^token:.+:\d{4}-\d{2}-\d{2}$"}},
                    {"_id": {"$not": {"$regex": f":{today_ymd}$"}}},
                ]
            })
            if cleanup.deleted_count:
                _log.info(f"Counter cleanup: removed {cleanup.deleted_count} stale token counter docs")
        except Exception as e:
            _log.warning(f"Counter cleanup skipped: {e}")

    except Exception as e:
        _log.error(f"Startup initialisation error: {e}")

    # Start daily close-out scheduler (21:00 IST)
    scheduler = None
    try:
        scheduler = closeout_module.start_scheduler(db)
    except Exception as e:
        _log.warning(f"Close-out scheduler skipped: {e}")

    yield

    # ---- shutdown ----
    if scheduler:
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass
    client.close()
    _log.info("MongoDB client closed")


app = FastAPI(lifespan=lifespan)

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


# ==================== EXTRACTED → routers/ ==================== (== PATIENT ROUTES)
# ==================== EXTRACTED → routers/ ==================== (== M01.B: APPOINTMEN)
# ==================== EXTRACTED → routers/ ==================== (== TOKEN / QUEUE)
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


# ==================== CLOSE-OUTS + REPORTS moved to /app/backend/routers/ ====================


# Include the router in the main app
app.include_router(api_router)
app.include_router(billing_module.billing_router)

from routers import closeouts as closeouts_router    # noqa: E402
from routers import reports as reports_router         # noqa: E402
from routers import patients as patients_router       # noqa: E402
from routers import appointments as appointments_router  # noqa: E402
from routers import tokens as tokens_router           # noqa: E402

app.include_router(closeouts_router.router)
app.include_router(reports_router.router)
app.include_router(patients_router.router)
app.include_router(appointments_router.router)
app.include_router(tokens_router.router)

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

    # Seed default service catalogue for the default clinic (idempotent)
    try:
        inserted = await billing_module.seed_default_services(db, clinic_id)
        if inserted:
            logger.info(f"Seeded {inserted} default services for {clinic_id}")
    except Exception as e:
        logger.warning(f"Service seeding skipped: {e}")