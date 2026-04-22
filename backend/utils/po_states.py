"""Purchase-Order status state machine.

Keeps PO lifecycle rules in one place so they can be unit-tested
and reused by anything that needs to know "is this PO mutable?".
"""
from __future__ import annotations

from fastapi import HTTPException

# Legal statuses
PO_STATUSES = frozenset({
    "draft", "approved", "ordered",
    "partial_received", "received", "closed", "cancelled",
})

# (from → allowed targets). Any other transition is 409.
PO_ALLOWED: dict[str, frozenset[str]] = {
    "draft":             frozenset({"approved", "cancelled"}),
    "approved":          frozenset({"ordered", "cancelled"}),
    "ordered":           frozenset({"partial_received", "received", "cancelled"}),
    "partial_received":  frozenset({"received", "closed", "cancelled"}),
    "received":          frozenset({"closed"}),
    "closed":            frozenset(),
    "cancelled":         frozenset(),
}

# Statuses during which a GRN may be posted.
PO_RECEIVABLE = frozenset({"approved", "ordered", "partial_received"})


def assert_po_transition(from_status: str, to_status: str) -> None:
    """Raises 409 if the transition is not in the allowed table."""
    if from_status not in PO_STATUSES:
        raise HTTPException(status_code=500, detail=f"Unknown PO status: {from_status!r}")
    if to_status not in PO_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unknown target PO status: {to_status!r}")
    if to_status not in PO_ALLOWED.get(from_status, frozenset()):
        raise HTTPException(
            status_code=409,
            detail=f"Illegal PO transition: {from_status} → {to_status}",
        )


def auto_advance_on_grn(current: str, fully_received: bool) -> list[str]:
    """Return the sequence of status writes that should be applied to a PO
    after a GRN is posted.  `[]` means the status is already terminal or
    already at the right place.

    Walk through the allowed table — never skip states, so the audit remains
    faithful."""
    target = "received" if fully_received else "partial_received"
    path = {
        "approved":          ["ordered", target],          # approved → ordered → received/partial
        "ordered":           [target],
        "partial_received":  ["received"] if target == "received" else [],
    }
    return path.get(current, [])
