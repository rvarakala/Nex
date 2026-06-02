"""TOTP / 2FA endpoints — clinic_owner + super_admin + founder only.

Endpoints
---------
  POST  /api/mfa/setup/init        — generate a fresh TOTP secret + provisioning URI.
  POST  /api/mfa/setup/verify      — confirm with a 6-digit code; returns recovery codes (once).
  POST  /api/mfa/disable           — verify code, then disable MFA.
  GET   /api/mfa/status            — does the current user have MFA enabled?

  POST  /api/auth/mfa/verify-login — second step of login: send {mfa_token, code}
                                     → receive {access_token, user, clinic}.

Login (`/api/auth/login` in server.py) returns either:
  - `{access_token, user, clinic}` (no MFA enabled), OR
  - `{requires_mfa: true, mfa_token: <short-lived JWT>}`.

Storage
-------
  users.mfa_enabled              : bool
  users.mfa_secret_encrypted     : str (Fernet-encrypted base32)
  users.mfa_temp_secret_encrypted: str — set during setup, promoted on verify.
  users.mfa_recovery_codes       : list[{hash, used}] — bcrypt-hashed, single-use.
  users.mfa_created_at           : ISO string.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
import pyotp
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from auth import (
    JWT_ALGORITHM, _jwt_secret, create_access_token, get_current_user,
)
from database import get_db

router = APIRouter(prefix="/api/mfa", tags=["mfa"])
auth_router = APIRouter(prefix="/api/auth", tags=["auth-mfa"])

MFA_ELIGIBLE_ROLES = {"clinic_owner", "super_admin", "founder"}
MFA_TOKEN_TTL = timedelta(minutes=5)


# ─── Crypto: encrypt the TOTP secret at rest ────────────────────────────
#
# We derive a Fernet key from `MFA_SECRET_ENC_KEY` (env) or, as a safe
# fallback, from `JWT_SECRET`. This means a stolen DB alone can't reveal
# usable TOTP secrets without the runtime key.

def _fernet() -> Fernet:
    raw = os.environ.get("MFA_SECRET_ENC_KEY") or _jwt_secret()
    # Fernet needs a url-safe base64-encoded 32-byte key. Derive deterministically.
    key = base64.urlsafe_b64encode(hashlib.sha256(raw.encode("utf-8")).digest())
    return Fernet(key)


def _encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def _decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(status_code=500, detail="MFA secret decryption failed") from exc


# ─── Recovery code helpers ───────────────────────────────────────────────

_ALPHABET = string.ascii_uppercase + string.digits


def _generate_recovery_codes(count: int = 10, length: int = 10) -> list[str]:
    """Plain codes shown to the user once; never stored as plaintext."""
    return ["".join(secrets.choice(_ALPHABET) for _ in range(length)) for _ in range(count)]


def _hash_recovery_codes(codes: list[str]) -> list[dict]:
    return [
        {"hash": bcrypt.hashpw(c.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
         "used": False}
        for c in codes
    ]


def _try_consume_recovery_code(stored: list[dict], submitted: str) -> tuple[bool, list[dict]]:
    """Returns (matched, updated_list). Marks the matched code as used."""
    updated = []
    matched = False
    for entry in stored or []:
        if not entry.get("used") and not matched:
            try:
                if bcrypt.checkpw(submitted.encode("utf-8"), entry["hash"].encode("utf-8")):
                    entry = {**entry, "used": True}
                    matched = True
            except Exception:
                pass
        updated.append(entry)
    return matched, updated


# ─── MFA token (short-lived, for the second login step only) ─────────────

def _create_mfa_token(user_id: str) -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "exp": datetime.now(timezone.utc) + MFA_TOKEN_TTL,
            "type": "mfa_step",
        },
        _jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )


def _decode_mfa_token(token: str) -> str:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="MFA challenge expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid MFA token")
    if payload.get("type") != "mfa_step":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload["sub"]


# ─── Helpers ─────────────────────────────────────────────────────────────

def _require_eligible(user):
    if user["role"] not in MFA_ELIGIBLE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="2FA is available only for clinic owners and super admins.",
        )


def _issuer_label(clinic_name: Optional[str]) -> str:
    name = (clinic_name or "AUDINEXA").strip()
    # RFC 6238 issuer cannot contain colons.
    return name.replace(":", " ") + " · AUDINEXA"


# ─── Models ──────────────────────────────────────────────────────────────

class MfaSetupInitOut(BaseModel):
    secret_base32: str
    provisioning_uri: str


class MfaVerifyIn(BaseModel):
    code: str = Field(min_length=6, max_length=12)


class MfaDisableIn(BaseModel):
    code: str = Field(min_length=6, max_length=12)
    use_recovery_code: bool = False


class MfaLoginVerifyIn(BaseModel):
    mfa_token: str
    code: str = Field(min_length=6, max_length=12)
    use_recovery_code: bool = False


# ─── Endpoints ───────────────────────────────────────────────────────────

@router.get("/status")
async def mfa_status(user=Depends(get_current_user), db=Depends(get_db)):
    """Lightweight check — used by the Security & Privacy UI."""
    doc = await db.users.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "mfa_enabled": 1, "mfa_created_at": 1, "mfa_recovery_codes": 1},
    ) or {}
    codes = doc.get("mfa_recovery_codes") or []
    return {
        "mfa_enabled": bool(doc.get("mfa_enabled")),
        "mfa_eligible": user["role"] in MFA_ELIGIBLE_ROLES,
        "created_at": doc.get("mfa_created_at"),
        "unused_recovery_codes": sum(1 for c in codes if not c.get("used")),
    }


@router.post("/setup/init", response_model=MfaSetupInitOut)
async def mfa_setup_init(user=Depends(get_current_user), db=Depends(get_db)):
    """Generate a fresh secret. Overwrites any in-flight (unconfirmed) setup."""
    _require_eligible(user)
    secret = pyotp.random_base32()
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0, "name": 1})
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(
        name=user["email"], issuer_name=_issuer_label((clinic or {}).get("name")),
    )
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"mfa_temp_secret_encrypted": _encrypt(secret)}},
    )
    return MfaSetupInitOut(secret_base32=secret, provisioning_uri=provisioning_uri)


@router.post("/setup/verify")
async def mfa_setup_verify(
    payload: MfaVerifyIn,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Confirm setup. On success, MFA is enabled and recovery codes are shown ONCE."""
    _require_eligible(user)
    doc = await db.users.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "mfa_temp_secret_encrypted": 1, "mfa_enabled": 1},
    ) or {}
    enc = doc.get("mfa_temp_secret_encrypted")
    if not enc:
        raise HTTPException(status_code=400, detail="No pending MFA setup — call /setup/init first")
    secret = _decrypt(enc)
    if not pyotp.TOTP(secret).verify(payload.code.strip(), valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code — try again with a fresh code from your app")

    recovery_plain = _generate_recovery_codes(10, 10)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                "mfa_enabled": True,
                "mfa_secret_encrypted": enc,
                "mfa_recovery_codes": _hash_recovery_codes(recovery_plain),
                "mfa_created_at": datetime.now(timezone.utc).isoformat(),
            },
            "$unset": {"mfa_temp_secret_encrypted": ""},
        },
    )
    return {"success": True, "recovery_codes": recovery_plain}


@router.post("/disable")
async def mfa_disable(
    payload: MfaDisableIn,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Require a fresh code (or recovery code) before disabling — defence-in-depth."""
    _require_eligible(user)
    doc = await db.users.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "mfa_enabled": 1, "mfa_secret_encrypted": 1, "mfa_recovery_codes": 1},
    ) or {}
    if not doc.get("mfa_enabled"):
        raise HTTPException(status_code=400, detail="MFA is not enabled for this account")

    if payload.use_recovery_code:
        matched, _ = _try_consume_recovery_code(doc.get("mfa_recovery_codes") or [], payload.code.strip())
        ok = matched
    else:
        ok = pyotp.TOTP(_decrypt(doc["mfa_secret_encrypted"])).verify(payload.code.strip(), valid_window=1)

    if not ok:
        raise HTTPException(status_code=400, detail="Invalid code")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {"mfa_enabled": False},
            "$unset": {
                "mfa_secret_encrypted": "",
                "mfa_recovery_codes": "",
                "mfa_temp_secret_encrypted": "",
                "mfa_created_at": "",
            },
        },
    )
    return {"success": True}


# ─── Second-step login endpoint ──────────────────────────────────────────

@auth_router.post("/mfa/verify-login")
async def mfa_verify_login(request: Request, payload: MfaLoginVerifyIn, response: Response, db=Depends(get_db)):
    user_id = _decode_mfa_token(payload.mfa_token)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user or not user.get("active", True) or not user.get("mfa_enabled"):
        raise HTTPException(status_code=401, detail="MFA challenge invalid")

    if payload.use_recovery_code:
        matched, updated = _try_consume_recovery_code(
            user.get("mfa_recovery_codes") or [], payload.code.strip(),
        )
        if not matched:
            raise HTTPException(status_code=401, detail="Invalid recovery code")
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"mfa_recovery_codes": updated}},
        )
    else:
        secret = _decrypt(user["mfa_secret_encrypted"])
        if not pyotp.TOTP(secret).verify(payload.code.strip(), valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid code")

    from routers.user_sessions import mint_session_row
    sid = await mint_session_row(db, user, request, purpose="mfa")
    token = create_access_token(
        user["user_id"], user["email"], user["role"], user["clinic_id"],
        token_version=int(user.get("token_version", 0) or 0),
        session_id=sid,
    )
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})

    # Audit the login as if it came through the normal path.
    try:
        from utils.activity import record_login
        await record_login(db, user, clinic, request)
    except Exception:
        pass

    # P1 XSS hardening — set httpOnly cookies (matched on the verify-login
    # path so the post-2FA browser session uses cookie auth).
    from utils.auth_cookies import set_auth_cookies
    csrf = set_auth_cookies(response, token)

    return {
        "access_token": token,
        "token_type": "bearer",
        "csrf_token": csrf,
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "name": user.get("name", ""),
            "role": user["role"],
            "clinic_id": user["clinic_id"],
            "branch_ids": user.get("branch_ids", []) or [],
        },
        "clinic": clinic,
    }


# ─── Helper exposed to server.login() ────────────────────────────────────

def issue_mfa_challenge(user_id: str) -> dict:
    """Returned by /api/auth/login when the user has MFA enabled."""
    return {"requires_mfa": True, "mfa_token": _create_mfa_token(user_id)}
