"""Session-wide pytest config.

Loads env files at collection time, then idempotently seeds a *dedicated test
tenant* (`clinic-pytest-suite` with admin `pytest.admin@audinexa.test`) into
the database so the suite can run against a production-style deployment
where `DISABLE_DEMO_SEED=1` strips the legacy `clinic-acs-demo` fixture.

Why a dedicated test tenant instead of the legacy `admin@acs.in` bootstrap?
--------------------------------------------------------------------------
The previous bootstrap re-created `clinic-acs-demo` (the original sandbox
clinic) so 49 legacy test files could keep logging in as the hardcoded
`admin@acs.in`. That meant we could never permanently drop the demo tenant
from production — the test suite was effectively gluing it back on every
run.

We've now migrated all `test_*.py` files to read credentials from
`tests/_helpers.py` (which honours `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD`
env vars), so this bootstrap can target a completely test-only tenant that
doesn't pollute the marketing/demo namespace.

Override behaviour:
  * `TEST_CLINIC_ID`        — default: `clinic-pytest-suite`
  * `TEST_CLINIC_NAME`      — default: `Pytest Suite Tenant`
  * `TEST_ADMIN_EMAIL`      — default: `pytest.admin@audinexa.test`
  * `TEST_ADMIN_PASSWORD`   — default: `Pytest@123`

Env files are loaded with `override=False` so a value already set in the
shell (e.g. CI) wins.
"""
from __future__ import annotations

import os
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


# Resolve repo root from this file (conftest.py lives at /app/backend/tests/)
_REPO = Path(__file__).resolve().parent.parent.parent  # -> /app
_load_env_file(_REPO / "backend" / ".env")
_load_env_file(_REPO / "frontend" / ".env")


# ────────────────────────────────────────────────────────────────────
# Self-bootstrapping pytest tenant
# ────────────────────────────────────────────────────────────────────
import asyncio  # noqa: E402  (deliberate after env-load)
import sys      # noqa: E402

sys.path.insert(0, str(_REPO / "backend"))


_PYTEST_CLINIC_ID = os.environ.get("TEST_CLINIC_ID", "clinic-pytest-suite")
_PYTEST_CLINIC_NAME = os.environ.get("TEST_CLINIC_NAME", "Pytest Suite Tenant")
_PYTEST_ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "pytest.admin@audinexa.test")
_PYTEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "Pytest@123")

# Sub-role accounts used by ~30 legacy tests (front desk, audiologist, accounts).
_PYTEST_FRONTDESK_EMAIL = os.environ.get("TEST_FRONTDESK_EMAIL", "pytest.frontdesk@audinexa.test")
_PYTEST_FRONTDESK_PASSWORD = os.environ.get("TEST_FRONTDESK_PASSWORD", "Pytest@123")
_PYTEST_AUDIO_EMAIL = os.environ.get("TEST_AUDIO_EMAIL", "pytest.audio@audinexa.test")
_PYTEST_AUDIO_PASSWORD = os.environ.get("TEST_AUDIO_PASSWORD", "Pytest@123")
_PYTEST_ACCOUNTS_EMAIL = os.environ.get("TEST_ACCOUNTS_EMAIL", "pytest.accounts@audinexa.test")
_PYTEST_ACCOUNTS_PASSWORD = os.environ.get("TEST_ACCOUNTS_PASSWORD", "Pytest@123")


def _bootstrap_pytest_tenant() -> None:
    """Idempotently ensure the pytest tenant + super_admin user + 1 branch
    + 1 patient exist. No-op if already present.

    Errors are logged + swallowed — tests will surface the real auth failure.
    """
    try:
        from datetime import datetime, timezone

        from motor.motor_asyncio import AsyncIOMotorClient

        from auth import hash_password
        from utils.serde import serialize_datetime

        async def _go() -> None:
            mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = mongo[os.environ["DB_NAME"]]
            try:
                # 1) Clinic
                if not await db.clinics.find_one({"clinic_id": _PYTEST_CLINIC_ID}):
                    await db.clinics.insert_one(serialize_datetime({
                        "clinic_id": _PYTEST_CLINIC_ID,
                        "name": _PYTEST_CLINIC_NAME,
                        "city": "Mumbai",
                        "state": "Maharashtra",
                        "phone": "+91-22-00000099",
                        "email": "pytest@audinexa.test",
                        "mrd_prefix": "PYT",
                        # PREMIUM so every feature is reachable in the test
                        # suite without per-feature tier-bypass plumbing.
                        "subscription_tier": "PREMIUM",
                        "created_at": datetime.utcnow(),
                    }))

                # 2) All four role users (idempotent on email)
                role_users = [
                    ("USR-PYTEST-ADMIN",      _PYTEST_ADMIN_EMAIL,      _PYTEST_ADMIN_PASSWORD,      "Pytest Super Admin",  "super_admin"),
                    ("USR-PYTEST-FRONTDESK",  _PYTEST_FRONTDESK_EMAIL,  _PYTEST_FRONTDESK_PASSWORD,  "Pytest Front Desk",   "front_desk"),
                    ("USR-PYTEST-AUDIO",      _PYTEST_AUDIO_EMAIL,      _PYTEST_AUDIO_PASSWORD,      "Pytest Audiologist",  "audiologist"),
                    ("USR-PYTEST-ACCOUNTS",   _PYTEST_ACCOUNTS_EMAIL,   _PYTEST_ACCOUNTS_PASSWORD,   "Pytest Accounts",     "accounts"),
                ]
                # Resolve branch_id once (set after step 3 below). We'll
                # patch it onto branch-restricted users in a second pass.
                for uid, email, pw, name, role in role_users:
                    if not await db.users.find_one({"email": email}):
                        await db.users.insert_one({
                            "user_id": uid,
                            "email": email,
                            "password_hash": hash_password(pw),
                            "name": name,
                            "role": role,
                            "clinic_id": _PYTEST_CLINIC_ID,
                            "active": True,
                            "branch_ids": [],
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })

                # 3) Primary branch (named "Mumbai HQ" for legacy test
                # compatibility — many tests assert this exact name).
                branch = await db.branches.find_one({"clinic_id": _PYTEST_CLINIC_ID})
                if not branch:
                    bid = "BR-PYTEST-001"
                    await db.branches.insert_one({
                        "branch_id": bid,
                        "clinic_id": _PYTEST_CLINIC_ID,
                        "name": "Mumbai HQ",
                        "city": "Mumbai",
                        "state": "Maharashtra",
                        "is_primary": True,
                        "active": True,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                else:
                    bid = branch["branch_id"]

                # 4) Bootstrap patient (so simple list-tests succeed)
                if not await db.patients.find_one({"patient_id": "PT-PYTEST-BOOTSTRAP-001"}):
                    await db.patients.insert_one({
                        "patient_id": "PT-PYTEST-BOOTSTRAP-001",
                        "mrd_no": "PYT-2026-TEST01",
                        "clinic_id": _PYTEST_CLINIC_ID,
                        "primary_branch_id": bid,
                        "branch_ids": [bid],
                        "name": "Bootstrap Test Patient",
                        "phone": "+91-9999900099",
                        "email": "bootstrap@pytest.local",
                        "age": 45,
                        "gender": "Male",
                        "city": "Mumbai",
                        "active": True,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })

                # 5) Backfill branch_ids on branch-restricted role users.
                # CLINIC_WIDE_ROLES (super_admin/founder/accounts) see every
                # branch automatically; front_desk + audiologist need an
                # explicit grant.
                for email in (_PYTEST_FRONTDESK_EMAIL, _PYTEST_AUDIO_EMAIL):
                    await db.users.update_one(
                        {"email": email, "branch_ids": {"$ne": [bid]}},
                        {"$set": {"branch_ids": [bid], "primary_branch_id": bid}},
                    )

                # 6) Seed default service catalogue (idempotent).
                # Multiple legacy billing tests assume `/billing/services`
                # returns ≥ 1 row in the active clinic.
                try:
                    import billing as _billing  # local import: heavy module
                    await _billing.seed_default_services(db, _PYTEST_CLINIC_ID)
                except Exception as _e:  # noqa: BLE001
                    print(f"[conftest] service seed skipped: {_e}",
                          file=sys.stderr)
            finally:
                mongo.close()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_go())
            else:
                loop.run_until_complete(_go())
        except RuntimeError:
            asyncio.run(_go())
    except Exception as exc:  # noqa: BLE001
        print(f"[conftest] WARNING: pytest tenant bootstrap failed: {exc}",
              file=sys.stderr)


if os.environ.get("MONGO_URL") and os.environ.get("DB_NAME"):
    _bootstrap_pytest_tenant()
