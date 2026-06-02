"""Serial-item state machine for the Hearing-Aid module.

Defines the 9 legal states + the (from → to) transition table frozen in
`/app/memory/HA_MODULE_ARCHITECTURE.md § 3`. The only way to move a serial
item between states is via `transition_serial(...)` — direct writes to
`serial_items.state` are a contract violation and will be caught in lint/tests
as they're added.

Every successful transition writes one append-only row to `serial_events`:
    {serial_id, from, to, at, actor_user_id, ref_doc, note}
"""
from __future__ import annotations

from datetime import datetime, timezone
from fastapi import HTTPException

# 10 legal states. ON_LOAN added in Phase 14 for the loaner lifecycle —
# IN_STOCK → ON_LOAN at handover, ON_LOAN → IN_STOCK at patient return.
STATES = frozenset({
    "IN_STOCK", "RESERVED", "TRIAL_OUT", "SOLD",
    "LOANER", "ON_LOAN", "SERVICE_IN", "RETURNED", "DAMAGED", "RETIRED",
})

# Every other (from, to) pair → 409.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "IN_STOCK":   frozenset({"RESERVED", "TRIAL_OUT", "SOLD", "LOANER", "ON_LOAN", "SERVICE_IN", "DAMAGED"}),
    "RESERVED":   frozenset({"SOLD", "IN_STOCK"}),
    "TRIAL_OUT":  frozenset({"SOLD", "IN_STOCK", "DAMAGED"}),
    "LOANER":     frozenset({"IN_STOCK", "DAMAGED"}),
    "ON_LOAN":    frozenset({"IN_STOCK", "DAMAGED"}),
    "SERVICE_IN": frozenset({"IN_STOCK", "RETURNED", "DAMAGED"}),
    "SOLD":       frozenset({"SERVICE_IN", "RETURNED"}),
    "DAMAGED":    frozenset({"SERVICE_IN", "RETIRED"}),
    "RETURNED":   frozenset({"RETIRED"}),  # terminal → vendor credit → retire
    "RETIRED":    frozenset(),              # terminal
}


def assert_transition(from_state: str, to_state: str) -> None:
    """Raises 409 if the transition is not in the table."""
    if from_state not in STATES:
        raise HTTPException(status_code=500, detail=f"Invalid source state: {from_state!r}")
    if to_state not in STATES:
        raise HTTPException(status_code=400, detail=f"Invalid target state: {to_state!r}")
    if to_state not in ALLOWED_TRANSITIONS.get(from_state, frozenset()):
        raise HTTPException(
            status_code=409,
            detail=f"Illegal serial-item transition: {from_state} → {to_state}",
        )


async def transition_serial(
    db,
    serial_id: str,
    to_state: str,
    actor_user_id: str,
    ref_doc: dict | None = None,
    note: str | None = None,
) -> dict:
    """Atomically moves a SerialItem to `to_state` and writes the audit row.

    `ref_doc` should be a small dict describing the triggering record, e.g.
    {"kind": "grn", "id": "GRN-2026-0001"} or {"kind": "sale", "id": "SAL-…"}.
    Returns the updated SerialItem doc (minus _id)."""
    si = await db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
    if not si:
        raise HTTPException(status_code=404, detail="Serial item not found")

    assert_transition(si["state"], to_state)

    now = datetime.now(timezone.utc).isoformat()
    await db.serial_items.update_one(
        {"serial_id": serial_id},
        {"$set": {"state": to_state, "updated_at": now}},
    )
    await db.serial_events.insert_one({
        "serial_id": serial_id,
        "from": si["state"],
        "to": to_state,
        "at": now,
        "actor_user_id": actor_user_id,
        "ref_doc": ref_doc or {},
        "note": note,
    })
    si["state"] = to_state
    si["updated_at"] = now
    return si
