"""User sessions & devices — Gmail-style "where am I signed in?" UX.

Endpoints (all scoped to the authenticated user):

  GET    /api/auth/sessions                 — list my sessions, newest first
  POST   /api/auth/sessions/{sid}/revoke    — sign out one device
  POST   /api/auth/sessions/revoke-others   — sign out every device except current

Storage: `user_sessions` collection (not capped). Rows survive token expiry
so the UI can still show "this device signed in last week" even after the
JWT ran out. Add an external GC if rows grow unbounded — for now, expect
~30/user.

Session creation lives in `mint_session_row()` (called from /auth/login,
/auth/mfa/verify-login, /auth/switch-clinic, /public/clinic-signup).
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/auth/sessions", tags=["user-sessions"])


# ─── Helpers ────────────────────────────────────────────────────────────


def _extract_ip(request: Optional[Request]) -> Optional[str]:
    if not request:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


# Tiny user-agent → friendly label parser. Good enough for "iPhone Safari"
# / "Chrome on macOS" — anything richer would need a UA database we don't
# want to ship.
_UA_BROWSERS = [
    (re.compile(r"Edg/"),                  "Edge"),
    (re.compile(r"OPR/|Opera"),            "Opera"),
    (re.compile(r"Chrome/"),               "Chrome"),
    (re.compile(r"Firefox/"),              "Firefox"),
    (re.compile(r"Version/.*Safari"),      "Safari"),
    (re.compile(r"PostmanRuntime"),        "Postman"),
    (re.compile(r"curl/"),                 "curl"),
]
_UA_OS = [
    (re.compile(r"Windows NT"),                       "Windows"),
    (re.compile(r"iPhone"),                           "iPhone"),
    (re.compile(r"iPad"),                             "iPad"),
    (re.compile(r"Android"),                          "Android"),
    (re.compile(r"Macintosh|Mac OS"),                 "macOS"),
    (re.compile(r"X11; Linux|Ubuntu|Debian|Fedora"),  "Linux"),
]


def label_from_user_agent(ua: Optional[str]) -> str:
    if not ua:
        return "Unknown device"
    browser = next((label for pat, label in _UA_BROWSERS if pat.search(ua)), None)
    os_ = next((label for pat, label in _UA_OS if pat.search(ua)), None)
    if browser and os_:
        return f"{browser} on {os_}"
    if browser:
        return browser
    if os_:
        return os_
    return (ua[:32] + "…") if len(ua) > 32 else ua


# ─── Session-row creator ────────────────────────────────────────────────


async def mint_session_row(
    db,
    user: dict,
    request: Optional[Request],
    *,
    purpose: str = "login",
) -> str:
    """Insert a row in `user_sessions` and return the new session_id."""
    sid = "S-" + secrets.token_urlsafe(20)
    now = datetime.now(timezone.utc)
    ua = (request.headers.get("user-agent") if request else None) or ""
    doc = {
        "session_id":    sid,
        "user_id":       user["user_id"],
        "clinic_id":     user.get("clinic_id"),
        "created_at":    now,
        "last_seen_at":  now,
        "ip":            _extract_ip(request),
        "user_agent":    ua[:300],
        "device_label":  label_from_user_agent(ua),
        "purpose":       purpose,           # "login" | "mfa" | "switch_clinic" | "signup"
        "revoked_at":    None,
    }
    await db.user_sessions.insert_one(doc)
    return sid


async def touch_session_last_seen(db, sid: Optional[str]) -> None:
    """Lazy update for the Last Activity column. Throttled by record_heartbeat."""
    if not sid:
        return
    try:
        await db.user_sessions.update_one(
            {"session_id": sid, "revoked_at": None},
            {"$set": {"last_seen_at": datetime.now(timezone.utc)}},
        )
    except Exception:
        pass


# ─── List ───────────────────────────────────────────────────────────────


class SessionOut(BaseModel):
    session_id: str
    created_at: str
    last_seen_at: str
    ip: Optional[str] = None
    device_label: str
    user_agent: Optional[str] = None
    purpose: Optional[str] = None
    current: bool


def _iso(v):
    if isinstance(v, datetime):
        return v.isoformat()
    return v


@router.get("", response_model=list[SessionOut])
async def list_sessions(user=Depends(get_current_user), db=Depends(get_db)):
    cur_sid = user.get("session_id")
    rows = await db.user_sessions.find(
        {"user_id": user["user_id"], "revoked_at": None},
        {"_id": 0},
    ).sort("last_seen_at", -1).to_list(length=50)

    return [
        SessionOut(
            session_id=r["session_id"],
            created_at=_iso(r["created_at"]),
            last_seen_at=_iso(r.get("last_seen_at") or r["created_at"]),
            ip=r.get("ip"),
            device_label=r.get("device_label") or "Unknown device",
            user_agent=r.get("user_agent"),
            purpose=r.get("purpose"),
            current=(r["session_id"] == cur_sid),
        )
        for r in rows
    ]


# ─── Revoke one ─────────────────────────────────────────────────────────


@router.post("/{session_id}/revoke")
async def revoke_session(
    session_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    if session_id == user.get("session_id"):
        raise HTTPException(
            status_code=400,
            detail="Use the regular Sign Out button to revoke your current session.",
        )
    res = await db.user_sessions.update_one(
        {"session_id": session_id, "user_id": user["user_id"], "revoked_at": None},
        {"$set": {"revoked_at": datetime.now(timezone.utc)}},
    )
    if not res.modified_count:
        raise HTTPException(status_code=404, detail="Session not found or already revoked")
    return {"success": True, "session_id": session_id}


# ─── Revoke all others ──────────────────────────────────────────────────


@router.post("/revoke-others")
async def revoke_other_sessions(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    cur_sid = user.get("session_id")
    res = await db.user_sessions.update_many(
        {
            "user_id": user["user_id"],
            "session_id": {"$ne": cur_sid},
            "revoked_at": None,
        },
        {"$set": {"revoked_at": datetime.now(timezone.utc)}},
    )
    return {"success": True, "revoked": res.modified_count}
