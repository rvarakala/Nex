"""Appointments, waitlist, and reminders."""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import (
    Appointment, AppointmentCreate,
    WaitlistEntry, WaitlistCreate,
    CancellationLog,
    APPOINTMENT_SERVICES,
)
from reminders import dispatch_reminder
from utils.ist import ist_today_ymd
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


# Used by Book Appointment modal — list active users filtered by role.
@router.get("/users")
async def list_users(role: Optional[str] = None,
                     user=Depends(get_current_user), db=Depends(get_db)):
    q: dict = {"clinic_id": user["clinic_id"], "active": True}
    if role:
        q["role"] = role
    us = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(100)
    return [deserialize_datetime(u) for u in us]


@router.get("/appointments/services")
async def list_appointment_services(user=Depends(get_current_user)):
    return {"services": APPOINTMENT_SERVICES}


def _overlap_query(clinic_id: str, audiologist_id: str, start: datetime, end: datetime,
                   exclude_id: Optional[str] = None) -> dict:
    q: dict = {
        "clinic_id": clinic_id,
        "audiologist_id": audiologist_id,
        "status": {"$nin": ["cancelled", "no_show", "completed"]},
        "start_at": {"$lt": end.isoformat()},
        "end_at":   {"$gt": start.isoformat()},
    }
    if exclude_id:
        q["appointment_id"] = {"$ne": exclude_id}
    return q


@router.post("/appointments", response_model=Appointment)
async def create_appointment(payload: AppointmentCreate,
                             user=Depends(get_current_user), db=Depends(get_db)):
    clinic_id = user["clinic_id"]
    p = await db.patients.find_one({"patient_id": payload.patient_id, "clinic_id": clinic_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    a = await db.users.find_one({"user_id": payload.audiologist_id, "clinic_id": clinic_id},
                                {"_id": 0, "password_hash": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Audiologist not found")

    start = payload.start_at
    end = start + timedelta(minutes=payload.duration_minutes)

    overlap = await db.appointments.find_one(_overlap_query(clinic_id, payload.audiologist_id, start, end))
    if overlap:
        raise HTTPException(status_code=409, detail={
            "message": "Time slot conflicts with an existing appointment",
            "conflict_with": {
                "appointment_id": overlap.get("appointment_id"),
                "patient_name": overlap.get("patient_name"),
                "start_at": overlap.get("start_at"),
                "end_at": overlap.get("end_at"),
            },
        })

    obj = Appointment(
        clinic_id=clinic_id,
        patient_id=p["patient_id"],
        patient_name=p.get("name", ""),
        patient_mobile=p.get("mobile") or p.get("phone"),
        mrd=p.get("mrd"),
        audiologist_id=a["user_id"],
        audiologist_name=a.get("name", ""),
        room=payload.room,
        service=payload.service,
        priority=payload.priority,
        start_at=start,
        end_at=end,
        duration_minutes=payload.duration_minutes,
        notes=payload.notes,
        visit_type=payload.visit_type,
        recommended_tests=payload.recommended_tests,
        referred_by=payload.referred_by,
        created_by_user_id=user["user_id"],
    )
    await db.appointments.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@router.get("/appointments", response_model=List[Appointment])
async def list_appointments(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    audiologist_id: Optional[str] = None,
    service: Optional[str] = None,
    room: Optional[str] = None,
    priority: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 500,
    user=Depends(get_current_user), db=Depends(get_db),
):
    q: dict = {"clinic_id": user["clinic_id"]}
    if from_date or to_date:
        rng: dict = {}
        if from_date:
            rng["$gte"] = f"{from_date}T00:00:00"
        if to_date:
            rng["$lte"] = f"{to_date}T23:59:59"
        q["start_at"] = rng
    if audiologist_id:
        q["audiologist_id"] = audiologist_id
    if service:
        q["service"] = service
    if room:
        q["room"] = room
    if priority:
        q["priority"] = priority
    if status:
        q["status"] = status
    rows = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.put("/appointments/{appointment_id}", response_model=Appointment)
async def update_appointment(appointment_id: str, payload: dict,
                             user=Depends(get_current_user), db=Depends(get_db)):
    """Accepts any subset of: start_at, duration_minutes, audiologist_id, service, room, priority, status, notes.
    Re-runs double-booking guard if start/duration/audiologist changes."""
    existing = await db.appointments.find_one({"appointment_id": appointment_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Appointment not found")

    update: dict = {"updated_at": datetime.utcnow()}
    impacts_schedule = any(k in payload for k in ("start_at", "duration_minutes", "audiologist_id"))

    if "start_at" in payload:
        val = payload["start_at"]
        start = datetime.fromisoformat(val) if isinstance(val, str) else val
        update["start_at"] = start
    else:
        start = (datetime.fromisoformat(existing["start_at"])
                 if isinstance(existing["start_at"], str) else existing["start_at"])

    duration = payload.get("duration_minutes", existing.get("duration_minutes", 30))
    update["duration_minutes"] = duration
    end = start + timedelta(minutes=duration)
    update["end_at"] = end

    aud_id = payload.get("audiologist_id", existing["audiologist_id"])
    if payload.get("audiologist_id"):
        a = await db.users.find_one({"user_id": aud_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Audiologist not found")
        update["audiologist_id"] = a["user_id"]
        update["audiologist_name"] = a.get("name", "")

    if impacts_schedule:
        overlap = await db.appointments.find_one(
            _overlap_query(user["clinic_id"], aud_id, start, end, exclude_id=appointment_id)
        )
        if overlap:
            raise HTTPException(status_code=409, detail={
                "message": "Time slot conflicts with an existing appointment",
                "conflict_with": {
                    "appointment_id": overlap.get("appointment_id"),
                    "patient_name": overlap.get("patient_name"),
                    "start_at": overlap.get("start_at"),
                },
            })

    for k in ("service", "room", "priority", "status", "notes",
              "visit_type", "recommended_tests", "referred_by"):
        if k in payload:
            update[k] = payload[k]

    await db.appointments.update_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(update)},
    )
    updated = await db.appointments.find_one({"appointment_id": appointment_id}, {"_id": 0})
    return deserialize_datetime(updated)


@router.post("/appointments/{appointment_id}/cancel")
async def cancel_appointment(appointment_id: str, payload: dict,
                             user=Depends(get_current_user), db=Depends(get_db)):
    existing = await db.appointments.find_one({"appointment_id": appointment_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if existing.get("status") == "cancelled":
        return {"message": "Already cancelled"}
    reason = (payload or {}).get("reason", "")
    start_at = existing.get("start_at", "")
    was_same_day = False
    try:
        was_same_day = isinstance(start_at, str) and start_at[:10] == ist_today_ymd()
    except Exception:
        pass
    await db.appointments.update_one(
        {"appointment_id": appointment_id},
        {"$set": {"status": "cancelled", "updated_at": datetime.utcnow().isoformat()}},
    )
    log = CancellationLog(
        clinic_id=user["clinic_id"],
        appointment_id=appointment_id,
        patient_id=existing["patient_id"],
        patient_name=existing["patient_name"],
        cancelled_by_user_id=user["user_id"],
        reason=reason,
        was_same_day=was_same_day,
    )
    await db.cancellation_logs.insert_one(serialize_datetime(log.model_dump()))
    return {"message": "Cancelled", "appointment_id": appointment_id}


@router.get("/appointments/slots")
async def suggest_slots(
    audiologist_id: str,
    date: str,
    duration_minutes: int = 30,
    start_hour: int = 9,
    end_hour: int = 18,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Returns 15-min-granularity free slots for an audiologist on a given date."""
    day_start = datetime.fromisoformat(f"{date}T00:00:00")
    day_end = datetime.fromisoformat(f"{date}T23:59:59")
    busy = await db.appointments.find(
        {
            "clinic_id": user["clinic_id"],
            "audiologist_id": audiologist_id,
            "status": {"$nin": ["cancelled", "no_show"]},
            "start_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()},
        },
        {"_id": 0, "start_at": 1, "end_at": 1},
    ).to_list(200)
    busy_ranges = []
    for b in busy:
        try:
            busy_ranges.append((datetime.fromisoformat(b["start_at"]), datetime.fromisoformat(b["end_at"])))
        except Exception:
            pass

    slots = []
    cur = day_start.replace(hour=start_hour, minute=0)
    dayEnd = day_start.replace(hour=end_hour, minute=0)
    step = timedelta(minutes=15)
    dur = timedelta(minutes=duration_minutes)
    while cur + dur <= dayEnd:
        slot_end = cur + dur
        conflict = any(not (slot_end <= bs or cur >= be) for (bs, be) in busy_ranges)
        if not conflict:
            slots.append({"start_at": cur.isoformat(), "end_at": slot_end.isoformat()})
        cur += step
    return {"slots": slots, "busy": [{"start_at": bs.isoformat(), "end_at": be.isoformat()} for bs, be in busy_ranges]}


# ==================== WAITLIST ====================

@router.post("/waitlist", response_model=WaitlistEntry)
async def add_to_waitlist(payload: WaitlistCreate,
                          user=Depends(get_current_user), db=Depends(get_db)):
    p = await db.patients.find_one({"patient_id": payload.patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    obj = WaitlistEntry(
        clinic_id=user["clinic_id"],
        patient_id=p["patient_id"],
        patient_name=p.get("name", ""),
        patient_mobile=p.get("mobile") or p.get("phone"),
        mrd=p.get("mrd"),
        preferred_audiologist_id=payload.preferred_audiologist_id,
        preferred_service=payload.preferred_service,
        preferred_date=payload.preferred_date,
        notes=payload.notes,
    )
    await db.waitlist.insert_one(serialize_datetime(obj.model_dump()))
    return obj


@router.get("/waitlist", response_model=List[WaitlistEntry])
async def list_waitlist(status: Optional[str] = "active", limit: int = 200,
                        user=Depends(get_current_user), db=Depends(get_db)):
    q: dict = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    rows = await db.waitlist.find(q, {"_id": 0}).sort("created_at", 1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.put("/waitlist/{entry_id}/status")
async def update_waitlist_status(entry_id: str, payload: dict,
                                 user=Depends(get_current_user), db=Depends(get_db)):
    new_status = payload.get("status")
    if new_status not in {"active", "scheduled", "cancelled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.waitlist.update_one(
        {"entry_id": entry_id, "clinic_id": user["clinic_id"]},
        {"$set": {"status": new_status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Waitlist entry not found")
    return {"message": "Updated", "entry_id": entry_id, "status": new_status}


# ==================== REMINDERS ====================

@router.post("/reminders/send")
async def send_reminder(payload: dict,
                        user=Depends(get_current_user), db=Depends(get_db)):
    """Body: {appointment_id?, patient_id, channel: 'whatsapp'|'sms'|'email'}"""
    channel = payload.get("channel")
    patient_id = payload.get("patient_id")
    appointment_id = payload.get("appointment_id")
    if channel not in {"whatsapp", "sms", "email"}:
        raise HTTPException(status_code=400, detail="Invalid channel")
    if not patient_id:
        raise HTTPException(status_code=400, detail="patient_id required")
    p = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    appt = None
    if appointment_id:
        appt = await db.appointments.find_one(
            {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
        )
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    log = await dispatch_reminder(db, channel=channel, patient=p, appointment=appt,
                                  clinic=clinic, sent_by_user_id=user["user_id"])
    return log


@router.get("/reminders")
async def list_reminders(
    appointment_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    limit: int = 50,
    user=Depends(get_current_user), db=Depends(get_db),
):
    q: dict = {"clinic_id": user["clinic_id"]}
    if appointment_id:
        q["appointment_id"] = appointment_id
    if patient_id:
        q["patient_id"] = patient_id
    rows = await db.reminder_logs.find(q, {"_id": 0}).sort("sent_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]
