"""Subscription tier registry + FastAPI dependency.

Single source of truth for:
  * Tier → modules map (what each tier unlocks)
  * Monthly base prices (derived prices in get_tier_prices)
  * `require_tier` dependency for protecting premium endpoints

Tiers:
    BASIC     — M01 Front Desk + M02 Diagnostics (free-tier onboarding)
    STANDARD  — + M03 Hearing Aids commerce
    PREMIUM   — + M04 Service & Repair + M05 Owner Analytics & multi-branch
"""
from __future__ import annotations

from typing import Literal

from fastapi import Depends, HTTPException

from auth import get_current_user
from database import get_db


Tier = Literal["BASIC", "STANDARD", "PREMIUM"]
TIER_ORDER = ["BASIC", "STANDARD", "PREMIUM"]


# Modules each tier unlocks (additive — PREMIUM gets everything).
TIER_MODULES: dict[str, list[str]] = {
    "BASIC":    ["frontdesk", "diagnostics"],
    "STANDARD": ["frontdesk", "diagnostics", "hearing-aids", "amc", "patient-portal"],
    "PREMIUM":  ["frontdesk", "diagnostics", "hearing-aids", "amc", "patient-portal",
                 "repair", "analytics", "referral-partners"],
}


# Monthly base prices (INR) — source of truth. Displayed on the landing page.
_MONTHLY_PRICE: dict[str, int] = {
    "BASIC": 499,
    "STANDARD": 999,
    "PREMIUM": 1499,
}


def get_tier_prices() -> dict:
    """Returns the full price matrix used by the landing page + pricing UI.

    Monthly is the source of truth. Annual = 10 × monthly (industry-standard
    "pay yearly, get 2 months free" nudge). Quarterly and half-yearly are
    simple multiples of monthly (no discount) so annual remains the clear
    winner.
    """
    out = {}
    for tier, monthly in _MONTHLY_PRICE.items():
        annual = monthly * 10        # 2 months free vs. monthly
        quarterly = monthly * 3
        half_yearly = monthly * 6
        out[tier] = {
            "monthly":     monthly,
            "quarterly":   quarterly,
            "half_yearly": half_yearly,
            "annual":      annual,
            # Savings figure shown on UI to nudge annual purchase
            "annual_savings_vs_monthly":   monthly * 12 - annual,
            # Legacy key kept for backward-compat with admin panel + old clients
            "annual_savings_vs_quarterly": monthly * 12 - annual,
        }
    return out


def has_module_access(tier: str, module: str) -> bool:
    return module in TIER_MODULES.get(tier or "BASIC", [])


async def resolve_effective_tier(clinic: dict) -> str:
    """Returns the tier *effectively* active right now — honours 30-day Premium
    trial. Does NOT mutate the DB; cron `expire_trials()` flips expired ones
    to BASIC nightly. Tolerates a missing/None clinic dict — defaults to BASIC.
    """
    from datetime import datetime, timezone
    if not clinic:
        return "BASIC"
    tier = clinic.get("subscription_tier") or "BASIC"
    trial_end = clinic.get("trial_ends_at")
    if trial_end:
        if isinstance(trial_end, str):
            try:
                trial_end_dt = datetime.fromisoformat(trial_end.replace("Z", "+00:00"))
            except ValueError:
                trial_end_dt = None
        else:
            trial_end_dt = trial_end
        if trial_end_dt and trial_end_dt.tzinfo is None:
            trial_end_dt = trial_end_dt.replace(tzinfo=timezone.utc)
        if trial_end_dt and trial_end_dt > datetime.now(timezone.utc):
            return "PREMIUM"  # trial overrides stored tier
    return tier


def require_tier(*modules: str):
    """Dependency — protects a module's endpoints. Super-admin always bypasses.

    Usage:
        @router.get(..., dependencies=[Depends(require_tier("repair"))])
    """
    async def _dep(user=Depends(get_current_user), db=Depends(get_db)):
        if user["role"] in {"super_admin", "founder"}:
            return user
        clinic = await db.clinics.find_one(
            {"clinic_id": user["clinic_id"]},
            {"_id": 0, "subscription_tier": 1, "trial_ends_at": 1},
        )
        # If clinic doc is missing, treat as BASIC — return 402 (upgrade_required)
        # rather than 404, which is semantically the same module-access failure.
        tier = await resolve_effective_tier(clinic or {})
        for mod in modules:
            if not has_module_access(tier, mod):
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "upgrade_required",
                        "current_tier": tier,
                        "required_modules": list(modules),
                        "message": f"This feature is part of the {modules[0]!r} module. "
                                   f"Your current plan is {tier}. Upgrade to access.",
                    },
                )
        return user
    return _dep
