"""Shared datetime serialisation helpers used by server.py and routers.

Mongo stores datetimes as ISO strings (so we can compare with `$gte: '2026-...'`).
Pydantic models round-trip them back to `datetime` objects.

**UTC-awareness contract** (added 2026-08-12 after bug report from Sound
Clinic — patient timeline was showing 09:04 instead of 14:34 IST):
- `serialize_datetime` stamps a `+00:00` suffix on naive datetimes so
  frontend `new Date(...)` parses them as UTC (browsers otherwise treat
  naive ISO as local, causing a 5:30 hr offset in India).
- `deserialize_datetime` marks naive ISO strings as `tzinfo=timezone.utc`
  when parsing back to `datetime`, so FastAPI's JSON response emits
  `+00:00` on the way out — no need to touch 72+ frontend call sites.
"""
import logging
from datetime import datetime, timezone
from typing import List, Type

from pydantic import BaseModel, ValidationError

log = logging.getLogger(__name__)


def serialize_datetime(obj):
    """Convert datetime objects to ISO format strings for MongoDB storage.

    Naive datetimes are interpreted as UTC (matches our
    `datetime.utcnow()` convention) and emitted with a `+00:00`
    suffix so downstream JS clients parse them as UTC, not local.
    """
    if isinstance(obj, dict):
        return {k: serialize_datetime(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [serialize_datetime(item) for item in obj]
    if isinstance(obj, datetime):
        if obj.tzinfo is None:
            obj = obj.replace(tzinfo=timezone.utc)
        return obj.isoformat()
    return obj


def deserialize_datetime(obj):
    """Convert ISO format strings back to datetime objects.
    Skips known string-typed date fields (e.g., 'dob', HA date fields) to avoid coercing them into datetimes.
    """
    STRING_DATE_KEYS = {
        # Patient DOB is a YYYY-MM-DD string
        "dob",
        # HA module — all these are Optional[str] on the Pydantic models
        "warranty_end_date", "received_at", "expected_date",
        "approved_at", "closed_at", "updated_at",
        "start_date", "end_date", "valid_until",
        "sent_at", "accepted_at", "cancelled_at", "margin_approval_at",
        # HA Fittings (Phase 4)
        "first_fit_at", "completed_at", "measured_at", "at",
        # HA Trials (Phase 4.5)
        "return_date", "actual_return_date",
        # HA Loaners
        "issued_on", "expected_return_date",
        # HA CRM (Phase 6)
        "due_date", "next_due_date", "last_delivered_at",
        # Service tickets
        "resolved_at",
        # HA Trade-ins (Phase 10.5)
        "accepted_at", "applied_at", "rejected_at",
        # AUDINEXA Service (Phase 12.A + 12.B)
        "dispatched_at", "delivered_to_company_at", "estimate_received_at",
        "client_decided_at", "return_shipped_at", "ready_at",
        "delivered_to_client_at", "decided_at", "delivered_at",
        "conveyed_at",
        # AUDINEXA Couriers + Estimates (Phase 12.B)
        "dispatch_date", "eta_date", "received_on",
        # AMC (Phase 13.A)
        "amc_start_date", "amc_expiry_date", "last_service_at",
        # Patient Portal / Partner Portal (Phase 13.C/D)
        "otp_expires_at", "partner_since",
        # Share-link audit uses ISO strings
        "last_accessed_at", "expires_at",
        # Optimistic concurrency
        "version_updated_at",
        # AUDINEXA Connect (PR 1) — patient WhatsApp consent stamps + config audit
        "whatsapp_consent_at", "whatsapp_consent_withdrawn_at",
        "dpa_accepted_at", "last_test_at",
        # AUDINEXA Phase B — Imported clinical YYYY-MM-DD visit dates (PatientNote / Invoice / Appointment side metadata)
        "visit_date", "invoice_date",
        # HA borrow lifecycle (Inventory Phase B) — model declares these
        # as Optional[str] so they must stay strings on the way out.
        "borrowed_at", "returned_at",
        # Patient merge bookkeeping — Optional[str] on the Patient model.
        # Without this, the ISO string is coerced to datetime by the
        # recursive walker below and ResponseValidationError fires,
        # returning HTTP 500 on `GET /api/patients/:id` for any
        # already-merged secondary record.
        "merged_at",
    }
    if isinstance(obj, dict):
        # For string-typed date keys, coerce native datetime values back to
        # ISO strings so Pydantic models declaring `Optional[str]` accept the
        # response. Legacy docs sometimes store BSON datetime even though the
        # model expects a YYYY-MM-DD string — without this branch, FastAPI's
        # `response_model=` validation raises ResponseValidationError and the
        # endpoint returns HTTP 500 (the user sees a misleading "Connection
        # issue" toast from the axios retry interceptor).
        out = {}
        for k, v in obj.items():
            if k in STRING_DATE_KEYS:
                if isinstance(v, datetime):
                    # Date-only fields (dob etc.) → 'YYYY-MM-DD'.
                    # Date-time fields (updated_at etc.) → full ISO.
                    out[k] = (v.date().isoformat()
                              if v.hour == 0 and v.minute == 0 and v.second == 0
                              else v.isoformat())
                elif (isinstance(v, str) and len(v) >= 19
                      and v[4] == '-' and v[10] in ('T', ' ')
                      and not v.endswith('Z') and '+' not in v[10:]
                      and '-' not in v[10:]):
                    # Naive ISO datetime string from legacy `datetime.utcnow().isoformat()`
                    # writes — stamp UTC so JS clients converting to local
                    # time don't drift 5:30 hrs behind on IST browsers.
                    # Guard against re-tagging strings that already carry
                    # a `Z` / `+HH:MM` / `-HH:MM` suffix, and date-only
                    # values (YYYY-MM-DD, len == 10) which stay untouched.
                    out[k] = v + '+00:00'
                else:
                    out[k] = v
            else:
                out[k] = deserialize_datetime(v)
        return out
    if isinstance(obj, list):
        return [deserialize_datetime(item) for item in obj]
    if isinstance(obj, datetime):
        # BSON stores datetimes as naive `datetime` objects — pattern
        # spotted 2026-08-13 when the billing invoice popup was showing
        # UTC times to IST users. Sister of the string branch below:
        # stamp UTC on the naive value so FastAPI's encoder emits `Z`
        # and JS converts to local time correctly.
        if obj.tzinfo is None:
            return obj.replace(tzinfo=timezone.utc)
        return obj
    if isinstance(obj, str):
        try:
            parsed = datetime.fromisoformat(obj)
            # Naive strings (no `Z` or `+HH:MM`) come from legacy
            # `datetime.utcnow()` writes. Mark them UTC-aware so
            # FastAPI's JSON response emits `+00:00` and JS clients
            # convert to local time correctly. Without this, IST users
            # see UTC times (5:30 hr behind reality).
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except Exception:
            return obj
    return obj


def safe_deserialize_rows(
    rows: List[dict],
    model: Type[BaseModel],
    *,
    collection: str = "unknown",
    clinic_id: str = "",
) -> List[dict]:
    """Deserialise a batch of Mongo rows against a Pydantic `model`, but
    tolerate legacy documents that fail strict validation.

    Rows that validate cleanly are returned in the output list (with dates
    coerced by `deserialize_datetime`). Rows that fail validation are
    warn-logged (row id + first error line) and *skipped* so the whole
    endpoint doesn't 500 for one bad legacy row. This is the standard fix
    for tenants that have early-adopter data written before the schema was
    tightened (e.g. rows with `product_id=None` from the pre-2026 imports).

    Args:
        rows: Raw dicts from `.find(...).to_list()`.
        model: The Pydantic model that would normally be the `response_model`.
        collection: Human name of the collection (for log context).
        clinic_id: Tenant id (for log context).
    """
    out: List[dict] = []
    skipped = 0
    for r in rows:
        cleaned = deserialize_datetime(r)
        try:
            model(**cleaned)          # validate; we discard the model, keep the dict
            out.append(cleaned)
        except ValidationError as e:
            skipped += 1
            # Grab any obvious primary key for the log line
            row_key = (
                r.get("id") or r.get("serial_id") or r.get("contract_no")
                or r.get("fitting_id") or r.get("sku_id") or r.get("_id")
            )
            log.warning(
                "safe_deserialize_rows[%s] skipping bad row key=%s err=%s",
                collection, row_key, str(e).splitlines()[0][:200],
            )
    if skipped:
        log.info(
            "safe_deserialize_rows[%s] skipped %d legacy row(s) for clinic=%s",
            collection, skipped, clinic_id,
        )
    return out
