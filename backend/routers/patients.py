"""Patient CRUD + duplicate detection + MRD counter."""
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import Patient, PatientCreate
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


async def _next_mrd(db, clinic_id: str, mrd_prefix: str) -> str:
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


@router.post("/patients", response_model=Patient)
async def create_patient(patient: PatientCreate, user=Depends(get_current_user), db=Depends(get_db)):
    """Create patient. Tenant-scoped. Auto-generates MRD."""
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    mrd = await _next_mrd(db, user["clinic_id"], clinic.get("mrd_prefix", "ACS"))
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


@router.get("/patients/check-duplicate")
async def check_duplicate_patient(
    mobile: Optional[str] = None,
    name: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Returns potential duplicates. Mobile matching normalises to last 10 digits;
    name is case-insensitive substring."""
    if not mobile and not name:
        return {"matches": []}
    ors = []
    if mobile:
        digits = re.sub(r"\D", "", str(mobile))
        last10 = digits[-10:] if len(digits) >= 10 else digits
        if last10:
            rx = {"$regex": re.escape(last10), "$options": "i"}
            ors.append({"mobile": rx})
            ors.append({"alternate_mobile": rx})
            ors.append({"phone": rx})
    if name and len(name.strip()) >= 3:
        ors.append({"name": {"$regex": re.escape(name.strip()), "$options": "i"}})
    if not ors:
        return {"matches": []}
    matches = await db.patients.find(
        {"clinic_id": user["clinic_id"], "$or": ors},
        {"_id": 0, "patient_id": 1, "mrd": 1, "name": 1, "mobile": 1, "age": 1, "gender": 1, "updated_at": 1},
    ).sort("updated_at", -1).limit(10).to_list(10)
    return {"matches": matches}


@router.get("/patients", response_model=List[Patient])
async def get_patients(search: Optional[str] = None, limit: int = 100,
                       user=Depends(get_current_user), db=Depends(get_db)):
    query: dict = {"clinic_id": user["clinic_id"]}
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [
                {"name": rx}, {"mobile": rx}, {"alternate_mobile": rx},
                {"phone": rx}, {"patient_id": rx}, {"mrd": rx},
            ]
    patients = await db.patients.find(query, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    return [deserialize_datetime(p) for p in patients]


@router.get("/patients/{patient_id}", response_model=Patient)
async def get_patient(patient_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    p = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    return deserialize_datetime(p)


@router.put("/patients/{patient_id}", response_model=Patient)
async def update_patient(patient_id: str, patient_update: PatientCreate,
                         user=Depends(get_current_user), db=Depends(get_db)):
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


@router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    existing = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    await db.patients.delete_one({"patient_id": patient_id})
    await db.patient_notes.delete_many({"patient_id": patient_id})
    return {"message": "Patient deleted", "patient_id": patient_id}
