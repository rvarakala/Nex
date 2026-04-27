"""Optimistic concurrency control — server-side version columns.

Pattern: every versioned record has an integer `version` field. Clients send the
version they last loaded (via `If-Match: <int>` header OR `expected_version` in
the request body). On update, the server compares; on mismatch it raises
**409 Conflict** with a structured payload the client can use to drive a 3-way
merge UI.

Usage in routes:

    from utils.concurrency import (
        VersionConflict, get_expected_version, version_filter, version_update,
    )

    @router.put("/foo/{id}")
    async def update_foo(id: str, payload: ..., request: Request, ...):
        existing = await db.foos.find_one({"id": id})
        expected = get_expected_version(request, payload_dict={...})
        if expected is not None and existing["version"] != expected:
            raise VersionConflict(current=existing, expected_version=expected)

        upd = version_update({"name": payload.name})
        await db.foos.update_one({"id": id}, upd)

The helpers keep the per-route boilerplate to one or two lines and ensure every
versioned write is atomic + auditable.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request


class VersionConflict(HTTPException):
    """Raised when a write was attempted against a stale record version.

    Returns HTTP 409 with a payload the client can use to drive a 3-way diff:

        {
          "code": "VERSION_MISMATCH",
          "expected_version": <what client thought was current>,
          "current_version": <what server actually has>,
          "current": <full server doc, with _id stripped>,
          "detail": "<human-readable>"
        }
    """

    def __init__(self, *, current: Dict[str, Any], expected_version: int):
        # Strip Mongo internal id if present
        cleaned = {k: v for k, v in current.items() if k != "_id"}
        cur_v = int(cleaned.get("version", 1))
        super().__init__(
            status_code=409,
            detail={
                "code": "VERSION_MISMATCH",
                "expected_version": expected_version,
                "current_version": cur_v,
                "current": cleaned,
                "detail": (
                    f"This record was updated by someone else "
                    f"(version {expected_version} → {cur_v}). "
                    "Reload to see the latest changes, or merge yours into them."
                ),
            },
        )


def get_expected_version(
    request: Request,
    payload_dict: Optional[Dict[str, Any]] = None,
) -> Optional[int]:
    """Resolve the client's expected version from header or body.

    Precedence:
        1. `If-Match` HTTP header (canonical REST style)
        2. `expected_version` field in the request body

    Returns None if neither is supplied — in which case the route should treat
    the write as unversioned (legacy clients) and skip the version check, but
    still bump the version on success.
    """
    h = request.headers.get("if-match") or request.headers.get("If-Match")
    if h:
        try:
            return int(h.strip().strip('"'))
        except ValueError:
            return None
    if payload_dict and "expected_version" in payload_dict:
        v = payload_dict.get("expected_version")
        if v is not None:
            try:
                return int(v)
            except (ValueError, TypeError):
                return None
    return None


def version_update(set_fields: Dict[str, Any]) -> Dict[str, Any]:
    """Build the Mongo update document with `$inc: version` baked in.

    Always stamps `version_updated_at` (ISO string, UTC).
    """
    set_fields = dict(set_fields)
    set_fields["version_updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"$set": set_fields, "$inc": {"version": 1}}


def assert_version(existing: Dict[str, Any], expected: Optional[int]) -> None:
    """One-line guard for routes that already have `existing` loaded.

    Raises VersionConflict on mismatch. No-op when expected is None (legacy
    callers).
    """
    if expected is None:
        return
    cur = int(existing.get("version") or 1)
    if cur != expected:
        raise VersionConflict(current=existing, expected_version=expected)
