"""NAV-006 F-007 · Merged-patient resolution for clinical reports.

When a session references a `patient_id` that no longer resolves directly
(patient was hard-deleted, or the session was created BEFORE the NAV-005
Sprint-3A merge whitelist added `test_sessions`), this helper walks the
`patients.merged_into` pointer + the `patient_merge_events` log to find
the CURRENT surviving primary — **never crossing clinic boundaries**.

READ-ONLY. Does not mutate any collection.

Every DB query is filtered by `session.clinic_id`, so:
  • a forged merge_event with a different `clinic_id` cannot resolve
  • a patient in another clinic can never be substituted
  • callers only get back a patient whose `clinic_id == session.clinic_id`
    (or `None` if the chain is genuinely unresolvable — the caller then
    falls back to whatever "UNKNOWN" behaviour it uses today).
"""
from __future__ import annotations

from typing import Optional

# Safety cap on chain-following. A real-world merge chain is 1–3 hops;
# 8 is generous and prevents infinite loops from malformed data.
MAX_CHAIN_DEPTH = 8


async def _follow_merged_into_chain(
    db, start: dict, clinic_id: str
) -> dict:
    """Follow `patient.merged_into` pointers, staying within `clinic_id`,
    until we hit a live patient (no `merged_into`) or the chain breaks.
    Returns the last successfully-loaded patient in the chain (never None
    because `start` itself is returned when it has no `merged_into`)."""
    current = start
    seen: set[str] = set()
    depth = 0
    while (
        depth < MAX_CHAIN_DEPTH
        and current.get("merged_into")
        and current.get("patient_id") not in seen
    ):
        seen.add(current.get("patient_id"))
        next_pid = current["merged_into"]
        if not next_pid:
            break
        nxt = await db.patients.find_one(
            {"patient_id": next_pid, "clinic_id": clinic_id}, {"_id": 0},
        )
        if not nxt:
            # Chain terminates at a missing intermediate — keep the last
            # successfully-loaded patient rather than returning None so
            # the report at least renders with the closest known ancestor.
            break
        current = nxt
        depth += 1
    return current


async def resolve_patient_for_session(
    db, session: dict
) -> Optional[dict]:
    """Resolve the surviving primary patient for a session.

    Returns:
        • The current live patient dict — clinic_id verified equal to
          `session.clinic_id` by construction of every query below.
        • `None` when direct + merge-log resolution both fail. The caller
          is expected to render an "UNKNOWN" fallback in that case.

    Handles:
        • normal patient (direct hit — no chain)
        • secondary merged into primary (direct hit → chase merged_into)
        • chained merges A→B→C (chase up to MAX_CHAIN_DEPTH)
        • undone merge (patient.merged_into is $unset on undo — chain stops)
        • patient hard-deleted (direct miss → consult merge_events)
        • malformed merge event (missing primary_patient_id → returns None)
        • cross-clinic merge_event injection (filtered out by clinic_id
          on every query)
    """
    clinic_id = session.get("clinic_id")
    patient_id = session.get("patient_id")
    if not clinic_id or not patient_id:
        return None

    # ── Step 1 — direct lookup, clinic-scoped ────────────────────────
    p = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if p is not None:
        # Chase the merged_into chain if the direct hit was itself a
        # merged secondary. `_follow_merged_into_chain` is idempotent
        # when there's nothing to chase.
        return await _follow_merged_into_chain(db, p, clinic_id)

    # ── Step 2 — direct miss: consult patient_merge_events ───────────
    # The patient row is genuinely gone (hard-deleted OR legacy
    # pre-Sprint-3A row whose secondary was never active-marked).
    # Look for a NON-UNDONE merge event where this patient_id was
    # the SECONDARY, ordered most-recent-first, scoped to session's
    # clinic. Cross-clinic events cannot match.
    evt = await db.patient_merge_events.find_one(
        {
            "secondary_patient_id": patient_id,
            "clinic_id": clinic_id,
            "undone_at": None,
        },
        {"_id": 0, "primary_patient_id": 1},
        sort=[("merged_at", -1)],
    )
    if not evt:
        return None
    primary_pid = evt.get("primary_patient_id")
    if not primary_pid:
        return None

    primary = await db.patients.find_one(
        {"patient_id": primary_pid, "clinic_id": clinic_id}, {"_id": 0},
    )
    if primary is None:
        # Primary was also deleted after the merge — genuinely orphan.
        return None
    # Primary itself might be a further-merged secondary — chase the
    # chain one more time.
    return await _follow_merged_into_chain(db, primary, clinic_id)
