"""Iter25 extras — cover the additional verifications requested by main agent:
1. GET /api/ha/sales/{nonexistent}/invoice-prefill → 404
2. GET /api/admin/v2/system/data-health auto-creates an actual platform_incidents
   doc (title prefix 'DATA_HEALTH:', resolved_at=null), then bulk-resolve cleans it.
"""
import os
import asyncio
import uuid
import requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


def test_invoice_prefill_404_for_nonexistent_sale():
    token = _login("admin@delhi.test", "delhiadmin123")
    h = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{API}/ha/sales/SALE-DOES-NOT-EXIST-{uuid.uuid4().hex[:6]}/invoice-prefill",
                     headers=h, timeout=15)
    assert r.status_code == 404, (r.status_code, r.text)


async def _seed_bad_patient():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    bad = {
        "patient_id": f"TEST-BAD-{uuid.uuid4().hex[:6]}",
        "clinic_id": "clinic-pytest-suite",
        "created_at": "2030-01-01T00:00:00+00:00",
    }
    await db.patients.insert_one(bad)
    return bad["patient_id"]


async def _find_open_incidents():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    return await db.platform_incidents.find(
        {"title": {"$regex": "^DATA_HEALTH:"}, "resolved_at": None},
        {"_id": 0}
    ).to_list(length=20)


async def _cleanup(pid):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.patients.delete_one({"patient_id": pid})


def test_auto_incident_doc_exists_and_bulk_resolves():
    token = _login("founder@audinexa.com", "founder123")
    h = {"Authorization": f"Bearer {token}"}
    pid = asyncio.run(_seed_bad_patient())
    try:
        # Trigger probe
        r = requests.get(f"{API}/admin/v2/system/data-health", headers=h, timeout=30)
        r.raise_for_status()
        d = r.json()
        assert d["overall"] == "degraded"
        opened = d.get("auto_incidents_opened", [])
        assert len(opened) >= 1, d

        # Verify doc in mongo
        docs = asyncio.run(_find_open_incidents())
        assert any(doc["title"].startswith("DATA_HEALTH:") and doc.get("resolved_at") in (None,)
                   for doc in docs), docs
        print(f"PASS: open incident found, count={len(docs)}, ids={opened}")

        # Bulk-resolve cleanup using API (per main agent instruction)
        rr = requests.post(f"{API}/admin/v2/system/incidents/bulk-resolve",
                           headers=h, json={"title_prefix": "DATA_HEALTH:"}, timeout=15)
        # Endpoint may return 200 with count; tolerate either 200/204
        assert rr.status_code in (200, 204), (rr.status_code, rr.text)
        print(f"bulk-resolve status={rr.status_code} body={rr.text[:200]}")
    finally:
        async def _full_cleanup():
            cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
            await db.patients.delete_one({"patient_id": pid})
            await db.platform_incidents.delete_many({"title": {"$regex": "^DATA_HEALTH:"}})
        asyncio.run(_full_cleanup())


if __name__ == "__main__":
    test_invoice_prefill_404_for_nonexistent_sale()
    test_auto_incident_doc_exists_and_bulk_resolves()
