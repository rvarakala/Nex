"""Session-wide pytest config.

Injects env vars that individual tests need at import time (before any fixture
runs). Specifically:

* `backend/.env` — provides MONGO_URL, DB_NAME, JWT_SECRET, etc. for tests that
  spin up a direct motor client (e.g. Phase 1 numbering + state machine tests).
* `frontend/.env` — provides REACT_APP_BACKEND_URL for HTTP-level tests.

Both files are loaded with `override=False` so a value already set in the shell
(e.g. CI) wins.
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
# Self-bootstrapping test admin / clinic
# ────────────────────────────────────────────────────────────────────
#
# Production sets DISABLE_DEMO_SEED=1, which strips `clinic-acs-demo` and the
# four demo users (`admin@acs.in`, `frontdesk@acs.in`, `audiologist@acs.in`,
# `accounts@acs.in`) from the database. Most of the legacy test suite still
# logs in as `admin@acs.in`, which would 401 against a stripped database and
# every test would fail.
#
# Rather than rewrite 49 test files (high risk for a P2 cleanup), we detect
# the missing fixtures at pytest collection time and re-seed them in-place
# via the same helpers `seeds.demo` uses. This is idempotent and runs ONCE
# per pytest invocation — production code paths and the user's running
# preview/production servers are untouched.
import asyncio  # noqa: E402  (deliberate after env-load)
import sys      # noqa: E402

sys.path.insert(0, str(_REPO / "backend"))


def _bootstrap_test_admin() -> None:
    """Idempotently ensure `clinic-acs-demo` + the 4 demo users exist.

    No-op if the demo user already exists with the right password.
    Errors are logged + swallowed — tests will surface the real auth failure.
    """
    try:
        # We import inside the function so collection-time errors (e.g. missing
        # MONGO_URL when running unit tests in isolation) don't blow up pytest.
        from motor.motor_asyncio import AsyncIOMotorClient

        from seeds.demo import (
            _MUMBAI_USERS, _seed_primary_branch, _seed_primary_clinic, _seed_users,
        )

        async def _go() -> None:
            mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = mongo[os.environ["DB_NAME"]]
            try:
                clinic_id = "clinic-acs-demo"
                clinic_name = "ACS Audiology Clinic"
                await _seed_primary_clinic(db, clinic_id, clinic_name)
                await _seed_users(db, clinic_id, _MUMBAI_USERS)
                await _seed_primary_branch(db, clinic_id, "Mumbai HQ", "Mumbai", "Maharashtra")

                # Ensure at least one patient exists so simple tests like
                # `GET /patients?limit=1` succeed without each file having to
                # seed its own. Re-uses the demo MRD prefix so MRD generation
                # stays consistent.
                from datetime import datetime, timezone
                pid = "PT-TEST-BOOTSTRAP-001"
                if not await db.patients.find_one({"patient_id": pid}):
                    branch = await db.branches.find_one(
                        {"clinic_id": clinic_id}, {"_id": 0, "branch_id": 1},
                    )
                    bid = branch["branch_id"] if branch else None
                    await db.patients.insert_one({
                        "patient_id": pid,
                        "mrd_no": "ACS-2026-TEST01",
                        "clinic_id": clinic_id,
                        "primary_branch_id": bid,
                        "branch_ids": [bid] if bid else [],
                        "name": "Bootstrap Test Patient",
                        "phone": "+91-9999900001",
                        "email": "bootstrap@test.local",
                        "age": 45,
                        "gender": "Male",
                        "city": "Mumbai",
                        "active": True,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
            finally:
                mongo.close()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Inside an existing loop (rare during collection) — schedule a task
                loop.create_task(_go())
            else:
                loop.run_until_complete(_go())
        except RuntimeError:
            asyncio.run(_go())
    except Exception as exc:  # noqa: BLE001
        # Don't let bootstrap failures silently mask: print loudly so it shows
        # up in the test report header. Tests will still fail at login if needed.
        print(f"[conftest] WARNING: test admin bootstrap failed: {exc}", file=sys.stderr)


# Run bootstrap only when actually required env is present (skips for cases
# where pytest is collecting tests against a different MONGO_URL or no DB).
if os.environ.get("MONGO_URL") and os.environ.get("DB_NAME"):
    _bootstrap_test_admin()
