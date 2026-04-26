"""BYOK Phase 1 — Clinic Vault PoC router.

Endpoints expose the *plumbing* for client-controlled encryption. The server
NEVER sees the master passphrase, derived master key, or the plaintext data
encryption key (DEK). Everything is wrapped client-side in the browser.

Server stores per clinic_id:
  - kdf_salt       : 16-byte salt used for PBKDF2 (public, non-secret)
  - kdf_iterations : 600_000 (configurable per clinic)
  - kdf_algo       : "pbkdf2-sha256-aesgcm-v1"
  - verifier       : SHA-256(MasterKey) hex — quick wrong-pass check on unlock
                     without giving anyone a path to recover the master key
  - encrypted_dek  : AES-GCM(MasterKey, DEK) base64
  - dek_iv         : 12-byte IV used for the DEK ciphertext
  - recovery_slots : list of {code_hash, encrypted_dek, dek_iv} — each entry
                     is a one-time recovery code that can unwrap the DEK if
                     the owner forgets the passphrase

Test record collection demonstrates encrypt/decrypt round-trip without
touching the live patient table.

PoC limitations (P0-1 ships these only):
  - One vault per clinic_id (no per-branch / per-user vaults)
  - Recovery codes are write-only at setup (not yet usable for unlock — that
    flow ships in the Recovery Codes PR)
  - No multi-admin (Shamir) yet — also next PR
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db


router = APIRouter(prefix="/api/vault", tags=["vault"])


# --------------------------- Pydantic models -------------------------------

class VaultSetupRequest(BaseModel):
    kdf_salt: str = Field(..., min_length=10, max_length=64, description="base64 16-byte salt")
    kdf_iterations: int = Field(default=600_000, ge=100_000, le=1_500_000)
    kdf_algo: str = Field(default="pbkdf2-sha256-aesgcm-v1")
    verifier: str = Field(..., min_length=64, max_length=64, description="hex SHA-256 of master key")
    encrypted_dek: str = Field(..., min_length=10)
    dek_iv: str = Field(..., min_length=10)
    recovery_slots: list[dict[str, str]] = Field(default_factory=list)


class VaultUnlockResponse(BaseModel):
    kdf_salt: str
    kdf_iterations: int
    kdf_algo: str
    encrypted_dek: str
    dek_iv: str
    verifier: str


class VaultStatus(BaseModel):
    enabled: bool
    setup_at: datetime | None = None
    kdf_iterations: int | None = None
    recovery_slots_remaining: int = 0


class VaultUnlockProof(BaseModel):
    """Client proves it has the master key by sending verifier hash. No-op
    server-side beyond logging — the *real* unlock happens in the browser."""
    verifier: str = Field(..., min_length=64, max_length=64)


class TestRecordCreate(BaseModel):
    label: str = Field(..., max_length=80)
    encrypted_payload: str = Field(..., description="AES-GCM ciphertext base64")
    iv: str = Field(..., description="12-byte IV base64")


class TestRecord(BaseModel):
    record_id: str
    clinic_id: str
    label: str
    encrypted_payload: str
    iv: str
    created_at: datetime
    created_by: str


# --------------------------- Helpers ---------------------------------------

async def _get_vault(db, clinic_id: str) -> dict[str, Any] | None:
    return await db.clinic_vaults.find_one({"clinic_id": clinic_id}, {"_id": 0})


def _require_super_or_owner(user: dict[str, Any]) -> None:
    if user.get("role") not in {"super_admin", "clinic_owner", "founder"}:
        raise HTTPException(status_code=403, detail="Vault setup requires owner/super_admin role")


# --------------------------- Endpoints -------------------------------------

@router.get("/status", response_model=VaultStatus)
async def vault_status(user=Depends(get_current_user), db=Depends(get_db)):
    """Tells the frontend whether to show the setup modal or the unlock modal."""
    v = await _get_vault(db, user["clinic_id"])
    if not v:
        return VaultStatus(enabled=False)
    return VaultStatus(
        enabled=True,
        setup_at=v.get("setup_at"),
        kdf_iterations=v.get("kdf_iterations"),
        recovery_slots_remaining=len(v.get("recovery_slots", [])),
    )


@router.post("/setup", response_model=VaultStatus)
async def vault_setup(
    payload: VaultSetupRequest,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """One-time vault initialisation. Owner-only. Idempotent guard: if a vault
    already exists for this clinic, returns 409 to prevent silent overwrites
    that would orphan all encrypted data."""
    _require_super_or_owner(user)
    existing = await _get_vault(db, user["clinic_id"])
    if existing:
        raise HTTPException(status_code=409, detail="Vault already initialised for this clinic")

    doc = {
        "clinic_id": user["clinic_id"],
        "kdf_salt": payload.kdf_salt,
        "kdf_iterations": payload.kdf_iterations,
        "kdf_algo": payload.kdf_algo,
        "verifier": payload.verifier,
        "encrypted_dek": payload.encrypted_dek,
        "dek_iv": payload.dek_iv,
        "recovery_slots": payload.recovery_slots,
        "setup_at": datetime.now(timezone.utc),
        "setup_by": user["user_id"],
    }
    await db.clinic_vaults.insert_one(doc)
    await db.clinics.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {"vault_enabled": True, "vault_setup_at": doc["setup_at"]}},
    )
    return VaultStatus(
        enabled=True,
        setup_at=doc["setup_at"],
        kdf_iterations=doc["kdf_iterations"],
        recovery_slots_remaining=len(doc["recovery_slots"]),
    )


@router.get("/unlock-params", response_model=VaultUnlockResponse)
async def vault_unlock_params(user=Depends(get_current_user), db=Depends(get_db)):
    """Returns everything the browser needs to derive MasterKey + unwrap DEK.
    The server never sees the passphrase; we just hand back public params."""
    v = await _get_vault(db, user["clinic_id"])
    if not v:
        raise HTTPException(status_code=404, detail="Vault not initialised")
    return VaultUnlockResponse(
        kdf_salt=v["kdf_salt"],
        kdf_iterations=v["kdf_iterations"],
        kdf_algo=v["kdf_algo"],
        encrypted_dek=v["encrypted_dek"],
        dek_iv=v["dek_iv"],
        verifier=v["verifier"],
    )


@router.post("/unlock-verify")
async def vault_unlock_verify(
    proof: VaultUnlockProof,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Client-supplied verifier check. Server compares hashes only — does NOT
    learn the master key. Used purely for audit + telemetry; the actual
    decrypt happens client-side."""
    v = await _get_vault(db, user["clinic_id"])
    if not v:
        raise HTTPException(status_code=404, detail="Vault not initialised")
    expected = v["verifier"]
    # Constant-time compare
    ok = secrets.compare_digest(expected.lower(), proof.verifier.lower())
    if not ok:
        raise HTTPException(status_code=401, detail="Wrong passphrase")
    await db.activity_logs.insert_one({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": "vault.unlock",
        "at": datetime.now(timezone.utc),
    })
    return {"ok": True}


# --------------------------- Test records (PoC demo) -----------------------

@router.post("/test-records", response_model=TestRecord)
async def create_test_record(
    payload: TestRecordCreate,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Stores an encrypted blob. Server never sees plaintext."""
    record = {
        "record_id": "vrec-" + hashlib.sha256(secrets.token_bytes(16)).hexdigest()[:16],
        "clinic_id": user["clinic_id"],
        "label": payload.label,
        "encrypted_payload": payload.encrypted_payload,
        "iv": payload.iv,
        "created_at": datetime.now(timezone.utc),
        "created_by": user["user_id"],
    }
    await db.vault_test_records.insert_one(record)
    return TestRecord(**{k: v for k, v in record.items() if k != "_id"})


@router.get("/test-records", response_model=list[TestRecord])
async def list_test_records(user=Depends(get_current_user), db=Depends(get_db)):
    rows = await db.vault_test_records.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return [TestRecord(**r) for r in rows]


@router.delete("/test-records/{record_id}")
async def delete_test_record(record_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    res = await db.vault_test_records.delete_one(
        {"record_id": record_id, "clinic_id": user["clinic_id"]},
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"ok": True}
