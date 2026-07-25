"""Phase 12.0 — nightly trial-expiry scanner.

Runs daily at 02:00 IST. For every clinic whose stored tier is PREMIUM/STANDARD
via trial (`trial_ends_at` is now in the past), flip it down to the default
`post_trial_tier` ("BASIC") and clear `trial_ends_at`.

The frontend will detect the change on next page load via `/api/subscription/my`
and the ModuleGate lock screens will surface immediately.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("trial_expiry")


async def run_trial_expiry_scan(db, post_trial_tier: str = "BASIC") -> int:
    """Returns count of clinics flipped. Idempotent — safe to run any time.

    `trial_ends_at` may be stored as EITHER a BSON date (legacy admin seed
    path) OR an ISO string (`serialize_datetime()` path used by
    `/public/clinic-signup` and every subsequent write). We match both by
    OR-ing a datetime `$lte` and a string `$lte` on `now.isoformat()`.
    Without this, self-signed-up tenants would silently never downgrade —
    they'd enjoy free PREMIUM forever.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    flipped = 0
    async for c in db.clinics.find(
        {"$or": [
            {"trial_ends_at": {"$type": "string", "$lte": now_iso}},
            {"trial_ends_at": {"$type": "date", "$lte": now}},
        ]},
        {"_id": 0, "clinic_id": 1, "trial_ends_at": 1, "subscription_tier": 1},
    ):
        await db.clinics.update_one(
            {"clinic_id": c["clinic_id"]},
            {"$set": {"subscription_tier": post_trial_tier,
                      "trial_expired_at": now_iso,
                      "tier_auto_downgraded_from_trial": True},
             "$unset": {"trial_ends_at": ""}},
        )
        flipped += 1
        log.info(
            "Trial expired for %s — flipped %s → %s",
            c["clinic_id"], c.get("subscription_tier") or "?", post_trial_tier,
        )
    if flipped:
        log.info("Trial-expiry scan: %d clinic(s) downgraded", flipped)
    return flipped
