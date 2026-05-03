"""Verify GET /api/admin/v2/system/data-health auto-opens an incident
when a sampled doc fails Pydantic validation, and is idempotent.
"""
import os
import asyncio
import uuid
import requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "founder@audinexa.com", "password": "founder123"},
                      timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


async def _seed_bad_patient():
    cli = AsyncIOMotorClient(MONGO)
    db = cli[DBN]
    bad = {
        "patient_id": f"TEST-BAD-{uuid.uuid4().hex[:6]}",
        "clinic_id": "clinic-acs-demo",
        # intentionally missing required fields like first_name/last_name
        "created_at": "2030-01-01T00:00:00+00:00",
    }
    await db.patients.insert_one(bad)
    return bad["patient_id"]


async def _cleanup(pid):
    cli = AsyncIOMotorClient(MONGO)
    db = cli[DBN]
    await db.patients.delete_one({"patient_id": pid})
    await db.platform_incidents.delete_many({"title": {"$regex": "^DATA_HEALTH:"}})


def test_auto_incident_idempotent():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    pid = asyncio.run(_seed_bad_patient())
    try:
        r1 = requests.get(f"{API}/admin/v2/system/data-health", headers=h, timeout=30)
        r1.raise_for_status()
        d1 = r1.json()
        assert d1["overall"] == "degraded", d1
        assert any(p["failed"] > 0 for p in d1["probes"]), d1
        opened1 = d1.get("auto_incidents_opened", [])
        assert len(opened1) >= 1, ("expected auto-incident", d1)

        # Second call must NOT create duplicates.
        r2 = requests.get(f"{API}/admin/v2/system/data-health", headers=h, timeout=30)
        r2.raise_for_status()
        d2 = r2.json()
        opened2 = d2.get("auto_incidents_opened", [])
        assert opened2 == [], ("duplicate auto-incident opened", d2)

        print("PASS: opened", opened1, "second call idempotent.")
    finally:
        asyncio.run(_cleanup(pid))


if __name__ == "__main__":
    test_auto_incident_idempotent()
