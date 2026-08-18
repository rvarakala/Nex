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


@router.get("/patients/duplicates")
async def list_duplicate_patients(
    key: str = "phone_and_name",   # or "phone_only" or "name_only"
    min_group: int = 2,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Sweep every active patient in the clinic and return groups where
    two or more rows share the same normalised phone AND/OR name — the
    "one-screen bulk duplicate" tool the owner uses to clean up merges.

    Normalisation matches what `check-duplicate` uses:
      · phone → last 10 digits of `mobile` (falls back to `phone` /
        `alternate_mobile`)
      · name  → lower-cased, whitespace-collapsed

    Rows that were already merged (`merged_into` set) are excluded so
    old cleanups don't re-surface.
    """
    if key not in ("phone_and_name", "phone_only", "name_only"):
        raise HTTPException(400, "key must be phone_and_name / phone_only / name_only")

    cursor = db.patients.find(
        {"clinic_id": user["clinic_id"], "merged_into": {"$in": [None, False]}},
        {"_id": 0, "patient_id": 1, "mrd": 1, "name": 1, "mobile": 1,
         "phone": 1, "alternate_mobile": 1, "age": 1, "gender": 1,
         "email": 1, "created_at": 1, "updated_at": 1, "active": 1},
    )

    def _norm_phone(row):
        for k in ("mobile", "phone", "alternate_mobile"):
            v = row.get(k)
            if not v:
                continue
            digits = re.sub(r"\D", "", str(v))
            if len(digits) >= 10:
                return digits[-10:]
        return None

    def _norm_name(row):
        v = (row.get("name") or "").strip().lower()
        return re.sub(r"\s+", " ", v) or None

    groups: dict = {}
    async for row in cursor:
        ph = _norm_phone(row) if key != "name_only" else None
        nm = _norm_name(row)  if key != "phone_only" else None
        if key == "phone_and_name":
            k = (ph or "", nm or "") if (ph and nm) else None
        elif key == "phone_only":
            k = (ph,) if ph else None
        else:
            k = (nm,) if nm else None
        if not k:
            continue
        groups.setdefault(k, []).append(row)

    dup_groups = [
        {"key": {"phone": k[0] if key != "name_only" else None,
                 "name":  k[-1] if key != "phone_only" else None},
         "count": len(rows),
         "patients": sorted(rows, key=lambda r: r.get("created_at") or "")}
        for k, rows in groups.items()
        if len(rows) >= min_group
    ]
    # Biggest groups first — those are the ones costing the clinic the
    # most manual clean-up.
    dup_groups.sort(key=lambda g: (-g["count"], g["key"].get("phone") or "", g["key"].get("name") or ""))
    dup_groups = dup_groups[:limit]

    # Enrich each patient with light activity counts so the owner can
    # tell at a glance which row is the "real" record before merging.
    for grp in dup_groups:
        for p in grp["patients"]:
            pid = p["patient_id"]
            p["counts"] = {
                "sessions": await db.test_sessions.count_documents(
                    {"clinic_id": user["clinic_id"], "patient_id": pid}),
                "invoices": await db.invoices.count_documents(
                    {"clinic_id": user["clinic_id"], "patient_id": pid}),
                "appointments": await db.appointments.count_documents(
                    {"clinic_id": user["clinic_id"], "patient_id": pid}),
            }

    return {
        "key": key,
        "group_count": len(dup_groups),
        "affected_patients": sum(g["count"] for g in dup_groups),
        "groups": [deserialize_datetime(g) for g in dup_groups],
    }


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
# a merge.
#
# NAV-005 Sprint-3A / MERGE-001 update: extended after a repo-wide audit
# of every `patient_id` FK. Additions cover HA follow-ups, loaners,
# subscriptions, trade-ins, custom orders, ear-moulds and portal
# appointment requests — all of which are patient-scoped operational
# records that must follow the surviving patient.
#
# Intentionally NOT rewritten (documented for future readers):
#   • activity_logs, greeting_log  — audit trails; original patient_id
#     preserved for forensic accuracy. A new activity_log entry is
#     written at merge-time so the audit chain stays intact.
#   • patient_merge_events          — the merge event itself; secondary_id
#     MUST keep pointing at the actually-merged secondary.
#   • patient_otps                  — short-lived (10 min) portal auth
#     tokens; secondary is deactivated so they cannot be used. Deleted
#     during merge (see `_MERGE_DELETE_COLLECTIONS`).
#   • payments                      — no top-level patient_id; embedded
#     in invoices. Follows invoices which are already re-parented.
#   • partner_payouts               — aggregated by partner_id + period;
#     no patient_id FK. Attribution follows patients.referring_doctor_id.
#   • hearing_report_versions       — already in whitelist.
#   • serial_items                  — special-cased below (MERGE-002):
#     `current_patient_id` is the CURRENT ownership pointer and must be
#     rewritten separately from the standard `patient_id` FK. Historical
#     ownership audit lives in `serial_events` (no direct patient_id).
#   • family_groups                 — special-cased below (MERGE-003):
#     subdocument `members[]` + denormalised `patients.family_group_id`.
_MERGEABLE_COLLECTIONS = [
    "appointments", "invoices", "service_tickets", "cancellation_logs",
    "dpdpa_actions", "reminder_logs", "test_sessions", "ha_sales",
    "ha_fittings", "waitlist", "referral_notifications", "quotations",
    "hearing_report_versions", "tokens", "ha_trials", "patient_feedback",
    "ha_amc_contracts", "report_deliveries", "ha_quotes", "ha_quick_sales",
    "patient_notes",
    # NAV-005 Sprint-3A additions (MERGE-001):
    "ha_followups", "ha_loaners", "ha_subscriptions", "ha_trade_ins",
    "custom_ha_orders", "ear_mould_orders", "patient_appointment_requests",
]

# Collections where secondary rows are DELETED (not re-parented) on
# merge. Short-lived credentials that can't be used against a
# deactivated patient anyway.
_MERGE_DELETE_COLLECTIONS = [
    "patient_otps",
]

# Collections with a non-standard patient-ownership field. Rewritten
# on merge via `field` rather than `patient_id`. Undo reverses using
# the same `field` marker (recorded in `rewrites`).
_MERGE_ALT_FIELDS = [
    ("serial_items", "current_patient_id"),  # MERGE-002 — active device owner
]


class MergePayload(BaseModel):
    primary_patient_id: str
    secondary_patient_id: str
    dry_run: bool = False


# ─── MERGE-003 · Family group cohesion helpers ───────────────────────
# See the decision tree comment inside `merge_patients` for behaviour.
async def _plan_family_merge(db, clinic_id: str, primary: dict, secondary: dict):
    """Read-only planner. Returns (action, group_id) describing what
    `_apply_family_merge` will do. Called during dry-run for preview
    and again at wet-run.
    """
    a_gid = primary.get("family_group_id")
    b_gid = secondary.get("family_group_id")
    if a_gid and b_gid and a_gid == b_gid:
        return ("cleanup_same_group", a_gid)         # case 1
    if a_gid and not b_gid:
        return ("noop", None)                        # case 2
    if b_gid and not a_gid:
        return ("inherit_secondary", b_gid)          # case 3
    if a_gid and b_gid and a_gid != b_gid:
        return ("conflict", a_gid)                   # case 4 — leave both as-is
    return ("noop", None)                            # case 5


async def _apply_family_merge(db, clinic_id: str, primary: dict, secondary: dict,
                              action: str, group_id):
    """Apply the family-merge action returned by `_plan_family_merge`.
    Returns a small dict logged into `patient_merge_events.family_result`
    so undo can reverse precisely.
    """
    result: dict = {"action": action, "group_id": group_id}
    primary_id = primary["patient_id"]
    secondary_id = secondary["patient_id"]

    if action == "cleanup_same_group":
        # Remove secondary from members[]; primary already listed.
        secondary_member = await _find_member(db, clinic_id, group_id, secondary_id)
        result["removed_member"] = secondary_member
        await db.family_groups.update_one(
            {"group_id": group_id, "clinic_id": clinic_id},
            {"$pull": {"members": {"patient_id": secondary_id}}},
        )
    elif action == "inherit_secondary":
        # Move primary into secondary's group. Secondary is deactivated,
        # so we replace its member row with primary (preserving the
        # relationship label the front-desk originally chose).
        secondary_member = await _find_member(db, clinic_id, group_id, secondary_id)
        result["inherited_member"] = secondary_member
        relationship = (secondary_member or {}).get("relationship") if secondary_member else None
        # Push primary FIRST (so if $pull fails we don't lose the group entirely).
        await db.family_groups.update_one(
            {"group_id": group_id, "clinic_id": clinic_id,
             "members.patient_id": {"$ne": primary_id}},
            {"$push": {"members": {"patient_id": primary_id, "relationship": relationship}}},
        )
        await db.family_groups.update_one(
            {"group_id": group_id, "clinic_id": clinic_id},
            {"$pull": {"members": {"patient_id": secondary_id}}},
        )
        # Denormalised pointer on patients row.
        await db.patients.update_one(
            {"patient_id": primary_id, "clinic_id": clinic_id},
            {"$set": {"family_group_id": group_id}},
        )
    elif action == "conflict":
        # Documented behaviour: primary keeps its group, secondary keeps its.
        # Nothing to write here (secondary's deactivation is handled by the
        # main merge routine). Owner is expected to reconcile manually.
        result["note"] = "primary and secondary were in different family groups; both preserved"
    # noop cases 2 and 5: nothing to do.
    return result


async def _find_member(db, clinic_id: str, group_id: str, patient_id: str):
    """Return the {patient_id, relationship} subdoc for `patient_id`
    inside `group_id`, or None."""
    group = await db.family_groups.find_one(
        {"group_id": group_id, "clinic_id": clinic_id},
        {"_id": 0, "members": 1},
    )
    if not group:
        return None
    for m in group.get("members", []):
        if m.get("patient_id") == patient_id:
            return {"patient_id": patient_id, "relationship": m.get("relationship")}
    return None


async def _undo_family_merge(db, clinic_id: str, family_result: dict,
                             primary_snapshot: dict, secondary_snapshot: dict,
                             primary_patient_id: str, secondary_patient_id: str):
    """Reverse the family-merge action recorded during merge."""
    action = family_result.get("action")
    group_id = family_result.get("group_id")
    undo = {"action": f"undo_{action}", "group_id": group_id}

    if action == "cleanup_same_group":
        removed = family_result.get("removed_member")
        if removed and group_id:
            await db.family_groups.update_one(
                {"group_id": group_id, "clinic_id": clinic_id,
                 "members.patient_id": {"$ne": secondary_patient_id}},
                {"$push": {"members": {
                    "patient_id": secondary_patient_id,
                    "relationship": removed.get("relationship"),
                }}},
            )
    elif action == "inherit_secondary":
        inherited = family_result.get("inherited_member")
        if group_id:
            # Restore secondary's membership row.
            if inherited:
                await db.family_groups.update_one(
                    {"group_id": group_id, "clinic_id": clinic_id,
                     "members.patient_id": {"$ne": secondary_patient_id}},
                    {"$push": {"members": {
                        "patient_id": secondary_patient_id,
                        "relationship": inherited.get("relationship"),
                    }}},
                )
            # Remove primary from the group.
            await db.family_groups.update_one(
                {"group_id": group_id, "clinic_id": clinic_id},
                {"$pull": {"members": {"patient_id": primary_patient_id}}},
            )
            # Restore primary's family_group_id (was None; unset it).
            if primary_snapshot.get("family_group_id") is None:
                await db.patients.update_one(
                    {"patient_id": primary_patient_id, "clinic_id": clinic_id},
                    {"$unset": {"family_group_id": ""}},
                )
            else:
                await db.patients.update_one(
                    {"patient_id": primary_patient_id, "clinic_id": clinic_id},
                    {"$set": {"family_group_id": primary_snapshot["family_group_id"]}},
                )
    # conflict and noop: nothing to reverse.
    return undo
# ─── /MERGE-003 helpers ──────────────────────────────────────────────


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
    # NOTE: We filter by `patient_id` ONLY (no clinic_id filter) here.
    # Rationale: secondary was already tenant-verified at the top of
    # this function, and `patient_id` is uuid4 — cross-tenant collision
    # is cryptographically impossible. Some mergeable collections
    # (e.g. `patient_notes`) do not carry `clinic_id` on the document,
    # so a `{clinic_id, patient_id}` filter would silently miss those
    # rows (a latent bug this Sprint-3A test surfaced).
    impact: dict = {}
    for coll in _MERGEABLE_COLLECTIONS:
        n = await db[coll].count_documents({
            "patient_id": payload.secondary_patient_id,
        })
        if n:
            impact[coll] = n

    # Alt-field collections (MERGE-002) — e.g. serial_items.current_patient_id
    alt_impact: dict = {}
    for coll, field in _MERGE_ALT_FIELDS:
        n = await db[coll].count_documents({
            field: payload.secondary_patient_id,
        })
        if n:
            alt_impact[f"{coll}:{field}"] = n

    # Family-group cohesion (MERGE-003) — computed for preview only.
    # Decision tree (documented in test suite):
    #   1. Both patients in SAME family group     → remove secondary from members[]
    #   2. Only PRIMARY in a family group         → add secondary is a no-op (secondary
    #                                               is being deactivated); we ALSO clear
    #                                               secondary.family_group_id if stale.
    #   3. Only SECONDARY in a family group       → inherit: primary is added to that
    #                                               group (taking secondary's slot), and
    #                                               patients.family_group_id is moved.
    #   4. BOTH in DIFFERENT family groups        → CONFLICT. Primary stays in its group.
    #                                               Secondary stays in its group (its
    #                                               member row remains; the group renders
    #                                               it as a merged/inactive dropout via
    #                                               `_populate_members`). A `family_conflict`
    #                                               entry is added to the activity log so the
    #                                               owner can manually resolve.
    #   5. Neither in a family group              → no-op.
    family_action, family_group_id_touch = await _plan_family_merge(
        db, clinic_id, primary, secondary,
    )
    family_impact = {"action": family_action, "group_id": family_group_id_touch} if family_action != "noop" else {}

    if payload.dry_run:
        return {
            "dry_run": True,
            "primary": {"patient_id": primary["patient_id"], "name": primary.get("name"), "mrd": primary.get("mrd")},
            "secondary": {"patient_id": secondary["patient_id"], "name": secondary.get("name"), "mrd": secondary.get("mrd")},
            "preview": impact,
            "alt_preview": alt_impact,
            "family": family_impact,
            "total_rows_affected": sum(impact.values()) + sum(alt_impact.values()),
        }

    # Wet-run: rewrite FKs in each whitelisted collection.
    # We snapshot the exact `_id`s BEFORE mutating so a 10-minute
    # undo window can precisely reverse just those rows — no relying
    # on `merged_from_patient_id` sentinels (which could be shared
    # across chained merges of the same row).
    applied: dict = {}
    rewrites: list = []  # [{coll, id: str(_id), field?: 'patient_id'|'current_patient_id'}, ...] — for undo
    now = datetime.utcnow()
    now_iso = now.isoformat()
    expires_at = now + timedelta(minutes=10)
    merge_id = f"MRG-{uuid.uuid4().hex[:12].upper()}"
    for coll, _ in impact.items():
        # Snapshot the ids we're about to rewrite (patient_id-only
        # filter — see impact-count rationale above).
        cursor = db[coll].find(
            {"patient_id": payload.secondary_patient_id},
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
        rewrites.extend([{"coll": coll, "id": str(_id), "field": "patient_id"} for _id in ids])

    # MERGE-002 — alt-field collections (serial_items.current_patient_id).
    # Historical ownership audit lives in `serial_events` and is NOT
    # touched — that's an append-only state-machine log keyed by
    # serial_id, not patient_id. Only the CURRENT ownership pointer moves.
    for coll, field in _MERGE_ALT_FIELDS:
        cursor = db[coll].find(
            {field: payload.secondary_patient_id},
            {"_id": 1},
        )
        ids = [d["_id"] async for d in cursor]
        if not ids:
            continue
        res = await db[coll].update_many(
            {"_id": {"$in": ids}},
            {"$set": {field: payload.primary_patient_id, "merged_from_patient_id": payload.secondary_patient_id}},
        )
        alt_key = f"{coll}:{field}"
        applied[alt_key] = int(res.modified_count or 0)
        rewrites.extend([{"coll": coll, "id": str(_id), "field": field} for _id in ids])

    # Delete short-lived credentials that would otherwise dangle.
    for coll in _MERGE_DELETE_COLLECTIONS:
        res = await db[coll].delete_many({
            "patient_id": payload.secondary_patient_id,
        })
        if res.deleted_count:
            applied[f"{coll}:deleted"] = int(res.deleted_count or 0)

    # MERGE-003 — family group cohesion.
    family_result = await _apply_family_merge(
        db, clinic_id, primary, secondary, family_action, family_group_id_touch,
    )

    # Capture the secondary's pre-merge state so undo can restore it
    # cleanly. Only fields the merge itself touches — everything else
    # is left as-is.
    secondary_snapshot = {
        "active": secondary.get("active", True),
        "family_group_id": secondary.get("family_group_id"),
    }
    primary_snapshot = {
        "family_group_id": primary.get("family_group_id"),
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
        "primary_snapshot": primary_snapshot,
        "family_result": family_result,
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
        "family_result": family_result,
        "at": now,
    }))

    return {
        "dry_run": False,
        "merge_id": merge_id,
        "expires_at": expires_at.isoformat(),
        "primary": {"patient_id": primary["patient_id"], "name": primary.get("name"), "mrd": primary.get("mrd")},
        "secondary": {"patient_id": secondary["patient_id"], "name": secondary.get("name"), "mrd": secondary.get("mrd")},
        "applied": applied,
        "family_result": family_result,
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
    now = datetime.now(timezone.utc)
    # Mongo stores as ISO string (see utils/serde.py — always emitted
    # with `+00:00` suffix). Coerce string → aware datetime for the
    # range check; if `expires_at` is somehow already a naive datetime
    # (legacy row from before serde stamping), treat it as UTC.
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except Exception:
            expires_at = None
    if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not expires_at or now >= expires_at:
        raise HTTPException(status_code=410, detail="Undo window (10 minutes) has expired")

    # Reverse every recorded rewrite. Update by `_id` so a subsequent
    # merge that touched the same rows can't accidentally get reverted
    # here — we only touch the specific ObjectIds we snapshotted.
    # Filter by `_id` only (no clinic_id constraint) because some
    # collections (e.g. patient_notes) don't carry clinic_id; the
    # rewrite list already contains only rows we authored during the
    # original merge, so this is safe.
    reverted: dict = {}
    for r in ev.get("rewrites", []):
        coll = r["coll"]
        field = r.get("field", "patient_id")  # legacy events default to patient_id
        try:
            oid = ObjectId(r["id"])
        except Exception:
            continue
        res = await db[coll].update_one(
            {"_id": oid},
            {"$set": {field: ev["secondary_patient_id"]}, "$unset": {"merged_from_patient_id": ""}},
        )
        if res.modified_count:
            key = f"{coll}:{field}" if field != "patient_id" else coll
            reverted[key] = reverted.get(key, 0) + 1

    # MERGE-003 undo — reverse family-group changes.
    family_undo = await _undo_family_merge(
        db, clinic_id, ev.get("family_result") or {},
        primary_snapshot=ev.get("primary_snapshot") or {},
        secondary_snapshot=ev.get("secondary_snapshot") or {},
        primary_patient_id=ev["primary_patient_id"],
        secondary_patient_id=ev["secondary_patient_id"],
    )

    # Restore the secondary patient.
    snap = ev.get("secondary_snapshot") or {}
    unset_fields = {"merged_into": "", "merged_at": "", "merged_by": ""}
    set_fields = {"active": snap.get("active", True)}
    # Restore family_group_id if it was cleared by the merge; otherwise unset any inheritance.
    if snap.get("family_group_id") is not None:
        set_fields["family_group_id"] = snap["family_group_id"]
    else:
        unset_fields["family_group_id"] = ""
    await db.patients.update_one(
        {"patient_id": ev["secondary_patient_id"], "clinic_id": clinic_id},
        {"$set": set_fields, "$unset": unset_fields},
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
        "family_undo": family_undo,
        "at": now,
    }))

    return {
        "merge_id": merge_id,
        "reverted": reverted,
        "family_undo": family_undo,
        "total_rows_reverted": sum(reverted.values()),
        "primary_patient_id": ev["primary_patient_id"],
        "secondary_patient_id": ev["secondary_patient_id"],
    }
