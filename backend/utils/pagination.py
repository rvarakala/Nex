"""Cursor pagination helpers — P2 scalability.

Why cursor (not offset)?
- Offset pagination scans + skips N rows; the cost grows with the page
  number. With 50k invoices, page 100 is 50× slower than page 1.
- Cursor pagination uses an index seek on the sort field, so every page
  is ~constant-time. Critical when one clinic has 10k+ patients or
  invoices.

Cursor encoding: base64url-encoded JSON of the last row's sort-key
tuple, e.g. `{"d": "2026-05-01T10:00:00Z", "i": "INV-2026-0042"}`.
Opaque to the client — never parse it on the frontend.

Tie-breaker: every cursor includes a unique id field (`patient_id`,
`invoice_id`, `sale_no`) so rows sharing the primary sort field
(same-millisecond `updated_at`) are ordered deterministically.

Backward compat: if the caller doesn't pass `cursor`, the legacy
`limit`-only behaviour is preserved (we return a bare array). With
`cursor`, the response shape becomes `{items, next_cursor, has_more}`.
"""
from __future__ import annotations

import base64
import json
from typing import Optional


def encode_cursor(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_cursor(cursor: str) -> Optional[dict]:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, json.JSONDecodeError):
        return None


def cursor_clause(
    sort_field: str,
    id_field: str,
    cursor: Optional[str],
) -> Optional[dict]:
    """Returns a Mongo `$or` clause that picks rows strictly *after* the
    cursor in descending order of `sort_field`, with `id_field` as the
    tiebreaker. Returns None when the cursor is empty / invalid (= start
    of the list).
    """
    parsed = decode_cursor(cursor) if cursor else None
    if not parsed:
        return None
    sort_val = parsed.get("d")
    id_val = parsed.get("i")
    if sort_val is None or id_val is None:
        return None
    # Descending order: next rows have sort_val strictly less than the
    # cursor's value, OR equal-sort + id strictly less (since we sort
    # _id descending too as tiebreak — keeps it deterministic).
    return {
        "$or": [
            {sort_field: {"$lt": sort_val}},
            {"$and": [{sort_field: sort_val}, {id_field: {"$lt": id_val}}]},
        ]
    }


def next_cursor_for(
    rows: list,
    sort_field: str,
    id_field: str,
    limit: int,
) -> Optional[str]:
    """Builds the next-page cursor from the *last* row of the current
    page. Returns None when we know we're at the end (fewer rows than
    requested)."""
    if len(rows) < limit:
        return None
    last = rows[-1]
    sort_val = last.get(sort_field)
    id_val = last.get(id_field)
    if sort_val is None or id_val is None:
        return None
    return encode_cursor({"d": sort_val, "i": id_val})
