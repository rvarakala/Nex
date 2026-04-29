"""Demo / dev clinic seeding logic.

Extracted from `server.py` (Phase 2 refactor, 2026-04-28).

Two clinics are seeded for development & smoke-test purposes:
  • clinic-acs-demo      (Mumbai, PREMIUM) — primary sandbox with 4 demo users
  • clinic-delhi-test    (New Delhi, BASIC) — cross-tenant isolation fixture

Production safety:
  • Set `DISABLE_DEMO_SEED=1` to skip ALL of the below; only the founder
    account (`founder@audinexa.com`) is then provisioned via
    `admin_seed.seed_founder_only()`.
  • Set `FOUNDER_PASSWORD` env to override the default founder password.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from uuid import uuid4

from auth import hash_password, verify_password
from utils.serde import serialize_datetime

logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────
# Demo user matrix per clinic
# ────────────────────────────────────────────────────────────────────

_MUMBAI_USERS = [
    {"email": "admin@acs.in",        "password": "admin123",      "name": "Super Admin",     "role": "super_admin"},
    {"email": "frontdesk@acs.in",    "password": "frontdesk123",  "name": "Front Desk",      "role": "front_desk"},
    {"email": "audiologist@acs.in",  "password": "audio123",      "name": "Dr. Audiologist", "role": "audiologist"},
    {"email": "accounts@acs.in",     "password": "accounts123",   "name": "Accounts Team",   "role": "accounts"},
]

_DELHI_USERS = [
    {"email": "admin@delhi.test",       "password": "delhiadmin123",      "name": "Delhi Admin",      "role": "super_admin"},
    {"email": "frontdesk@delhi.test",   "password": "delhifrontdesk123",  "name": "Delhi Front Desk", "role": "front_desk"},
]


# ────────────────────────────────────────────────────────────────────
# Public entry-point
# ────────────────────────────────────────────────────────────────────

async def run_demo_seed(db, billing_module) -> None:
    """Idempotently seed dev clinics + users + branches + admin demo data.

    Called once at FastAPI startup from server.lifespan().
    """
    if os.environ.get("DISABLE_DEMO_SEED") == "1":
        logger.info("DISABLE_DEMO_SEED=1 — skipping demo data seed")
        try:
            from admin_seed import seed_founder_only
            await seed_founder_only(db)
        except Exception as e:                    # noqa: BLE001
            logger.warning("Founder seed skipped: %s", e)
        return

    clinic_id = os.environ.get("DEFAULT_CLINIC_ID", "clinic-acs-demo")
    clinic_name = os.environ.get("DEFAULT_CLINIC_NAME", "ACS Audiology Clinic")

    await _seed_primary_clinic(db, clinic_id, clinic_name)
    await _seed_users(db, clinic_id, _MUMBAI_USERS)
    await _backfill_legacy_clinic_id(db, clinic_id)

    # Optional service-catalogue auto-population (off by default in production).
    if os.environ.get("SEED_DEFAULT_SERVICES") == "1":
        try:
            inserted = await billing_module.seed_default_services(db, clinic_id)
            if inserted:
                logger.info("Seeded %d default services for %s", inserted, clinic_id)
        except Exception as e:                    # noqa: BLE001
            logger.warning("Service seeding skipped: %s", e)

    await _seed_primary_branch(db, clinic_id, "Mumbai HQ", "Mumbai", "Maharashtra")

    # Cross-tenant isolation fixture.
    await _seed_second_clinic(db, billing_module)

    # AUDINEXA Super Admin Panel demo data (founder + demo tenants + leads).
    try:
        from admin_seed import seed_admin_panel_demo
        await seed_admin_panel_demo(db)
    except Exception as e:                        # noqa: BLE001
        logger.warning("Admin panel seed skipped: %s", e)


# ────────────────────────────────────────────────────────────────────
# Building blocks (private — but shared between Mumbai + Delhi seed)
# ────────────────────────────────────────────────────────────────────

async def _seed_primary_clinic(db, clinic_id: str, name: str) -> None:
    existing = await db.clinics.find_one({"clinic_id": clinic_id})
    if not existing:
        await db.clinics.insert_one(serialize_datetime({
            "clinic_id": clinic_id,
            "name": name,
            "city": "Mumbai",
            "state": "Maharashtra",
            "phone": "+91-22-00000000",
            "email": "clinic@acsdemo.in",
            "mrd_prefix": "ACS",
            # Demo clinic seeded on PREMIUM so every feature is visible for showcase.
            "subscription_tier": "PREMIUM",
            "created_at": datetime.utcnow(),
        }))
        logger.info("Seeded default clinic: %s", clinic_id)
        return

    # Idempotent migration: backfill subscription_tier on a pre-existing doc.
    if not existing.get("subscription_tier"):
        await db.clinics.update_one(
            {"clinic_id": clinic_id},
            {"$set": {"subscription_tier": "PREMIUM"}},
        )


async def _seed_users(db, clinic_id: str, users: list[dict]) -> None:
    """Idempotently create + password-sync the given user matrix on `clinic_id`."""
    for u in users:
        found = await db.users.find_one({"email": u["email"]})
        if found:
            # Re-pin the password to the documented seed value if it drifted —
            # safe in dev/demo because credentials are public anyway.
            if not verify_password(u["password"], found.get("password_hash", "")):
                await db.users.update_one(
                    {"email": u["email"]},
                    {"$set": {
                        "password_hash": hash_password(u["password"]),
                        "clinic_id": clinic_id,
                    }},
                )
            continue
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(os.urandom(4).hex()).upper()}",
            "clinic_id": clinic_id,
            "email": u["email"],
            "name": u["name"],
            "role": u["role"],
            "active": True,
            "password_hash": hash_password(u["password"]),
            "created_at": datetime.utcnow(),
        }))
        logger.info("Seeded user: %s (%s)", u["email"], u["role"])


async def _backfill_legacy_clinic_id(db, clinic_id: str) -> None:
    """Backfill `clinic_id` on legacy collection rows so multi-tenant queries
    don't accidentally drop pre-tenant-aware data."""
    for coll in ("patients", "referring_doctors", "test_sessions"):
        try:
            await db[coll].update_many(
                {"clinic_id": {"$exists": False}}, {"$set": {"clinic_id": clinic_id}},
            )
            await db[coll].update_many(
                {"clinic_id": None}, {"$set": {"clinic_id": clinic_id}},
            )
        except Exception as e:                    # noqa: BLE001
            logger.warning("Backfill skipped for %s: %s", coll, e)


async def _seed_second_clinic(db, billing_module) -> None:
    """Idempotently seed the Delhi cross-tenant isolation fixture clinic."""
    c2_id = "clinic-delhi-test"
    existing = await db.clinics.find_one({"clinic_id": c2_id})

    if existing:
        if not existing.get("subscription_tier"):
            await db.clinics.update_one(
                {"clinic_id": c2_id},
                {"$set": {"subscription_tier": "BASIC"}},
            )
        await _seed_users(db, c2_id, _DELHI_USERS)
        await _seed_primary_branch(db, c2_id, "Delhi", "New Delhi", "Delhi")
        return

    await db.clinics.insert_one(serialize_datetime({
        "clinic_id": c2_id,
        "name": "Delhi Test Branch",
        "city": "New Delhi",
        "state": "Delhi",
        "phone": "+91-11-00000000",
        "email": "clinic@delhi.test",
        "mrd_prefix": "DEL",
        # Delhi on BASIC so cross-tenant tier-gate tests are meaningful.
        "subscription_tier": "BASIC",
        "created_at": datetime.utcnow(),
    }))
    logger.info("Seeded second test clinic: %s", c2_id)

    await _seed_users(db, c2_id, _DELHI_USERS)

    try:
        inserted = await billing_module.seed_default_services(db, c2_id)
        if inserted:
            logger.info("Seeded %d default services for %s", inserted, c2_id)
    except Exception as e:                        # noqa: BLE001
        logger.warning("Delhi service seeding skipped: %s", e)

    await _seed_primary_branch(db, c2_id, "Delhi", "New Delhi", "Delhi")


async def _seed_primary_branch(db, clinic_id: str, name: str, city: str, state: str) -> None:
    """Ensure the given clinic has at least one primary branch, and backfill
    every user that has no `branch_ids` so they're scoped to it. Idempotent."""
    existing = await db.branches.find_one({"clinic_id": clinic_id, "is_primary": True})
    if existing:
        primary_branch_id = existing["branch_id"]
    else:
        primary_branch_id = f"BR-{str(uuid4())[:8].upper()}"
        await db.branches.insert_one(serialize_datetime({
            "branch_id": primary_branch_id,
            "clinic_id": clinic_id,
            "name": name,
            "city": city,
            "state": state,
            "is_primary": True,
            "active": True,
            "created_at": datetime.utcnow(),
        }))
        logger.info("Seeded primary branch %s (%s) for %s", primary_branch_id, name, clinic_id)

    res = await db.users.update_many(
        {"clinic_id": clinic_id,
         "$or": [{"branch_ids": {"$exists": False}}, {"branch_ids": {"$size": 0}}]},
        {"$set": {"branch_ids": [primary_branch_id]}},
    )
    if res.modified_count:
        logger.info("Backfilled branch_ids for %d users in %s", res.modified_count, clinic_id)
