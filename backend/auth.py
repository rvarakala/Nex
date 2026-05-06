"""
Authentication + RBAC + multi-tenant scoping for ACS.
- JWT (HS256) with Bearer token in Authorization header (frontend stores in localStorage).
- bcrypt for password hashing.
- Roles: super_admin, front_desk, audiologist, accounts.
- Tenant scoping: every authenticated request carries `clinic_id` in JWT claims.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import bcrypt
import jwt
from fastapi import HTTPException, Request, status

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(hours=12)  # front-desk runs all day; 12h is pragmatic for this sprint

# bcrypt silently truncates input longer than 72 bytes — a 100-char password
# would auth-equivalent to its first 72 bytes, which is a real auth-bypass
# vector. We enforce the cap at the hashing boundary so EVERY caller (login,
# reset-password, admin reset, seeds) is protected, regardless of whether
# their Pydantic model added max_length.
MAX_PASSWORD_BYTES = 72

VALID_ROLES = {
    "super_admin", "clinic_owner", "front_desk", "audiologist",
    "accounts", "inventory_manager", "technician", "referral_partner",
    "founder",
    # Phase 14C granular internal-team roles
    "sales_manager", "support_agent", "finance_manager", "product_ops", "read_only",
}
# Roles that see every branch of a clinic; everyone else is branch-scoped.
CLINIC_WIDE_ROLES = {"super_admin", "clinic_owner", "accounts", "founder"}


def _jwt_secret() -> str:
    s = os.environ.get("JWT_SECRET")
    if not s:
        raise RuntimeError("JWT_SECRET not configured")
    return s


def hash_password(pw: str) -> str:
    if len(pw.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Password is too long. Please use {MAX_PASSWORD_BYTES} characters or fewer.",
        )
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        # Reject inputs longer than bcrypt's 72-byte limit so an attacker can't
        # bypass auth with a 100-char password whose first 72 bytes match.
        # Existing accounts unaffected — their stored hashes were created from
        # passwords already <= 72 bytes (older code never enforced this, but
        # passwords longer than 72 are extremely rare in practice).
        if len(pw.encode("utf-8")) > MAX_PASSWORD_BYTES:
            return False
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str, clinic_id: str, token_version: int = 0) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "clinic_id": clinic_id,
        "tv": int(token_version or 0),  # token version — incremented to force-logout all sessions
        "exp": datetime.now(timezone.utc) + ACCESS_TOKEN_TTL,
        "type": "access",
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def _extract_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    # Cookie fallback (optional)
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload


async def get_current_user(request: Request):
    """FastAPI dependency — returns dict: {user_id, email, role, clinic_id}.

    The DB existence check is done once per request so revoked users are rejected.
    Also updates user's last-seen heartbeat (throttled to 1 write/min per user).

    Multi-clinic: the JWT's `clinic_id` claim is the *active* clinic. We check
    that the user has access to it either as their primary clinic or via
    `additional_clinic_ids`. The returned dict's `clinic_id` is the JWT's
    active one — so every downstream tenant-scoped query just works.
    """
    token = _extract_token(request)
    payload = decode_token(token)
    db = request.app.state.db
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Multi-clinic: accept the token's clinic_id if it's the primary OR one of
    # the user's granted additional clinics (set by super_admin via Settings).
    allowed: set = {user.get("clinic_id")}
    for cid in user.get("additional_clinic_ids", []) or []:
        allowed.add(cid)
    if payload.get("clinic_id") not in allowed:
        raise HTTPException(status_code=401, detail="Tenant mismatch")

    # Force-logout check: if user's token_version was bumped after this token
    # was issued, reject (user must re-login)
    current_tv = int(user.get("token_version", 0) or 0)
    token_tv = int(payload.get("tv", 0) or 0)
    if token_tv < current_tv:
        raise HTTPException(status_code=401, detail="Session revoked, please sign in again")
    # Heartbeat — fire-and-forget, never blocks the request
    try:
        from utils.activity import record_heartbeat
        await record_heartbeat(db, user["user_id"], request)
    except Exception:
        pass
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user["role"],
        "clinic_id": payload["clinic_id"],  # ← active clinic from JWT, not user.clinic_id
        "primary_clinic_id": user.get("clinic_id"),
        "additional_clinic_ids": list(user.get("additional_clinic_ids", []) or []),
        "branch_ids": user.get("branch_ids", []) or [],
        "active": user.get("active", True),
        "signature_image_fs_id": user.get("signature_image_fs_id"),
        "license_no": user.get("license_no"),
        "appointment_color": user.get("appointment_color"),
    }


def require_roles(*roles: str):
    """Returns a FastAPI dependency that enforces one of the given roles.
    `super_admin` and `founder` always bypass every role gate in the codebase.
    """
    async def checker(request: Request):
        user = await get_current_user(request)
        if user["role"] not in set(roles) | {"super_admin", "founder"}:
            raise HTTPException(status_code=403, detail=f"Requires one of: {roles}")
        return user
    return checker


def user_can_see_branch(user: dict, branch_id: str) -> bool:
    """Clinic-wide roles see every branch of their clinic; everyone else must
    have the branch explicitly in their `branch_ids` list."""
    if user.get("role") in CLINIC_WIDE_ROLES:
        return True
    return branch_id in (user.get("branch_ids") or [])


def assert_branch_access(user: dict, branch_id: str) -> None:
    """Raises 403 if the user cannot act on `branch_id`."""
    if not user_can_see_branch(user, branch_id):
        raise HTTPException(status_code=403, detail="Branch access denied")
