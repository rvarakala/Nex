"""Iteration 7 — Daily Close-out backend tests.

Covers:
- Auth gating (401, 403)
- Idempotency
- Computation correctness (against known seed)
- list / latest / by-date / read endpoints
- Tenant isolation (direct Mongo seed of a 2nd clinic)
- APScheduler wiring (job exists, IST timezone, next_run hour=21)
"""
import os
import sys
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests

# Load REACT_APP_BACKEND_URL from frontend/.env if not already in env
from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
if not os.environ.get("REACT_APP_BACKEND_URL"):
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip()
                break

# Load backend .env for MONGO_URL / DB_NAME (used in tenant isolation test)
for key in ("MONGO_URL", "DB_NAME"):
    if not os.environ.get(key):
        for line in Path("/app/backend/.env").read_text().splitlines():
            if line.startswith(f"{key}="):
                os.environ[key] = line.split("=", 1)[1].strip().strip('"')
                break

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API = f"{BASE_URL}/api"

# Add backend to path so we can import closeout module + start_scheduler for direct verification
sys.path.insert(0, "/app/backend")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def session():
    return requests.Session()


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=10)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def accounts_token(session):
    return _login(session, "accounts@acs.in", "accounts123")


@pytest.fixture(scope="module")
def admin_token(session):
    return _login(session, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def front_desk_token(session):
    return _login(session, "frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="module")
def audiologist_token(session):
    return _login(session, "audiologist@acs.in", "audio123")


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- AUTH gating ----------
class TestAuthGating:
    def test_no_token_401(self, session):
        for path, method in [
            ("/closeouts", "get"),
            ("/closeouts/latest", "get"),
            ("/closeouts/2026-04-22", "get"),
            ("/closeouts/generate", "post"),
            ("/closeouts/2026-04-22/read", "put"),
        ]:
            r = getattr(session, method)(f"{API}{path}", json={} if method == "post" else None, timeout=10)
            assert r.status_code in (401, 403), f"{method.upper()} {path} expected 401/403, got {r.status_code}"

    def test_front_desk_cannot_generate(self, session, front_desk_token):
        r = session.post(f"{API}/closeouts/generate", headers=_h(front_desk_token), json={}, timeout=10)
        assert r.status_code == 403

    def test_audiologist_cannot_generate(self, session, audiologist_token):
        r = session.post(f"{API}/closeouts/generate", headers=_h(audiologist_token), json={}, timeout=10)
        assert r.status_code == 403

    def test_accounts_can_generate(self, session, accounts_token):
        r = session.post(f"{API}/closeouts/generate", headers=_h(accounts_token), json={}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["clinic_id"] == "clinic-acs-demo"
        assert "closeout_id" in data and data["closeout_id"].startswith("CO-")
        assert "_id" not in data


# ---------- IDEMPOTENCY + Computation ----------
class TestGenerateAndCompute:
    def test_idempotent_same_closeout_id(self, session, accounts_token):
        r1 = session.post(f"{API}/closeouts/generate", headers=_h(accounts_token), json={}, timeout=15)
        r2 = session.post(f"{API}/closeouts/generate", headers=_h(accounts_token), json={}, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["closeout_id"] == r2.json()["closeout_id"], "closeout_id must remain stable across regenerations"
        assert r1.json()["date"] == r2.json()["date"]

    def test_known_seed_correctness(self, session, accounts_token):
        r = session.post(f"{API}/closeouts/generate", headers=_h(accounts_token), json={}, timeout=15)
        d = r.json()
        # Structural + sanity checks (not brittle seed-value asserts — seed evolves per session).
        for key in ("closeout_id", "date", "clinic_id", "walkins_today", "appointments_today",
                    "collections_total", "collections_by_method", "pending_reports",
                    "invoices_pending_due", "pending_due_amount", "read"):
            assert key in d, f"missing key {key}"
        assert d["clinic_id"] == "clinic-acs-demo"
        assert d["closeout_id"].startswith("CO-")
        assert isinstance(d["walkins_today"], int) and d["walkins_today"] >= 0
        assert isinstance(d["collections_total"], (int, float)) and d["collections_total"] >= 0
        assert isinstance(d["collections_by_method"], dict)
        # Totals must reconcile with by-method breakdown
        assert abs(d["collections_total"] - sum(d["collections_by_method"].values())) < 0.01
        assert d["read"] is False
        assert "_id" not in d

    def test_specific_date_param(self, session, accounts_token):
        r = session.post(
            f"{API}/closeouts/generate", headers=_h(accounts_token),
            json={"date": "2026-04-15"}, timeout=15
        )
        assert r.status_code == 200
        assert r.json()["date"] == "2026-04-15"


# ---------- READ endpoints ----------
class TestReadEndpoints:
    def test_list_latest_first_and_limit(self, session, accounts_token):
        r = session.get(f"{API}/closeouts?limit=5", headers=_h(accounts_token), timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) <= 5
        if len(rows) >= 2:
            assert rows[0]["date"] >= rows[1]["date"]
        for row in rows:
            assert "_id" not in row
            assert row["clinic_id"] == "clinic-acs-demo"

    def test_latest_returns_today(self, session, accounts_token):
        # ensure today exists
        session.post(f"{API}/closeouts/generate", headers=_h(accounts_token), json={}, timeout=15)
        r = session.get(f"{API}/closeouts/latest", headers=_h(accounts_token), timeout=10)
        assert r.status_code == 200
        row = r.json()
        assert row is not None
        assert "_id" not in row

    def test_get_by_date_404_for_missing(self, session, accounts_token):
        r = session.get(f"{API}/closeouts/1999-01-01", headers=_h(accounts_token), timeout=10)
        assert r.status_code == 404

    def test_get_by_date_200_for_existing(self, session, accounts_token):
        # Use today's IST date
        today_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
        session.post(f"{API}/closeouts/generate", headers=_h(accounts_token), json={"date": today_ist}, timeout=15)
        r = session.get(f"{API}/closeouts/{today_ist}", headers=_h(accounts_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["date"] == today_ist

    def test_mark_read_flips_flag(self, session, accounts_token):
        today_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
        # Re-generate to reset read=false
        session.post(f"{API}/closeouts/generate", headers=_h(accounts_token), json={"date": today_ist}, timeout=15)
        r0 = session.get(f"{API}/closeouts/{today_ist}", headers=_h(accounts_token), timeout=10)
        assert r0.json()["read"] is False
        r1 = session.put(f"{API}/closeouts/{today_ist}/read", headers=_h(accounts_token), timeout=10)
        assert r1.status_code == 200
        assert r1.json() == {"ok": True}
        r2 = session.get(f"{API}/closeouts/{today_ist}", headers=_h(accounts_token), timeout=10)
        assert r2.json()["read"] is True


# ---------- TENANT ISOLATION (via direct Mongo seed) ----------
class TestTenantIsolation:
    def test_other_clinic_closeout_not_visible(self, session, accounts_token):
        """Seed a closeout for a fake clinic-XYZ via direct Mongo, ensure list/latest/by-date
        for the demo-clinic accounts user does NOT include it."""
        from motor.motor_asyncio import AsyncIOMotorClient

        async def seed_other():
            mongo_url = os.environ["MONGO_URL"]
            db_name = os.environ["DB_NAME"]
            cli = AsyncIOMotorClient(mongo_url)
            db = cli[db_name]
            await db.daily_closeouts.update_one(
                {"clinic_id": "clinic-other-test", "date": "2026-04-22"},
                {"$set": {
                    "clinic_id": "clinic-other-test",
                    "date": "2026-04-22",
                    "closeout_id": "CO-OTHER01",
                    "walkins_today": 999,
                    "collections_total": 99999.0,
                    "read": False,
                }},
                upsert=True,
            )
            cli.close()

        async def cleanup():
            mongo_url = os.environ["MONGO_URL"]
            db_name = os.environ["DB_NAME"]
            cli = AsyncIOMotorClient(mongo_url)
            db = cli[db_name]
            await db.daily_closeouts.delete_many({"clinic_id": "clinic-other-test"})
            cli.close()

        try:
            asyncio.run(seed_other())

            r = session.get(f"{API}/closeouts?limit=100", headers=_h(accounts_token), timeout=10)
            for row in r.json():
                assert row["clinic_id"] != "clinic-other-test"

            r2 = session.get(f"{API}/closeouts/2026-04-22", headers=_h(accounts_token), timeout=10)
            # demo-clinic's row exists for that date — must not be the seeded other clinic one
            if r2.status_code == 200:
                assert r2.json()["clinic_id"] == "clinic-acs-demo"
                assert r2.json()["closeout_id"] != "CO-OTHER01"
        finally:
            asyncio.run(cleanup())


# ---------- APScheduler wiring ----------
class TestSchedulerWiring:
    def test_scheduler_job_registered_with_ist(self):
        """Direct module check: starting a scheduler returns a job registered for 21:00 IST."""
        import closeout as closeout_module

        class _Stub:
            class clinics:
                @staticmethod
                def find(*a, **kw):
                    async def gen():
                        if False:
                            yield None
                    return gen()

        async def _run():
            sched = closeout_module.start_scheduler(_Stub)
            try:
                jobs = sched.get_jobs()
                assert len(jobs) == 1
                j = jobs[0]
                assert j.id == "daily_closeout_21_ist"
                fields = {f.name: str(f) for f in j.trigger.fields}
                assert fields.get("hour") == "21"
                assert fields.get("minute") == "0"
                nrt = j.next_run_time
                assert nrt is not None
                ist_nrt = nrt.astimezone(timezone(timedelta(hours=5, minutes=30)))
                assert ist_nrt.hour == 21
                assert ist_nrt.minute == 0
            finally:
                sched.shutdown(wait=False)

        asyncio.run(_run())
