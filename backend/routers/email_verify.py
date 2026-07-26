"""Email verification router — 6-digit OTP + resend + hard-block login.

Flow:
    1. POST /public/clinic-signup   — creates user with `email_verified=False`,
                                       fires OTP email via Zepto, returns
                                       `{verification_required: true, email: ...}`.
                                       NO access_token is returned.
    2. POST /auth/verify-email       — user submits `{email, code}`; on success
                                       marks user verified and issues the full
                                       login payload (JWT + cookies + user +
                                       clinic).
    3. POST /auth/resend-verification — regenerates code, resends email. Rate-
                                       limited by slowapi + application-level
                                       cooldown (60 s between resends).
    4. POST /auth/login              — existing endpoint; if `email_verified` is
                                       False, returns 403 with a payload the
                                       frontend uses to redirect to the verify
                                       screen.

Security:
    * Codes are 6-digit numeric, expire in 15 minutes.
    * Constant-time comparison on code (`secrets.compare_digest`).
    * Max 5 wrong attempts per code → code is invalidated, force resend.
    * Resend endpoint always returns 202 to prevent email enumeration.
    * Endpoint-level rate-limiting (slowapi) belt-and-braces the per-email
      cooldown.
    * Grandfathered users (`email_verified_via: "grandfathered"`) are never
      re-challenged.

Fields added to `users`:
    email_verified              bool
    email_verified_at           ISO str
    email_verified_via          "grandfathered" | "otp" | "magic_link"
    email_verification_code     6-digit str  (unset once verified)
    email_verification_expires  ISO str
    email_verification_attempts int
    email_verification_last_sent ISO str
"""
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from database import get_db
from rate_limit import limiter
from utils.email import send_email
from utils.serde import serialize_datetime

log = logging.getLogger("audinexa.email_verify")

router = APIRouter(prefix="/api", tags=["auth-email-verify"])

# ── Config ────────────────────────────────────────────────────────
CODE_TTL_MIN = 15
RESEND_COOLDOWN_S = 60
MAX_CODE_ATTEMPTS = 5


def _generate_code() -> str:
    """6-digit numeric OTP with cryptographically secure RNG."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


# ── Email template ────────────────────────────────────────────────
BRAND = "AUDINEXA"
APP_URL = os.environ.get("PUBLIC_APP_URL", "https://audinexa.com").rstrip("/")


def _build_email(name: str, code: str, magic_link: str):
    subject = f"{BRAND} — verify your email ({code})"
    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#FDFBF7;font-family:'IBM Plex Sans','Inter',system-ui,sans-serif;color:#1A1C23;">
    <div style="max-width:560px;margin:0 auto;padding:48px 32px;">
      <p style="font-family:'Cabinet Grotesk','Inter',sans-serif;font-size:32px;font-weight:800;letter-spacing:-0.02em;margin:0 0 8px 0;color:#1A1C23;">
        Welcome to {BRAND}, {name.split()[0] if name else 'clinician'}.
      </p>
      <p style="font-size:15px;color:#4A4D57;margin:0 0 32px 0;line-height:1.55;">
        We just need to confirm this is you before your 30-day Premium trial can begin.
        Two ways — pick whichever is easier.
      </p>

      <div style="background:white;border:1px solid #E2DFD8;border-radius:16px;padding:32px;text-align:center;">
        <p style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:#4A4D57;margin:0 0 12px 0;">
          Verification code
        </p>
        <p style="font-family:'Cabinet Grotesk','Inter',sans-serif;font-size:52px;font-weight:800;letter-spacing:0.24em;color:#D95D39;margin:0;">
          {code}
        </p>
        <p style="font-size:12px;color:#4A4D57;margin:12px 0 0 0;">
          Valid for {CODE_TTL_MIN} minutes.
        </p>
      </div>

      <div style="text-align:center;margin:24px 0;">
        <a href="{magic_link}" style="display:inline-block;padding:14px 28px;background:#D95D39;color:white;text-decoration:none;border-radius:9999px;font-weight:600;font-family:'Cabinet Grotesk','Inter',sans-serif;">
          Or verify with one click →
        </a>
      </div>

      <p style="font-size:13px;color:#4A4D57;margin-top:32px;line-height:1.6;">
        Didn't sign up for {BRAND}? You can safely ignore this email —
        no account is activated until the code is entered.
      </p>

      <hr style="border:0;border-top:1px solid #E2DFD8;margin:32px 0 16px 0;" />
      <p style="font-size:11px;color:#4A4D57;font-family:'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.1em;">
        {BRAND} · The audiology clinic OS built for India · <a href="{APP_URL}" style="color:#D95D39;text-decoration:none;">{APP_URL.replace('https://','')}</a>
      </p>
    </div>
  </body>
</html>"""
    text = (
        f"Welcome to {BRAND}.\n\n"
        f"Your verification code is: {code}\n"
        f"Valid for {CODE_TTL_MIN} minutes.\n\n"
        f"Or open this link to verify in one click:\n{magic_link}\n\n"
        f"Didn't sign up for {BRAND}? You can safely ignore this email."
    )
    return subject, html, text


async def issue_verification_code(db, user: dict, purpose: str = "signup") -> str:
    """Generate a fresh code, persist to user, and fire the email.

    Returns the code (for tests / mock-mode logging). Callers should treat
    this as internal — never expose the code in an API response.
    """
    code = _generate_code()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=CODE_TTL_MIN)
    magic = f"{APP_URL}/verify-email?email={user['email']}&code={code}"

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "email_verification_code": code,
            "email_verification_expires": _iso(expires),
            "email_verification_attempts": 0,
            "email_verification_last_sent": _iso(now),
        }},
    )
    subject, html_body, text_body = _build_email(user.get("name", ""), code, magic)
    email_result = send_email(
        to=user["email"],
        subject=subject,
        html_body=html_body,
        text_body=text_body,
        purpose=f"verify_email_{purpose}",
    )
    if email_result.get("status") not in ("sent", "mocked"):
        # Log loudly but don't break the signup — user can hit "resend"
        log.warning("Failed to send verification email to %s: %s",
                    user["email"], email_result.get("error") or email_result.get("message"))
    else:
        log.info("Verification email dispatched to %s via %s (msg_id=%s)",
                 user["email"], email_result.get("provider"), email_result.get("message_id"))
    return code


# ══════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════

class VerifyEmailIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


@router.post("/auth/verify-email")
@limiter.limit("20/minute")
async def verify_email(request: Request, response: Response, payload: VerifyEmailIn = Body(...), db=Depends(get_db)):
    email = str(payload.email).strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        # Enumeration guard — same 400 as "bad code" so attackers can't
        # tell "user doesn't exist" from "wrong code".
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    if user.get("email_verified"):
        # Idempotent — already verified, just log them in
        return await _issue_login_response(db, user, request, response)

    stored = user.get("email_verification_code") or ""
    expires_iso = user.get("email_verification_expires") or ""
    attempts = int(user.get("email_verification_attempts") or 0)

    if attempts >= MAX_CODE_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")

    if not stored or not expires_iso:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    try:
        expires = datetime.fromisoformat(expires_iso)
    except ValueError:
        expires = datetime.now(timezone.utc) - timedelta(seconds=1)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(status_code=400, detail="Code expired. Request a new one.")

    # Constant-time comparison
    if not secrets.compare_digest(stored, payload.code):
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"email_verification_attempts": 1}},
        )
        remaining = MAX_CODE_ATTEMPTS - (attempts + 1)
        detail = "Invalid or expired code"
        if remaining <= 2:
            detail = f"Invalid code — {remaining} attempt(s) left"
        raise HTTPException(status_code=400, detail=detail)

    # SUCCESS — mark verified, clear code, log the user in
    now_iso = _iso(datetime.now(timezone.utc))
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email_verified": True, "email_verified_at": now_iso,
                  "email_verified_via": "otp"},
         "$unset": {"email_verification_code": "",
                    "email_verification_expires": "",
                    "email_verification_attempts": ""}},
    )
    log.info("Email verified for %s via OTP", email)
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return await _issue_login_response(db, fresh, request, response)


class ResendVerificationIn(BaseModel):
    email: EmailStr


@router.post("/auth/resend-verification", status_code=202)
@limiter.limit("5/minute")
async def resend_verification(request: Request, payload: ResendVerificationIn = Body(...), db=Depends(get_db)):
    """Always returns 202 to prevent email enumeration."""
    email = str(payload.email).strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or user.get("email_verified"):
        return {"ok": True, "message": "If an unverified account exists, a new code has been sent."}

    # Application-level 60s cooldown per email
    last_sent_iso = user.get("email_verification_last_sent")
    if last_sent_iso:
        try:
            last_sent = datetime.fromisoformat(last_sent_iso)
            if (datetime.now(timezone.utc) - last_sent).total_seconds() < RESEND_COOLDOWN_S:
                # Silent success — the frontend cooldown timer prevents accidental spam
                return {"ok": True, "message": "If an unverified account exists, a new code has been sent."}
        except ValueError:
            pass

    await issue_verification_code(db, user, purpose="resend")
    return {"ok": True, "message": "If an unverified account exists, a new code has been sent."}


# ── Shared login-response helper (mirrors server.py login) ────────
async def _issue_login_response(db, user: dict, request: Request, response: Response) -> dict:
    """Same shape as POST /auth/login — cookies + JSON body."""
    from auth import create_access_token
    from utils.auth_cookies import set_auth_cookies
    from utils.activity import record_login

    # Import lazily to avoid circular imports
    try:
        from server import mint_session_row
    except ImportError:
        # Fallback for testing
        async def mint_session_row(db, u, r, purpose):
            return None
    sid = await mint_session_row(db, user, request, purpose="verify-email")
    token = create_access_token(
        user["user_id"], user["email"], user["role"], user["clinic_id"],
        token_version=int(user.get("token_version", 0) or 0),
        session_id=sid,
    )
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    try:
        await record_login(db, user, clinic, request)
    except Exception:
        pass
    csrf = set_auth_cookies(response, token, request)
    return {
        "access_token": token,
        "token_type": "bearer",
        "csrf_token": csrf,
        "user": {
            "user_id": user["user_id"], "email": user["email"],
            "name": user.get("name", ""), "role": user["role"],
            "clinic_id": user["clinic_id"],
            "branch_ids": user.get("branch_ids", []) or [],
        },
        "clinic": clinic,
    }
