"""AUDINEXA Connect — clinic-side WhatsApp settings + test send.

PR 1 surface (PR 2 will layer auto-triggers + template registry on top):

  * GET    /api/connect/whatsapp                — current clinic's config
  * PUT    /api/connect/whatsapp                — owner upserts BYOG / Hosted
  * DELETE /api/connect/whatsapp                — owner disables Connect
  * POST   /api/connect/whatsapp/test           — fires the canned hello-world
                                                  template to a phone number
                                                  the owner picks (own mobile)
  * POST   /api/connect/whatsapp/dpa            — owner accepts the DPA
  * GET    /api/connect/whatsapp/logs           — last 50 message attempts

Tenant scoping: every read/write filters by `clinic_id` from the JWT, and
write operations are gated to `clinic_owner` / `super_admin` / `founder`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, require_roles
from database import get_db
from utils.msg91 import (
    enc,
    mask_key,
    normalise_phone,
    resolve_credentials,
    send_template,
    log_message,
)

router = APIRouter(prefix="/api/connect", tags=["connect"])

OWNER_ROLES = ("clinic_owner", "super_admin", "founder")

# ──────────────────────────── PYDANTIC ──────────────────────────────


class ConnectConfigPublic(BaseModel):
    """Read shape — never echoes the raw auth key."""
    enabled: bool = False
    mode: str = "byog"                          # byog | hosted
    integrated_number: Optional[str] = None
    auth_key_masked: Optional[str] = None
    dpa_accepted: bool = False
    dpa_accepted_at: Optional[str] = None
    dpa_accepted_by_user_id: Optional[str] = None
    dpa_accepted_by_name: Optional[str] = None
    last_test_at: Optional[str] = None
    last_test_status: Optional[str] = None
    updated_at: Optional[str] = None


class ConnectConfigUpsert(BaseModel):
    enabled: bool = True
    mode: str = Field(..., pattern="^(byog|hosted)$")
    integrated_number: Optional[str] = None     # required only for BYOG
    auth_key: Optional[str] = None              # required only for BYOG
                                                # (omit on PUT to keep stored)


class DPAAcceptPayload(BaseModel):
    accept: bool = True


class TestSendPayload(BaseModel):
    to_phone: str
    message: Optional[str] = None               # ignored by template send,
                                                # used only as variable {{1}}


# ──────────────────────────── HELPERS ───────────────────────────────


def _serialize(cfg: dict) -> ConnectConfigPublic:
    """Strip secrets from the stored config before returning to clinic UI."""
    enc_key = cfg.get("auth_key_encrypted")
    masked = ""
    if enc_key:
        try:
            masked = mask_key(enc.decrypt(enc_key))
        except HTTPException:
            masked = "••••••••"
    return ConnectConfigPublic(
        enabled=bool(cfg.get("enabled")),
        mode=cfg.get("mode", "byog"),
        integrated_number=cfg.get("integrated_number"),
        auth_key_masked=masked or None,
        dpa_accepted=bool(cfg.get("dpa_accepted")),
        dpa_accepted_at=cfg.get("dpa_accepted_at"),
        dpa_accepted_by_user_id=cfg.get("dpa_accepted_by_user_id"),
        dpa_accepted_by_name=cfg.get("dpa_accepted_by_name"),
        last_test_at=cfg.get("last_test_at"),
        last_test_status=cfg.get("last_test_status"),
        updated_at=cfg.get("updated_at"),
    )


# ──────────────────────────── ROUTES ────────────────────────────────


@router.get("/whatsapp", response_model=ConnectConfigPublic)
async def get_config(user=Depends(get_current_user), db=Depends(get_db)):
    cfg = await db.whatsapp_configs.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not cfg:
        return ConnectConfigPublic()  # all defaults — empty config
    return _serialize(cfg)


@router.put("/whatsapp", response_model=ConnectConfigPublic)
async def upsert_config(
    payload: ConnectConfigUpsert,
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    clinic_id = user["clinic_id"]
    existing = await db.whatsapp_configs.find_one(
        {"clinic_id": clinic_id}, {"_id": 0}
    ) or {}

    set_doc: dict = {
        "clinic_id": clinic_id,
        "enabled": payload.enabled,
        "mode": payload.mode,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by_user_id": user["user_id"],
    }

    if payload.mode == "byog":
        # Validate phone format (raise 400 with a clean message)
        if not payload.integrated_number:
            raise HTTPException(400, "BYOG mode requires an integrated number.")
        try:
            set_doc["integrated_number"] = normalise_phone(payload.integrated_number)
        except ValueError as exc:
            raise HTTPException(400, f"Invalid integrated number: {exc}")
        # Auth key — only overwrite if a fresh value was supplied
        if payload.auth_key:
            ak = payload.auth_key.strip()
            if len(ak) < 12:
                raise HTTPException(400, "Auth key looks too short — please paste the full key.")
            set_doc["auth_key_encrypted"] = enc.encrypt(ak)
        elif not existing.get("auth_key_encrypted"):
            raise HTTPException(400, "BYOG mode requires an auth key.")
    else:  # hosted
        # Hosted mode shares Audinexa's number; clear stored BYOG details.
        set_doc["integrated_number"] = None
        set_doc["auth_key_encrypted"] = None

    # Preserve DPA acceptance across updates.
    for k in ("dpa_accepted", "dpa_accepted_at",
              "dpa_accepted_by_user_id", "dpa_accepted_by_name"):
        if k in existing:
            set_doc.setdefault(k, existing[k])

    await db.whatsapp_configs.update_one(
        {"clinic_id": clinic_id},
        {"$set": set_doc, "$setOnInsert": {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by_user_id": user["user_id"],
        }},
        upsert=True,
    )
    cfg = await db.whatsapp_configs.find_one({"clinic_id": clinic_id}, {"_id": 0})
    return _serialize(cfg or {})


@router.delete("/whatsapp", response_model=ConnectConfigPublic)
async def disable_config(
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    """Soft-disable Connect — keeps the doc (with DPA history) but flips off."""
    await db.whatsapp_configs.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {
            "enabled": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by_user_id": user["user_id"],
        }},
    )
    cfg = await db.whatsapp_configs.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return _serialize(cfg or {})


@router.post("/whatsapp/dpa", response_model=ConnectConfigPublic)
async def accept_dpa(
    payload: DPAAcceptPayload,
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    if not payload.accept:
        raise HTTPException(400, "DPA must be accepted to proceed.")
    now = datetime.now(timezone.utc).isoformat()
    await db.whatsapp_configs.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {
            "dpa_accepted": True,
            "dpa_accepted_at": now,
            "dpa_accepted_by_user_id": user["user_id"],
            "dpa_accepted_by_name": user.get("name") or user.get("email"),
            "updated_at": now,
        }, "$setOnInsert": {
            "clinic_id": user["clinic_id"],
            "enabled": False,
            "mode": "byog",
            "created_at": now,
            "created_by_user_id": user["user_id"],
        }},
        upsert=True,
    )
    cfg = await db.whatsapp_configs.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    return _serialize(cfg or {})


@router.post("/whatsapp/test")
async def test_send(
    payload: TestSendPayload,
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    """Fire a probe message to verify auth_key + sender number work end-to-end.

    PR 1 doesn't yet have a real Meta-approved template registry — so the
    actual `send_template` call will hit MSG91 and return either:
      * success → {"ok": true, "request_id": "..."}
      * failure → {"ok": false, "error_code": "...", "error_message": "..."}

    Either way we persist the test attempt to `whatsapp_message_logs`
    (status="test_sent" / "test_failed") and stamp `last_test_*` on the
    config so the Settings UI can show it.
    """
    creds = await resolve_credentials(db, user["clinic_id"])
    try:
        to_phone = normalise_phone(payload.to_phone)
    except ValueError as exc:
        raise HTTPException(400, f"Invalid phone: {exc}")

    # Test template — clinics must register a "audinexa_test_ping" template
    # with their MSG91 account in PR 2. For now we send the request and
    # surface whatever MSG91 says (typically 132001 "template not found"
    # which is itself a useful diagnostic — it proves the auth_key works).
    ok, req_id, code, msg = await send_template(
        auth_key=creds["auth_key"],
        integrated_number=creds["integrated_number"],
        template_name="audinexa_test_ping",
        template_namespace=(await db.whatsapp_configs.find_one(
            {"clinic_id": user["clinic_id"]}, {"_id": 0}
        ) or {}).get("test_template_namespace", "audinexa_default"),
        language_code="en_US",
        recipient=to_phone,
        body_variables=[user.get("name") or "Audinexa user"],
    )
    now = datetime.now(timezone.utc).isoformat()
    status = "test_sent" if ok else "test_failed"
    await db.whatsapp_configs.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {"last_test_at": now, "last_test_status": status}},
    )
    await log_message(
        db,
        clinic_id=user["clinic_id"],
        template_name="audinexa_test_ping",
        recipient=to_phone,
        status=status,
        request_id=req_id,
        error_code=code,
        error_message=msg,
        purpose="connectivity_test",
        triggered_by_user_id=user["user_id"],
    )
    if ok:
        return {"ok": True, "request_id": req_id, "to": to_phone}
    return {
        "ok": False,
        "error_code": code,
        "error_message": msg,
        "to": to_phone,
        "hint": (
            "If the error is 'template not approved', that's expected for now — "
            "it confirms your auth key is valid. PR 2 will register live templates."
        ),
    }


@router.get("/whatsapp/logs")
async def list_logs(
    limit: int = 50,
    user=Depends(require_roles(*OWNER_ROLES)),
    db=Depends(get_db),
):
    limit = max(1, min(limit, 200))
    cur = (
        db.whatsapp_message_logs
          .find({"clinic_id": user["clinic_id"]}, {"_id": 0})
          .sort("created_at", -1)
          .limit(limit)
    )
    return {"items": [r async for r in cur]}
