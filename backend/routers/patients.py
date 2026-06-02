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
    payload = patient.model_dump()
    # Stamp WhatsApp consent timestamp on the very first opt-in (DPDP audit).
    consent_at = datetime.utcnow().isoformat() if payload.get("whatsapp_consent") else None
    patient_obj = Patient(
        **payload,
        clinic_id=user["clinic_id"],
        mrd=mrd,
        whatsapp_consent_at=consent_at,
    )
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


@router.post("/patients/{patient_id}/whatsapp-consent")
async def update_whatsapp_consent(
    patient_id: str,
    payload: dict,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Toggle WhatsApp consent (DPDP Act 2023). Body: {grant: bool}."""
    grant = bool(payload.get("grant"))
    existing = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(404, "Patient not found")
    now = datetime.utcnow().isoformat()
    update = {
        "whatsapp_consent": grant,
        "updated_at": now,
    }
    if grant:
        update["whatsapp_consent_at"] = now
        update["whatsapp_consent_withdrawn_at"] = None
    else:
        update["whatsapp_consent_withdrawn_at"] = now
    await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"$set": update},
    )
    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": "patient.whatsapp_consent" + (".grant" if grant else ".withdraw"),
        "patient_id": patient_id,
        "at": datetime.utcnow(),
    }))
    return {"patient_id": patient_id, "whatsapp_consent": grant, "at": now}


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


@router.get("/patients", response_model=None)
async def get_patients(
    search: Optional[str] = None,
    limit: int = 100,
    cursor: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """List patients for this clinic.

    Two modes:
    - **Legacy / array mode** (no `cursor` param) — returns `[Patient, ...]`
      truncated to `limit`. Preserves backward compat for the 30+ call sites
      that haven't migrated yet.
    - **Cursor mode** (`?cursor=…` present, even if empty) — returns
      `{items, next_cursor, has_more}`. Use this for paginated UIs.
    """
    from utils.pagination import cursor_clause, next_cursor_for

    query: dict = {"clinic_id": user["clinic_id"]}
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [
                {"name": rx}, {"mobile": rx}, {"alternate_mobile": rx},
                {"phone": rx}, {"patient_id": rx}, {"mrd": rx},
            ]

    # `cursor` query-param is present in the URL even when its value is
    # empty (= first page) — that's our signal to return the pagination
    # envelope. We can't distinguish "not provided" from "= empty string"
    # at the FastAPI layer easily, so we use the value-is-not-None hack:
    # FastAPI defaults `Optional[str]` to None when the param is omitted.
    paginated = cursor is not None

    if paginated and cursor:
        clause = cursor_clause("updated_at", "patient_id", cursor)
        if clause:
            # If query already has $or (from `search`), nest into $and so
            # both filter sets are required.
            if "$or" in query:
                query = {"$and": [{"$or": query.pop("$or")}, clause, query]}
            else:
                query.update(clause)

    cap = max(1, min(int(limit or 50), 500))
    fetch_limit = cap if paginated else cap

    rows = await (
        db.patients.find(query, {"_id": 0})
        .sort([("updated_at", -1), ("patient_id", -1)])
        .to_list(fetch_limit)
    )
    items = [deserialize_datetime(p) for p in rows]

    if paginated:
        nxt = next_cursor_for(rows, "updated_at", "patient_id", fetch_limit)
        return {
            "items": items,
            "next_cursor": nxt,
            "has_more": nxt is not None,
        }
    return items


@router.get("/patients/export.csv")
async def export_patients_csv(
    search: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Stream the current Patients view as CSV. Accepts the same
    `search` filter as `/api/patients`. Exports the *entire* matching
    result set (no 50/page cap), streamed in chunks so memory stays
    bounded even for clinics with 10k+ patients.

    Auth: cookie or Bearer (browser <a download> uses cookies).
    """
    from utils.csv_export import stream_csv

    query: dict = {"clinic_id": user["clinic_id"]}
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [
                {"name": rx}, {"mobile": rx}, {"alternate_mobile": rx},
                {"phone": rx}, {"patient_id": rx}, {"mrd": rx},
            ]

    headers = [
        "MRD", "Patient ID", "Name", "Age", "Gender",
        "Mobile", "Alt Mobile", "Email",
        "City", "State", "Pincode",
        "Chief Complaint", "Ear Side",
        "Referring Doctor", "Referral Source", "Insurance Scheme",
        "Registered At", "Last Updated",
    ]

    async def rows_iter():
        cursor = db.patients.find(
            query,
            {"_id": 0, "mrd": 1, "patient_id": 1, "name": 1, "age": 1,
             "gender": 1, "mobile": 1, "alternate_mobile": 1, "email": 1,
             "city": 1, "state": 1, "pincode": 1, "chief_complaint": 1,
             "ear_side": 1, "referring_physician": 1, "referral_source": 1,
             "insurance_scheme": 1, "created_at": 1, "updated_at": 1},
        ).sort([("updated_at", -1), ("patient_id", -1)])
        async for p in cursor:
            yield [
                p.get("mrd") or "",
                p.get("patient_id") or "",
                p.get("name") or "",
                p.get("age") or "",
                p.get("gender") or "",
                p.get("mobile") or "",
                p.get("alternate_mobile") or "",
                p.get("email") or "",
                p.get("city") or "",
                p.get("state") or "",
                p.get("pincode") or "",
                (p.get("chief_complaint") or "").replace("\n", " ").strip(),
                p.get("ear_side") or "",
                p.get("referring_physician") or "",
                p.get("referral_source") or "",
                p.get("insurance_scheme") or "",
                str(p.get("created_at") or ""),
                str(p.get("updated_at") or ""),
            ]

    return await stream_csv(
        filename_prefix=f"audinexa-patients-{user['clinic_id']}",
        headers=headers,
        rows_iter=rows_iter(),
    )


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
