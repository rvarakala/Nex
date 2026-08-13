"""Appointments, waitlist, and reminders."""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from database import get_db
from models import (
    Appointment, AppointmentCreate,
    WaitlistEntry, WaitlistCreate,
    CancellationLog,
    APPOINTMENT_SERVICES,
    APPOINTMENT_CATEGORIES,
    COUNTERPARTY_TYPES,
    color_for_staff,
)
from reminders import dispatch_reminder
from utils.ist import ist_today_ymd
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


# Roles that can see / book on behalf of every staff member in the clinic.
_FULL_VIEW_ROLES = {"super_admin", "clinic_owner", "front_desk", "accounts"}


async def _peer_visibility_enabled(db, clinic_id: str) -> bool:
    """Read clinic-level toggle that lets audiologists see peers' calendars."""
    c = await db.clinics.find_one(
        {"clinic_id": clinic_id}, {"_id": 0, "appointment_peer_visibility": 1}
    ) or {}
    return bool(c.get("appointment_peer_visibility"))


async def _apply_rbac_filter(q: dict, user, db) -> dict:
    """Mutates `q` in place to restrict by role. Returns the same dict for chaining.

    - clinic_owner / front_desk / accounts / super_admin: see every appointment.
    - audiologist: only their own slots, unless the clinic enables peer-visibility
      (in which case they see all but the UI must still gate write ops).
    - technician / inventory_manager: only slots they own (typically vendor/internal).

    Uses `$and` to combine with any pre-existing `$or` (e.g. caller's staff_ids
    filter) so neither side is overwritten.
    """
    role = user.get("role")
    if role in _FULL_VIEW_ROLES:
        return q
    if role == "audiologist" and await _peer_visibility_enabled(db, user["clinic_id"]):
        return q
    rbac_or = [
        {"staff_id": user["user_id"]},
        {"audiologist_id": user["user_id"]},
    ]
    if "$or" in q:
        existing_or = q.pop("$or")
        q.setdefault("$and", []).extend([
            {"$or": existing_or},
            {"$or": rbac_or},
        ])
    else:
        q["$or"] = rbac_or
    return q




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
    return {
        "services": APPOINTMENT_SERVICES,
        "categories": APPOINTMENT_CATEGORIES,
        "counterparty_types": COUNTERPARTY_TYPES,
    }


# ------------------------------------------------------------------------
# STAFF RESOURCES — drives the "Doctors" rail in the calendar UI.
# Returns every active user that can be the *owner* of an appointment, with
# their auto-assigned colour (or override if set). Front-desk + clinic-owner
# get every staff member; audiologists see themselves (plus peers if peer-
# visibility is enabled at clinic level).
# ------------------------------------------------------------------------
_STAFF_ROLES = ["audiologist", "clinic_owner", "front_desk", "technician"]


@router.get("/appointments/staff-resources")
async def list_staff_resources(user=Depends(get_current_user), db=Depends(get_db)):
    role = user.get("role")
    base_q: dict = {
        "clinic_id": user["clinic_id"],
        "active": True,
        "role": {"$in": _STAFF_ROLES},
    }
    rows = await db.users.find(
        base_q,
        {"_id": 0, "user_id": 1, "name": 1, "role": 1, "appointment_color": 1, "avatar_url": 1},
    ).sort("name", 1).to_list(200)

    visible_to_self_only = (
        role not in _FULL_VIEW_ROLES
        and not await _peer_visibility_enabled(db, user["clinic_id"])
    )
    if visible_to_self_only:
        rows = [r for r in rows if r["user_id"] == user["user_id"]]

    out = []
    for r in rows:
        out.append({
            "user_id": r["user_id"],
            "name": r.get("name", ""),
            "role": r.get("role"),
            "color": r.get("appointment_color") or color_for_staff(r["user_id"]),
            "color_overridden": bool(r.get("appointment_color")),
            "avatar_url": r.get("avatar_url"),
        })
    return {"staff": out, "can_edit_colors": role in {"clinic_owner", "super_admin"}}


@router.patch("/appointments/staff-resources/{staff_id}/color")
async def set_staff_color(staff_id: str, payload: dict,
                          user=Depends(get_current_user), db=Depends(get_db)):
    """Clinic-owner-only: override the auto-assigned calendar colour for a staff member.
    Pass `{"color": "#3B82F6"}` to set, or `{"color": null}` to revert to auto.
    """
    if user.get("role") not in {"clinic_owner", "super_admin"}:
        raise HTTPException(status_code=403, detail="Only clinic owners can change staff colours")
    color = payload.get("color")
    if color is not None:
        if not isinstance(color, str) or not color.startswith("#") or len(color) not in (4, 7):
            raise HTTPException(status_code=400, detail="Color must be a hex string like '#3B82F6'")
    res = await db.users.update_one(
        {"user_id": staff_id, "clinic_id": user["clinic_id"]},
        {"$set": {"appointment_color": color}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return {
        "user_id": staff_id,
        "color": color or color_for_staff(staff_id),
        "color_overridden": color is not None,
    }


# ------------------------------------------------------------------------
# COUNTERPARTIES — autocomplete source for the booking modal.
# `type=patient`  → not handled here (use existing /api/patients search).
# `type=vendor`   → vendors collection.
# `type=tech_staff` → users with role technician (this clinic).
# `type=sales_rep|internal|other` → free-text only; returns [].
# ------------------------------------------------------------------------
@router.get("/appointments/counterparties")
async def list_counterparties(
    type: str = Query(..., description="vendor | tech_staff | sales_rep | internal | other"),
    q: Optional[str] = None,
    limit: int = 25,
    user=Depends(get_current_user), db=Depends(get_db),
):
    if type not in COUNTERPARTY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid counterparty type")

    if type == "vendor":
        filt: dict = {"clinic_id": user["clinic_id"]}
        if q:
            filt["name"] = {"$regex": q, "$options": "i"}
        rows = await db.vendors.find(
            filt, {"_id": 0, "vendor_id": 1, "name": 1, "phone": 1, "contact_person": 1},
        ).sort("name", 1).to_list(limit)
        return [{
            "id": r["vendor_id"], "name": r.get("name", ""),
            "phone": r.get("phone"), "company": r.get("name"),
            "subtitle": r.get("contact_person") or "",
        } for r in rows]

    if type == "tech_staff":
        filt = {"clinic_id": user["clinic_id"], "role": "technician", "active": True}
        if q:
            filt["name"] = {"$regex": q, "$options": "i"}
        rows = await db.users.find(
            filt, {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        ).sort("name", 1).to_list(limit)
        return [{
            "id": r["user_id"], "name": r.get("name", ""),
            "phone": None, "company": None,
            "subtitle": r.get("email", ""),
        } for r in rows]

    # Free-text-only types — UI handles input directly.
    return []


def _overlap_query(clinic_id: str, staff_id: str, start: datetime, end: datetime,
                   exclude_id: Optional[str] = None) -> dict:
    """Double-booking guard. Matches both the legacy `audiologist_id` field and
    the new `staff_id` field so a single staff resource can never own two
    overlapping non-terminal appointments — regardless of which field stores
    the resource id on a given row.
    """
    q: dict = {
        "clinic_id": clinic_id,
        "$or": [
            {"staff_id": staff_id},
            {"audiologist_id": staff_id},
        ],
        "status": {"$nin": ["cancelled", "no_show", "completed"]},
        "start_at": {"$lt": end.isoformat()},
        "end_at":   {"$gt": start.isoformat()},
    }
    if exclude_id:
        q["appointment_id"] = {"$ne": exclude_id}
    return q


def _reject_past_start(start: datetime, *, allow_grace_minutes: int = 2) -> None:
    """Raise 400 if the requested appointment start time is in the past.

    We compare in the clinic's local timezone (IST) because slot datetimes
    are stored as naive wall-clock strings. A tiny grace window
    (default 2 minutes) covers clock drift + the user-typing-then-clicking
    latency — front desk can still submit a booking for the current slot
    even if the clock ticked over between typing "10:00" and hitting Book.

    The frontend's `min` attribute already guards against picking a
    yesterday-or-earlier date; this backend check is the defence-in-depth
    for any bypass (API scripts, stale forms, timezone tricks).
    """
    from routers.schedules import now_clinic_naive, IST  # local to avoid circular import
    # If the client sent an offset-aware datetime, project it into the
    # clinic's local wall-clock so we compare apples to apples. Otherwise
    # treat the value as already-IST-wall-clock (which is what the modal
    # sends via `${date}T${time}:00`).
    if start.tzinfo is not None:
        start_local = start.astimezone(IST).replace(tzinfo=None)
    else:
        start_local = start
    now_wall = now_clinic_naive()
    if start_local < now_wall - timedelta(minutes=allow_grace_minutes):
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Cannot book an appointment for a time that has already passed",
                "attempted_start": start_local.isoformat(),
                "now": now_wall.isoformat(),
            },
        )


async def _resolve_staff(db, clinic_id: str, staff_id: str) -> dict:
    """Look up the staff resource by user_id within the clinic. Raises 404 otherwise."""
    u = await db.users.find_one(
        {"user_id": staff_id, "clinic_id": clinic_id},
        {"_id": 0, "user_id": 1, "name": 1, "role": 1, "appointment_color": 1, "active": 1},
    )
    if not u or u.get("active") is False:
        raise HTTPException(status_code=404, detail="Staff resource not found")
    return u


async def _resolve_counterparty(db, clinic_id: str, payload: AppointmentCreate) -> dict:
    """Returns a normalised counterparty record:
    {patient_id, patient_name, patient_mobile, mrd,
     counterparty_type, counterparty_id, counterparty_name,
     counterparty_phone, counterparty_company}
    Backward-compat: when `patient_id` is supplied, it always wins and the type
    is forced to 'patient'.
    """
    # --- Legacy / patient path ---------------------------------------------------
    if payload.patient_id:
        p = await db.patients.find_one(
            {"patient_id": payload.patient_id, "clinic_id": clinic_id}, {"_id": 0}
        )
        if not p:
            raise HTTPException(status_code=404, detail="Patient not found")
        mob = p.get("mobile") or p.get("phone")
        return {
            "patient_id": p["patient_id"],
            "patient_name": p.get("name", ""),
            "patient_mobile": mob,
            "mrd": p.get("mrd"),
            "counterparty_type": "patient",
            "counterparty_id": p["patient_id"],
            "counterparty_name": p.get("name", ""),
            "counterparty_phone": mob,
            "counterparty_company": None,
        }

    # --- Non-patient path --------------------------------------------------------
    ctype = payload.counterparty_type or "patient"
    if ctype == "patient":
        raise HTTPException(status_code=400, detail="patient_id is required for patient appointments")

    name = (payload.counterparty_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="counterparty_name is required")

    phone = payload.counterparty_phone
    company = payload.counterparty_company
    cid = payload.counterparty_id

    # Enrich vendor/tech_staff lookups (best effort — free-text fallbacks if id not found).
    if ctype == "vendor" and cid:
        v = await db.vendors.find_one(
            {"vendor_id": cid, "clinic_id": clinic_id},
            {"_id": 0, "vendor_id": 1, "name": 1, "phone": 1},
        )
        if v:
            name = name or v.get("name", "")
            phone = phone or v.get("phone")
            company = company or v.get("name")
    elif ctype == "tech_staff" and cid:
        u = await db.users.find_one(
            {"user_id": cid, "clinic_id": clinic_id, "role": "technician"},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        )
        if u:
            name = name or u.get("name", "")

    return {
        "patient_id": None,
        "patient_name": None,
        "patient_mobile": None,
        "mrd": None,
        "counterparty_type": ctype,
        "counterparty_id": cid,
        "counterparty_name": name,
        "counterparty_phone": phone,
        "counterparty_company": company,
    }


@router.post("/appointments", response_model=Appointment)
async def create_appointment(payload: AppointmentCreate,
                             user=Depends(get_current_user), db=Depends(get_db)):
    clinic_id = user["clinic_id"]

    # 1. Resolve staff (resource owner). Accept either field; prefer staff_id.
    staff_id = payload.staff_id or payload.audiologist_id
    if not staff_id:
        raise HTTPException(status_code=400, detail="staff_id (or audiologist_id) is required")
    staff = await _resolve_staff(db, clinic_id, staff_id)

    # 2. RBAC: audiologists can only book on their own calendar.
    if user.get("role") == "audiologist" and staff_id != user["user_id"]:
        raise HTTPException(status_code=403, detail="Audiologists can only book on their own calendar")

    # 3. Resolve counterparty (patient | vendor | sales_rep | tech_staff | internal | other).
    cp = await _resolve_counterparty(db, clinic_id, payload)

    # 4. Default service: pick a reasonable one if missing (non-patient appointments
    #    typically don't need a clinical service code).
    service = payload.service or ("Consultation" if cp["counterparty_type"] == "patient" else "Meeting")

    # 5. Time math + past-time guard + double-booking guard.
    start = payload.start_at
    end = start + timedelta(minutes=payload.duration_minutes)
    _reject_past_start(start)
    overlap = await db.appointments.find_one(_overlap_query(clinic_id, staff_id, start, end))
    if overlap:
        raise HTTPException(status_code=409, detail={
            "message": "Time slot conflicts with an existing appointment",
            "conflict_with": {
                "appointment_id": overlap.get("appointment_id"),
                "patient_name": overlap.get("patient_name") or overlap.get("counterparty_name"),
                "start_at": overlap.get("start_at"),
                "end_at": overlap.get("end_at"),
            },
        })

    obj = Appointment(
        clinic_id=clinic_id,
        # Counterparty
        patient_id=cp["patient_id"],
        patient_name=cp["patient_name"],
        patient_mobile=cp["patient_mobile"],
        mrd=cp["mrd"],
        counterparty_type=cp["counterparty_type"],
        counterparty_id=cp["counterparty_id"],
        counterparty_name=cp["counterparty_name"],
        counterparty_phone=cp["counterparty_phone"],
        counterparty_company=cp["counterparty_company"],
        # Resource (mirror to legacy fields too)
        staff_id=staff["user_id"],
        staff_name=staff.get("name", ""),
        staff_role=staff.get("role"),
        staff_color=staff.get("appointment_color") or color_for_staff(staff["user_id"]),
        audiologist_id=staff["user_id"],
        audiologist_name=staff.get("name", ""),
        # Slot details
        room=payload.room,
        service=service,
        category=payload.category,
        priority=payload.priority,
        start_at=start,
        end_at=end,
        duration_minutes=payload.duration_minutes,
        notes=payload.notes,
        visit_type=payload.visit_type,
        recommended_tests=payload.recommended_tests,
        referred_by=payload.referred_by,
        hearing_aid_services=payload.hearing_aid_services,
        wing=payload.wing,
        created_by_user_id=user["user_id"],
    )
    await db.appointments.insert_one(serialize_datetime(obj.model_dump()))

    # Auto-link the patient to the referring doctor when the picker was used
    # for a `referral` visit type. Idempotent — only writes if the patient's
    # current doctor_id doesn't already match, so we never overwrite a manual
    # correction the front desk made earlier.
    if payload.visit_type == "referral" and payload.referring_doctor_id and payload.counterparty_type == "patient" and payload.counterparty_id:
        try:
            await db.patients.update_one(
                {"clinic_id": user["clinic_id"],
                 "patient_id": payload.counterparty_id,
                 "$or": [{"referring_doctor_id": None},
                         {"referring_doctor_id": {"$exists": False}},
                         {"referring_doctor_id": ""}]},
                {"$set": {"referring_doctor_id": payload.referring_doctor_id,
                          "referral_source": "Doctor"}},
            )
        except Exception:  # noqa: BLE001 — never let a link-up crash booking
            pass

    return obj


@router.get("/appointments", response_model=List[Appointment])
async def list_appointments(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    audiologist_id: Optional[str] = None,
    staff_id: Optional[str] = None,
    staff_ids: Optional[str] = Query(None, description="Comma-separated list of staff user_ids to filter by"),
    counterparty_type: Optional[str] = None,
    category: Optional[str] = None,
    service: Optional[str] = None,
    room: Optional[str] = None,
    priority: Optional[str] = None,
    status: Optional[str] = None,
    patient_id: Optional[str] = Query(
        None,
        description="Filter to a single patient. Used by the Patient Profile "
                    "History tab — without this every imported visit in the "
                    "clinic would flood every patient timeline.",
    ),
    limit: int = 500,
    user=Depends(get_current_user), db=Depends(get_db),
):
    q: dict = {"clinic_id": user["clinic_id"]}
    if patient_id:
        q["patient_id"] = patient_id
    if from_date or to_date:
        rng: dict = {}
        if from_date:
            rng["$gte"] = f"{from_date}T00:00:00"
        if to_date:
            rng["$lte"] = f"{to_date}T23:59:59"
        q["start_at"] = rng

    # Staff/audiologist filters — match either legacy or new field.
    chosen_staff: List[str] = []
    if staff_id:
        chosen_staff.append(staff_id)
    if audiologist_id:
        chosen_staff.append(audiologist_id)
    if staff_ids:
        chosen_staff.extend([s.strip() for s in staff_ids.split(",") if s.strip()])
    chosen_staff = list({s for s in chosen_staff if s})
    if chosen_staff:
        q["$or"] = [
            {"staff_id": {"$in": chosen_staff}},
            {"audiologist_id": {"$in": chosen_staff}},
        ]

    if counterparty_type:
        q["counterparty_type"] = counterparty_type
    if category:
        q["category"] = category
    if service:
        q["service"] = service
    if room:
        q["room"] = room
    if priority:
        q["priority"] = priority
    if status:
        q["status"] = status

    # Apply role-based scoping last so it never widens the query.
    await _apply_rbac_filter(q, user, db)

    rows = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(limit)
    return [_hydrate_legacy(deserialize_datetime(r)) for r in rows]


def _hydrate_legacy(row: dict) -> dict:
    """Back-fill new fields on legacy rows so the UI never has to branch.
    Pure-function, idempotent, no DB write."""
    if not row:
        return row
    if not row.get("staff_id") and row.get("audiologist_id"):
        row["staff_id"] = row["audiologist_id"]
        row["staff_name"] = row.get("audiologist_name") or ""
    if not row.get("audiologist_id") and row.get("staff_id"):
        row["audiologist_id"] = row["staff_id"]
        row["audiologist_name"] = row.get("staff_name") or ""
    if not row.get("counterparty_type"):
        row["counterparty_type"] = "patient" if row.get("patient_id") else "other"
    if not row.get("counterparty_name"):
        row["counterparty_name"] = row.get("patient_name") or ""
    if not row.get("counterparty_id") and row.get("patient_id"):
        row["counterparty_id"] = row["patient_id"]
    if not row.get("staff_color") and row.get("staff_id"):
        row["staff_color"] = color_for_staff(row["staff_id"])
    if not row.get("category"):
        row["category"] = "consultation"
    return row


@router.put("/appointments/{appointment_id}", response_model=Appointment)
async def update_appointment(appointment_id: str, payload: dict,
                             user=Depends(get_current_user), db=Depends(get_db)):
    """Accepts any subset of: start_at, duration_minutes, staff_id (or legacy
    audiologist_id), service, category, room, priority, status, notes,
    counterparty_* fields. Re-runs double-booking guard if start/duration/staff
    changes. Audiologists may only edit appointments they own.
    """
    existing = await db.appointments.find_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Appointment not found")

    # RBAC: audiologists can only mutate their own slots (regardless of peer-visibility,
    # which is read-only).
    if user.get("role") == "audiologist":
        owner = existing.get("staff_id") or existing.get("audiologist_id")
        if owner != user["user_id"]:
            raise HTTPException(status_code=403, detail="You can only edit your own appointments")

    update: dict = {"updated_at": datetime.utcnow()}
    impacts_schedule = any(
        k in payload for k in ("start_at", "duration_minutes", "audiologist_id", "staff_id")
    )

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

    # Staff change — accept either field, write both for backward compat.
    new_staff_id = payload.get("staff_id") or payload.get("audiologist_id")
    current_staff = existing.get("staff_id") or existing.get("audiologist_id")
    effective_staff = new_staff_id or current_staff
    if new_staff_id and new_staff_id != current_staff:
        s = await _resolve_staff(db, user["clinic_id"], new_staff_id)
        update["staff_id"] = s["user_id"]
        update["staff_name"] = s.get("name", "")
        update["staff_role"] = s.get("role")
        update["staff_color"] = s.get("appointment_color") or color_for_staff(s["user_id"])
        update["audiologist_id"] = s["user_id"]
        update["audiologist_name"] = s.get("name", "")

    if impacts_schedule:
        # If the caller is moving the slot forward in time, block a past
        # move too. When only status/notes are being edited we skip this
        # check so admins can still edit historical slots' metadata.
        _reject_past_start(start)
        overlap = await db.appointments.find_one(
            _overlap_query(user["clinic_id"], effective_staff, start, end, exclude_id=appointment_id)
        )
        if overlap:
            raise HTTPException(status_code=409, detail={
                "message": "Time slot conflicts with an existing appointment",
                "conflict_with": {
                    "appointment_id": overlap.get("appointment_id"),
                    "patient_name": overlap.get("patient_name") or overlap.get("counterparty_name"),
                    "start_at": overlap.get("start_at"),
                },
            })

    for k in ("service", "category", "room", "priority", "status", "notes",
              "visit_type", "recommended_tests", "referred_by",
              "hearing_aid_services", "wing",
              "counterparty_type", "counterparty_id", "counterparty_name",
              "counterparty_phone", "counterparty_company"):
        if k in payload:
            update[k] = payload[k]

    await db.appointments.update_one(
        {"appointment_id": appointment_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(update)},
    )
    updated = await db.appointments.find_one({"appointment_id": appointment_id}, {"_id": 0})
    return _hydrate_legacy(deserialize_datetime(updated))


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
        {"$set": {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}},
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
    date: str,
    audiologist_id: Optional[str] = None,
    staff_id: Optional[str] = None,
    duration_minutes: int = 30,
    start_hour: int = 9,
    end_hour: int = 18,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Returns 15-min-granularity free slots for a staff resource on a given date.
    Accepts either `staff_id` (new) or `audiologist_id` (legacy)."""
    sid = staff_id or audiologist_id
    if not sid:
        raise HTTPException(status_code=400, detail="staff_id or audiologist_id is required")
    day_start = datetime.fromisoformat(f"{date}T00:00:00")
    day_end = datetime.fromisoformat(f"{date}T23:59:59")
    busy = await db.appointments.find(
        {
            "clinic_id": user["clinic_id"],
            "$or": [{"audiologist_id": sid}, {"staff_id": sid}],
            "status": {"$nin": ["cancelled", "no_show"]},
            "start_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()},
        },
        {"_id": 0, "start_at": 1, "end_at": 1},
    ).to_list(200)
    busy_ranges = []
    for b in busy:
        try:
            bs = datetime.fromisoformat(b["start_at"])
            be = datetime.fromisoformat(b["end_at"])
            # Strip tzinfo so we can compare against naive `cur` / `slot_end`
            # datetimes constructed below.
            if bs.tzinfo is not None:
                bs = bs.replace(tzinfo=None)
            if be.tzinfo is not None:
                be = be.replace(tzinfo=None)
            busy_ranges.append((bs, be))
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
