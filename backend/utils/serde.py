"""Shared datetime serialisation helpers used by server.py and routers.

Mongo stores datetimes as ISO strings (so we can compare with `$gte: '2026-...'`).
Pydantic models round-trip them back to `datetime` objects.
"""
from datetime import datetime


def serialize_datetime(obj):
    """Convert datetime objects to ISO format strings for MongoDB storage."""
    if isinstance(obj, dict):
        return {k: serialize_datetime(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [serialize_datetime(item) for item in obj]
    if isinstance(obj, datetime):
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
                else:
                    out[k] = v
            else:
                out[k] = deserialize_datetime(v)
        return out
    if isinstance(obj, list):
        return [deserialize_datetime(item) for item in obj]
    if isinstance(obj, str):
        try:
            return datetime.fromisoformat(obj)
        except Exception:
            return obj
    return obj
