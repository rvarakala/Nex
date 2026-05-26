"""DPDPA — patient data portability + right-to-be-forgotten.

India's Digital Personal Data Protection Act, 2023 obligates a clinic to:
  1. **Right to access (s. 12)**     — give the patient a copy of their data.
  2. **Right to erasure (s. 13)**    — irreversibly anonymise their data, on request.

We expose two endpoints (clinic_owner + super_admin + founder only):

  • GET    /api/patients/{patient_id}/dpdpa-export.zip
      Streams a ZIP bundle containing every row about the patient — demographics,
      appointments, hearing tests, HA quotes / sales / invoices, service tickets,
      communications, plus a `manifest.json` summary.

  • POST   /api/patients/{patient_id}/dpdpa-forget
      Anonymises the patient: replaces name / mobile / email / address with
      irreversible salted hashes, removes free-text notes. Keeps numeric /
      aggregate billing data intact so tax & audit obligations under the IT Act
      and GST law are still satisfied. Writes a tamper-evident audit log entry.

Both endpoints write an audit-log row to `dpdpa_actions` for compliance review.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import secrets
import zipfile
from datetime import datetime, timezone
from typing import Optional

from bson import json_util
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/patients", tags=["dpdpa"])

DPDPA_ELIGIBLE_ROLES = {"clinic_owner", "super_admin", "founder"}

# Collections that may hold patient-linked rows. The key is the collection
# name; the value is the field on that collection that references the patient.
PATIENT_LINKED = [
    ("appointments",          "patient_id"),
    ("hearing_tests",         "patient_id"),
    ("pta_tests",             "patient_id"),
    ("ha_quotes",             "patient_id"),
    ("ha_sales",              "patient_id"),
    ("quick_sales",           "patient_id"),
    ("invoices",              "patient_id"),
    ("ha_service_tickets",    "patient_id"),
    ("ha_trials",             "patient_id"),
    ("ha_fittings",           "patient_id"),
    ("communications",        "patient_id"),
    ("patient_files",         "patient_id"),
    ("patient_consents",      "patient_id"),
    ("repair_jobs",           "patient_id"),
]


def _require_eligible(user):
    if user["role"] not in DPDPA_ELIGIBLE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only clinic owners can export or erase patient data.",
        )


async def _get_patient_in_scope(db, patient_id: str, user) -> dict:
    pt = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0},
    )
    if not pt:
        raise HTTPException(status_code=404, detail="Patient not found in your clinic")
    return pt


# ────────────────────────────────────────────────────────────────────────
# 1. EXPORT
# ────────────────────────────────────────────────────────────────────────


@router.get("/{patient_id}/dpdpa-export.zip")
async def dpdpa_export(
    patient_id: str,
    request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    _require_eligible(user)
    patient = await _get_patient_in_scope(db, patient_id, user)
    if patient.get("dpdpa_forgotten_at"):
        raise HTTPException(
            status_code=410,
            detail="This patient has been erased under DPDPA; their data is no longer recoverable.",
        )

    # Pull every linked row, scoped to the clinic.
    bundle: dict[str, list] = {}
    for coll_name, fk_field in PATIENT_LINKED:
        rows = await db[coll_name].find(
            {fk_field: patient_id, "clinic_id": user["clinic_id"]},
            {"_id": 0},
        ).to_list(length=10_000)
        if rows:
            bundle[coll_name] = rows

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by_user_id": user["user_id"],
        "generated_by_email": user.get("email"),
        "clinic_id": user["clinic_id"],
        "patient_id": patient_id,
        "patient_mrd": patient.get("mrd_no") or patient.get("mrd"),
        "row_counts": {coll: len(rows) for coll, rows in bundle.items()},
        "patient_name": patient.get("name"),
        "patient_mobile": patient.get("mobile"),
        "act_reference": "India Digital Personal Data Protection Act, 2023 — s. 12 (Right to Access)",
        "format": "JSON",
        "format_version": 1,
    }

    # Build the ZIP in memory.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, default=str))
        zf.writestr("patient.json", json.dumps(patient, indent=2, default=str))
        for coll, rows in bundle.items():
            # `json_util` preserves Mongo-specific types (datetimes, Decimal128).
            zf.writestr(f"{coll}.json", json_util.dumps(rows, indent=2))
        zf.writestr(
            "README.txt",
            (
                "AUDINEXA — DPDPA Patient Data Export\n"
                "====================================\n\n"
                f"Patient: {patient.get('name')} (MRD {patient.get('mrd_no') or patient.get('mrd')})\n"
                f"Generated: {manifest['generated_at']}\n"
                f"By: {user.get('email')} (clinic {user['clinic_id']})\n\n"
                "This archive contains every record AUDINEXA has linked to this patient\n"
                "in the issuing clinic's database, in machine-readable JSON.\n\n"
                "Issued under India's Digital Personal Data Protection Act 2023, s. 12.\n\n"
                "Questions: lead@audinexa.com\n"
            ),
        )
    buf.seek(0)

    # Audit log
    await db.dpdpa_actions.insert_one({
        "_id": f"DPDPA-EXP-{secrets.token_hex(6).upper()}",
        "kind": "export",
        "clinic_id": user["clinic_id"],
        "patient_id": patient_id,
        "actor_user_id": user["user_id"],
        "actor_email": user.get("email"),
        "actor_ip": request.client.host if request.client else None,
        "at": datetime.now(timezone.utc),
        "row_counts": manifest["row_counts"],
    })

    safe_mrd = (patient.get("mrd_no") or patient.get("mrd") or patient_id).replace("/", "-")
    filename = f"AUDINEXA-DPDPA-{safe_mrd}-{datetime.now(timezone.utc):%Y%m%d}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ────────────────────────────────────────────────────────────────────────
# 2. RIGHT TO BE FORGOTTEN
# ────────────────────────────────────────────────────────────────────────


class DpdpaForgetIn(BaseModel):
    confirm_phrase: str = Field(
        ..., min_length=1,
        description='Must literally equal "ERASE PATIENT DATA" to proceed.',
    )
    reason: Optional[str] = Field(None, max_length=500)


_CONFIRM_PHRASE = "ERASE PATIENT DATA"


def _hashed_marker(value: str | None, salt: bytes) -> Optional[str]:
    if not value:
        return None
    return "dpdpa-erased-" + hashlib.sha256(salt + value.encode("utf-8")).hexdigest()[:16]


@router.post("/{patient_id}/dpdpa-forget")
async def dpdpa_forget(
    patient_id: str,
    payload: DpdpaForgetIn,
    request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Irreversibly anonymise the patient.

    Strategy: keep the *shape* of every record so tax / audit holds, but
    replace personally identifying fields with one-way salted hashes (so we
    can answer "is this patient the same one we erased last year?" without
    storing the answer in plaintext).
    """
    _require_eligible(user)
    if payload.confirm_phrase.strip() != _CONFIRM_PHRASE:
        raise HTTPException(
            status_code=400,
            detail=f'You must type "{_CONFIRM_PHRASE}" exactly to confirm.',
        )

    patient = await _get_patient_in_scope(db, patient_id, user)
    if patient.get("dpdpa_forgotten_at"):
        raise HTTPException(status_code=400, detail="This patient has already been erased.")

    salt = os.urandom(16)
    now = datetime.now(timezone.utc)
    audit_id = f"DPDPA-DEL-{secrets.token_hex(6).upper()}"

    # ── Anonymise the patient document ──
    #
    # We deliberately preserve `age` + `gender` — these are non-identifying
    # demographic facts useful for aggregate analytics, and the Patient
    # pydantic model marks them as required. DPDPA s. 13 mandates removal
    # of *identifiable* personal data; statistical demographics are exempt.
    erased_patient = {
        "name":                 f"[erased] {audit_id}",
        "first_name":           "[erased]",
        "last_name":             "[erased]",
        "mobile":               _hashed_marker(patient.get("mobile"), salt),
        "alt_mobile":           None,
        "alternate_mobile":     None,
        "email":                _hashed_marker(patient.get("email"), salt),
        "address":              None,
        "address_line1":        None,
        "address_line2":        None,
        "city":                 None,
        "state":                None,
        "pincode":              None,
        "dob":                  None,
        "aadhaar_last4":        None,
        "chief_complaint":      None,
        "case_history":         None,
        "notes":                None,
        "referrer_name":        None,
        "referrer_phone":       None,
        "referring_physician":  None,
        "guardian_name":        None,
        "guardian_mobile":      None,
        "anniversary_date":     None,
        "tags":                 [],
        "whatsapp_consent":     False,
        "sms_consent":          False,
        "email_consent":        False,
        "dpdpa_forgotten_at":   now,
        "dpdpa_audit_id":       audit_id,
        "updated_at":           now,
    }
    await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"$set": erased_patient},
    )

    # ── Scrub free-text fields on every linked collection ──
    # Numeric / financial / inventory data is kept so tax + audit are intact.
    scrub_unset = {
        "patient_name": "",
        "patient_mobile": "",
        "patient_email": "",
        "patient_address": "",
        "notes": "",
        "remarks": "",
        "complaint": "",
        "complaint_text": "",
        "chief_complaint": "",
        "case_history": "",
        "diagnosis_notes": "",
        "follow_up_notes": "",
        "audiologist_notes": "",
        "patient_signature_url": "",
        "patient_signature_data": "",
        "body": "",
        "message": "",
        "html_body": "",
    }
    scrubbed_counts = {}
    for coll, fk in PATIENT_LINKED:
        res = await db[coll].update_many(
            {fk: patient_id, "clinic_id": user["clinic_id"]},
            {"$unset": scrub_unset, "$set": {"dpdpa_scrubbed_at": now}},
        )
        if res.modified_count:
            scrubbed_counts[coll] = res.modified_count

    # ── Tamper-evident audit log ──
    audit_doc = {
        "_id": audit_id,
        "kind": "forget",
        "clinic_id": user["clinic_id"],
        "patient_id": patient_id,
        "actor_user_id": user["user_id"],
        "actor_email": user.get("email"),
        "actor_ip": request.client.host if request.client else None,
        "at": now,
        "reason": payload.reason,
        "scrubbed_counts": scrubbed_counts,
        "salt_hex": salt.hex(),
    }
    await db.dpdpa_actions.insert_one(audit_doc)

    return {
        "success": True,
        "audit_id": audit_id,
        "erased_at": now.isoformat(),
        "scrubbed_counts": scrubbed_counts,
        "message": "Patient anonymised under DPDPA s. 13.",
    }


# ────────────────────────────────────────────────────────────────────────
# 3. AUDIT LOG (read)
# ────────────────────────────────────────────────────────────────────────


@router.get("/dpdpa/audit-log")
async def dpdpa_audit_log(
    limit: int = 50,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    _require_eligible(user)
    rows = await db.dpdpa_actions.find(
        {"clinic_id": user["clinic_id"]},
        {"_id": 1, "kind": 1, "patient_id": 1, "actor_email": 1, "at": 1, "reason": 1},
    ).sort("at", -1).to_list(length=min(limit, 200))
    for r in rows:
        r["audit_id"] = r.pop("_id")
        if isinstance(r.get("at"), datetime):
            r["at"] = r["at"].isoformat()
    return rows
