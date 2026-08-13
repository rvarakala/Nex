"""Patient CRUD + duplicate detection + MRD counter."""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_roles
from database import get_db
from models import Patient, PatientCreate
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


async def _next_mrd(db, clinic_id: str, mrd_prefix: str) -> str:
    """Generates a human-facing MRD like ACS-2026-001234 (6-digit annual counter per clinic)."""
    now = datetime.utcnow()
    counter = await db.counters.find_one_and_update(
        {"_id": f"mrd:{clinic_id}:{now.year}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = counter["seq"] if counter else 1
    return f"{mrd_prefix}-{now.year}-{seq:06d}"


@router.post("/patients", response_model=Patient)
async def create_patient(
    patient: PatientCreate,
    allow_duplicate_phone: bool = False,
    allow_duplicate_email: bool = False,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Create patient. Tenant-scoped. Auto-generates MRD.

    Duplicate-contact guards (2026-08-07):
      • **Phone** — matches last 10 digits across `mobile`,
        `alternate_mobile`, `phone`. Overridable via
        `?allow_duplicate_phone=true` for legitimate family-shares-one-
        phone cases.
      • **Email** — case-insensitive exact match on the `email` field.
        Overridable via `?allow_duplicate_email=true` (rare — usually
        indicates a typo or an actual duplicate).

    Both guards return **HTTP 409** with `{code, message, matches:[…]}` so
    the frontend can offer a friendly "Open existing / Create anyway"
    choice. Overrides are stamped on the activity log for forensic
    traceability.
    """
    # ── Duplicate-phone detection ──
    if not allow_duplicate_phone and patient.mobile:
        digits = re.sub(r"\D", "", str(patient.mobile))
        last10 = digits[-10:] if len(digits) >= 10 else digits
        if last10:
            rx = {"$regex": re.escape(last10), "$options": "i"}
            existing = await db.patients.find(
                {
                    "clinic_id": user["clinic_id"],
                    "$or": [
                        {"mobile": rx},
                        {"alternate_mobile": rx},
                        {"phone": rx},
                    ],
                    # Never surface merged/soft-deleted rows as duplicates
                    # (see `POST /patients/merge` below). This keeps the
                    # UX clean after a clinic has cleaned up their data.
                    "merged_into": {"$in": [None, False]},
                },
                {"_id": 0, "patient_id": 1, "mrd": 1, "name": 1,
                 "mobile": 1, "email": 1, "age": 1, "gender": 1, "updated_at": 1},
            ).sort("updated_at", -1).limit(5).to_list(5)
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "duplicate_phone",
                        "message": (
                            f"A patient with phone ending {last10[-4:] if len(last10) >= 4 else last10} "
                            f"already exists in this clinic."
                        ),
                        "matches": existing,
                        "hint": "Retry with ?allow_duplicate_phone=true if this is genuinely a new patient sharing the phone (e.g. a family member).",
                    },
                )

    # ── Duplicate-email detection ──
    # Case-insensitive exact match; emails don't have the "family shares
    # one" pattern that phones do, so a hit is nearly always either a
    # typo or a true duplicate. Kept overridable for the edge case where
    # a household really does share a mailbox.
    if not allow_duplicate_email and patient.email:
        e = patient.email.strip()
        if e:
            existing_e = await db.patients.find(
                {
                    "clinic_id": user["clinic_id"],
                    "email": {"$regex": f"^{re.escape(e)}$", "$options": "i"},
                    "merged_into": {"$in": [None, False]},
                },
                {"_id": 0, "patient_id": 1, "mrd": 1, "name": 1,
                 "mobile": 1, "email": 1, "age": 1, "gender": 1, "updated_at": 1},
            ).sort("updated_at", -1).limit(5).to_list(5)
            if existing_e:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "duplicate_email",
                        "message": f"A patient with email {e} already exists in this clinic.",
                        "matches": existing_e,
                        "hint": "Retry with ?allow_duplicate_email=true if this is genuinely a new patient sharing the email (e.g. a family address).",
                    },
                )

    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    mrd = await _next_mrd(db, user["clinic_id"], clinic.get("mrd_prefix", "ACS"))
    payload = patient.model_dump()
    # Stamp WhatsApp consent timestamp on the very first opt-in (DPDP audit).
    consent_at = datetime.now(timezone.utc).isoformat() if payload.get("whatsapp_consent") else None
    patient_obj = Patient(
        **payload,
        clinic_id=user["clinic_id"],
        mrd=mrd,
        whatsapp_consent_at=consent_at,
    )
    doc = serialize_datetime(patient_obj.model_dump())
    await db.patients.insert_one(doc)
    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": "patient.create",
        "patient_id": patient_obj.patient_id,
        "duplicate_phone_override": bool(allow_duplicate_phone and patient.mobile),
        "duplicate_email_override": bool(allow_duplicate_email and patient.email),
        "at": datetime.utcnow(),
    }))
    return patient_obj


@router.post("/patients/{patient_id}/whatsapp-consent")
async def update_whatsapp_consent(
    patient_id: str,
    payload: dict,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Toggle WhatsApp consent (DPDP Act 2023). Body: {grant: bool}."""
    grant = bool(payload.get("grant"))
    existing = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(404, "Patient not found")
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "whatsapp_consent": grant,
        "updated_at": now,
    }
    if grant:
        update["whatsapp_consent_at"] = now
        update["whatsapp_consent_withdrawn_at"] = None
    else:
        update["whatsapp_consent_withdrawn_at"] = now
    await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"$set": update},
    )
    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": "patient.whatsapp_consent" + (".grant" if grant else ".withdraw"),
        "patient_id": patient_id,
        "at": datetime.utcnow(),
    }))
    return {"patient_id": patient_id, "whatsapp_consent": grant, "at": now}


@router.get("/patients/check-duplicate")
async def check_duplicate_patient(
    mobile: Optional[str] = None,
    name: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Returns potential duplicates. Mobile matching normalises to last 10 digits;
    name is case-insensitive substring."""
    if not mobile and not name:
        return {"matches": []}
    ors = []
    if mobile:
        digits = re.sub(r"\D", "", str(mobile))
        last10 = digits[-10:] if len(digits) >= 10 else digits
        if last10:
            rx = {"$regex": re.escape(last10), "$options": "i"}
            ors.append({"mobile": rx})
            ors.append({"alternate_mobile": rx})
            ors.append({"phone": rx})
    if name and len(name.strip()) >= 3:
        ors.append({"name": {"$regex": re.escape(name.strip()), "$options": "i"}})
    if not ors:
        return {"matches": []}
    matches = await db.patients.find(
        {
            "clinic_id": user["clinic_id"],
            "$or": ors,
            "merged_into": {"$in": [None, False]},
        },
        {"_id": 0, "patient_id": 1, "mrd": 1, "name": 1, "mobile": 1, "age": 1, "gender": 1, "updated_at": 1},
    ).sort("updated_at", -1).limit(10).to_list(10)
    return {"matches": matches}


@router.get("/patients", response_model=None)
async def get_patients(
    search: Optional[str] = None,
    limit: int = 100,
    cursor: Optional[str] = None,
    include_merged: bool = False,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """List patients for this clinic.

    Two modes:
    - **Legacy / array mode** (no `cursor` param) — returns `[Patient, ...]`
      truncated to `limit`. Preserves backward compat for the 30+ call sites
      that haven't migrated yet.
    - **Cursor mode** (`?cursor=…` present, even if empty) — returns
      `{items, next_cursor, has_more}`. Use this for paginated UIs.

    Merged rows are hidden by default (post-merge cleanup). Pass
    `?include_merged=true` to surface them for forensic/audit views.
    """
    from utils.pagination import cursor_clause, next_cursor_for

    query: dict = {"clinic_id": user["clinic_id"]}
    if not include_merged:
        query["merged_into"] = {"$in": [None, False]}
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [
                {"name": rx}, {"mobile": rx}, {"alternate_mobile": rx},
                {"phone": rx}, {"patient_id": rx}, {"mrd": rx},
            ]

    # `cursor` query-param is present in the URL even when its value is
    # empty (= first page) — that's our signal to return the pagination
    # envelope. We can't distinguish "not provided" from "= empty string"
    # at the FastAPI layer easily, so we use the value-is-not-None hack:
    # FastAPI defaults `Optional[str]` to None when the param is omitted.
    paginated = cursor is not None

    if paginated and cursor:
        clause = cursor_clause("updated_at", "patient_id", cursor)
        if clause:
            # If query already has $or (from `search`), nest into $and so
            # both filter sets are required.
            if "$or" in query:
                query = {"$and": [{"$or": query.pop("$or")}, clause, query]}
            else:
                query.update(clause)

    cap = max(1, min(int(limit or 50), 500))
    fetch_limit = cap if paginated else cap

    rows = await (
        db.patients.find(query, {"_id": 0})
        .sort([("updated_at", -1), ("patient_id", -1)])
        .to_list(fetch_limit)
    )
    items = [deserialize_datetime(p) for p in rows]

    if paginated:
        nxt = next_cursor_for(rows, "updated_at", "patient_id", fetch_limit)
        return {
            "items": items,
            "next_cursor": nxt,
            "has_more": nxt is not None,
        }
    return items


@router.get("/patients/export.csv")
async def export_patients_csv(
    search: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Stream the current Patients view as CSV. Accepts the same
    `search` filter as `/api/patients`. Exports the *entire* matching
    result set (no 50/page cap), streamed in chunks so memory stays
    bounded even for clinics with 10k+ patients.

    Auth: cookie or Bearer (browser <a download> uses cookies).
    """
    from utils.csv_export import stream_csv

    query: dict = {"clinic_id": user["clinic_id"], "merged_into": {"$in": [None, False]}}
    if search:
        safe = re.escape(search.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [
                {"name": rx}, {"mobile": rx}, {"alternate_mobile": rx},
                {"phone": rx}, {"patient_id": rx}, {"mrd": rx},
            ]

    headers = [
        "MRD", "Patient ID", "Name", "Age", "Gender",
        "Mobile", "Alt Mobile", "Email",
        "City", "State", "Pincode",
        "Chief Complaint", "Ear Side",
        "Referring Doctor", "Referral Source", "Insurance Scheme",
        "Registered At", "Last Updated",
    ]

    async def rows_iter():
        cursor = db.patients.find(
            query,
            {"_id": 0, "mrd": 1, "patient_id": 1, "name": 1, "age": 1,
             "gender": 1, "mobile": 1, "alternate_mobile": 1, "email": 1,
             "city": 1, "state": 1, "pincode": 1, "chief_complaint": 1,
             "ear_side": 1, "referring_physician": 1, "referral_source": 1,
             "insurance_scheme": 1, "created_at": 1, "updated_at": 1},
        ).sort([("updated_at", -1), ("patient_id", -1)])
        async for p in cursor:
            yield [
                p.get("mrd") or "",
                p.get("patient_id") or "",
                p.get("name") or "",
                p.get("age") or "",
                p.get("gender") or "",
                p.get("mobile") or "",
                p.get("alternate_mobile") or "",
                p.get("email") or "",
                p.get("city") or "",
                p.get("state") or "",
                p.get("pincode") or "",
                (p.get("chief_complaint") or "").replace("\n", " ").strip(),
                p.get("ear_side") or "",
                p.get("referring_physician") or "",
                p.get("referral_source") or "",
                p.get("insurance_scheme") or "",
                str(p.get("created_at") or ""),
                str(p.get("updated_at") or ""),
            ]

    return await stream_csv(
        filename_prefix=f"audinexa-patients-{user['clinic_id']}",
        headers=headers,
        rows_iter=rows_iter(),
    )


@router.get("/patients/{patient_id}", response_model=Patient)
async def get_patient(patient_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    p = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    return deserialize_datetime(p)


@router.put("/patients/{patient_id}", response_model=Patient)
async def update_patient(patient_id: str, patient_update: PatientCreate,
                         user=Depends(get_current_user), db=Depends(get_db)):
    existing = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    update_data = patient_update.model_dump()
    update_data["updated_at"] = datetime.utcnow()
    await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(update_data)},
    )
    updated = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    return deserialize_datetime(updated)


@router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    existing = await db.patients.find_one({"patient_id": patient_id, "clinic_id": user["clinic_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Patient not found")
    await db.patients.delete_one({"patient_id": patient_id})
    await db.patient_notes.delete_many({"patient_id": patient_id})
    return {"message": "Patient deleted", "patient_id": patient_id}


# ═══════════════════════════════════════════════════════════════════════
#   Merge patients — collapse two accidentally-created duplicate records
#   into one canonical patient. Owner-only. Discovered via a production
#   report where front-desk had already created 3-4 rows for the same
#   patient before the phone-guard shipped.
# ═══════════════════════════════════════════════════════════════════════

# Whitelisted collections that carry a `patient_id` foreign key. Kept
# hand-maintained (rather than auto-discovered via listCollections) so a
# stray dev-time collection can never accidentally get rewritten during
# a merge. Enumerated by production count 2026-08-07. activity_logs and
# greeting_log intentionally NOT rewritten — those are audit trails and
# must retain the original patient_id for forensic accuracy. A new
# activity_log entry is written at merge-time so the audit chain stays
# intact.
_MERGEABLE_COLLECTIONS = [
    "appointments", "invoices", "service_tickets", "cancellation_logs",
    "dpdpa_actions", "reminder_logs", "test_sessions", "ha_sales",
    "ha_fittings", "waitlist", "referral_notifications", "quotations",
    "hearing_report_versions", "tokens", "ha_trials", "patient_feedback",
    "ha_amc_contracts", "report_deliveries", "ha_quotes", "ha_quick_sales",
    "patient_notes",
]


class MergePayload(BaseModel):
    primary_patient_id: str
    secondary_patient_id: str
    dry_run: bool = False


@router.post("/patients/merge")
async def merge_patients(
    payload: MergePayload,
    user=Depends(require_roles("clinic_owner")),
    db=Depends(get_db),
):
    """Merge `secondary` into `primary`. All FK'd rows across whitelisted
    collections get their `patient_id` rewritten to the primary. The
    secondary row is soft-marked (`merged_into=<primary>, active=False`)
    — never hard-deleted, so the audit chain stays intact.

    Owner-only (`clinic_owner`). In `dry_run` mode we compute the
    per-collection impact counts without touching a single document. The
    frontend uses this for the merge preview screen ("This will move 8
    appointments, 3 invoices…").
    """
    if payload.primary_patient_id == payload.secondary_patient_id:
        raise HTTPException(status_code=400, detail="primary and secondary must differ")

    clinic_id = user["clinic_id"]
    primary = await db.patients.find_one(
        {"patient_id": payload.primary_patient_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    secondary = await db.patients.find_one(
        {"patient_id": payload.secondary_patient_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if not primary:
        raise HTTPException(status_code=404, detail="Primary patient not found in your clinic")
    if not secondary:
        raise HTTPException(status_code=404, detail="Secondary patient not found in your clinic")
    if secondary.get("merged_into"):
        raise HTTPException(
            status_code=400,
            detail=f"Secondary was already merged into {secondary['merged_into']}",
        )

    # Compute per-collection impact counts BEFORE any writes.
    impact: dict = {}
    for coll in _MERGEABLE_COLLECTIONS:
        n = await db[coll].count_documents({
            "clinic_id": clinic_id,
            "patient_id": payload.secondary_patient_id,
        })
        if n:
            impact[coll] = n

    if payload.dry_run:
        return {
            "dry_run": True,
            "primary": {"patient_id": primary["patient_id"], "name": primary.get("name"), "mrd": primary.get("mrd")},
            "secondary": {"patient_id": secondary["patient_id"], "name": secondary.get("name"), "mrd": secondary.get("mrd")},
            "preview": impact,
            "total_rows_affected": sum(impact.values()),
        }

    # Wet-run: rewrite FKs in each whitelisted collection.
    # We snapshot the exact `_id`s BEFORE mutating so a 10-minute
    # undo window can precisely reverse just those rows — no relying
    # on `merged_from_patient_id` sentinels (which could be shared
    # across chained merges of the same row).
    applied: dict = {}
    rewrites: list = []  # [{coll, id: str(_id)}, ...] — for undo
    now = datetime.utcnow()
    now_iso = now.isoformat()
    expires_at = now + timedelta(minutes=10)
    merge_id = f"MRG-{uuid.uuid4().hex[:12].upper()}"
    for coll, _ in impact.items():
        # Snapshot the ids we're about to rewrite.
        cursor = db[coll].find(
            {"clinic_id": clinic_id, "patient_id": payload.secondary_patient_id},
            {"_id": 1},
        )
        ids = [d["_id"] async for d in cursor]
        if not ids:
            continue
        res = await db[coll].update_many(
            {"_id": {"$in": ids}},
            {"$set": {"patient_id": payload.primary_patient_id, "merged_from_patient_id": payload.secondary_patient_id}},
        )
        applied[coll] = int(res.modified_count or 0)
        rewrites.extend([{"coll": coll, "id": str(_id)} for _id in ids])

    # Capture the secondary's pre-merge state so undo can restore it
    # cleanly. Only fields the merge itself touches — everything else
    # is left as-is.
    secondary_snapshot = {
        "active": secondary.get("active", True),
    }

    # Soft-mark the secondary. Never hard-delete: forensic trail.
    await db.patients.update_one(
        {"patient_id": payload.secondary_patient_id, "clinic_id": clinic_id},
        {"$set": {
            "merged_into": payload.primary_patient_id,
            "merged_at": now_iso,
            "merged_by": user["user_id"],
            "active": False,
        }},
    )

    # Persist the merge event so the 10-minute undo window has
    # everything it needs (rewrite list + secondary snapshot + expiry).
    await db.patient_merge_events.insert_one(serialize_datetime({
        "merge_id": merge_id,
        "clinic_id": clinic_id,
        "primary_patient_id": payload.primary_patient_id,
        "secondary_patient_id": payload.secondary_patient_id,
        "primary_name": primary.get("name"),
        "secondary_name": secondary.get("name"),
        "merged_at": now,
        "merged_by": user["user_id"],
        "expires_at": expires_at,
        "rewrites": rewrites,
        "applied": applied,
        "secondary_snapshot": secondary_snapshot,
        "undone_at": None,
        "undone_by": None,
    }))

    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": clinic_id,
        "user_id": user["user_id"],
        "action": "patient.merge",
        "merge_id": merge_id,
        "primary_patient_id": payload.primary_patient_id,
        "secondary_patient_id": payload.secondary_patient_id,
        "rows_rewritten": applied,
        "at": now,
    }))

    return {
        "dry_run": False,
        "merge_id": merge_id,
        "expires_at": expires_at.isoformat(),
        "primary": {"patient_id": primary["patient_id"], "name": primary.get("name"), "mrd": primary.get("mrd")},
        "secondary": {"patient_id": secondary["patient_id"], "name": secondary.get("name"), "mrd": secondary.get("mrd")},
        "applied": applied,
        "total_rows_affected": sum(applied.values()),
    }


@router.get("/patients/{patient_id}/undoable-merges")
async def get_undoable_merges(
    patient_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Return every merge event within its 10-minute undo window
    where `patient_id` is either the surviving primary OR the merged
    secondary. Powers the amber "Merged just now — Undo" banner on
    both sides of the profile page.
    """
    # Mongo stores our datetimes as ISO strings (see utils/serde.py) so
    # the range comparison must be ISO-vs-ISO — not datetime-vs-string
    # (that silently returns [] because Mongo can't order across types).
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.patient_merge_events.find({
        "clinic_id": user["clinic_id"],
        "$or": [
            {"primary_patient_id": patient_id},
            {"secondary_patient_id": patient_id},
        ],
        "undone_at": None,
        "expires_at": {"$gt": now_iso},
    }).sort("merged_at", -1)
    out = []
    async for ev in cursor:
        out.append({
            "merge_id": ev["merge_id"],
            "primary_patient_id": ev["primary_patient_id"],
            "secondary_patient_id": ev["secondary_patient_id"],
            "primary_name": ev.get("primary_name"),
            "secondary_name": ev.get("secondary_name"),
            "merged_at": (ev["merged_at"].isoformat() if isinstance(ev["merged_at"], datetime) else ev["merged_at"]),
            "expires_at": (ev["expires_at"].isoformat() if isinstance(ev["expires_at"], datetime) else ev["expires_at"]),
            "merged_by": ev.get("merged_by"),
            "total_rows_affected": sum((ev.get("applied") or {}).values()),
            "role": "primary" if ev["primary_patient_id"] == patient_id else "secondary",
        })
    return out


@router.post("/patients/merge-events/{merge_id}/undo")
async def undo_merge(
    merge_id: str,
    user=Depends(require_roles("clinic_owner")),
    db=Depends(get_db),
):
    """Reverse a merge inside its 10-minute grace window.

    Rewrites every previously-rewritten row's `patient_id` back to the
    secondary, unsets `merged_from_patient_id`, un-soft-marks the
    secondary (restores `active` from snapshot, clears `merged_into`
    / `merged_at` / `merged_by`), and stamps the event as undone so
    it can't be re-run.

    Fails 404 if the event doesn't exist in this clinic, 410 if the
    window already expired, 409 if it was already undone.
    """
    clinic_id = user["clinic_id"]
    ev = await db.patient_merge_events.find_one({"merge_id": merge_id, "clinic_id": clinic_id})
    if not ev:
        raise HTTPException(status_code=404, detail="Merge event not found")
    if ev.get("undone_at"):
        raise HTTPException(status_code=409, detail="Merge already undone")

    expires_at = ev.get("expires_at")
    now = datetime.utcnow()
    # Mongo stores as ISO string (see utils/serde.py). Coerce both back
    # to naive datetime for the range check.
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except Exception:
            expires_at = None
    if not expires_at or now >= expires_at:
        raise HTTPException(status_code=410, detail="Undo window (10 minutes) has expired")

    # Reverse every recorded rewrite. Update by `_id` so a subsequent
    # merge that touched the same rows can't accidentally get reverted
    # here — we only touch the specific ObjectIds we snapshotted.
    reverted: dict = {}
    for r in ev.get("rewrites", []):
        coll = r["coll"]
        try:
            oid = ObjectId(r["id"])
        except Exception:
            continue
        res = await db[coll].update_one(
            {"_id": oid, "clinic_id": clinic_id},
            {"$set": {"patient_id": ev["secondary_patient_id"]}, "$unset": {"merged_from_patient_id": ""}},
        )
        if res.modified_count:
            reverted[coll] = reverted.get(coll, 0) + 1

    # Restore the secondary patient.
    snap = ev.get("secondary_snapshot") or {}
    await db.patients.update_one(
        {"patient_id": ev["secondary_patient_id"], "clinic_id": clinic_id},
        {
            "$set": {"active": snap.get("active", True)},
            "$unset": {"merged_into": "", "merged_at": "", "merged_by": ""},
        },
    )

    await db.patient_merge_events.update_one(
        {"merge_id": merge_id, "clinic_id": clinic_id},
        {"$set": {"undone_at": now, "undone_by": user["user_id"]}},
    )

    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": clinic_id,
        "user_id": user["user_id"],
        "action": "patient.merge_undo",
        "merge_id": merge_id,
        "primary_patient_id": ev["primary_patient_id"],
        "secondary_patient_id": ev["secondary_patient_id"],
        "rows_reverted": reverted,
        "at": now,
    }))

    return {
        "merge_id": merge_id,
        "reverted": reverted,
        "total_rows_reverted": sum(reverted.values()),
        "primary_patient_id": ev["primary_patient_id"],
        "secondary_patient_id": ev["secondary_patient_id"],
    }
