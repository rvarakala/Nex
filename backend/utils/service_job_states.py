"""AUDINEXA Service Job 13-state machine (Phase 12.A).

Extends the original 4-state ticket (open/in_progress/resolved/closed) into the
full AUDINEXA pipeline, while preserving backward compatibility with any ticket
that was created before Phase 12.A.

Pipeline:
    RECEIVED        — intake complete (default on create)
    INSPECTED       — audiologist has examined the device
    AWAITING_DISPATCH — decision: send out to company
    DISPATCHED      — courier booked + picked up
    IN_TRANSIT      — courier en route
    DELIVERED_TO_COMPANY — company received device
    ESTIMATE_PENDING — company submitted estimate; awaiting customer
    CLIENT_APPROVED  — customer approved estimate
    CLIENT_REJECTED  — customer rejected estimate
    REPAIR_IN_PROGRESS — company repairing
    RETURN_SHIPPED  — company dispatched repaired device
    READY_FOR_PICKUP — received back at clinic, QC done
    DELIVERED_TO_CLIENT — handed over to patient
    CLOSED          — terminal
    CANCELLED       — aborted anywhere

Legacy 4-state values map on-read:
    open → RECEIVED, in_progress → REPAIR_IN_PROGRESS,
    resolved → READY_FOR_PICKUP, closed → CLOSED
"""
from __future__ import annotations

from typing import Set

from fastapi import HTTPException


# Full set of valid AUDINEXA states
SERVICE_JOB_STATES: list[str] = [
    "RECEIVED",
    "INSPECTED",
    "AWAITING_DISPATCH",
    "DISPATCHED",
    "IN_TRANSIT",
    "DELIVERED_TO_COMPANY",
    "ESTIMATE_PENDING",
    "CLIENT_APPROVED",
    "CLIENT_REJECTED",
    "REPAIR_IN_PROGRESS",
    "RETURN_SHIPPED",
    "READY_FOR_PICKUP",
    "DELIVERED_TO_CLIENT",
    "CLOSED",
    "CANCELLED",
]


# Transition matrix — (from → set[to]).
# Philosophy: each state can always transition to CANCELLED or directly to
# CLOSED (if the front-desk needs to hard-close an abandoned job).
JOB_TRANSITIONS: dict[str, Set[str]] = {
    "RECEIVED":             {"INSPECTED", "AWAITING_DISPATCH", "READY_FOR_PICKUP", "CANCELLED"},
    "INSPECTED":            {"AWAITING_DISPATCH", "READY_FOR_PICKUP", "CANCELLED"},  # in-house fix possible
    "AWAITING_DISPATCH":    {"DISPATCHED", "CANCELLED"},
    "DISPATCHED":           {"IN_TRANSIT", "CANCELLED"},
    "IN_TRANSIT":           {"DELIVERED_TO_COMPANY", "CANCELLED"},
    "DELIVERED_TO_COMPANY": {"ESTIMATE_PENDING", "REPAIR_IN_PROGRESS", "CANCELLED"},
    "ESTIMATE_PENDING":     {"CLIENT_APPROVED", "CLIENT_REJECTED", "CANCELLED"},
    "CLIENT_APPROVED":      {"REPAIR_IN_PROGRESS", "CANCELLED"},
    "CLIENT_REJECTED":      {"RETURN_SHIPPED", "CANCELLED"},  # return unrepaired
    "REPAIR_IN_PROGRESS":   {"RETURN_SHIPPED", "CANCELLED"},
    "RETURN_SHIPPED":       {"READY_FOR_PICKUP", "CANCELLED"},
    "READY_FOR_PICKUP":     {"DELIVERED_TO_CLIENT", "CANCELLED"},
    "DELIVERED_TO_CLIENT":  {"CLOSED"},
    "CLOSED":               set(),
    "CANCELLED":            set(),
}


# Backward-compat map: old 4-state → new 13-state (on-read normalisation).
# Tickets created BEFORE Phase 12.A had these values; we map them so the new
# UI + API don't have to special-case them everywhere.
LEGACY_STATUS_MAP = {
    "open":        "RECEIVED",
    "in_progress": "REPAIR_IN_PROGRESS",
    "resolved":    "READY_FOR_PICKUP",
    "closed":      "CLOSED",
    "cancelled":   "CANCELLED",
}


def normalise_status(st: str) -> str:
    """Map legacy values to new pipeline; return unchanged if already new."""
    if st in SERVICE_JOB_STATES:
        return st
    return LEGACY_STATUS_MAP.get(st, st)


def assert_job_transition(from_status: str, to_status: str) -> None:
    """Raise 409 if transition is illegal. Auto-normalises the FROM value."""
    cur = normalise_status(from_status)
    if to_status not in SERVICE_JOB_STATES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown target status: {to_status}. Valid: {SERVICE_JOB_STATES}",
        )
    if cur not in JOB_TRANSITIONS:
        raise HTTPException(
            status_code=409,
            detail=f"Current status {cur!r} has no defined transitions",
        )
    if to_status not in JOB_TRANSITIONS[cur]:
        raise HTTPException(
            status_code=409,
            detail=f"Illegal service-job transition: {cur} → {to_status}. "
                   f"Legal next states: {sorted(JOB_TRANSITIONS[cur])}",
        )


# Terminal states (no further transitions possible).
TERMINAL_STATES: Set[str] = {"CLOSED", "CANCELLED"}


# Status → UI metadata (colour hint, human label).
STATUS_META = {
    "RECEIVED":             ("Received",             "slate"),
    "INSPECTED":            ("Inspected",            "blue"),
    "AWAITING_DISPATCH":    ("Awaiting Dispatch",    "amber"),
    "DISPATCHED":           ("Dispatched",           "orange"),
    "IN_TRANSIT":           ("In Transit",           "orange"),
    "DELIVERED_TO_COMPANY": ("At Service Centre",    "indigo"),
    "ESTIMATE_PENDING":     ("Estimate Pending",     "amber"),
    "CLIENT_APPROVED":      ("Approved by Client",   "emerald"),
    "CLIENT_REJECTED":      ("Rejected by Client",   "rose"),
    "REPAIR_IN_PROGRESS":   ("Repair in Progress",   "indigo"),
    "RETURN_SHIPPED":       ("Return Shipped",       "orange"),
    "READY_FOR_PICKUP":     ("Ready for Pickup",     "emerald"),
    "DELIVERED_TO_CLIENT":  ("Delivered to Client",  "emerald"),
    "CLOSED":               ("Closed",               "slate"),
    "CANCELLED":            ("Cancelled",            "rose"),
}
