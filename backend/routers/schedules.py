"""Clinic & staff schedule — working hours, lunch breaks, audiologist shifts.

Two collections, identical shape:

  • `clinic_schedules`   keyed by `clinic_id`        — clinic-wide hours.
  • `staff_schedules`    keyed by `(clinic_id, user_id)` — per-audiologist shifts.

Each doc holds a `weekly_hours` map keyed by lower-case 3-letter weekday
(`mon`, `tue`, …, `sun`). Each weekday has:

    {
      "open":     bool       # clinic OR staff "is working today?"
      "windows":  [           # zero, one or more shift windows.
        {"start": "HH:MM", "end": "HH:MM", "label": "Morning" }
      ]
    }

A clinic with a Mon-Sat 9-1.30 + 2.30-7 schedule has two windows on each
working day. An audiologist on a split shift has the same shape. Sundays
typically have `open: False` and an empty windows array.

Slot eligibility (applied by `/api/availability/slots`):
  • A 30-min slot at T is "open" only if  T..T+dur  fits inside SOME
    clinic window AND inside the staff member's window for that day.
  • Slots outside windows are returned with `available: False` plus a
    machine-readable `reason` so the UI can grey them out with a tooltip.
  • A founder/super_admin can `?override=true` to render every slot
    bookable (still flags conflicts but lets the admin acknowledge).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, time, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from auth import get_current_user
from database import get_db
from utils.serde import serialize_datetime, deserialize_datetime


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DEFAULT_CLINIC_TEMPLATE = {
    "mon": {"open": True,  "windows": [{"start": "09:00", "end": "13:30", "label": "Morning"},
                                       {"start": "14:30", "end": "19:00", "label": "Evening"}]},
    "tue": {"open": True,  "windows": [{"start": "09:00", "end": "13:30", "label": "Morning"},
                                       {"start": "14:30", "end": "19:00", "label": "Evening"}]},
    "wed": {"open": True,  "windows": [{"start": "09:00", "end": "13:30", "label": "Morning"},
                                       {"start": "14:30", "end": "19:00", "label": "Evening"}]},
    "thu": {"open": True,  "windows": [{"start": "09:00", "end": "13:30", "label": "Morning"},
                                       {"start": "14:30", "end": "19:00", "label": "Evening"}]},
    "fri": {"open": True,  "windows": [{"start": "09:00", "end": "13:30", "label": "Morning"},
                                       {"start": "14:30", "end": "19:00", "label": "Evening"}]},
    "sat": {"open": True,  "windows": [{"start": "09:00", "end": "13:30", "label": "Morning"},
                                       {"start": "14:30", "end": "17:30", "label": "Evening"}]},
    "sun": {"open": False, "windows": []},
}


# ─────────────── Schema ───────────────

class ScheduleWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: str = Field(..., description="HH:MM 24h")
    end: str = Field(..., description="HH:MM 24h")
    label: Optional[str] = None

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        try:
            time.fromisoformat(v)
        except ValueError as e:
            raise ValueError("Time must be HH:MM 24-hour format") from e
        return v


class ScheduleDay(BaseModel):
    model_config = ConfigDict(extra="forbid")
    open: bool = True
    windows: List[ScheduleWindow] = Field(default_factory=list)


class WeeklySchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mon: ScheduleDay = ScheduleDay()
    tue: ScheduleDay = ScheduleDay()
    wed: ScheduleDay = ScheduleDay()
    thu: ScheduleDay = ScheduleDay()
    fri: ScheduleDay = ScheduleDay()
    sat: ScheduleDay = ScheduleDay()
    sun: ScheduleDay = ScheduleDay(open=False)


class ClinicSchedulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weekly_hours: WeeklySchedule


class StaffSchedulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weekly_hours: WeeklySchedule
    inherit_clinic: bool = False


# ─────────────── Helpers (also imported by appointments router) ───────────────

def _hhmm_to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _wd_key(date_str: str) -> str:
    return WEEKDAYS[datetime.fromisoformat(f"{date_str}T00:00:00").weekday()]


def _windows_for_day(schedule: dict, weekday: str) -> tuple[bool, list[dict]]:
    day = (schedule or {}).get("weekly_hours", {}).get(weekday) or {}
    is_open = bool(day.get("open"))
    return is_open, day.get("windows", []) if is_open else []


def _slot_inside_any_window(slot_start_min: int, slot_end_min: int,
                            windows: list[dict]) -> bool:
    """True iff [slot_start_min, slot_end_min] fits entirely inside ONE window."""
    for w in windows:
        ws, we = _hhmm_to_minutes(w["start"]), _hhmm_to_minutes(w["end"])
        if slot_start_min >= ws and slot_end_min <= we:
            return True
    return False


async def get_clinic_schedule(db, clinic_id: str) -> dict:
    """Read the clinic schedule, returning a sane default template if unset."""
    doc = await db.clinic_schedules.find_one({"clinic_id": clinic_id}, {"_id": 0})
    if doc:
        return doc
    return {
        "clinic_id": clinic_id,
        "weekly_hours": DEFAULT_CLINIC_TEMPLATE,
        "is_default": True,
    }


async def get_staff_schedule(db, clinic_id: str, user_id: str) -> dict:
    """Read a staff schedule. Returns inherit_clinic=True default if unset."""
    doc = await db.staff_schedules.find_one(
        {"clinic_id": clinic_id, "user_id": user_id}, {"_id": 0},
    )
    if doc:
        return doc
    return {
        "clinic_id": clinic_id,
        "user_id": user_id,
        "inherit_clinic": True,
        "weekly_hours": DEFAULT_CLINIC_TEMPLATE,
        "is_default": True,
    }


# ─────────────── CLINIC schedule endpoints ───────────────

@router.get("/clinic-schedule")
async def read_clinic_schedule(user=Depends(get_current_user), db=Depends(get_db)):
    """Get the working hours for the caller's clinic."""
    sch = await get_clinic_schedule(db, user["clinic_id"])
    return deserialize_datetime(sch)


@router.put("/clinic-schedule")
async def update_clinic_schedule(payload: ClinicSchedulePayload,
                                 user=Depends(get_current_user), db=Depends(get_db)):
    """Upsert the clinic's working hours.

    Restricted to clinic_owner / super_admin / founder — front-desk / accounts /
    audiologist roles cannot change the clinic's hours.
    """
    if user.get("role") not in {"clinic_owner", "super_admin", "founder"}:
        raise HTTPException(status_code=403, detail="Only owner/admin can change clinic hours")
    body = serialize_datetime({
        "clinic_id": user["clinic_id"],
        "weekly_hours": payload.weekly_hours.model_dump(),
        "updated_at": datetime.now(timezone.utc),
        "updated_by": user["user_id"],
    })
    await db.clinic_schedules.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": body},
        upsert=True,
    )
    return {"ok": True, "clinic_id": user["clinic_id"]}


# ─────────────── STAFF schedule endpoints ───────────────

@router.get("/staff-schedule/{user_id}")
async def read_staff_schedule(user_id: str,
                              user=Depends(get_current_user), db=Depends(get_db)):
    """Get the working hours for a specific staff member."""
    sch = await get_staff_schedule(db, user["clinic_id"], user_id)
    return deserialize_datetime(sch)


@router.put("/staff-schedule/{user_id}")
async def update_staff_schedule(user_id: str,
                                payload: StaffSchedulePayload,
                                user=Depends(get_current_user), db=Depends(get_db)):
    """Upsert a staff member's weekly schedule.

    Permission rules:
      • clinic_owner / super_admin / founder can edit ANY staff in their clinic.
      • Other roles can edit only their own (`user_id == user["user_id"]`).
    """
    if user.get("role") not in {"clinic_owner", "super_admin", "founder"} and user_id != user["user_id"]:
        raise HTTPException(status_code=403, detail="Cannot edit another staff member's schedule")
    target = await db.users.find_one(
        {"user_id": user_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "user_id": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Staff member not found")
    body = serialize_datetime({
        "clinic_id": user["clinic_id"],
        "user_id": user_id,
        "inherit_clinic": payload.inherit_clinic,
        "weekly_hours": payload.weekly_hours.model_dump(),
        "updated_at": datetime.now(timezone.utc),
        "updated_by": user["user_id"],
    })
    await db.staff_schedules.update_one(
        {"clinic_id": user["clinic_id"], "user_id": user_id},
        {"$set": body},
        upsert=True,
    )
    return {"ok": True, "user_id": user_id}


# ─────────────── Availability endpoint ───────────────

class SlotInfo(BaseModel):
    start_at: str
    end_at: str
    available: bool
    reason: Optional[str] = None     # human-readable reason when unavailable
    label: Optional[str] = None      # window label e.g. "Morning"


@router.get("/availability/slots")
async def availability_slots(
    date: str,
    staff_id: Optional[str] = None,
    audiologist_id: Optional[str] = None,
    duration_minutes: int = 30,
    granularity_minutes: int = 15,
    override: bool = False,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Returns every 15-min slot for the day with availability+reason metadata.

    UNLIKE /api/appointments/slots (which returns ONLY free slots), this
    endpoint returns the FULL day so the booking modal can render greyed-out
    "lunch", "outside clinic hours", and "Dr X off today" tooltips.

    Conflict detection considers the audiologist's existing appointments.
    """
    sid = staff_id or audiologist_id
    if not sid:
        raise HTTPException(status_code=400, detail="staff_id is required")

    weekday = _wd_key(date)
    clinic_sch = await get_clinic_schedule(db, user["clinic_id"])
    staff_sch_full = await get_staff_schedule(db, user["clinic_id"], sid)
    inherit = staff_sch_full.get("inherit_clinic", True)

    clinic_open, clinic_windows = _windows_for_day(clinic_sch, weekday)
    if inherit:
        staff_open, staff_windows = clinic_open, clinic_windows
    else:
        staff_open, staff_windows = _windows_for_day(staff_sch_full, weekday)

    # Existing busy ranges for the audiologist on this date.
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
            busy_ranges.append((datetime.fromisoformat(b["start_at"]),
                                datetime.fromisoformat(b["end_at"])))
        except (TypeError, ValueError):
            continue

    # Walk every slot start from 06:00 to 22:00 at the requested granularity.
    DAY_START_MIN = 6 * 60     # 06:00
    DAY_END_MIN = 22 * 60      # 22:00
    slots: list[dict] = []
    cur = DAY_START_MIN
    while cur + duration_minutes <= DAY_END_MIN:
        slot_end_min = cur + duration_minutes
        slot_start_dt = day_start.replace(hour=cur // 60, minute=cur % 60)
        slot_end_dt = day_start.replace(hour=slot_end_min // 60,
                                        minute=slot_end_min % 60)

        if not clinic_open:
            reason, label = "Clinic closed today", None
            available = False
        elif not staff_open:
            reason, label = "Audiologist off today", None
            available = False
        elif not _slot_inside_any_window(cur, slot_end_min, clinic_windows):
            reason, label = "Outside clinic hours / lunch break", None
            available = False
        elif not inherit and not _slot_inside_any_window(cur, slot_end_min, staff_windows):
            reason, label = "Audiologist not on shift", None
            available = False
        else:
            # Inside both windows — last check is appointment conflict.
            conflict = any(not (slot_end_dt <= bs or slot_start_dt >= be)
                           for (bs, be) in busy_ranges)
            if conflict:
                reason, label = "Already booked", None
                available = False
            else:
                # Find which window label to show
                lbl = None
                for w in (staff_windows if not inherit and staff_open else clinic_windows):
                    ws = _hhmm_to_minutes(w["start"])
                    we = _hhmm_to_minutes(w["end"])
                    if cur >= ws and slot_end_min <= we:
                        lbl = w.get("label")
                        break
                reason, label, available = None, lbl, True

        slots.append({
            "start_at": slot_start_dt.isoformat(),
            "end_at": slot_end_dt.isoformat(),
            "available": available if not override else (available or reason != "Already booked"),
            "reason": reason,
            "label": label,
        })
        cur += granularity_minutes

    # Find the earliest available — the UI shows it as "Next available" CTA.
    next_avail = next((s for s in slots if s["available"]), None)

    return {
        "date": date,
        "staff_id": sid,
        "clinic_open": clinic_open,
        "staff_open": staff_open,
        "inherit_clinic": inherit,
        "windows": staff_windows if (not inherit and staff_open) else clinic_windows,
        "slots": slots,
        "next_available": next_avail,
    }


# ─────────────── Weekly availability calendar ───────────────

@router.get("/availability/week")
async def availability_week(
    start_date: str,
    user=Depends(get_current_user), db=Depends(get_db),
):
    """Returns a 7-day grid of who's working when for the whole clinic.

    Used by the new "Schedule" calendar in Settings → Staff. Each cell is one
    staff × one weekday and contains the windows they work that day.
    """
    weekdays_start = datetime.fromisoformat(f"{start_date}T00:00:00").weekday()
    week_keys = [WEEKDAYS[(weekdays_start + i) % 7] for i in range(7)]

    clinic_sch = await get_clinic_schedule(db, user["clinic_id"])
    staff = await db.users.find(
        {"clinic_id": user["clinic_id"],
         "active": {"$ne": False},
         "role": {"$in": ["audiologist", "clinic_owner", "super_admin"]}},
        {"_id": 0, "user_id": 1, "name": 1, "role": 1},
    ).to_list(200)

    rows = []
    for s in staff:
        sch_doc = await get_staff_schedule(db, user["clinic_id"], s["user_id"])
        inherit = sch_doc.get("inherit_clinic", True)
        days = []
        for d in week_keys:
            is_open, windows = _windows_for_day(
                clinic_sch if inherit else sch_doc, d,
            )
            days.append({
                "weekday": d,
                "open": is_open,
                "windows": windows,
                "inherit": inherit,
            })
        rows.append({
            "user_id": s["user_id"],
            "name": s.get("name"),
            "role": s.get("role"),
            "inherit_clinic": inherit,
            "days": days,
        })

    return {
        "clinic_id": user["clinic_id"],
        "start_date": start_date,
        "weekdays": week_keys,
        "clinic": clinic_sch,
        "staff": rows,
    }
