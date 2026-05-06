"""Self-serve password reset flow.

Two endpoints:
  POST /api/auth/forgot-password { email }
  POST /api/auth/reset-password   { token, new_password }

Security:
  * Anti-enumeration — both endpoints respond with the same generic message
    regardless of whether the email is registered, so attackers can't probe
    user-existence. Real failures (rate-limit, expired token) still surface.
  * Tokens are stored as SHA-256 hashes — even a DB leak doesn't expose live
    reset links. The plain token is only ever in the email and the user's
    browser URL.
  * Single-use — token is marked `used=true` on first successful reset.
  * 1-hour expiry — TTL index auto-purges old tokens.
  * Rate-limited — 5 forgot requests per IP per 15 minutes.
  * Audit log — every reset event written to `auth_events`.

Lives at /api/auth/* alongside the existing login route in server.py.
"""
import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth import hash_password
from database import get_db
from rate_limit import limiter

router = APIRouter(prefix="/api/auth", tags=["auth-password-reset"])
log = logging.getLogger("audinexa.password_reset")

RESET_TOKEN_TTL_MINUTES = 60                                 # 1-hour link lifetime
GENERIC_OK_MESSAGE = (
    "If an account with that email exists, a password reset link has been "
    "sent. Please check your inbox (and spam folder)."
)
PASSWORD_MIN_LEN = 8


# ─── Helpers ───────────────────────────────────────────────────────────

def _hash_token(token: str) -> str:
    """SHA-256 the plain token before persisting — protects against DB leaks."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _client_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _build_reset_url(request: Request, token: str) -> str:
    """Mirror the precedence used in routers/invitations._build_accept_url
    so reset emails always carry the canonical public domain on production."""
    fwd_host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").lower()
    if "emergent.host" in fwd_host or "audinexa.com" in fwd_host:
        return f"https://audinexa.com/reset-password/{token}"
    base = (os.environ.get("PUBLIC_APP_URL") or "").strip().rstrip("/")
    if base:
        return f"{base}/reset-password/{token}"
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = fwd_host or request.url.netloc
    return f"{proto}://{host}/reset-password/{token}"


def _is_strong_enough(pw: str) -> Optional[str]:
    """Return None if OK, else a human-readable reason."""
    if len(pw) < PASSWORD_MIN_LEN:
        return f"Password must be at least {PASSWORD_MIN_LEN} characters."
    if not re.search(r"[A-Za-z]", pw):
        return "Password must include at least one letter."
    if not re.search(r"\d", pw):
        return "Password must include at least one number."
    return None


async def _send_reset_email(to_email: str, name: str, reset_url: str, clinic_name: str) -> bool:
    """Best-effort email send — returns True/False so caller can log."""
    try:
        from utils.email import send_email
        html = f"""
        <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:540px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#0B5FFF,#00C2A8);color:#fff;padding:24px;border-radius:12px 12px 0 0">
            <h2 style="margin:0;font-size:22px">Reset your AUDINEXA password</h2>
            <p style="margin:6px 0 0;opacity:0.9;font-size:13px">{clinic_name}</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:0;padding:28px;border-radius:0 0 12px 12px">
            <p style="font-size:15px">Hi {name or "there"},</p>
            <p>We received a request to reset the password for <b>{to_email}</b>. Click the button below to choose a new one:</p>
            <p style="margin:24px 0;text-align:center">
              <a href="{reset_url}" style="background:#0B5FFF;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;display:inline-block;font-size:15px">Reset Password</a>
            </p>
            <p style="font-size:12px;color:#64748b">If the button doesn't work, copy this link into your browser:<br>
              <a href="{reset_url}" style="color:#0B5FFF;word-break:break-all">{reset_url}</a></p>
            <p style="font-size:12px;color:#94a3b8;margin-top:24px">
              This link expires in <b>1 hour</b>. If you didn't request this, you can safely ignore this email — your password won't change.
            </p>
            <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">
            <p style="font-size:11px;color:#94a3b8;text-align:center">AUDINEXA · Audiology clinic management · audinexa.com</p>
          </div>
        </div>
        """
        result = send_email(
            to=to_email,
            subject="Reset your AUDINEXA password",
            html_body=html,
            purpose="password_reset",
        )
        return (result or {}).get("status") == "sent"
    except Exception as exc:  # noqa: BLE001 — email is best-effort, never breaks the flow
        log.warning(f"reset email failed to {to_email}: {exc}")
        return False


# ─── Models ────────────────────────────────────────────────────────────

class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)
    new_password: str = Field(..., min_length=PASSWORD_MIN_LEN, max_length=200)


# ─── Endpoints ─────────────────────────────────────────────────────────

@router.post("/forgot-password")
@limiter.limit("5/15minutes")
async def forgot_password(request: Request, payload: ForgotPasswordIn = Body(...), db=Depends(get_db)):
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "active": 1, "clinic_id": 1})

    # Anti-enumeration: respond OK even if user not found / inactive.
    # We still log silent skips so support can investigate genuine misses.
    if not user or not user.get("active", True):
        log.info(f"forgot-password: silent skip for {email!r} (not found / inactive)")
        return {"ok": True, "message": GENERIC_OK_MESSAGE}

    # Generate token + persist hash
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
    ip = _client_ip(request)

    # Invalidate prior unused tokens for this user (only one live link at a time)
    await db.password_reset_tokens.update_many(
        {"user_id": user["user_id"], "used": False, "expires_at": {"$gt": now}},
        {"$set": {"superseded_at": now, "superseded": True}},
    )
    await db.password_reset_tokens.insert_one({
        "token_hash": token_hash,
        "user_id": user["user_id"],
        "email": email,
        "clinic_id": user.get("clinic_id"),
        "created_at": now,
        "expires_at": expires_at,
        "used": False,
        "ip_address": ip,
        "user_agent": request.headers.get("user-agent", "")[:300],
    })

    # Build the reset URL (production-domain-aware) and email it
    reset_url = _build_reset_url(request, token)
    clinic = await db.clinics.find_one({"clinic_id": user.get("clinic_id")}, {"_id": 0, "name": 1}) or {}
    sent = await _send_reset_email(email, user.get("name", ""), reset_url, clinic.get("name", "AUDINEXA"))

    # Audit log
    await db.auth_events.insert_one({
        "kind": "password_reset_requested",
        "email": email,
        "user_id": user["user_id"],
        "clinic_id": user.get("clinic_id"),
        "ip_address": ip,
        "email_sent": sent,
        "at": now.isoformat(),
    })
    log.info(f"forgot-password: token issued for {email} (sent={sent}, expires={expires_at.isoformat()})")
    return {"ok": True, "message": GENERIC_OK_MESSAGE}


@router.post("/reset-password")
@limiter.limit("10/15minutes")
async def reset_password(request: Request, payload: ResetPasswordIn = Body(...), db=Depends(get_db)):
    # Validate password strength early so a weak retry doesn't burn the token.
    bad = _is_strong_enough(payload.new_password)
    if bad:
        raise HTTPException(400, detail=bad)

    token_hash = _hash_token(payload.token)
    now = datetime.now(timezone.utc)
    row = await db.password_reset_tokens.find_one({"token_hash": token_hash}, {"_id": 0})
    if not row or row.get("used"):
        raise HTTPException(400, detail="This password reset link has already been used. Please request a new one.")
    if row.get("superseded"):
        raise HTTPException(400, detail="A newer reset link was issued — please use the latest email.")

    # Compare expiry as aware UTC.
    exp = row["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now:
        raise HTTPException(400, detail="This password reset link has expired. Please request a new one.")

    user = await db.users.find_one({"user_id": row["user_id"]}, {"_id": 0, "user_id": 1, "email": 1, "active": 1})
    if not user or not user.get("active", True):
        raise HTTPException(400, detail="Account is no longer active. Please contact your clinic administrator.")

    # Persist the new password hash and bump token_version so all old JWTs
    # for this user are invalidated (forces logout on every other device).
    new_hash = hash_password(payload.new_password)
    await db.users.update_one(
        {"user_id": row["user_id"]},
        {"$set": {"password_hash": new_hash, "password_changed_at": now.isoformat()},
         "$inc": {"token_version": 1}},
    )
    await db.password_reset_tokens.update_one(
        {"token_hash": token_hash},
        {"$set": {"used": True, "used_at": now,
                  "used_ip": _client_ip(request),
                  "used_user_agent": request.headers.get("user-agent", "")[:300]}},
    )
    await db.auth_events.insert_one({
        "kind": "password_reset_completed",
        "email": user["email"],
        "user_id": user["user_id"],
        "ip_address": _client_ip(request),
        "at": now.isoformat(),
    })
    log.info(f"reset-password: {user['email']} successfully reset their password")
    return {
        "ok": True,
        "email": user["email"],
        "message": "Your password has been reset. Please sign in with your new password.",
    }


# Indexes (idempotent — safe to call on every startup)
async def ensure_indexes(db):
    """Call this from server.py startup. Creates TTL on expires_at + lookup index."""
    await db.password_reset_tokens.create_index("token_hash", unique=True)
    await db.password_reset_tokens.create_index("user_id")
    # TTL — Mongo auto-deletes docs whose `expires_at` is in the past.
    # We give it +1 day grace so we still have a record for audit replay window.
    await db.password_reset_tokens.create_index(
        "expires_at",
        expireAfterSeconds=86_400,  # 24h after expiry, then sweep
    )
