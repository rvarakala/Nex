"""Birthday & Anniversary auto-greetings.

Two surfaces:
  * GET  /api/greetings/today             — patients with birthday or
                                            anniversary today + next 7 days
  * GET  /api/greetings/upcoming          — same as today, but caller can
                                            tweak window via ?days=N
  * POST /api/greetings/{patient_id}/send — generate a wa.me deep link
                                            (PR 1 fallback; PR 2 will route
                                            through MSG91 once Connect is
                                            enabled). Records to greeting_log.

A daily cron (09:00 IST) writes idempotent rows to `greeting_log` for every
matching patient — one row per patient per kind per day. The Patient Profile
shows these as queued sends; clinic owners can fire them manually any time.

Templates intentionally use Indian language conventions and emoji that
render reliably on WhatsApp.
"""
from __future__ import annotations

import re
import urllib.parse
from datetime import date, datetime, timezone, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/greetings", tags=["greetings"])

KIND_BIRTHDAY = "birthday"
KIND_ANNIVERSARY = "anniversary"


# ──────────────────── Pydantic surface ────────────────────


class GreetingItem(BaseModel):
    patient_id: str
    name: str
    mobile: Optional[str] = None
    kind: Literal["birthday", "anniversary"]
    days_until: int                       # 0 = today
    occasion_date: str                    # MM-DD
    age_years: Optional[int] = None       # only for birthdays
    years_together: Optional[int] = None  # only for anniversaries
    already_sent_today: bool = False
    whatsapp_consent: bool = False


class GreetingsBucket(BaseModel):
    today: list[GreetingItem]
    upcoming: list[GreetingItem]


class SendGreetingPayload(BaseModel):
    kind: Literal["birthday", "anniversary"]
    custom_message: Optional[str] = None  # owner override


# ──────────────────── helpers ─────────────────────────────


_DOB_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def _parse_iso_ymd(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    m = _DOB_RE.match(s.strip()[:10])
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _days_until_anniv(today: date, occasion: date) -> int:
    """Return # of days from `today` until the next occurrence of
    occasion's MM-DD (handling Feb-29 → Feb-28 fallback)."""
    target_year = today.year
    try:
        next_occurrence = date(target_year, occasion.month, occasion.day)
    except ValueError:
        # Feb 29 in a non-leap year — fall back to Feb 28
        next_occurrence = date(target_year, occasion.month, 28)
    if next_occurrence < today:
        try:
            next_occurrence = date(target_year + 1, occasion.month, occasion.day)
        except ValueError:
            next_occurrence = date(target_year + 1, occasion.month, 28)
    return (next_occurrence - today).days


def _years_completed(today: date, anchor: date) -> int:
    yrs = today.year - anchor.year
    if (today.month, today.day) < (anchor.month, anchor.day):
        yrs -= 1
    return max(yrs, 0)


def _today_ist() -> date:
    """Server-side date in IST so birthdays don't drift around midnight UTC."""
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()


# ──────────────────── core scan ───────────────────────────


async def _scan_clinic(db, clinic_id: str, *, window_days: int) -> tuple[list[GreetingItem], list[GreetingItem]]:
    today = _today_ist()
    window_end = window_days

    cur = db.patients.find(
        {"clinic_id": clinic_id,
         "$or": [
             {"dob": {"$nin": [None, ""]}},
             {"anniversary_date": {"$nin": [None, ""]}},
         ]},
        {"_id": 0, "patient_id": 1, "name": 1, "mobile": 1, "dob": 1,
         "anniversary_date": 1, "whatsapp_consent": 1},
    )

    today_bucket: list[GreetingItem] = []
    upcoming: list[GreetingItem] = []

    # We'll bulk-pre-fetch today's greeting_log rows for this clinic so we
    # can flag already_sent_today without n+1 queries.
    sent_today_keys: set[tuple[str, str]] = set()
    log_cur = db.greeting_log.find(
        {"clinic_id": clinic_id, "occasion_date_ymd": today.isoformat()},
        {"_id": 0, "patient_id": 1, "kind": 1},
    )
    async for r in log_cur:
        sent_today_keys.add((r["patient_id"], r["kind"]))

    async for p in cur:
        for kind, raw, anchor_field in (
            (KIND_BIRTHDAY,    p.get("dob"),               "dob"),
            (KIND_ANNIVERSARY, p.get("anniversary_date"),  "anniversary_date"),
        ):
            anchor = _parse_iso_ymd(raw)
            if not anchor:
                continue
            d = _days_until_anniv(today, anchor)
            if d > window_end:
                continue
            item = GreetingItem(
                patient_id=p["patient_id"],
                name=p["name"],
                mobile=p.get("mobile"),
                kind=kind,
                days_until=d,
                occasion_date=f"{anchor.month:02d}-{anchor.day:02d}",
                age_years=(_years_completed(today, anchor) if kind == KIND_BIRTHDAY else None),
                years_together=(_years_completed(today, anchor) if kind == KIND_ANNIVERSARY else None),
                already_sent_today=((p["patient_id"], kind) in sent_today_keys),
                whatsapp_consent=bool(p.get("whatsapp_consent")),
            )
            if d == 0:
                today_bucket.append(item)
            else:
                upcoming.append(item)

    today_bucket.sort(key=lambda x: x.name)
    upcoming.sort(key=lambda x: (x.days_until, x.name))
    return today_bucket, upcoming


# ──────────────────── routes ──────────────────────────────


@router.get("/today", response_model=GreetingsBucket)
async def greetings_today(
    days: int = 7,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    days = max(0, min(days, 60))
    today_bucket, upcoming = await _scan_clinic(db, user["clinic_id"], window_days=days)
    return GreetingsBucket(today=today_bucket, upcoming=upcoming)


def _compose_message(name: str, kind: str, age_or_years: Optional[int], clinic_name: str) -> str:
    first = (name or "").strip().split()[0] or "there"
    if kind == KIND_BIRTHDAY:
        if age_or_years and age_or_years > 0:
            return (
                f"Dear {first}, 🎂 Wishing you a very Happy Birthday from all of us at "
                f"{clinic_name}! May this {age_or_years}{_ord_suffix(age_or_years)} "
                f"year bring you great health and many smiles. — Team {clinic_name}"
            )
        return (
            f"Dear {first}, 🎂 Wishing you a very Happy Birthday from all of us at "
            f"{clinic_name}! May this year bring you great health and many smiles. "
            f"— Team {clinic_name}"
        )
    # anniversary
    if age_or_years and age_or_years > 0:
        return (
            f"Dear {first}, 💍 Wishing you a very Happy {age_or_years}{_ord_suffix(age_or_years)} "
            f"Wedding Anniversary! Lots of love and best wishes from your friends at "
            f"{clinic_name}."
        )
    return (
        f"Dear {first}, 💍 Wishing you a very Happy Wedding Anniversary! "
        f"Lots of love and best wishes from your friends at {clinic_name}."
    )


def _ord_suffix(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


@router.post("/{patient_id}/send")
async def send_greeting(
    patient_id: str,
    payload: SendGreetingPayload,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    p = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(404, "Patient not found")
    if not p.get("mobile"):
        raise HTTPException(400, "Patient has no mobile number on file.")

    today = _today_ist()
    if payload.kind == KIND_BIRTHDAY:
        anchor = _parse_iso_ymd(p.get("dob"))
    else:
        anchor = _parse_iso_ymd(p.get("anniversary_date"))
    yrs = _years_completed(today, anchor) if anchor else None

    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    clinic_name = clinic.get("name") or "your clinic"
    message = payload.custom_message or _compose_message(p["name"], payload.kind, yrs, clinic_name)

    # Build wa.me deep link (PR 1 fallback). PR 2 will swap this for MSG91.
    digits = re.sub(r"\D+", "", p["mobile"])
    if len(digits) == 10:
        digits = "91" + digits
    wa_link = f"https://wa.me/{digits}?text={urllib.parse.quote(message)}"

    # Idempotent log per patient/kind/day
    log_doc = {
        "clinic_id": user["clinic_id"],
        "patient_id": patient_id,
        "patient_name": p["name"],
        "kind": payload.kind,
        "occasion_date_ymd": today.isoformat(),
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "sent_by_user_id": user["user_id"],
        "sent_by_name": user.get("name") or user.get("email"),
        "channel": "wa_link",            # PR 2 will add "msg91"
        "message": message,
        "wa_link": wa_link,
    }
    await db.greeting_log.update_one(
        {"clinic_id": user["clinic_id"], "patient_id": patient_id,
         "kind": payload.kind, "occasion_date_ymd": today.isoformat()},
        {"$set": log_doc},
        upsert=True,
    )
    return {
        "ok": True,
        "wa_link": wa_link,
        "message": message,
        "kind": payload.kind,
    }


@router.get("/log")
async def greeting_log(
    limit: int = 100,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    limit = max(1, min(limit, 500))
    cur = db.greeting_log.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    ).sort("sent_at", -1).limit(limit)
    return {"items": [r async for r in cur]}


# ──────────────────── daily cron ──────────────────────────


async def run_daily_greeting_scan(db) -> None:
    """09:00 IST daily — for every clinic, pre-stage today's birthdays /
    anniversaries by writing a `kind=queued` row to greeting_log so the
    Patients Dashboard widget can show "X celebrations today" the moment
    staff log in.

    We do NOT actually fire WhatsApp here — owners click "Send" to open
    the wa.me link. PR 2 will plug MSG91 send into this same function.
    """
    today = _today_ist()
    clinic_ids = await db.patients.distinct("clinic_id")
    for cid in clinic_ids:
        today_bucket, _ = await _scan_clinic(db, cid, window_days=0)
        for g in today_bucket:
            if g.already_sent_today:
                continue
            await db.greeting_log.update_one(
                {"clinic_id": cid, "patient_id": g.patient_id,
                 "kind": g.kind, "occasion_date_ymd": today.isoformat()},
                {"$setOnInsert": {
                    "clinic_id": cid,
                    "patient_id": g.patient_id,
                    "patient_name": g.name,
                    "kind": g.kind,
                    "occasion_date_ymd": today.isoformat(),
                    "queued_at": datetime.now(timezone.utc).isoformat(),
                    "channel": "queued",
                }},
                upsert=True,
            )
