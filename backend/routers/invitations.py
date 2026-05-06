"""Email-token invitation flow (P1 onboarding upgrade).

Goal: replace "create user with temp password → owner WhatsApps password" with
"create token-based invite link → owner shares link → invitee sets own password".

Why it's safer:
  - Password never travels in plaintext over WhatsApp / email
  - Token is single-use + auto-expires (default 7 days)
  - Owner can revoke a pending invite before it's accepted
  - Audit trail: who invited whom, when accepted, from which IP

Endpoints (mounted under /api by main):
  POST   /settings/staff/invite              — clinic owner creates an invite for a staff member
  GET    /settings/staff/invitations         — list pending + recently-used invites
  DELETE /settings/staff/invite/{token}      — revoke a pending invite
  GET    /public/invitations/{token}         — invitee fetches invite metadata (no auth)
  POST   /public/invitations/{token}/accept  — invitee sets password, gets a JWT (no auth)
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4
import os
import secrets

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from typing import Annotated

from auth import get_current_user, hash_password, create_access_token, require_roles
from database import get_db
from rate_limit import limiter


# ----------------------------- Constants -----------------------------------

INVITE_TTL_DAYS = 7
ALLOWED_STAFF_ROLES = {"clinic_owner", "audiologist", "front_desk", "accounts"}


# ----------------------------- Models --------------------------------------

class InviteCreateRequest(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(...)
    branch_ids: list[str] = Field(default_factory=list)
    phone: Optional[str] = None


class InviteResponse(BaseModel):
    """Owner-facing response. The owner shares `accept_url` with the invitee
    via WhatsApp / email / Slack — whatever channel they prefer."""
    token: str
    accept_url: str
    email: str
    name: str
    role: str
    expires_at: datetime
    status: str = "pending"


class InviteListItem(BaseModel):
    token_preview: str  # first 8 chars only — full token only revealed at create time
    email: str
    name: str
    role: str
    status: str  # pending | accepted | revoked | expired
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None


class PublicInviteInfo(BaseModel):
    """What the invitee sees when they click the link. Note we expose the
    clinic name so they know which clinic they're joining."""
    email: str
    name: str
    role: str
    clinic_name: str
    expires_at: datetime
    status: str


class AcceptInviteRequest(BaseModel):
    password: str = Field(..., min_length=10, max_length=128, description="Min 10 chars; user-set")


class AcceptInviteResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    role: str
    clinic_id: str
    must_change_password: bool = False  # set False — they just chose it themselves


# ----------------------------- Router --------------------------------------

router = APIRouter(tags=["invitations"])


def _ensure_aware(dt):
    """MongoDB sometimes returns naive datetimes after roundtripping; coerce
    them back to UTC so we can compare against datetime.now(timezone.utc)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _build_accept_url(request: Request, token: str) -> str:
    """Build the absolute URL the invitee will click.

    Order of precedence:
      1. ``PUBLIC_APP_URL`` env var (set this on production to ``https://audinexa.com``).
      2. If running on the production deployment host (``*.emergent.host``) → fall back to ``https://audinexa.com``.
      3. ``X-Forwarded-Proto`` + ``X-Forwarded-Host`` request headers.
      4. The request's own scheme + host (last resort, often the internal ingress URL).
    """
    base = (os.environ.get("PUBLIC_APP_URL") or "").strip().rstrip("/")
    if base:
        return f"{base}/invite/{token}"

    fwd_host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").lower()
    # Production host fallback — emergent.host is the internal deployment hostname
    # the K8s ingress uses; clients see audinexa.com publicly.
    if "emergent.host" in fwd_host or "audinexa.com" in fwd_host:
        return f"https://audinexa.com/invite/{token}"

    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = fwd_host or request.url.netloc
    return f"{proto}://{host}/invite/{token}"


def _serialize_invite_for_owner(inv: dict) -> dict:
    """Strip sensitive fields, expose only the preview hash & metadata."""
    return {
        "token_preview": (inv.get("token", "") or "")[:8],
        "email": inv["email"],
        "name": inv["name"],
        "role": inv["role"],
        "status": inv.get("status", "pending"),
        "created_at": inv["created_at"],
        "expires_at": inv["expires_at"],
        "accepted_at": inv.get("accepted_at"),
    }


# ------------------------- Owner endpoints ---------------------------------

@router.post("/settings/staff/invite", response_model=InviteResponse)
async def create_invite(
    request: Request,
    payload: Annotated[InviteCreateRequest, Body()],
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    """Owner generates a single-use token-based invitation. No password is
    set yet — the invitee chooses their own when accepting."""
    if payload.role not in ALLOWED_STAFF_ROLES:
        raise HTTPException(400, detail=f"role must be one of {sorted(ALLOWED_STAFF_ROLES)}")

    email = payload.email.strip().lower()

    # Block duplicate-active accounts within the same clinic
    existing = await db.users.find_one(
        {"clinic_id": user["clinic_id"], "email": email},
        {"_id": 0, "user_id": 1, "active": 1},
    )
    if existing and existing.get("active") is not False:
        raise HTTPException(409, detail="A user with this email already exists in your clinic")

    # If a pending invite already exists, revoke it (owner can re-invite freely)
    await db.invitations.update_many(
        {"clinic_id": user["clinic_id"], "email": email, "status": "pending"},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},
    )

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=INVITE_TTL_DAYS)

    invite_doc = {
        "invite_id": f"INV-{uuid4().hex[:10].upper()}",
        "token": token,
        "clinic_id": user["clinic_id"],
        "email": email,
        "name": payload.name.strip(),
        "role": payload.role,
        "branch_ids": payload.branch_ids,
        "phone": payload.phone,
        "status": "pending",
        "created_at": now,
        "created_by": user["user_id"],
        "expires_at": expires_at,
    }
    await db.invitations.insert_one(invite_doc)

    return InviteResponse(
        token=token,
        accept_url=_build_accept_url(request, token),
        email=email,
        name=payload.name,
        role=payload.role,
        expires_at=expires_at,
    )


@router.get("/settings/staff/invitations", response_model=list[InviteListItem])
async def list_invitations(
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    """Owner-facing list. Auto-marks expired invites in real time (no cron needed)."""
    now = datetime.now(timezone.utc)
    cursor = db.invitations.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0},
    ).sort("created_at", -1).limit(100)
    items: list[InviteListItem] = []
    expired_to_mark: list[str] = []
    async for inv in cursor:
        inv["expires_at"] = _ensure_aware(inv.get("expires_at"))
        inv["created_at"] = _ensure_aware(inv.get("created_at"))
        if inv.get("status") == "pending" and inv["expires_at"] and inv["expires_at"] < now:
            inv["status"] = "expired"
            expired_to_mark.append(inv["invite_id"])
        items.append(InviteListItem(**_serialize_invite_for_owner(inv)))
    if expired_to_mark:
        await db.invitations.update_many(
            {"invite_id": {"$in": expired_to_mark}},
            {"$set": {"status": "expired"}},
        )
    return items


@router.delete("/settings/staff/invite/{token}")
async def revoke_invite(
    token: str,
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    """Owner revokes a pending invite. Idempotent: revoking an already-used
    invite is a no-op so the UI doesn't have to special-case it."""
    res = await db.invitations.update_one(
        {"clinic_id": user["clinic_id"], "token": token, "status": "pending"},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, detail="No pending invite with that token")
    return {"ok": True}


# --------------------- Public (invitee-side) endpoints ---------------------

@router.get("/public/invitations/{token}", response_model=PublicInviteInfo)
@limiter.limit("30/minute")
async def public_invite_info(
    request: Request,
    token: str,
    db=Depends(get_db),
):
    """Invitee landing page calls this to render the welcome screen.
    Rate-limited to deter token enumeration."""
    inv = await db.invitations.find_one({"token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(404, detail="Invitation not found")

    # Auto-expire inline so we don't return stale "pending" status
    now = datetime.now(timezone.utc)
    inv["expires_at"] = _ensure_aware(inv.get("expires_at"))
    if inv["status"] == "pending" and inv["expires_at"] and inv["expires_at"] < now:
        await db.invitations.update_one({"token": token}, {"$set": {"status": "expired"}})
        inv["status"] = "expired"

    clinic = await db.clinics.find_one({"clinic_id": inv["clinic_id"]}, {"_id": 0, "name": 1})
    return PublicInviteInfo(
        email=inv["email"],
        name=inv["name"],
        role=inv["role"],
        clinic_name=(clinic or {}).get("name", "your clinic"),
        expires_at=inv["expires_at"],
        status=inv["status"],
    )


@router.post("/public/invitations/{token}/accept", response_model=AcceptInviteResponse)
@limiter.limit("10/minute")
async def accept_invite(
    request: Request,
    token: str,
    payload: Annotated[AcceptInviteRequest, Body()],
    db=Depends(get_db),
):
    """Atomic: marks the invite consumed AND creates the user.

    Race-safe: the `status: pending` filter on the update guarantees only one
    accept request wins if two are fired simultaneously."""
    now = datetime.now(timezone.utc)

    # Step 1: atomically consume the invite
    inv = await db.invitations.find_one_and_update(
        {"token": token, "status": "pending", "expires_at": {"$gt": now}},
        {"$set": {"status": "accepted", "accepted_at": now,
                  "accepted_ip": (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
                                  or (request.client.host if request.client else None)}},
        return_document=True,
    )
    if not inv:
        # Distinguish 404 vs 410 vs 409 for cleaner client UX
        existing = await db.invitations.find_one({"token": token}, {"_id": 0})
        if not existing:
            raise HTTPException(404, detail="Invitation not found")
        if existing.get("status") in {"accepted"}:
            raise HTTPException(409, detail="Invitation has already been used")
        if existing.get("status") == "revoked":
            raise HTTPException(410, detail="Invitation has been revoked")
        raise HTTPException(410, detail="Invitation has expired")

    # Step 2: create or activate the user
    user_doc = await db.users.find_one(
        {"clinic_id": inv["clinic_id"], "email": inv["email"]}, {"_id": 0},
    )
    if user_doc:
        # Reactivate path — owner re-invited a previously-deactivated user
        await db.users.update_one(
            {"user_id": user_doc["user_id"]},
            {"$set": {
                "active": True,
                "password_hash": hash_password(payload.password),
                "must_change_password": False,
                "role": inv["role"],
                "branch_ids": inv.get("branch_ids", []),
                "name": inv["name"],
            }},
        )
        user_id = user_doc["user_id"]
    else:
        user_id = f"USR-{uuid4().hex[:8].upper()}"
        new_user = {
            "user_id": user_id,
            "clinic_id": inv["clinic_id"],
            "email": inv["email"],
            "name": inv["name"],
            "role": inv["role"],
            "branch_ids": inv.get("branch_ids", []),
            "phone": inv.get("phone"),
            "active": True,
            "must_change_password": False,
            "password_hash": hash_password(payload.password),
            "created_at": now,
            "created_via": "invitation",
            "invitation_id": inv["invite_id"],
        }
        await db.users.insert_one(new_user)

    # Step 3: issue JWT so the invitee lands directly on the dashboard
    access_token = create_access_token(
        user_id=user_id,
        email=inv["email"],
        role=inv["role"],
        clinic_id=inv["clinic_id"],
    )

    return AcceptInviteResponse(
        access_token=access_token,
        user_id=user_id,
        email=inv["email"],
        role=inv["role"],
        clinic_id=inv["clinic_id"],
    )
