"""Test session CRUD + PTA calculator."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import TestSession, TestSessionCreate, TestSessionUpdate, AudiogramData
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


@router.post("/sessions", response_model=TestSession)
async def create_test_session(session: TestSessionCreate,
                              user=Depends(get_current_user), db=Depends(get_db)):
    """Create a new test session. Tenant-scoped via authenticated user."""
    p = await db.patients.find_one({"patient_id": session.patient_id, "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    session_obj = TestSession(**session.model_dump())
    doc = serialize_datetime(session_obj.model_dump())
    doc["clinic_id"] = user["clinic_id"]
    await db.test_sessions.insert_one(doc)
    return session_obj


@router.get("/sessions", response_model=List[TestSession])
async def get_test_sessions(patient_id: Optional[str] = None, limit: int = 100,
                            user=Depends(get_current_user), db=Depends(get_db)):
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


@router.get("/sessions/{session_id}", response_model=TestSession)
async def get_test_session(session_id: str,
                           user=Depends(get_current_user), db=Depends(get_db)):
    s = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Test session not found")
    # Tenant check via patient
    p = await db.patients.find_one({"patient_id": s.get("patient_id"), "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised")
    return deserialize_datetime(s)


@router.put("/sessions/{session_id}", response_model=TestSession)
async def update_test_session(session_id: str, session_update: TestSessionUpdate,
                              user=Depends(get_current_user), db=Depends(get_db)):
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


@router.delete("/sessions/{session_id}")
async def delete_test_session(session_id: str,
                              user=Depends(get_current_user), db=Depends(get_db)):
    s = await db.test_sessions.find_one({"session_id": session_id})
    if not s:
        raise HTTPException(status_code=404, detail="Test session not found")
    p = await db.patients.find_one({"patient_id": s.get("patient_id"), "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised")
    await db.test_sessions.delete_one({"session_id": session_id})
    return {"message": "Deleted", "session_id": session_id}


# ==================== CALCULATION ROUTES ====================

@router.post("/calculate/pta")
async def calculate_pta(audiogram: AudiogramData):
    """Calculate Pure Tone Average from audiogram data."""
    frequencies = {m.frequency: m.threshold_db for m in audiogram.ac_measurements if m.threshold_db is not None}

    pta_3 = None
    if all(f in frequencies for f in [500, 1000, 2000]):
        pta_3 = round((frequencies[500] + frequencies[1000] + frequencies[2000]) / 3, 1)

    pta_4 = None
    if all(f in frequencies for f in [500, 1000, 2000, 4000]):
        pta_4 = round((frequencies[500] + frequencies[1000] + frequencies[2000] + frequencies[4000]) / 4, 1)

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
        "ear": audiogram.ear,
    }
