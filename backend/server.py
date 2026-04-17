from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from typing import List
from datetime import datetime

# Import our models
from models import (
    Patient, PatientCreate,
    TestSession, TestSessionCreate, TestSessionUpdate,
    AudiogramData, SpeechTest
)


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
    """Convert ISO format strings back to datetime objects"""
    if isinstance(obj, dict):
        return {k: deserialize_datetime(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [deserialize_datetime(item) for item in obj]
    elif isinstance(obj, str):
        try:
            return datetime.fromisoformat(obj)
        except:
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
async def get_patients(limit: int = 100):
    """Get all patients"""
    patients = await db.patients.find({}, {"_id": 0}).to_list(limit)
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