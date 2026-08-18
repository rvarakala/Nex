"""Test session CRUD + PTA calculator.

NAV-005 Sprint-3A / CLIN-001 hardening notes:
- Every read/write filters by `clinic_id` explicitly (not via patient
  cross-check). This is a defence-in-depth upgrade — session_id is a
  uuid4 so cross-tenant enumeration was never practically exploitable,
  but the new pattern is uniform, cheap, and audit-friendly.
- `clinic_id` is stamped from the JWT on every insert and cannot be
  spoofed via payload (`TestSessionCreate` has no clinic_id field, and
  `TestSession.model_config = ConfigDict(extra='ignore')`).
- Legacy sessions without `clinic_id` are backfilled once at startup
  via `patients.clinic_id` (see server.py lifespan).

NAV-006 Sprint-P2C (2026-08-18):
- **F-003** — `POST /api/sessions` auto-discover branch used
  `datetime.utcnow()` to build the "today" regex prefix. During the
  00:00–05:30 IST nightly window the UTC clock is on the previous
  day, so the regex missed IST-today's scheduled appointment. Swapped
  to `ist_today_ymd()` which anchors to Asia/Kolkata (single source
  of truth already used by `diagnostics_queue.py`, `appointments.py`,
  `tokens.py`).
- **F-004-B** — `PUT /api/sessions/{id}` wrote `updated_at` via
  `datetime.utcnow()` (naive). Swapped to `datetime.now(timezone.utc)`
  (tz-aware) for consistency with every other write site in the
  codebase, eliminating the latent naive-vs-aware comparison bug.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import TestSession, TestSessionCreate, TestSessionUpdate, AudiogramData
from utils.ist import ist_today_ymd
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


@router.post("/sessions", response_model=TestSession)
async def create_test_session(session: TestSessionCreate,
                              user=Depends(get_current_user), db=Depends(get_db)):
    """Create a new test session. Tenant-scoped via authenticated user.

    If an `appointment_id` is provided (or an auto-discovered open appointment
    for this patient today exists), we copy the front-desk intake triage
    (`visit_type`, `recommended_tests`, `referred_by`) onto the session so the
    audiologist sees what was marked at reception.
    """
    p = await db.patients.find_one({"patient_id": session.patient_id, "clinic_id": user["clinic_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Try to locate an appointment for this session.
    #
    # NAV-006 F-002 (2026-08-18): fail hard when an explicit `appointment_id`
    # is supplied but not resolvable in the caller's clinic. Previously the
    # endpoint silently fell through to the auto-discover branch and linked
    # the session to a DIFFERENT appointment (or to none) — turning the
    # session's `appointment_id` into a lie. We now:
    #   • CASE B — supplied AND in this clinic → link exactly.
    #   • CASE C/D — supplied AND not-in-this-clinic (unknown or foreign) →
    #     raise 404. We do NOT distinguish between "doesn't exist" and
    #     "belongs to another clinic" so foreign existence isn't leaked.
    #   • CASE A — not supplied → keep the existing auto-discover branch,
    #     which picks the most-recent same-day appointment for this
    #     patient (IST) at this clinic.
    appt = None
    if session.appointment_id:
        appt = await db.appointments.find_one(
            {"appointment_id": session.appointment_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
        )
        if not appt:
            raise HTTPException(
                status_code=404, detail="Appointment not found in this clinic."
            )
    else:
        # NAV-006 F-003 (2026-08-18): anchor "today" to IST (Asia/Kolkata),
        # not UTC. Appointments' `start_at` is stored as an IST-wall-clock
        # ISO string; using `datetime.utcnow()` here caused the 00:00-05:30
        # IST window to filter YESTERDAY's UTC prefix and miss today's
        # IST-morning appointment (silent — session persisted without the
        # appointment context, forcing the audiologist to re-enter it).
        today_prefix = ist_today_ymd()
        appt = await db.appointments.find_one(
            {
                "clinic_id": user["clinic_id"],
                "patient_id": session.patient_id,
                "start_at": {"$regex": f"^{today_prefix}"},
                "status": {"$ne": "cancelled"},
            },
            {"_id": 0},
            sort=[("start_at", -1)],
        )

    extras: dict = {}
    if appt:
        extras["appointment_id"] = appt.get("appointment_id")
        extras["visit_type"] = appt.get("visit_type") or "walkin"
        extras["recommended_tests"] = appt.get("recommended_tests") or []
        extras["referred_by"] = appt.get("referred_by")

    payload = session.model_dump(exclude={"appointment_id"})
    # CLIN-001: stamp clinic_id on the model itself (source of truth).
    session_obj = TestSession(**payload, **extras, clinic_id=user["clinic_id"])
    doc = serialize_datetime(session_obj.model_dump())
    await db.test_sessions.insert_one(doc)
    return session_obj


@router.get("/sessions", response_model=List[TestSession])
async def get_test_sessions(patient_id: Optional[str] = None, limit: int = 100,
                            user=Depends(get_current_user), db=Depends(get_db)):
    """List sessions. Always clinic-scoped. No legacy fallback — the
    startup backfill (see server.py) stamps `clinic_id` on every
    pre-tenant row, so a missing clinic_id here means the row does not
    belong to this tenant."""
    query: dict = {"clinic_id": user["clinic_id"]}
    if patient_id:
        query["patient_id"] = patient_id
    sessions = await db.test_sessions.find(query, {"_id": 0}).sort("test_date", -1).to_list(limit)
    return [deserialize_datetime(s) for s in sessions]


@router.get("/sessions/{session_id}", response_model=TestSession)
async def get_test_session(session_id: str,
                           user=Depends(get_current_user), db=Depends(get_db)):
    # CLIN-001: direct clinic_id filter. No patient-cross-check fallback.
    s = await db.test_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not s:
        raise HTTPException(status_code=404, detail="Test session not found")
    return deserialize_datetime(s)


@router.put("/sessions/{session_id}", response_model=TestSession)
async def update_test_session(session_id: str, session_update: TestSessionUpdate,
                              user=Depends(get_current_user), db=Depends(get_db)):
    # CLIN-001: direct clinic_id filter on existence check AND the write.
    s = await db.test_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
    )
    if not s:
        raise HTTPException(status_code=404, detail="Test session not found")
    update_data = {k: v for k, v in session_update.model_dump().items() if v is not None}
    # NAV-006 F-004-B (2026-08-18): use tz-aware UTC to match every other
    # write site in the codebase (queue/start, report_handover, hearing
    # report versions). Naive `datetime.utcnow()` mixed with aware writes
    # elsewhere raised `TypeError: can't compare offset-naive and offset-
    # aware datetimes` in any downstream code that sorts/compares across
    # sources. Serialiser stamps `+00:00` on the wire either way, so no
    # response-contract change.
    update_data["updated_at"] = datetime.now(timezone.utc)
    await db.test_sessions.update_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(update_data)},
    )
    updated = await db.test_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    return deserialize_datetime(updated)


@router.delete("/sessions/{session_id}")
async def delete_test_session(session_id: str,
                              user=Depends(get_current_user), db=Depends(get_db)):
    # CLIN-001: direct clinic_id filter.
    res = await db.test_sessions.delete_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
    )
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Test session not found")
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
