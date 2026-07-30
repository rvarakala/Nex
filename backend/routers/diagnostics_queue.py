"""Diagnostics queue orchestrator.

Surfaces a unified "who's ready to be tested?" view for the audiologist.
Merges three sources of truth into one board:

    * `tokens`        — walk-in queue tokens (status=waiting|in_consultation|in_testing).
    * `appointments`  — scheduled visits for today (status=checked_in|in_progress|completed).
    * `test_sessions` — draft sessions already underway (auto-saved but not yet
      marked completed/finalized) + completions from today.

A single patient may appear in more than one source (walked in AND had an
appointment, or both a queue token + a draft session). We de-duplicate by
`patient_id` and keep the most-advanced state per patient.  Advancement
order:  waiting < checked_in < in_progress < completed.

Endpoints:

    GET  /api/diagnostics/queue              → 4-column board
    POST /api/diagnostics/queue/start        → one-click: create/find session,
                                                flip queue-token & appointment
                                                state, return session_id
    POST /api/diagnostics/queue/complete     → called by the audiologist when
                                                a session is truly done — flips
                                                the related token + appointment.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database import get_db
from models import TestSession
from utils.ist import ist_day_start_utc, ist_today_ymd
from utils.serde import serialize_datetime, deserialize_datetime

router = APIRouter(prefix="/api/diagnostics")


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

STATE_RANK = {"waiting": 0, "checked_in": 1, "in_progress": 2, "completed": 3}


def _priority_rank(p: Optional[str]) -> int:
    """`urgent` > `vip` > `normal` — so urgent rows sort to the top per column."""
    return {"urgent": 0, "vip": 1, "normal": 2}.get(p or "normal", 2)


def _ymd_ist() -> str:
    return ist_today_ymd()


# --------------------------------------------------------------------------
# Board query
# --------------------------------------------------------------------------

@router.get("/queue")
async def diagnostics_queue(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Unified diagnostics board for the audiologist."""
    clinic_id = user["clinic_id"]
    day_key = _ymd_ist()
    today_start_iso = ist_day_start_utc().isoformat()

    # ------ Pull all three sources in parallel-ish (motor = event-loop) ------
    tokens = await db.tokens.find(
        {
            "clinic_id": clinic_id,
            "issued_at": {"$gte": today_start_iso},
            "status": {"$in": ["waiting", "in_consultation", "in_testing", "completed"]},
        },
        {"_id": 0},
    ).to_list(500)

    appts = await db.appointments.find(
        {
            "clinic_id": clinic_id,
            "start_at": {"$gte": f"{day_key}T00:00:00", "$lte": f"{day_key}T23:59:59"},
            "status": {"$in": ["scheduled", "confirmed", "checked_in", "in_progress", "completed"]},
        },
        {"_id": 0},
    ).to_list(500)

    draft_sessions = await db.test_sessions.find(
        {
            "clinic_id": clinic_id,
            "status": "draft",
            "created_at": {"$gte": today_start_iso},
        },
        {"_id": 0},
    ).to_list(500)

    completed_sessions = await db.test_sessions.find(
        {
            "clinic_id": clinic_id,
            "status": {"$in": ["completed", "finalized"]},
            "updated_at": {"$gte": today_start_iso},
        },
        {"_id": 0},
    ).to_list(500)

    # ------ Hydrate patient metadata once (bulk find) ------
    pids = set()
    for t in tokens:
        pids.add(t.get("patient_id"))
    for a in appts:
        pids.add(a.get("patient_id"))
    for s in draft_sessions:
        pids.add(s.get("patient_id"))
    for s in completed_sessions:
        pids.add(s.get("patient_id"))
    pids.discard(None)
    patient_map: dict[str, dict] = {}
    if pids:
        async for p in db.patients.find(
            {"patient_id": {"$in": list(pids)}, "clinic_id": clinic_id},
            {"_id": 0, "patient_id": 1, "name": 1, "age": 1, "gender": 1, "mobile": 1, "mrd": 1},
        ):
            patient_map[p["patient_id"]] = p

    # ------ Normalise every row to a common shape ------
    # bucket keyed by patient_id; we keep the *most advanced* entry per patient.
    by_patient: dict[str, dict] = {}

    def _upsert(entry: dict):
        pid = entry["patient_id"]
        existing = by_patient.get(pid)
        if not existing or STATE_RANK[entry["state"]] > STATE_RANK[existing["state"]]:
            by_patient[pid] = entry
        # If the two entries are SAME state, keep the one with the earlier
        # arrival time (FIFO) but merge source ids so the frontend can call
        # /start with the correct token+appointment pair.
        elif STATE_RANK[entry["state"]] == STATE_RANK[existing["state"]]:
            if entry.get("arrived_at", "") < existing.get("arrived_at", "zzz"):
                existing["arrived_at"] = entry["arrived_at"]
            for k in ("token_id", "appointment_id", "session_id"):
                if entry.get(k) and not existing.get(k):
                    existing[k] = entry[k]

    # ---- queue tokens ----
    token_state = {
        "waiting": "waiting",
        "in_consultation": "in_progress",  # already being handled
        "in_testing": "in_progress",
        "completed": "completed",
    }
    for t in tokens:
        pid = t.get("patient_id")
        if not pid:
            continue
        p = patient_map.get(pid, {})
        state = token_state.get(t.get("status"), "waiting")
        _upsert({
            "patient_id": pid,
            "name": p.get("name") or t.get("patient_name"),
            "mrd": p.get("mrd") or t.get("mrd"),
            "age": p.get("age"),
            "gender": p.get("gender"),
            "mobile": p.get("mobile") or t.get("patient_mobile"),
            "state": state,
            "source": "token",
            "token_id": t.get("token_id"),
            "token_no": t.get("token_no"),
            "appointment_id": None,
            "session_id": None,
            "priority": t.get("priority") or "normal",
            "service": t.get("service"),
            "arrived_at": t.get("issued_at"),
        })

    # ---- appointments ----
    # Map every relevant appointment status to a queue column so today's
    # whole roster is visible to the audiologist:
    #   • "scheduled" / "confirmed"  → WAITING   (booked but not yet here)
    #   • "checked_in"               → CHECKED IN (FD has marked arrival)
    #   • "in_progress"              → IN PROGRESS
    #   • "completed"                → COMPLETED
    appt_state = {
        "scheduled":   "waiting",
        "confirmed":   "waiting",
        "checked_in":  "checked_in",
        "in_progress": "in_progress",
        "completed":   "completed",
    }
    for a in appts:
        if a.get("status") not in appt_state:
            continue
        pid = a.get("patient_id")
        if not pid:
            continue
        p = patient_map.get(pid, {})
        _upsert({
            "patient_id": pid,
            "name": p.get("name") or a.get("patient_name"),
            "mrd": p.get("mrd"),
            "age": p.get("age"),
            "gender": p.get("gender"),
            "mobile": p.get("mobile"),
            "state": appt_state[a["status"]],
            "source": "appointment",
            "token_id": None,
            "appointment_id": a.get("appointment_id"),
            "session_id": None,
            "priority": a.get("priority") or "normal",
            "service": a.get("service"),
            "arrived_at": a.get("check_in_at") or a.get("start_at"),
            "start_at": a.get("start_at"),
            # Kanban chips: which diagnostic tests the audiologist should run
            # + whether this is a first-visit vs a repeat/follow-up.
            "recommended_tests": a.get("recommended_tests") or [],
            "visit_type": a.get("visit_type"),
        })

    # ---- draft sessions (always in_progress) ----
    for s in draft_sessions:
        pid = s.get("patient_id")
        if not pid:
            continue
        p = patient_map.get(pid, {})
        _upsert({
            "patient_id": pid,
            "name": p.get("name"),
            "mrd": p.get("mrd"),
            "age": p.get("age"),
            "gender": p.get("gender"),
            "mobile": p.get("mobile"),
            "state": "in_progress",
            "source": "session",
            "token_id": None,
            "appointment_id": s.get("appointment_id"),
            "session_id": s.get("session_id"),
            "priority": "normal",
            "service": None,
            "arrived_at": s.get("created_at"),
            "recommended_tests": s.get("recommended_tests") or [],
            "visit_type": s.get("visit_type"),
        })

    # ---- completed sessions today ----
    for s in completed_sessions:
        pid = s.get("patient_id")
        if not pid:
            continue
        p = patient_map.get(pid, {})
        _upsert({
            "patient_id": pid,
            "name": p.get("name"),
            "mrd": p.get("mrd"),
            "age": p.get("age"),
            "gender": p.get("gender"),
            "mobile": p.get("mobile"),
            "state": "completed",
            "source": "session",
            "token_id": None,
            "appointment_id": s.get("appointment_id"),
            "session_id": s.get("session_id"),
            "priority": "normal",
            "service": None,
            "arrived_at": s.get("updated_at") or s.get("created_at"),
            "recommended_tests": s.get("recommended_tests") or [],
            "visit_type": s.get("visit_type"),
        })

    # ------ Split into 4 columns, sort within each ------
    def _sort_key(row):
        return (_priority_rank(row.get("priority")), row.get("arrived_at") or "")

    columns = {"waiting": [], "checked_in": [], "in_progress": [], "completed": []}
    for row in by_patient.values():
        columns[row["state"]].append(row)
    for k in columns:
        columns[k].sort(key=_sort_key)

    return {
        "counts": {k: len(v) for k, v in columns.items()},
        "columns": {k: [deserialize_datetime(r) for r in v] for k, v in columns.items()},
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------
# One-click start
# --------------------------------------------------------------------------

class StartIn(BaseModel):
    """Accepts any subset of identifiers — we figure out the rest."""
    patient_id: str
    token_id: Optional[str] = None
    appointment_id: Optional[str] = None
    session_id: Optional[str] = None


@router.post("/queue/start")
async def start_diagnostics(
    payload: StartIn,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Audiologist clicked a patient card. Transition them to IN_PROGRESS
    and return a session the frontend can navigate to.

    Idempotent — clicking twice in quick succession never creates duplicate
    sessions; we re-use any draft session this patient already has for
    today.
    """
    clinic_id = user["clinic_id"]
    patient_id = payload.patient_id

    patient = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if not patient:
        raise HTTPException(404, detail="Patient not found")

    # --- Find an existing draft session for this patient today (idempotency) ---
    today_start_iso = ist_day_start_utc().isoformat()
    session = None
    if payload.session_id:
        session = await db.test_sessions.find_one(
            {"session_id": payload.session_id, "clinic_id": clinic_id}, {"_id": 0},
        )
    if not session:
        session = await db.test_sessions.find_one(
            {
                "clinic_id": clinic_id,
                "patient_id": patient_id,
                "status": "draft",
                "created_at": {"$gte": today_start_iso},
            },
            {"_id": 0},
            sort=[("created_at", -1)],
        )

    # --- Resolve / capture a matching appointment ---
    appt = None
    day_key = _ymd_ist()
    if payload.appointment_id:
        appt = await db.appointments.find_one(
            {"appointment_id": payload.appointment_id, "clinic_id": clinic_id}, {"_id": 0},
        )
    if not appt:
        appt = await db.appointments.find_one(
            {
                "clinic_id": clinic_id,
                "patient_id": patient_id,
                "start_at": {"$gte": f"{day_key}T00:00:00", "$lte": f"{day_key}T23:59:59"},
                "status": {"$nin": ["cancelled", "no_show"]},
            },
            {"_id": 0},
            sort=[("start_at", -1)],
        )

    # --- Create session if still missing ---
    if not session:
        sess = TestSession(
            clinic_id=clinic_id,
            patient_id=patient_id,
            appointment_id=(appt or {}).get("appointment_id"),
            visit_type=(appt or {}).get("visit_type") or "walkin",
            recommended_tests=(appt or {}).get("recommended_tests") or [],
            referred_by=(appt or {}).get("referred_by"),
        )
        doc = serialize_datetime(sess.model_dump())
        doc["clinic_id"] = clinic_id
        await db.test_sessions.insert_one(doc)
        doc.pop("_id", None)
        session = doc

    # --- Token transition: any active token for this patient → in_testing ---
    token = None
    if payload.token_id:
        token = await db.tokens.find_one(
            {"token_id": payload.token_id, "clinic_id": clinic_id}, {"_id": 0},
        )
    if not token:
        token = await db.tokens.find_one(
            {
                "clinic_id": clinic_id,
                "patient_id": patient_id,
                "issued_at": {"$gte": today_start_iso},
                "status": {"$in": ["waiting", "in_consultation"]},
            },
            {"_id": 0},
            sort=[("issued_at", -1)],
        )
    if token:
        await db.tokens.update_one(
            {"token_id": token["token_id"]},
            {
                "$set": {
                    "status": "in_testing",
                    "called_at": token.get("called_at") or datetime.now(timezone.utc).isoformat(),
                }
            },
        )

    # --- Appointment transition: checked_in/confirmed → in_progress ---
    if appt and appt.get("status") in {"scheduled", "confirmed", "checked_in"}:
        await db.appointments.update_one(
            {"appointment_id": appt["appointment_id"]},
            {"$set": {"status": "in_progress"}},
        )

    return {
        "session_id": session["session_id"],
        "patient": {
            "patient_id": patient["patient_id"],
            "name": patient.get("name"),
            "age": patient.get("age"),
            "gender": patient.get("gender"),
            "mrd": patient.get("mrd"),
            "mobile": patient.get("mobile"),
        },
        "token_id": (token or {}).get("token_id"),
        "appointment_id": (appt or {}).get("appointment_id"),
    }


# --------------------------------------------------------------------------
# One-click complete
# --------------------------------------------------------------------------

class CompleteIn(BaseModel):
    session_id: str


@router.post("/queue/complete")
async def complete_diagnostics(
    payload: CompleteIn,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Audiologist marked a session completed from the board.

    Flips the session to completed + closes the linked token and appointment
    in one atomic-ish call. Idempotent: calling on an already-completed
    session is a no-op.
    """
    clinic_id = user["clinic_id"]
    s = await db.test_sessions.find_one(
        {"session_id": payload.session_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if not s:
        raise HTTPException(404, detail="Session not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.test_sessions.update_one(
        {"session_id": payload.session_id},
        {"$set": {"status": "completed", "updated_at": now_iso}},
    )

    # Close the appointment if one is linked.
    if s.get("appointment_id"):
        await db.appointments.update_one(
            {"appointment_id": s["appointment_id"], "clinic_id": clinic_id},
            {"$set": {"status": "completed"}},
        )

    # Close the matching in-testing token if one exists for this patient today.
    today_start_iso = ist_day_start_utc().isoformat()
    await db.tokens.update_one(
        {
            "clinic_id": clinic_id,
            "patient_id": s["patient_id"],
            "issued_at": {"$gte": today_start_iso},
            "status": {"$in": ["waiting", "in_consultation", "in_testing"]},
        },
        {"$set": {"status": "completed", "completed_at": now_iso}},
    )

    return {"ok": True, "session_id": payload.session_id}


# --------------------------------------------------------------------------
# One-tap "→ Next stage" — waiting → checked_in
#
# The Kanban Board's `→ Next stage` chip on a waiting card calls this endpoint
# so the front-desk can move the patient into the "Checked In" column without
# starting the diagnostic session (that only happens when the audiologist is
# ready). Idempotent — re-calling on a checked-in card is a no-op.
# --------------------------------------------------------------------------

class CheckinIn(BaseModel):
    """Accept any one of the identifiers — we look up whichever is present."""
    patient_id: str
    token_id: Optional[str] = None
    appointment_id: Optional[str] = None


@router.post("/queue/checkin")
async def checkin_diagnostics(
    payload: CheckinIn,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Front-desk marked the patient as arrived.

    Flips the linked appointment/token from waiting/scheduled → checked_in.
    Returns which artefacts were updated so the UI can decide whether to
    refresh the queue.
    """
    clinic_id = user["clinic_id"]
    today_start_iso = ist_day_start_utc().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    updates = {"appointment": False, "token": False}

    # Update the appointment first — its status is what drives the Kanban.
    # We ONLY promote from scheduled/confirmed → checked_in. Never demote
    # an in-progress or completed row back to checked_in.
    ADVANCEABLE_APPT = {"scheduled", "confirmed"}
    appt = None
    if payload.appointment_id:
        appt = await db.appointments.find_one(
            {"appointment_id": payload.appointment_id, "clinic_id": clinic_id}, {"_id": 0},
        )
    if not appt:
        day_key = _ymd_ist()
        appt = await db.appointments.find_one(
            {
                "clinic_id": clinic_id,
                "patient_id": payload.patient_id,
                "start_at": {"$gte": f"{day_key}T00:00:00", "$lte": f"{day_key}T23:59:59"},
                "status": {"$in": list(ADVANCEABLE_APPT)},
            },
            {"_id": 0},
            sort=[("start_at", 1)],
        )
    if appt and appt.get("status") in ADVANCEABLE_APPT:
        await db.appointments.update_one(
            {"appointment_id": appt["appointment_id"], "clinic_id": clinic_id},
            {"$set": {"status": "checked_in", "check_in_at": now_iso}},
        )
        updates["appointment"] = True

    # Also close the "waiting" token — moves it to "in_consultation" so the
    # queue-board's token pane matches the appointment status. Same
    # promote-only guard as the appointment above.
    ADVANCEABLE_TOKEN = {"waiting"}
    tok = None
    if payload.token_id:
        tok = await db.tokens.find_one(
            {"token_id": payload.token_id, "clinic_id": clinic_id}, {"_id": 0},
        )
    if not tok:
        tok = await db.tokens.find_one(
            {
                "clinic_id": clinic_id,
                "patient_id": payload.patient_id,
                "issued_at": {"$gte": today_start_iso},
                "status": {"$in": list(ADVANCEABLE_TOKEN)},
            },
            {"_id": 0},
            sort=[("issued_at", -1)],
        )
    if tok and tok.get("status") in ADVANCEABLE_TOKEN:
        await db.tokens.update_one(
            {"token_id": tok["token_id"]},
            {"$set": {"status": "in_consultation", "called_at": now_iso}},
        )
        updates["token"] = True

    if not any(updates.values()):
        # Nothing to update — patient likely already checked in.
        return {"ok": True, "updates": updates, "already_checked_in": True}

    return {"ok": True, "updates": updates}
