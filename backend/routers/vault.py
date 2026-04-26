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
    mode: str = "standard"  # one of _VALID_MODES
    setup_at: datetime | None = None
    kdf_iterations: int | None = None
    recovery_slots_remaining: int = 0


class RecoverySlotPublic(BaseModel):
    """Subset of a recovery slot returned to the client during redemption.
    `code_hash` is safe to expose — it's a one-way hash of the code itself.
    """
    code_hash: str
    kdf_salt: str
    encrypted_dek: str
    dek_iv: str


class RecoveryRedeemRequest(BaseModel):
    """Used by the client to consume a recovery code and atomically rotate
    the master passphrase. The client has already (a) found the slot whose
    code_hash matches the code they typed, (b) derived a code-key, (c)
    unwrapped the DEK, (d) collected a NEW passphrase from the user, and (e)
    re-wrapped the same DEK with the new master key.

    The server's job is just to swap the master payload and mark the used
    slot as consumed — atomically so a parallel redemption can't double-use.
    """
    code_hash: str = Field(..., min_length=64, max_length=64)
    new_kdf_salt: str = Field(..., min_length=10, max_length=64)
    new_kdf_iterations: int = Field(default=600_000, ge=100_000, le=1_500_000)
    new_kdf_algo: str = Field(default="pbkdf2-sha256-aesgcm-v1")
    new_verifier: str = Field(..., min_length=64, max_length=64)
    new_encrypted_dek: str = Field(..., min_length=10)
    new_dek_iv: str = Field(..., min_length=10)


class VaultUnlockProof(BaseModel):
    """Client proves it has the master key by sending verifier hash. No-op
    server-side beyond logging — the *real* unlock happens in the browser."""
    verifier: str = Field(..., min_length=64, max_length=64)


# vault_mode lifecycle (Path A opt-in flow):
#   "standard"           — default. No vault; clinic uses normal at-rest encryption.
#   "vault_pending"      — owner clicked "Upgrade to Vault" but hasn't completed setup.
#   "vault_enabled"      — vault is fully initialised + DEK has been generated.
_VALID_MODES = {"standard", "vault_pending", "vault_enabled"}


class VaultModeChange(BaseModel):
    mode: str = Field(..., pattern=r"^(standard|vault_pending|vault_enabled)$")
    confirm_disable: bool = Field(default=False, description="Required when downgrading from vault_enabled to standard")


class VaultModeResponse(BaseModel):
    mode: str
    enabled: bool
    setup_at: datetime | None = None
    recovery_slots_remaining: int = 0


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
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    mode = clinic.get("vault_mode", "standard")
    v = await _get_vault(db, user["clinic_id"])
    if not v:
        return VaultStatus(enabled=False, mode=mode)
    unused = [s for s in v.get("recovery_slots", []) if not s.get("used_at")]
    return VaultStatus(
        enabled=True,
        mode=mode,
        setup_at=v.get("setup_at"),
        kdf_iterations=v.get("kdf_iterations"),
        recovery_slots_remaining=len(unused),
    )


@router.post("/mode", response_model=VaultModeResponse)
async def set_vault_mode(
    payload: VaultModeChange,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Lets the clinic owner opt into / out of vault mode (Path A opt-in).

    State machine:
      standard       → vault_pending   ✅ (owner intent registered; setup screen now appears)
      vault_pending  → vault_enabled   ❌ — happens automatically when /vault/setup completes
      vault_pending  → standard        ✅ (owner cancelled before completing setup)
      vault_enabled  → standard        ✅ requires confirm_disable=True; deletes vault doc
    """
    _require_super_or_owner(user)
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    current = clinic.get("vault_mode", "standard")
    target = payload.mode

    if target not in _VALID_MODES:
        raise HTTPException(status_code=400, detail="Invalid vault_mode")

    if target == "vault_enabled":
        # Owners can't directly flip to enabled — must go via /vault/setup which
        # promotes vault_pending → vault_enabled atomically.
        raise HTTPException(
            status_code=400,
            detail="Use POST /vault/setup with a passphrase — that flips vault_pending → vault_enabled.",
        )

    if current == "vault_enabled" and target == "standard":
        if not payload.confirm_disable:
            raise HTTPException(
                status_code=400,
                detail="Disabling vault destroys all encrypted records for this clinic. Pass confirm_disable=true.",
            )
        # Tear down: delete the vault doc + any encrypted demo records
        await db.clinic_vaults.delete_one({"clinic_id": user["clinic_id"]})
        await db.vault_test_records.delete_many({"clinic_id": user["clinic_id"]})

    await db.clinics.update_one(
        {"clinic_id": user["clinic_id"]},
        {"$set": {"vault_mode": target}},
    )
    await db.activity_logs.insert_one({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": f"vault.mode_change.{current}→{target}",
        "at": datetime.now(timezone.utc),
    })

    v = await _get_vault(db, user["clinic_id"])
    unused = [s for s in v.get("recovery_slots", []) if not s.get("used_at")] if v else []
    return VaultModeResponse(
        mode=target,
        enabled=bool(v),
        setup_at=v.get("setup_at") if v else None,
        recovery_slots_remaining=len(unused),
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
        {"$set": {"vault_enabled": True, "vault_setup_at": doc["setup_at"], "vault_mode": "vault_enabled"}},
    )
    return VaultStatus(
        enabled=True,
        mode="vault_enabled",
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


# --------------------------- Recovery flow ---------------------------------

@router.get("/recovery-slots", response_model=list[RecoverySlotPublic])
async def list_recovery_slots(user=Depends(get_current_user), db=Depends(get_db)):
    """Returns the public params of every UNUSED recovery slot.

    Safe to expose to any authenticated user of the clinic — a slot's
    `code_hash` is a one-way SHA-256 of the recovery code; without the code
    itself, the hash and ciphertext are useless.
    """
    v = await _get_vault(db, user["clinic_id"])
    if not v:
        raise HTTPException(status_code=404, detail="Vault not initialised")
    slots = [
        RecoverySlotPublic(
            code_hash=s["code_hash"],
            kdf_salt=s["kdf_salt"],
            encrypted_dek=s["encrypted_dek"],
            dek_iv=s["dek_iv"],
        )
        for s in v.get("recovery_slots", [])
        if not s.get("used_at")
    ]
    return slots


@router.post("/recovery-redeem", response_model=VaultStatus)
async def recovery_redeem(
    payload: RecoveryRedeemRequest,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Atomic recovery: marks one unused slot as consumed AND swaps the
    master payload (verifier + encrypted_dek + KDF params) with values
    derived from the user's NEW passphrase.

    Race-safe: the `recovery_slots.used_at` filter in the update guarantees
    only one of two parallel redemptions wins; the other gets 404/409.
    """
    now = datetime.now(timezone.utc)
    res = await db.clinic_vaults.update_one(
        {
            "clinic_id": user["clinic_id"],
            "recovery_slots": {
                "$elemMatch": {
                    "code_hash": payload.code_hash,
                    "used_at": {"$in": [None, False]},
                },
            },
        },
        {
            "$set": {
                "kdf_salt": payload.new_kdf_salt,
                "kdf_iterations": payload.new_kdf_iterations,
                "kdf_algo": payload.new_kdf_algo,
                "verifier": payload.new_verifier,
                "encrypted_dek": payload.new_encrypted_dek,
                "dek_iv": payload.new_dek_iv,
                "recovery_slots.$.used_at": now,
                "recovery_slots.$.used_by": user["user_id"],
            },
        },
    )
    if res.modified_count == 0:
        # Either the code hash didn't match anything, or the slot was already
        # consumed by a parallel redemption.
        raise HTTPException(
            status_code=404,
            detail="Recovery code not recognised or already used",
        )

    await db.activity_logs.insert_one({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": "vault.recovery_redeem",
        "at": now,
    })

    v = await _get_vault(db, user["clinic_id"])
    unused = [s for s in v.get("recovery_slots", []) if not s.get("used_at")]
    return VaultStatus(
        enabled=True,
        setup_at=v.get("setup_at"),
        kdf_iterations=v.get("kdf_iterations"),
        recovery_slots_remaining=len(unused),
    )


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
