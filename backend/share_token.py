"""Short-lived signed share tokens for patient-facing PDF report links.

These JWTs are deliberately *separate* from the user-auth tokens:
  * `type` claim: "report_share" (user-auth tokens use "access")
  * Default TTL: 7 days (kept short so a forwarded link expires before re-share risk)
  * Carries only `session_id` + `clinic_id` — never identifies the sharing user.

The front-desk / accounts user mints the token server-side via
`POST /api/reports/{session_id}/share-link`; the resulting URL
`/api/reports/shared/{token}` is safe to paste into WhatsApp / SMS / email.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException

SHARE_TOKEN_TYPE = "report_share"
SHARE_JWT_ALGORITHM = "HS256"
DEFAULT_SHARE_TTL_HOURS = 24 * 7  # 7 days
MAX_SHARE_TTL_HOURS = 24 * 30     # hard cap: 30 days


def _secret() -> str:
    s = os.environ.get("JWT_SECRET")
    if not s:
        raise RuntimeError("JWT_SECRET not configured")
    return s


def create_share_token(session_id: str, clinic_id: str, ttl_hours: int = DEFAULT_SHARE_TTL_HOURS) -> tuple[str, datetime]:
    """Mint a share-token for the given session.

    Returns (token, expires_at_utc).
    """
    ttl = max(1, min(int(ttl_hours or DEFAULT_SHARE_TTL_HOURS), MAX_SHARE_TTL_HOURS))
    exp = datetime.now(timezone.utc) + timedelta(hours=ttl)
    payload = {
        "session_id": session_id,
        "clinic_id": clinic_id,
        "type": SHARE_TOKEN_TYPE,
        "exp": exp,
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, _secret(), algorithm=SHARE_JWT_ALGORITHM)
    return token, exp


def decode_share_token(token: str) -> dict:
    """Validates the token and returns its claims, or raises 401/410."""
    try:
        payload = jwt.decode(token, _secret(), algorithms=[SHARE_JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Share link has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid share link")
    if payload.get("type") != SHARE_TOKEN_TYPE:
        raise HTTPException(status_code=401, detail="Invalid share link type")
    if not payload.get("session_id") or not payload.get("clinic_id"):
        raise HTTPException(status_code=401, detail="Malformed share link")
    return payload
