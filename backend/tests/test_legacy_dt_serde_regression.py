"""Regression test for the "Connection issue — retrying save" bug.

Root cause: legacy MongoDB docs stored fields like `dob` / `warranty_end_date`
as native BSON datetime objects, but the Pydantic models declare them as
`Optional[str]`. FastAPI's `response_model=` validation rejected → HTTP 500 →
axios retry interceptor showed the misleading "Connection issue" banner.

Fix lives in /app/backend/utils/serde.py:deserialize_datetime — it now coerces
datetime → ISO string for any key in STRING_DATE_KEYS.

This test seeds a patient with a native datetime `dob` and verifies the
GET /api/patients endpoint returns 200 (was 500 before the fix).
"""
import os
import asyncio
import uuid
import requests
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@delhi.test", "password": "delhiadmin123"}, timeout=15)
    r.raise_for_status()
    return r.json().get("access_token") or r.json()["token"]


async def _seed_legacy_patient(pid: str):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    # Insert with native BSON datetime to mimic legacy data shape.
    await db.patients.insert_one({
        "patient_id": pid,
        "clinic_id": "clinic-delhi-test",
        "branch_id": "BR-F05F6C00",
        "name": "Legacy Patient",
        "first_name": "Legacy",
        "last_name": "Patient",
        "age": 44,
        "gender": "Female",
        "mobile": "+919999911119",
        "mrd": f"LEGACY-{uuid.uuid4().hex[:6].upper()}",
        # Legacy: native datetime where Pydantic expects str.
        "dob": datetime(1980, 1, 15, 0, 0, 0),
        "created_at": datetime.utcnow(),
    })


async def _cleanup(pid: str):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.patients.delete_one({"patient_id": pid})


def test_legacy_dob_returns_200():
    pid = f"PAT-LEGACY-{uuid.uuid4().hex[:6].upper()}"
    asyncio.run(_seed_legacy_patient(pid))
    try:
        h = {"Authorization": f"Bearer {_login()}"}

        # 1. List endpoint must NOT 500 even though the doc has native dt dob.
        r = requests.get(f"{API}/patients", headers=h, timeout=15)
        assert r.status_code == 200, f"Expected 200 — got {r.status_code}: {r.text[:300]}"
        # Find our patient
        items = r.json()
        match = next((p for p in items if p.get("patient_id") == pid), None)
        assert match is not None, f"Inserted patient {pid} not in list response"
        # dob must come back as a string (the bug had it as a datetime → 500).
        assert isinstance(match.get("dob"), str), match
        assert match["dob"].startswith("1980-01-15"), match["dob"]

        # 2. Detail endpoint also OK.
        r = requests.get(f"{API}/patients/{pid}", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("dob"), str), r.json()
        assert r.json()["dob"].startswith("1980-01-15")
        print(f"PASS: legacy dob (native datetime) coerced to string OK — dob={r.json()['dob']}")
    finally:
        asyncio.run(_cleanup(pid))


if __name__ == "__main__":
    test_legacy_dob_returns_200()
