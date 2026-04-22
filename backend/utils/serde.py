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
        # HA CRM (Phase 6)
        "due_date", "next_due_date", "last_delivered_at",
        # Service tickets
        "resolved_at",
        # Share-link audit uses ISO strings
        "last_accessed_at", "expires_at",
    }
    if isinstance(obj, dict):
        return {k: (v if k in STRING_DATE_KEYS else deserialize_datetime(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deserialize_datetime(item) for item in obj]
    if isinstance(obj, str):
        try:
            return datetime.fromisoformat(obj)
        except Exception:
            return obj
    return obj
