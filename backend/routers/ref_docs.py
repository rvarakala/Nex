"""Referring doctors + patient journal / chart notes."""
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import (
    ReferringDoctor, ReferringDoctorCreate,
    PatientNote, PatientNoteCreate,
)
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


# ==================== REFERRING DOCTORS ====================

@router.get("/referring-doctors", response_model=List[ReferringDoctor])
async def list_referring_doctors(search: Optional[str] = None, limit: int = 200,
                                 user=Depends(get_current_user), db=Depends(get_db)):
    query: dict = {"clinic_id": user["clinic_id"]}
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [{"name": rx}, {"specialty": rx}, {"clinic": rx}, {"phone": rx}]
    docs = await db.referring_doctors.find(query, {"_id": 0}).sort("name", 1).to_list(limit)
    return [deserialize_datetime(d) for d in docs]


@router.post("/referring-doctors", response_model=ReferringDoctor)
async def create_referring_doctor(doc: ReferringDoctorCreate,
                                  user=Depends(get_current_user), db=Depends(get_db)):
    obj_data = doc.model_dump()
    obj_data["clinic_id"] = user["clinic_id"]
    # Guardrails: value must be non-negative. Percent capped at 100.
    for pfx in ("diag", "ha"):
        v = float(obj_data.get(f"{pfx}_cut_value") or 0.0)
        if v < 0:
            v = 0.0
        if obj_data.get(f"{pfx}_cut_mode") == "percent" and v > 100:
            v = 100.0
        obj_data[f"{pfx}_cut_value"] = v
    obj = ReferringDoctor(**obj_data)
    await db.referring_doctors.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@router.put("/referring-doctors/{doctor_id}", response_model=ReferringDoctor)
async def update_referring_doctor(doctor_id: str, payload: ReferringDoctorCreate,
                                  user=Depends(get_current_user), db=Depends(get_db)):
    existing = await db.referring_doctors.find_one({"doctor_id": doctor_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Referring doctor not found")
    data = payload.model_dump()
    # Same guardrails as create
    for pfx in ("diag", "ha"):
        v = float(data.get(f"{pfx}_cut_value") or 0.0)
        if v < 0:
            v = 0.0
        if data.get(f"{pfx}_cut_mode") == "percent" and v > 100:
            v = 100.0
        data[f"{pfx}_cut_value"] = v
    data["updated_at"] = datetime.utcnow()
    await db.referring_doctors.update_one(
        {"doctor_id": doctor_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(data)},
    )
    updated = await db.referring_doctors.find_one({"doctor_id": doctor_id}, {"_id": 0})
    return deserialize_datetime(updated)


@router.delete("/referring-doctors/{doctor_id}")
async def delete_referring_doctor(doctor_id: str,
                                  user=Depends(get_current_user), db=Depends(get_db)):
    res = await db.referring_doctors.delete_one({"doctor_id": doctor_id, "clinic_id": user["clinic_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Referring doctor not found")
    return {"message": "Deleted", "doctor_id": doctor_id}


# ==================== PATIENT JOURNAL / CHART NOTES ====================

@router.get("/patient-notes", response_model=List[PatientNote])
async def list_patient_notes(patient_id: str, limit: int = 500,
                             user=Depends(get_current_user), db=Depends(get_db)):
    p = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    notes = await db.patient_notes.find({"patient_id": patient_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(n) for n in notes]


@router.post("/patient-notes", response_model=PatientNote)
async def create_patient_note(note: PatientNoteCreate,
                              user=Depends(get_current_user), db=Depends(get_db)):
    p = await db.patients.find_one({"patient_id": note.patient_id, "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    obj = PatientNote(**note.model_dump())
    await db.patient_notes.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@router.delete("/patient-notes/{note_id}")
async def delete_patient_note(note_id: str,
                              user=Depends(get_current_user), db=Depends(get_db)):
    # Note doesn't carry clinic_id directly; guard via parent patient
    note = await db.patient_notes.find_one({"note_id": note_id}, {"_id": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    p = await db.patients.find_one({"patient_id": note.get("patient_id"), "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=403, detail="Not authorised")
    await db.patient_notes.delete_one({"note_id": note_id})
    return {"message": "Deleted", "note_id": note_id}
