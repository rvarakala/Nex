"""Regression — non-idempotent founder-seed lockout bug (2026-07-30).

The bug: `seed_founder_only` in admin_seed.py used to unconditionally
resync `password_hash` from FOUNDER_PASSWORD env on every backend
restart, clobbering any password the founder had changed via
/api/auth/reset-password. Symptom: "I reset my password, it works in
this session, but next time I come back it's broken again."

These tests exercise the fix directly against the seed function so we
catch any future regression before it hits production.
"""
from __future__ import annotations

import asyncio
import os

import pytest

import sys
import pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from admin_seed import seed_founder_only  # noqa: E402
from auth import hash_password, verify_password  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


TEST_EMAIL = "seed-regression-founder@audinexa.test"


def _run(coro):
    """Sync wrapper around an async coroutine — the pytest config here
    doesn't include pytest-asyncio, so we drive the coroutine manually.
    Fresh event loop per call so state doesn't bleed between tests.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _seed_test_founder(db, password_hash: str, *, password_changed_at: str | None):
    """Set up a founder-shaped row exactly like the production seed would,
    optionally stamped with password_changed_at so we can test both branches.
    """
    doc = {
        "user_id": "USR-SEEDTEST",
        "clinic_id": "audinexa-platform",
        "email": TEST_EMAIL,
        "name": "Seed Regression Founder",
        "role": "founder",
        "active": True,
        "password_hash": password_hash,
        "branch_ids": [],
        "email_verified": True,
    }
    if password_changed_at is not None:
        doc["password_changed_at"] = password_changed_at
    else:
        # Ensure any prior test run's stamp is cleared for the "no change" path.
        await db.users.update_one({"email": TEST_EMAIL}, {"$unset": {"password_changed_at": ""}})
    await db.users.update_one({"email": TEST_EMAIL}, {"$set": doc}, upsert=True)


@pytest.fixture
def _monkey_founder_email(monkeypatch):
    """Point the seed at our test email so we don't touch the real founder row."""
    monkeypatch.setenv("FOUNDER_EMAIL", TEST_EMAIL)
    yield


def test_seed_leaves_user_changed_password_alone(_monkey_founder_email, monkeypatch):
    """When password_changed_at is present, seed MUST NOT touch the hash
    even if FOUNDER_PASSWORD env doesn't match the stored hash.
    """
    monkeypatch.setenv("FOUNDER_PASSWORD", "SomeEnvValue@2026")

    async def go():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        try:
            user_pw = "MyOwnFounderPassword@42"
            stored_hash = hash_password(user_pw)
            await _seed_test_founder(db, stored_hash, password_changed_at="2026-07-30T00:00:00Z")

            await seed_founder_only(db)

            u = await db.users.find_one({"email": TEST_EMAIL}, {"_id": 0, "password_hash": 1})
            assert verify_password(user_pw, u["password_hash"]), (
                "Seed clobbered user-changed password — the exact bug from 2026-07-30!"
            )
            assert not verify_password("SomeEnvValue@2026", u["password_hash"])
        finally:
            await db.users.delete_one({"email": TEST_EMAIL})

    _run(go())


def test_seed_syncs_when_no_password_change_on_record(_monkey_founder_email, monkeypatch):
    """On a brand-new deploy where the operator explicitly sets FOUNDER_PASSWORD
    and the founder has never changed their password themselves, the seed
    SHOULD sync from env (this is the "first-time bootstrap" convenience).
    """
    monkeypatch.setenv("FOUNDER_PASSWORD", "OpsBootstrap@2026")

    async def go():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        try:
            # Stored hash is the OLD default, no password_changed_at field.
            await _seed_test_founder(db, hash_password("founder123"), password_changed_at=None)

            await seed_founder_only(db)

            u = await db.users.find_one({"email": TEST_EMAIL}, {"_id": 0, "password_hash": 1})
            assert verify_password("OpsBootstrap@2026", u["password_hash"]), (
                "First-time env-sync did not apply — bootstrap convenience is broken."
            )
        finally:
            await db.users.delete_one({"email": TEST_EMAIL})

    _run(go())


def test_seed_never_syncs_when_env_not_explicit(_monkey_founder_email, monkeypatch):
    """When FOUNDER_PASSWORD is NOT set (fallback default), the seed must
    not touch the hash — even before the user has done a reset. Otherwise
    every restart resets the account to the well-known default 'founder123'.
    """
    monkeypatch.delenv("FOUNDER_PASSWORD", raising=False)

    async def go():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        try:
            stored_hash = hash_password("SomeNonDefault@2026")
            await _seed_test_founder(db, stored_hash, password_changed_at=None)

            await seed_founder_only(db)

            u = await db.users.find_one({"email": TEST_EMAIL}, {"_id": 0, "password_hash": 1})
            assert verify_password("SomeNonDefault@2026", u["password_hash"]), (
                "Seed clobbered the hash even though FOUNDER_PASSWORD env is not set!"
            )
            assert not verify_password("founder123", u["password_hash"]), (
                "Seed reverted to the well-known default — original 2026-07-30 bug is back."
            )
        finally:
            await db.users.delete_one({"email": TEST_EMAIL})

    _run(go())
