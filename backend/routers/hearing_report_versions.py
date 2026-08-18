"""Hearing Report Versions — lightweight JSON snapshots of the Reports tab.

The audiologist can `Save` a report at any point during a hearing test.
Instead of storing the rendered PDF (500 KB – 2 MB) we snapshot the
underlying session state + patient + clinic branding as JSON (~15–40 KB)
into `hearing_report_versions`. On retrieval the front-end re-renders
the exact report the audiologist saved.

Endpoints (all `/api/hearing-reports`):
  POST   /save                         — create a new version from a session
  GET    /patient/{patient_id}         — list versions for a patient
  GET    /session/{session_id}         — list versions for a session
  GET    /{version_id}                 — fetch a full snapshot for re-render
  DELETE /{version_id}                 — soft-delete (audit-safe)

Auth: any authenticated user in the *same clinic* as the source session
can save + read. Delete is restricted to owner / super_admin / founder.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db

log = logging.getLogger("audinexa.hearing_reports")

router = APIRouter(prefix="/api/hearing-reports", tags=["hearing-reports"])

DELETE_ROLES = {"clinic_owner", "super_admin", "founder"}


# ───────── Pydantic ─────────

class SaveIn(BaseModel):
    session_id: str = Field(..., min_length=1)
    label: Optional[str] = None  # optional display label; server generates a default if missing


class VersionSummary(BaseModel):
    version_id: str
    session_id: str
    patient_id: str
    patient_name: Optional[str] = None
    patient_mrd: Optional[str] = None
    visit_date: Optional[str] = None
    label: str
    saved_by_name: Optional[str] = None
    saved_at: str


class VersionDetail(VersionSummary):
    snapshot: dict


# ───────── Helpers ─────────

def _new_version_id() -> str:
    return f"HRV-{uuid.uuid4().hex[:10].upper()}"


def _default_label(session: dict, existing_count: int) -> str:
    """Human-friendly label: "Visit N · <date>" so a history list is scannable."""
    dt = (session.get("test_date") or session.get("created_at") or
          datetime.now(timezone.utc).isoformat())
    try:
        # Strip time-of-day for the label, keep just YYYY-MM-DD
        date_part = str(dt)[:10]
    except Exception:
        date_part = str(dt)
    return f"Visit {existing_count + 1} · {date_part}"


async def _load_session(db, session_id: str, clinic_id: str) -> dict:
    """Load a session that BELONGS to `clinic_id`.

    NAV-006 F-006 (2026-08-18) — clinic_id is filtered directly in the
    query so that a foreign session_id is indistinguishable from a
    non-existent one (both 404). Removes the "find first, tenant-check
    later" defence-in-depth gap. We prefer `test_sessions`; the legacy
    `sessions` collection (F-008, out of scope this sprint) is kept as
    a scoped fallback so a caller in one clinic can never see a legacy
    row from another.
    """
    doc = await db.test_sessions.find_one(
        {"session_id": session_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if doc:
        return doc
    doc = await db.sessions.find_one(
        {"session_id": session_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if doc:
        return doc
    raise HTTPException(status_code=404, detail=f"Session {session_id} not found")


async def _load_patient(db, patient_id: str, clinic_id: str) -> dict:
    doc = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": clinic_id}, {"_id": 0}
    )
    if not doc:
        return {}
    # Enrich with referring doctor NAME so the Report Builder can auto-fill
    # "Referred by" without the audiologist retyping. If the front desk
    # backfills the doctor after the report is completed, the next save
    # picks it up here.
    ref_doc_id = doc.get("referring_doctor_id")
    if ref_doc_id and not doc.get("referring_doctor_name"):
        rd = await db.referring_doctors.find_one(
            {"doctor_id": ref_doc_id, "clinic_id": clinic_id},
            {"_id": 0, "name": 1},
        )
        if rd:
            doc["referring_doctor_name"] = rd.get("name")
    return doc


async def _load_clinic(db, clinic_id: str) -> dict:
    doc = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})
    # Keep the snapshot small: only branding fields the report uses.
    if not doc:
        return {}
    keep = {
        "clinic_id", "name", "address", "city", "state", "pincode", "phone",
        "mobile", "email", "website", "gst_number", "gstin", "registration_no",
        "logo_url", "letterhead_url", "signature_url", "tagline",
    }
    return {k: doc.get(k) for k in keep if k in doc}


def _sanitize(d: Optional[dict]) -> dict:
    """Drop Mongo `_id`s inside nested dicts so the snapshot is pure JSON."""
    if not d:
        return {}
    out: dict = {}
    for k, v in d.items():
        if k == "_id":
            continue
        out[k] = v
    return out


def _build_snapshot(session: dict, patient: dict, clinic: dict) -> dict:
    """Compose the JSON blob used to re-render the report on retrieval.

    We copy the session fields the ReportsPanel front-end reads:
      - audiogram data (right / left)
      - pre_test, impedance, speech, special_tests, oae, soundfield, abr,
        pediatric, tinnitus
      - report builder state that was auto-saved by ReportsPanel:
        clinical_impression, findings_by_section, recommendations[],
        further_advice, provisional_diagnosis, referred_by, license.
    """
    return {
        "patient": _sanitize(patient),
        "clinic": _sanitize(clinic),
        "session": {
            "session_id": session.get("session_id"),
            "test_date":  session.get("test_date"),
            "created_at": str(session.get("created_at") or ""),
            "visit_type": session.get("visit_type"),
        },
        # Test data
        "right_ear_audiogram": _sanitize(session.get("right_ear_audiogram")),
        "left_ear_audiogram":  _sanitize(session.get("left_ear_audiogram")),
        "pre_test_data":       _sanitize(session.get("pre_test_data")),
        "impedance_data":      _sanitize(session.get("impedance_data")),
        "speech_data":         _sanitize(session.get("speech_data")),
        "special_tests_data":  _sanitize(session.get("special_tests_data")),
        "oae_data":            _sanitize(session.get("oae_data")),
        "soundfield_data":     _sanitize(session.get("soundfield_data")),
        "abr_data":            _sanitize(session.get("abr_data")),
        "pediatric_data":      _sanitize(session.get("pediatric_data")),
        "tinnitus_data":       _sanitize(session.get("tinnitus_data")),
        # Report builder state (auto-saved to session by ReportsPanel)
        "builder": {
            "clinical_impression": session.get("clinical_impression") or "",
            "puretone_findings":   session.get("puretone_findings") or "",
            "immitence_findings":  session.get("immitence_findings") or "",
            "speech_findings":     session.get("speech_findings") or "",
            "findings_by_section": session.get("findings_by_section") or {},
            "recommendations":     session.get("recommendations") or [],
            "further_advice":      session.get("further_advice") or "",
            "provisional_diagnosis": session.get("provisional_diagnosis") or "",
            "referred_by":         session.get("referred_by") or "",
            # Toggleable section checkboxes as they were at save-time.
            # Empty list means "use frontend defaults" — the ReportsPanel
            # `initialBuilder.sections` override treats missing/empty as
            # a fall-through to TOGGLEABLE_SECTIONS.defaultEnabled.
            "sections":            session.get("sections") or [],
            "license":             session.get("license") or "",
        },
        # Audiologist attribution
        "audiologist": {
            "user_id": session.get("audiologist_id") or session.get("performed_by_user_id"),
            "name":    session.get("audiologist_name") or session.get("performed_by_name"),
        },
    }


# ───────── Endpoints ─────────

@router.post("/save", response_model=VersionSummary)
async def save_version(payload: SaveIn,
                       user=Depends(get_current_user), db=Depends(get_db)):
    # NAV-006 F-006 — session lookup is now directly clinic-scoped.
    # A foreign session_id → 404 in `_load_session` (existence not revealed).
    session = await _load_session(db, payload.session_id, user["clinic_id"])

    patient_id = session.get("patient_id")
    if not patient_id:
        raise HTTPException(status_code=400, detail="Session has no patient_id — cannot save")
    patient = await _load_patient(db, patient_id, user["clinic_id"])
    clinic = await _load_clinic(db, user["clinic_id"])

    # Count existing versions for this patient → drives the default label.
    existing_count = await db.hearing_report_versions.count_documents({
        "patient_id": patient_id,
        "clinic_id":  user["clinic_id"],
        "deleted":    {"$ne": True},
    })
    label = (payload.label or "").strip() or _default_label(session, existing_count)

    now = datetime.now(timezone.utc)
    doc = {
        "version_id":     _new_version_id(),
        "clinic_id":      user["clinic_id"],
        "patient_id":     patient_id,
        "patient_name":   patient.get("name") or "",
        "patient_mrd":    patient.get("mrd") or patient.get("patient_id") or "",
        "session_id":     payload.session_id,
        "visit_date":     session.get("test_date") or str(session.get("created_at") or ""),
        "label":          label,
        "saved_by_user_id": user["user_id"],
        "saved_by_name":  user.get("name") or user.get("email") or "",
        "saved_at":       now,
        "snapshot":       _build_snapshot(session, patient, clinic),
        "deleted":        False,
    }
    await db.hearing_report_versions.insert_one(doc)
    log.info("hearing_report.save clinic=%s patient=%s version=%s size≈%d bytes",
             user["clinic_id"], patient_id, doc["version_id"], len(str(doc["snapshot"])))
    return VersionSummary(
        version_id=doc["version_id"],
        session_id=doc["session_id"],
        patient_id=doc["patient_id"],
        patient_name=doc["patient_name"],
        patient_mrd=doc["patient_mrd"],
        visit_date=doc["visit_date"],
        label=doc["label"],
        saved_by_name=doc["saved_by_name"],
        saved_at=now.isoformat(),
    )


@router.get("/patient/{patient_id}", response_model=list[VersionSummary])
async def list_by_patient(patient_id: str = Path(..., min_length=1),
                          user=Depends(get_current_user), db=Depends(get_db)):
    """Return every non-deleted version for a patient, most recent first."""
    rows = await db.hearing_report_versions.find(
        {"patient_id": patient_id,
         "clinic_id":  user["clinic_id"],
         "deleted":    {"$ne": True}},
        {"_id": 0, "snapshot": 0},  # hide the heavy blob in the list view
    ).sort("saved_at", -1).to_list(200)
    return [VersionSummary(
        version_id=r["version_id"],
        session_id=r["session_id"],
        patient_id=r["patient_id"],
        patient_name=r.get("patient_name") or "",
        patient_mrd=r.get("patient_mrd") or "",
        visit_date=r.get("visit_date") or "",
        label=r.get("label") or "",
        saved_by_name=r.get("saved_by_name") or "",
        saved_at=str(r.get("saved_at") or ""),
    ) for r in rows]


@router.get("/session/{session_id}", response_model=list[VersionSummary])
async def list_by_session(session_id: str = Path(..., min_length=1),
                          user=Depends(get_current_user), db=Depends(get_db)):
    rows = await db.hearing_report_versions.find(
        {"session_id": session_id,
         "clinic_id":  user["clinic_id"],
         "deleted":    {"$ne": True}},
        {"_id": 0, "snapshot": 0},
    ).sort("saved_at", -1).to_list(200)
    return [VersionSummary(
        version_id=r["version_id"],
        session_id=r["session_id"],
        patient_id=r["patient_id"],
        patient_name=r.get("patient_name") or "",
        patient_mrd=r.get("patient_mrd") or "",
        visit_date=r.get("visit_date") or "",
        label=r.get("label") or "",
        saved_by_name=r.get("saved_by_name") or "",
        saved_at=str(r.get("saved_at") or ""),
    ) for r in rows]


@router.get("/{version_id}", response_model=VersionDetail)
async def get_version(version_id: str = Path(..., min_length=1),
                      user=Depends(get_current_user), db=Depends(get_db)):
    r = await db.hearing_report_versions.find_one(
        {"version_id": version_id,
         "clinic_id":  user["clinic_id"],
         "deleted":    {"$ne": True}},
        {"_id": 0},
    )
    if not r:
        raise HTTPException(status_code=404, detail="Version not found")
    return VersionDetail(
        version_id=r["version_id"],
        session_id=r["session_id"],
        patient_id=r["patient_id"],
        patient_name=r.get("patient_name") or "",
        patient_mrd=r.get("patient_mrd") or "",
        visit_date=r.get("visit_date") or "",
        label=r.get("label") or "",
        saved_by_name=r.get("saved_by_name") or "",
        saved_at=str(r.get("saved_at") or ""),
        snapshot=r.get("snapshot") or {},
    )


@router.delete("/{version_id}")
async def delete_version(version_id: str = Path(..., min_length=1),
                         user=Depends(get_current_user), db=Depends(get_db)):
    if user.get("role") not in DELETE_ROLES:
        raise HTTPException(status_code=403, detail="Only owners can delete saved reports")
    res = await db.hearing_report_versions.update_one(
        {"version_id": version_id, "clinic_id": user["clinic_id"]},
        {"$set": {"deleted": True,
                  "deleted_at": datetime.now(timezone.utc),
                  "deleted_by": user["user_id"]}},
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Version not found")
    return {"ok": True}
