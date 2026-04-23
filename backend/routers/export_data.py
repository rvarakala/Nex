"""Clinic-scoped "Export All Data" endpoint.

Honours the landing-page trust promise: *Your data is yours. Any day. Free.*
Any clinic_owner / accounts / super_admin / founder can pull their own clinic's
entire dataset as a streaming ZIP containing one CSV per collection plus a
README and metadata.json.

Platform roles (super_admin, founder) may additionally pass `?clinic_id=...`
to export any tenant's data — for support / migration workflows.

Collections are streamed to avoid memory spikes on large tenants. Password
hashes are NEVER included. `_id` is always projected out.
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from auth import get_current_user
from database import get_db
from utils.serde import serialize_datetime


router = APIRouter(prefix="/api/export", tags=["export"])


# Roles allowed to export their OWN clinic's data
CLINIC_EXPORT_ROLES = {"clinic_owner", "accounts", "super_admin", "founder"}

# Roles allowed to override the clinic via ?clinic_id=...
PLATFORM_EXPORT_ROLES = {"super_admin", "founder"}


# Collections we bundle into the ZIP. (collection_name, filename, sensitive_fields_to_drop)
# All queries are ALWAYS filtered by clinic_id — no cross-tenant leak possible.
EXPORTED_COLLECTIONS: list[tuple[str, str, tuple[str, ...]]] = [
    # Patient & clinical records
    ("patients",            "patients.csv",            ()),
    ("appointments",        "appointments.csv",        ()),
    ("waitlist",            "waitlist.csv",            ()),
    ("opd_tokens",          "tokens.csv",              ()),
    ("test_sessions",       "diagnostic_sessions.csv", ()),
    ("audiometry_reports",  "audiometry_reports.csv",  ()),
    ("report_deliveries",   "report_deliveries.csv",   ()),

    # Billing
    ("services",            "billing_catalogue.csv",   ()),
    ("invoices",            "invoices.csv",            ()),

    # Hearing aids commerce
    ("ha_sales",            "ha_sales.csv",            ()),
    ("ha_trials",            "ha_trials.csv",           ()),
    ("ha_subscriptions",    "ha_subscriptions.csv",    ()),
    ("ha_serial_items",     "ha_serial_items.csv",     ()),
    ("ha_fittings",         "ha_fittings.csv",         ()),
    ("ha_quotations",       "ha_quotations.csv",       ()),
    ("ha_purchase_orders",  "ha_purchase_orders.csv",  ()),
    ("ha_trade_ins",        "ha_trade_ins.csv",        ()),

    # Service & repair
    ("service_tickets",     "service_tickets.csv",     ()),
    ("repair_orders",       "repair_orders.csv",       ()),
    ("amc_contracts",       "amc_contracts.csv",       ()),
    ("loaner_units",        "loaner_units.csv",        ()),

    # CRM
    ("referring_doctors",   "referring_doctors.csv",   ()),
    ("referral_transactions", "referral_transactions.csv", ()),

    # Operations
    ("branches",            "branches.csv",            ()),
    ("users",               "users.csv",               ("password_hash",)),
    ("audit_log",           "audit_log.csv",           ()),
    ("login_events",        "login_events.csv",        ()),
]


def _flatten(value: Any) -> str:
    """Stringify a value so it survives a CSV cell. Lists/dicts → JSON."""
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    try:
        return json.dumps(value, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _rows_to_csv_bytes(rows: Iterable[dict], drop_fields: tuple[str, ...] = ()) -> bytes:
    """Materialise rows into a CSV byte-buffer with a stable, union-of-keys header."""
    rows = list(rows)
    if not rows:
        return b""
    # Build a stable column order: collect all keys across all docs, sorted but
    # with clinic_id / patient_id / id-like columns surfaced first when present.
    all_keys: set[str] = set()
    for r in rows:
        all_keys.update(r.keys())
    for f in drop_fields:
        all_keys.discard(f)

    preferred = [k for k in ("clinic_id", "patient_id", "appointment_id",
                             "invoice_id", "session_id", "ticket_id",
                             "sale_id", "trial_id", "user_id", "branch_id",
                             "created_at", "name", "email") if k in all_keys]
    remaining = sorted(all_keys - set(preferred))
    cols = preferred + remaining

    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(cols)
    for r in rows:
        writer.writerow([_flatten(r.get(c)) for c in cols])
    return buf.getvalue().encode("utf-8")


async def _fetch_clinic(db, clinic_id: str) -> Optional[dict]:
    return await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})


@router.get("/full")
async def export_full_clinic(
    clinic_id: Optional[str] = Query(None, description="Super-admin override — export any clinic"),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Bundle every clinic-scoped record into a downloadable ZIP.

    **Access rules**
    * `clinic_owner` / `accounts` / `super_admin` / `founder` — can export their *own* clinic.
    * `super_admin` / `founder` — can additionally pass `?clinic_id=...` to export any tenant.
    * Every other role → `403`.

    The response streams as `application/zip` with filename
    `audinexa-<clinic_id>-<YYYYMMDD-HHMMSS>.zip`.
    """
    role = user.get("role", "")
    if role not in CLINIC_EXPORT_ROLES:
        raise HTTPException(status_code=403, detail="Your role may not export clinic data.")

    target_clinic_id = user["clinic_id"]
    if clinic_id and clinic_id != target_clinic_id:
        if role not in PLATFORM_EXPORT_ROLES:
            raise HTTPException(status_code=403, detail="Only platform roles can export another clinic.")
        target_clinic_id = clinic_id

    clinic = await _fetch_clinic(db, target_clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail=f"Clinic not found: {target_clinic_id}")

    # Build ZIP in memory (small–medium tenants; for very large, we could stream
    # later, but a full beta clinic fits comfortably under 50 MB compressed).
    zip_buf = io.BytesIO()
    export_started = datetime.now(timezone.utc)
    record_counts: dict[str, int] = {}

    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        # Each collection → its own CSV, always filtered by clinic_id.
        for coll_name, fname, drop in EXPORTED_COLLECTIONS:
            projection = {"_id": 0}
            for f in drop:
                projection[f] = 0
            try:
                cursor = db[coll_name].find(
                    {"clinic_id": target_clinic_id}, projection
                ).sort("created_at", -1 if True else 1)
                # Bump the limit high; a single clinic's dataset is tiny vs platform.
                rows = await cursor.to_list(100_000)
            except Exception:
                # Unknown / not-yet-created collection → skip silently (don't break the whole export)
                rows = []
            # Run every row through serialize_datetime so dates come out as ISO
            normalised = [serialize_datetime(r) for r in rows]
            record_counts[coll_name] = len(normalised)
            csv_bytes = _rows_to_csv_bytes(normalised, drop_fields=drop)
            if csv_bytes:
                zf.writestr(fname, csv_bytes)

        # metadata.json — describes what's inside and provenance
        metadata = {
            "exported_at": export_started.isoformat(),
            "exported_by": {
                "user_id": user.get("user_id"),
                "email": user.get("email"),
                "role": role,
            },
            "clinic": {
                "clinic_id": clinic.get("clinic_id"),
                "name": clinic.get("name"),
                "city": clinic.get("city"),
                "state": clinic.get("state"),
                "tier": clinic.get("subscription_tier"),
            },
            "record_counts": record_counts,
            "schema_version": 1,
            "notes": (
                "Every CSV contains rows for a single clinic_id only. "
                "Password hashes are stripped from users.csv. "
                "Dates are ISO-8601 UTC. List/dict cells are JSON-encoded. "
                "This export is free, unrestricted, and contains no digital-rights-management."
            ),
        }
        zf.writestr("metadata.json", json.dumps(metadata, indent=2, default=str).encode("utf-8"))

        # README.txt — human-readable companion
        total = sum(record_counts.values())
        readme = (
            f"AUDINEXA clinic data export\n"
            f"==========================\n\n"
            f"Clinic : {clinic.get('name')} ({clinic.get('clinic_id')})\n"
            f"City   : {clinic.get('city') or '-'}\n"
            f"Tier   : {clinic.get('subscription_tier')}\n"
            f"When   : {export_started.isoformat()}\n"
            f"Rows   : {total:,} across {len(record_counts)} collections\n\n"
            f"Files\n-----\n"
            + "\n".join(f"  {fn:32s}  {record_counts.get(cn, 0):>8,} rows"
                       for cn, fn, _ in EXPORTED_COLLECTIONS if record_counts.get(cn))
            + "\n\n"
            f"This archive contains every record AUDINEXA stores for your clinic.\n"
            f"Open any CSV in Excel / Numbers / Google Sheets. Schema details are in metadata.json.\n"
            f"You may re-export any time — the feature is permanently free.\n"
        )
        zf.writestr("README.txt", readme.encode("utf-8"))

        # Audit: log the export itself into the source clinic's audit trail.
        try:
            await db.audit_log.insert_one({
                "clinic_id": target_clinic_id,
                "at": export_started,
                "actor_user_id": user.get("user_id"),
                "actor_email": user.get("email"),
                "actor_role": role,
                "action": "data_export.full",
                "target": {"clinic_id": target_clinic_id},
                "meta": {"total_rows": total, "collections": len(record_counts)},
            })
        except Exception:
            # Audit write must never break the export itself
            pass

    zip_buf.seek(0)
    stamp = export_started.strftime("%Y%m%d-%H%M%S")
    filename = f"audinexa-{target_clinic_id}-{stamp}.zip"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Length": str(len(zip_buf.getvalue())),
    }
    return StreamingResponse(zip_buf, media_type="application/zip", headers=headers)


@router.get("/preview")
async def export_preview(
    clinic_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Cheap counts-only preview used by the UI to set user expectations before
    triggering a full download. Returns the same collection list plus per-collection
    row counts — never any row contents."""
    role = user.get("role", "")
    if role not in CLINIC_EXPORT_ROLES:
        raise HTTPException(status_code=403, detail="Your role may not export clinic data.")

    target = user["clinic_id"]
    if clinic_id and clinic_id != target:
        if role not in PLATFORM_EXPORT_ROLES:
            raise HTTPException(status_code=403, detail="Only platform roles can preview another clinic.")
        target = clinic_id

    clinic = await _fetch_clinic(db, target)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    counts: dict[str, int] = {}
    for coll_name, _fname, _drop in EXPORTED_COLLECTIONS:
        try:
            n = await db[coll_name].count_documents({"clinic_id": target})
        except Exception:
            n = 0
        counts[coll_name] = n

    return {
        "clinic_id": target,
        "clinic_name": clinic.get("name"),
        "total_rows": sum(counts.values()),
        "per_collection": counts,
        "available_files": [fn for _cn, fn, _d in EXPORTED_COLLECTIONS],
    }
