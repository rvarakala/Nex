"""Clinic Settings router — Feb 2026 (Phase 1).

Consolidated endpoints used by the new `/settings` UI for clinic owners:

    GET  /api/settings/clinic            — full clinic record
    PUT  /api/settings/clinic            — update name / address / GSTIN / etc.
    POST /api/settings/clinic/logo       — upload logo (PNG/JPG/SVG, ≤2 MB)
    GET  /api/settings/clinic/logo       — stream stored logo
    POST /api/settings/staff             — create a new staff account
                                           (auto-generates password, returns it so
                                            the UI can show/email it to the user)
    PUT  /api/settings/staff/{user_id}   — update name / role / branch access / active
    POST /api/settings/staff/{user_id}/reset-password — generate + return a new temp password
    POST /api/settings/staff/{user_id}/force-logout   — bump token_version → kick them out

Branch CRUD already exists in `routers/branches.py` — we re-expose the same
endpoints under /api/settings/* is not needed; the Settings UI calls the
existing /api/branches endpoints directly.
"""
from __future__ import annotations

import io
import secrets
import string
from datetime import datetime, timezone
from typing import List, Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel

from auth import get_current_user, hash_password, require_roles
from database import get_db
from models import User
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api/settings", tags=["settings"])

_ALLOWED_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml"}
_MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB


# ---------- Clinic details ----------
class ClinicUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None


@router.get("/clinic")
async def get_clinic(user=Depends(get_current_user), db=Depends(get_db)):
    c = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Clinic not found")
    return deserialize_datetime(c)


@router.put("/clinic")
async def update_clinic(
    payload: ClinicUpdate,
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.clinics.update_one(
        {"clinic_id": user["clinic_id"]}, {"$set": patch}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Clinic not found")
    c = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    return deserialize_datetime(c)


# ---------- Clinic logo (GridFS) ----------
@router.post("/clinic/logo")
async def upload_clinic_logo(
    file: UploadFile = File(...),
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    if file.content_type not in _ALLOWED_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported type {file.content_type}. Use PNG, JPG, or SVG.",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > _MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo too large (max 2 MB)")

    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="clinic_logos")

    # Remove previous logo for this clinic (idempotent).
    c = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    old = (c or {}).get("logo_fs_id")
    if old:
        try:
            await bucket.delete(ObjectId(old))
        except Exception:
            pass  # missing/orphan is fine

    fs_id = await bucket.upload_from_stream(
        filename=file.filename or "logo",
        source=raw,
        metadata={
            "clinic_id": user["clinic_id"],
            "content_type": file.content_type,
            "size_bytes": len(raw),
            "uploaded_by_user_id": user["user_id"],
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await db.clinics.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {
            "logo_fs_id": str(fs_id),
            "logo_mime": file.content_type,
            "logo_updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True, "logo_fs_id": str(fs_id), "size_bytes": len(raw)}


@router.get("/clinic/logo")
async def get_clinic_logo(user=Depends(get_current_user), db=Depends(get_db)):
    c = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    if not c or not c.get("logo_fs_id"):
        raise HTTPException(status_code=404, detail="No logo set")
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="clinic_logos")
    try:
        stream = await bucket.open_download_stream(ObjectId(c["logo_fs_id"]))
        raw = await stream.read()
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Logo not found: {e}")
    return StreamingResponse(
        io.BytesIO(raw),
        media_type=c.get("logo_mime") or "image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


# ---------- Staff ----------
_STAFF_ROLES = ("clinic_owner", "front_desk", "audiologist", "accounts",
                "inventory_manager", "technician")

_EMAIL_ALPHABET = string.ascii_letters + string.digits
def _gen_password(n: int = 12) -> str:
    """Generate a URL-safe temp password: 12 mixed case + digits."""
    return "".join(secrets.choice(_EMAIL_ALPHABET) for _ in range(n))


class StaffCreate(BaseModel):
    name: str
    email: str
    role: Literal["clinic_owner", "front_desk", "audiologist", "accounts",
                  "inventory_manager", "technician"]
    branch_ids: List[str] = []
    phone: Optional[str] = None


class StaffUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["clinic_owner", "front_desk", "audiologist", "accounts",
                           "inventory_manager", "technician"]] = None
    branch_ids: Optional[List[str]] = None
    phone: Optional[str] = None
    active: Optional[bool] = None


async def _log_mock_email(db, clinic_id: str, to: str, subject: str, body: str, kind: str = "staff_welcome"):
    """Store the email payload in mongo + server log so a real SMTP provider
    can retro-fire them once integrated."""
    await db.email_outbox.insert_one({
        "clinic_id": clinic_id,
        "to": to,
        "subject": subject,
        "body": body,
        "kind": kind,
        "status": "mocked",  # flip to `sent` once real delivery lands
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # Also print to server log for debugging / demo.
    import logging
    logging.getLogger("settings.mock_email").info(
        f"[MOCK-EMAIL clinic={clinic_id}] TO={to} SUBJECT={subject}"
    )


@router.post("/staff")
async def create_staff(
    payload: StaffCreate,
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    # Email uniqueness check (per-clinic — same email across different tenants is fine).
    email = payload.email.strip().lower()
    existing = await db.users.find_one(
        {"clinic_id": user["clinic_id"], "email": email}, {"_id": 0, "user_id": 1},
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists in this clinic")

    temp_password = _gen_password()
    now = datetime.now(timezone.utc).isoformat()
    new_user = User(
        clinic_id=user["clinic_id"],
        email=email,
        name=payload.name.strip(),
        role=payload.role,
        branch_ids=payload.branch_ids or [],
    )
    doc = serialize_datetime(new_user.model_dump())
    doc["password_hash"] = hash_password(temp_password)
    doc["must_change_password"] = True
    if payload.phone:
        doc["phone"] = payload.phone
    doc["created_at"] = now
    await db.users.insert_one(doc)

    # Mock-email the welcome / credentials (MOCKED until real SMTP).
    subject = "Welcome to AUDINEXA — your staff account is ready"
    body = (
        f"Hi {payload.name},\n\n"
        f"Your AUDINEXA account was created by your clinic admin.\n\n"
        f"  Login:    {email}\n"
        f"  Password: {temp_password}\n\n"
        f"Please sign in at the AUDINEXA portal and change your password on first login.\n"
    )
    await _log_mock_email(db, user["clinic_id"], email, subject, body)

    return {
        "user": deserialize_datetime({**new_user.model_dump(),
                                      "must_change_password": True,
                                      "phone": payload.phone}),
        "temp_password": temp_password,
        "email_status": "mocked",  # UI should show "password emailed (MOCKED)"
    }


@router.put("/staff/{user_id}")
async def update_staff(
    user_id: str, payload: StaffUpdate,
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    target = await db.users.find_one(
        {"user_id": user_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Staff member not found")

    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"user_id": user_id}, {"$set": patch})
    updated = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "password_hash": 0},
    )
    return deserialize_datetime(updated)


@router.post("/staff/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    target = await db.users.find_one(
        {"user_id": user_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Staff member not found")

    temp_password = _gen_password()
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "password_hash": hash_password(temp_password),
            "must_change_password": True,
            "token_version": int(target.get("token_version") or 0) + 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    subject = "Your AUDINEXA password was reset"
    body = (
        f"Hi {target.get('name')},\n\n"
        f"Your clinic admin has issued a new temporary password.\n\n"
        f"  Login:    {target.get('email')}\n"
        f"  Password: {temp_password}\n\n"
        f"Please sign in and change it immediately.\n"
    )
    await _log_mock_email(db, user["clinic_id"], target.get("email"), subject, body,
                          kind="staff_reset_password")

    return {"ok": True, "temp_password": temp_password, "email_status": "mocked"}


@router.post("/staff/{user_id}/force-logout")
async def force_logout_staff(
    user_id: str,
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    target = await db.users.find_one(
        {"user_id": user_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Staff member not found")
    await db.users.update_one(
        {"user_id": user_id},
        {"$inc": {"token_version": 1},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True, "message": "User's active sessions invalidated"}



# ============================================================================
# Personal signature — every authenticated user can upload one.
# Used by:
#   • Audiogram report footer (auto-applied for the signing audiologist)
#   • Delivery-challan receipt (legacy alternative to drawing on the receive modal)
#
# Bucket: `user_signatures`. We strip the `data:image/png;base64,` prefix when
# the client sends a data-URL; raw uploads also work.
# ============================================================================
_SIG_BUCKET = "user_signatures"
_MAX_SIG_BYTES = 1_500_000  # 1.5 MB — drawn PNGs are small; reject pasted photos


class SignaturePayload(BaseModel):
    """JSON body for canvas-drawn signatures. The client sends the base64 PNG
    inline (data-URL or raw base64). We avoid multipart for this path because
    the canvas-pad already produces a base64 string."""
    image_base64: str
    license_no: Optional[str] = None


@router.post("/me/signature")
async def upload_my_signature(payload: SignaturePayload,
                              user=Depends(get_current_user), db=Depends(get_db)):
    import base64
    raw = payload.image_base64 or ""
    # Strip data-URL prefix if present.
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw, validate=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 PNG: {e}")
    if not blob:
        raise HTTPException(status_code=400, detail="Empty signature")
    if len(blob) > _MAX_SIG_BYTES:
        raise HTTPException(status_code=413, detail="Signature too large (max 1.5 MB)")

    bucket = AsyncIOMotorGridFSBucket(db, bucket_name=_SIG_BUCKET)
    udoc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "signature_image_fs_id": 1}) or {}
    if udoc.get("signature_image_fs_id"):
        try:
            await bucket.delete(ObjectId(udoc["signature_image_fs_id"]))
        except Exception:
            pass
    fs_id = await bucket.upload_from_stream(
        f"sig-{user['user_id']}.png",
        io.BytesIO(blob),
        metadata={"user_id": user["user_id"], "kind": "user-signature"},
    )
    update = {
        "signature_image_fs_id": str(fs_id),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.license_no is not None:
        update["license_no"] = payload.license_no.strip() or None
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    return {
        "signature_image_fs_id": str(fs_id),
        "license_no": update.get("license_no"),
    }


@router.delete("/me/signature")
async def clear_my_signature(user=Depends(get_current_user), db=Depends(get_db)):
    udoc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "signature_image_fs_id": 1}) or {}
    if udoc.get("signature_image_fs_id"):
        bucket = AsyncIOMotorGridFSBucket(db, bucket_name=_SIG_BUCKET)
        try:
            await bucket.delete(ObjectId(udoc["signature_image_fs_id"]))
        except Exception:
            pass
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"signature_image_fs_id": None, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@router.get("/users/{user_id}/signature")
async def fetch_user_signature(user_id: str,
                               user=Depends(get_current_user), db=Depends(get_db)):
    """Same-tenant fetch — used by the audiogram footer to embed the signing
    audiologist's signature. 404 cleanly when no signature is set so the UI
    can fall back to the typed name."""
    udoc = await db.users.find_one(
        {"user_id": user_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "signature_image_fs_id": 1, "license_no": 1, "name": 1},
    )
    if not udoc or not udoc.get("signature_image_fs_id"):
        raise HTTPException(status_code=404, detail="No signature on file")
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name=_SIG_BUCKET)
    try:
        stream = await bucket.open_download_stream(ObjectId(udoc["signature_image_fs_id"]))
        data = await stream.read()
    except Exception:
        raise HTTPException(status_code=404, detail="Signature blob missing")
    from fastapi.responses import Response
    return Response(content=data, media_type="image/png", headers={
        "X-License-No": udoc.get("license_no") or "",
        "X-Signed-By": udoc.get("name") or "",
        "Cache-Control": "private, max-age=300",
    })
