"""Regression test: MFA enforcement for platform admins.

Verifies the 3 states for a super_admin / founder account:

  1. **No grace stamped**  → first authenticated request lazily stamps
     `mfa_grace_started_at`. Login + every endpoint still works.

  2. **Inside grace**      → `auth.me` returns `mfa_enforcement.blocked = false`
     and `grace_days_left > 0`. Endpoints work.

  3. **Past grace**        → endpoints (except the MFA setup allowlist)
     return 403 with `code = MFA_ENFORCEMENT_REQUIRED`. The MFA setup
     endpoints (and `/api/auth/me`) keep working so the user can complete
     enrolment.

A regular `clinic_owner` account is unaffected.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

import os
import pytest
import requests

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H  # noqa: E402

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
import asyncio  # noqa: E402


# Manage the user doc directly so we don't pollute global state.
DB_NAME = os.environ.get("DB_NAME", "test_database")
MONGO_URL = os.environ.get("MONGO_URL")


async def _set_user_field(email: str, field_set: dict, field_unset: dict | None = None):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    update: dict = {}
    if field_set: update["$set"] = field_set
    if field_unset: update["$unset"] = field_unset
    if update:
        await db.users.update_one({"email": email}, update)
    client.close()


def _set_user_field_sync(email: str, field_set: dict, field_unset: dict | None = None):
    return asyncio.run(_set_user_field(email, field_set, field_unset))


@pytest.fixture(scope="function")
def admin_token_fresh():
    """Login each call → side-effect of stamping `mfa_grace_started_at`."""
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


def test_grace_window_lazily_stamped_on_first_use(admin_token_fresh):
    """Reset the user doc so it has neither mfa_enabled nor a grace stamp,
    hit any authenticated endpoint, and verify the stamp now exists +
    enforcement.blocked is False."""
    # Clear any prior state on the test admin
    _set_user_field_sync(
        ADMIN_EMAIL,
        field_set={"mfa_enabled": False},
        field_unset={"mfa_grace_started_at": "", "mfa_secret_encrypted": ""},
    )
    # Fresh login picks up the cleared doc
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)

    me = requests.get(f"{API}/auth/me", headers=H(tok), timeout=10).json()
    user = me.get("user", me)
    enf = user.get("mfa_enforcement")
    assert enf is not None, f"`mfa_enforcement` must be on /auth/me response: {user}"
    assert enf["required"] is True
    assert enf["enabled"] is False
    assert enf["blocked"] is False
    # `grace_days_left` is the *whole* days remaining. Fresh stamp on the
    # same calendar day → 7 days left.
    assert enf["grace_days_left"] == 7, f"Fresh stamp must show 7 days, got {enf['grace_days_left']}"

    # Hitting a normal endpoint should still work inside grace.
    r = requests.get(f"{API}/patients?limit=1", headers=H(tok), timeout=10)
    assert r.status_code == 200


def test_past_grace_blocks_normal_endpoints_but_allows_mfa_setup():
    """Backdate `mfa_grace_started_at` by 8 days → block every non-MFA path."""
    _set_user_field_sync(
        ADMIN_EMAIL,
        field_set={
            "mfa_enabled": False,
            "mfa_grace_started_at": (datetime.now(timezone.utc) - timedelta(days=8)).isoformat(),
        },
        field_unset={"mfa_secret_encrypted": ""},
    )
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)

    # /auth/me is on the allowlist → must succeed and report blocked=True
    r = requests.get(f"{API}/auth/me", headers=H(tok), timeout=10)
    assert r.status_code == 200
    enf = r.json().get("user", r.json())["mfa_enforcement"]
    assert enf["blocked"] is True, f"Expected blocked, got {enf}"
    assert enf["grace_days_left"] == 0

    # /api/mfa/status is on the allowlist → 200
    r = requests.get(f"{API}/mfa/status", headers=H(tok), timeout=10)
    assert r.status_code == 200

    # /api/mfa/setup/init is on the allowlist → 200
    r = requests.post(f"{API}/mfa/setup/init", headers=H(tok), timeout=10)
    assert r.status_code == 200

    # A normal endpoint → 403 with the enforcement code
    r = requests.get(f"{API}/patients?limit=1", headers=H(tok), timeout=10)
    assert r.status_code == 403
    body = r.json()
    detail = body.get("detail") if isinstance(body, dict) else body
    if isinstance(detail, dict):
        assert detail.get("code") == "MFA_ENFORCEMENT_REQUIRED"
    else:
        # FastAPI may serialise dict-detail as a JSON string in some configs
        assert "MFA_ENFORCEMENT_REQUIRED" in r.text


def test_cleanup_clears_enforcement_state():
    """Housekeeping — leave the test admin in a clean state for other tests."""
    _set_user_field_sync(
        ADMIN_EMAIL,
        field_set={"mfa_enabled": False},
        field_unset={
            "mfa_grace_started_at": "",
            "mfa_secret_encrypted": "",
            "mfa_temp_secret_encrypted": "",
            "mfa_recovery_codes": "",
        },
    )
    # After cleanup, the admin can hit normal endpoints again
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    r = requests.get(f"{API}/patients?limit=1", headers=H(tok), timeout=10)
    assert r.status_code == 200
