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
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
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
    """
    token = _extract_token(request)
    payload = decode_token(token)
    db = request.app.state.db
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    # Safety: reject if stored clinic_id no longer matches token claim (tenant boundary)
    if user.get("clinic_id") != payload.get("clinic_id"):
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
        "clinic_id": user["clinic_id"],
        "branch_ids": user.get("branch_ids", []) or [],
        "active": user.get("active", True),
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
