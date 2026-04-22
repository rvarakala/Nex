"""Shared RBAC matrix for the AUDINEXA Super Admin Panel.

Lives separately from auth.py because the permission list is driven by the
Admin Panel features (not by the clinic app). Imported by admin_panel.py and
admin_panel_b.py.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException

from auth import get_current_user


ROLE_PERMISSIONS: dict[str, list[str]] = {
    "founder":            ["*"],                   # includes delete-tenant
    "super_admin":        ["*:read", "*:write"],   # everything except delete-tenant
    "sales_manager":      [
        "dashboard:read", "tenants:read", "leads:read", "leads:write",
        "marketing:read", "marketing:write", "revenue:read", "audit:read",
    ],
    "support_agent":      [
        "dashboard:read", "tenants:read", "tenants:impersonate",
        "tickets:read", "tickets:write", "notifications:read",
        "audit:read", "system:read",
    ],
    "finance_manager":    [
        "dashboard:read", "tenants:read", "revenue:read", "revenue:write",
        "subscriptions:read", "subscriptions:write", "invoices:read",
        "invoices:write", "audit:read",
    ],
    "product_ops":        [
        "dashboard:read", "tenants:read", "features:read", "features:write",
        "usage:read", "system:read", "audit:read", "notifications:read",
        "notifications:write",
    ],
    "read_only":          [
        "dashboard:read", "tenants:read", "leads:read", "revenue:read",
        "tickets:read", "usage:read", "system:read", "audit:read",
        "subscriptions:read", "features:read", "notifications:read",
    ],
}

# Legacy roles never get admin-panel permissions
for legacy in ("clinic_owner", "front_desk", "audiologist", "accounts",
               "inventory_manager", "technician", "referral_partner"):
    ROLE_PERMISSIONS.setdefault(legacy, [])


def has_permission(user_role: str, action: str) -> bool:
    allowed = ROLE_PERMISSIONS.get(user_role, [])
    if "*" in allowed:
        return True
    verb = action.split(":")[-1]
    if f"*:{verb}" in allowed:
        return True
    return action in allowed


def require_permission(action: str):
    """Dependency — verifies caller has ACTION under ROLE_PERMISSIONS."""
    async def _dep(user=Depends(get_current_user)):
        if user["role"] in ("founder", "super_admin"):
            return user
        if not has_permission(user["role"], action):
            raise HTTPException(
                status_code=403,
                detail=f"Role '{user['role']}' lacks permission '{action}'",
            )
        return user
    return _dep
