"""Subscription tier registry + FastAPI dependency.

Single source of truth for:
  * Tier → modules map (what each tier unlocks)
  * Annual base prices (derived prices in get_tier_prices)
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
    "STANDARD": ["frontdesk", "diagnostics", "hearing-aids"],
    "PREMIUM":  ["frontdesk", "diagnostics", "hearing-aids", "repair", "analytics"],
}


# Annual base prices (INR). Quarterly/half-yearly are derived.
_ANNUAL_PRICE: dict[str, int] = {
    "BASIC": 3999,
    "STANDARD": 5999,
    "PREMIUM": 11999,
}

# Multipliers rounded to ₹100 (Option C math: quarterly = 0.30× annual,
# half-yearly = 0.55× annual). Quarterly is intentionally the *worst* deal
# so annual is the clear winner.
_DURATION_MULT = {"quarterly": 0.30, "half_yearly": 0.55, "annual": 1.00}


def get_tier_prices() -> dict:
    """Returns the full price matrix used by the landing page + pricing UI."""
    out = {}
    for tier, annual in _ANNUAL_PRICE.items():
        out[tier] = {
            "annual":      annual,
            "half_yearly": int(round(annual * _DURATION_MULT["half_yearly"] / 100) * 100),
            "quarterly":   int(round(annual * _DURATION_MULT["quarterly"] / 100) * 100),
            # Savings figure shown on UI to nudge annual purchase
            "annual_savings_vs_quarterly": int(
                round(annual * _DURATION_MULT["quarterly"] / 100) * 100 * 4 - annual
            ),
        }
    return out


def has_module_access(tier: str, module: str) -> bool:
    return module in TIER_MODULES.get(tier or "BASIC", [])


async def resolve_effective_tier(clinic: dict) -> str:
    """Returns the tier *effectively* active right now — honours 30-day Premium
    trial. Does NOT mutate the DB; cron `expire_trials()` flips expired ones
    to BASIC nightly.
    """
    from datetime import datetime, timezone
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
        if user["role"] == "super_admin":
            return user
        clinic = await db.clinics.find_one(
            {"clinic_id": user["clinic_id"]},
            {"_id": 0, "subscription_tier": 1, "trial_ends_at": 1},
        )
        if not clinic:
            raise HTTPException(status_code=404, detail="Clinic not found")
        tier = await resolve_effective_tier(clinic)
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
