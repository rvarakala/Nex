"""Per-user device (session) limit enforcement.

Locks the number of concurrent `user_sessions` rows a single user can
hold, keyed by their clinic's subscription tier. Netflix-style:

    BASIC     → 2 devices
    STANDARD  → 4 devices
    PREMIUM   → 8 devices
    founder / super_admin → unlimited

An "active" session is one that has NOT been revoked AND has been seen
in the last STALE_AFTER_DAYS days. Older idle sessions still exist in
the DB (for the audit trail on the Sessions & Devices page) but they
don't consume a slot.

Enforcement mode:
    * When env DEVICE_LIMIT_ENFORCE is truthy → the (N+1)ᵗʰ login is
      blocked with HTTP 409 DEVICE_LIMIT_EXCEEDED + a device list; the
      client (LoginPage.js) shows a picker and calls /auth/login again
      with `replace_session_id=<sid>` to atomically kick that device
      and mint the new session.
    * When falsy (default in preview) → we don't block, but we tag the
      response with `device_limit_warning` so the UI can nudge without
      any hard lockout during the 7-day rollout window.

The counter query is cheap (indexed on `user_id` already for the
Sessions page) so we can call it on every login without adding load.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

# Days of inactivity before an existing session stops counting toward the
# per-user cap. Matches the JWT refresh window so the UX feels consistent
# ("if I haven't opened AUDINEXA in a month, that laptop shouldn't hoard a slot").
STALE_AFTER_DAYS = 30


# Per-tier device caps. Keep in sync with the copy in
# frontend/src/components/DeviceLimitModal.jsx.
TIER_DEVICE_LIMIT: dict[str, int] = {
    "BASIC": 2,
    "STANDARD": 4,
    "PREMIUM": 8,
}
# Sentinel for founder / super_admin — arbitrarily high so the count check
# is guaranteed to pass without special-casing None.
UNLIMITED = 9999


def _truthy(v: Optional[str]) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes", "on"}


def is_enforcement_enabled() -> bool:
    """Kill-switch — flip DEVICE_LIMIT_ENFORCE=true in prod after the 7-day
    warn-only window. Preview defaults to warn-only so we can validate the
    UI end-to-end without locking anyone out mid-test.
    """
    return _truthy(os.environ.get("DEVICE_LIMIT_ENFORCE"))


def cap_for_user(user: dict, clinic: Optional[dict]) -> int:
    """Resolve the effective device cap for this user.

    Founders and platform super-admins get UNLIMITED so we never lock
    ourselves out of production support. Everyone else follows the
    clinic's *effective* tier (honours PREMIUM trials via
    resolve_effective_tier — but we accept a pre-resolved tier string
    on the clinic dict too, to save a round-trip in the login hot path).
    """
    if user and user.get("role") in {"founder", "super_admin"}:
        return UNLIMITED

    tier = None
    if clinic:
        # Prefer the caller-resolved trial-aware tier if it was attached.
        tier = clinic.get("effective_tier") or clinic.get("subscription_tier")
    return TIER_DEVICE_LIMIT.get((tier or "BASIC").upper(), TIER_DEVICE_LIMIT["BASIC"])


def _stale_cutoff() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=STALE_AFTER_DAYS)


async def count_active_sessions(db, user_id: str) -> int:
    """Number of sessions that would currently count against the cap."""
    return await db.user_sessions.count_documents({
        "user_id": user_id,
        "revoked_at": None,
        "last_seen_at": {"$gte": _stale_cutoff()},
    })


async def list_active_sessions(db, user_id: str) -> list[dict[str, Any]]:
    """Sessions that would count against the cap — for the frontend picker.

    Ordered oldest-last-seen first so the user sees the least useful
    device at the top of the list (the one they should probably kick).
    """
    cursor = db.user_sessions.find(
        {
            "user_id": user_id,
            "revoked_at": None,
            "last_seen_at": {"$gte": _stale_cutoff()},
        },
        {
            "_id": 0,
            "session_id": 1,
            "device_label": 1,
            "ip": 1,
            "created_at": 1,
            "last_seen_at": 1,
            "user_agent": 1,
        },
    ).sort("last_seen_at", 1)  # oldest first
    rows = await cursor.to_list(length=32)
    for r in rows:
        # Serialize datetimes for the JSON response.
        for k in ("created_at", "last_seen_at"):
            v = r.get(k)
            if isinstance(v, datetime):
                r[k] = v.isoformat()
    return rows


async def revoke_session_by_id(db, user_id: str, session_id: str) -> bool:
    """Atomic replacement helper — revokes exactly one session belonging to
    this user. Returns True if a row was actually revoked (so the caller
    can decide whether to proceed with minting the new session).
    """
    res = await db.user_sessions.update_one(
        {
            "session_id": session_id,
            "user_id": user_id,
            "revoked_at": None,
        },
        {"$set": {"revoked_at": datetime.now(timezone.utc), "revoked_reason": "device-limit-replace"}},
    )
    return bool(res.modified_count)


async def enforce_or_warn(
    db,
    user: dict,
    clinic: Optional[dict],
    *,
    replace_session_id: Optional[str] = None,
) -> dict:
    """Called by the login pipeline BEFORE mint_session_row().

    Returns a dict describing the outcome. The caller decides what to do
    with it:
        {"action": "allow"}                         → mint session normally
        {"action": "warn", "count": N, "cap": C}    → mint but flag it
        {"action": "block", "devices": [...], ...}  → raise HTTP 409

    Handles the "replace-and-login" path: if the caller passed
    replace_session_id AND the user is at cap, we revoke that session
    first, then re-check and allow.
    """
    cap = cap_for_user(user, clinic)
    if cap >= UNLIMITED:
        return {"action": "allow", "count": 0, "cap": cap}

    count = await count_active_sessions(db, user["user_id"])

    # If we're under cap, always allow.
    if count < cap:
        return {"action": "allow", "count": count, "cap": cap}

    # At or over cap. Two ways forward:
    # 1. Client already picked a device to kick → revoke + allow.
    if replace_session_id:
        revoked = await revoke_session_by_id(db, user["user_id"], replace_session_id)
        if revoked:
            new_count = await count_active_sessions(db, user["user_id"])
            if new_count < cap:
                return {"action": "allow", "count": new_count, "cap": cap, "replaced": replace_session_id}
        # If the revoke didn't take (already gone or not the user's), we
        # fall through into the normal block flow so the client can
        # re-pick from a fresh device list.

    # 2. Enforce vs. warn based on the env kill-switch.
    if is_enforcement_enabled():
        devices = await list_active_sessions(db, user["user_id"])
        return {
            "action": "block",
            "count": count,
            "cap": cap,
            "devices": devices,
        }

    # Warn-only rollout — mint the session but attach a soft warning so
    # the UI can render a banner on Sessions & Devices.
    return {"action": "warn", "count": count, "cap": cap}
