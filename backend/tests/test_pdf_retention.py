"""Hybrid PDF Storage Model — covers retention sweep + admin endpoints.

Steps:
  1. Upload a fake "old" report blob into GridFS (uploadDate set 60d ago).
  2. Upload a fresh blob too (uploadDate now).
  3. GET /admin/v2/system/storage — expect both blobs counted.
  4. POST /admin/v2/system/storage/purge-pdfs — only the old one purges.
  5. Verify session row's report_pdf_fs_id was cleared.
  6. days=0 override disables sweeping.
"""
import os
import asyncio
import requests
from datetime import datetime, timezone, timedelta

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login(email="founder@audinexa.com", password="founder123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


async def _seed():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="session_reports")

    # OLD blob (60 days) + matching session
    sid_old = "TEST-OLDSES"
    fs_old = await bucket.upload_from_stream(
        filename=f"{sid_old}.pdf",
        source=b"%PDF-1.4 fake old\n",
        metadata={"clinic_id": "TEST", "session_id": sid_old, "patient_id": "PAT-OLD"},
    )
    # Backdate uploadDate to before retention cutoff
    old_date = datetime.now(timezone.utc) - timedelta(days=60)
    await db["session_reports.files"].update_one(
        {"_id": fs_old}, {"$set": {"uploadDate": old_date}}
    )
    await db.test_sessions.update_one(
        {"session_id": sid_old},
        {"$set": {"session_id": sid_old, "report_pdf_fs_id": str(fs_old)}},
        upsert=True,
    )

    # FRESH blob (today) + matching session
    sid_new = "TEST-FRESH"
    fs_new = await bucket.upload_from_stream(
        filename=f"{sid_new}.pdf",
        source=b"%PDF-1.4 fake new\n",
        metadata={"clinic_id": "TEST", "session_id": sid_new, "patient_id": "PAT-NEW"},
    )
    await db.test_sessions.update_one(
        {"session_id": sid_new},
        {"$set": {"session_id": sid_new, "report_pdf_fs_id": str(fs_new)}},
        upsert=True,
    )
    return sid_old, fs_old, sid_new, fs_new


async def _cleanup(sid_old, fs_old, sid_new, fs_new):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="session_reports")
    for fid in (fs_old, fs_new):
        try: await bucket.delete(fid)
        except Exception: pass
    await db.test_sessions.delete_many({"session_id": {"$in": [sid_old, sid_new]}})


async def _verify(fs_old, fs_new, sid_old):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    old_still = await db["session_reports.files"].find_one({"_id": fs_old})
    new_still = await db["session_reports.files"].find_one({"_id": fs_new})
    ses = await db.test_sessions.find_one({"session_id": sid_old})
    return old_still, new_still, ses


def test_storage_stats_and_purge():
    sid_old, fs_old, sid_new, fs_new = asyncio.run(_seed())
    h = {"Authorization": f"Bearer {_login()}"}

    try:
        # 1. Stats endpoint
        r = requests.get(f"{API}/admin/v2/system/storage", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "buckets" in d, d
        assert "session_reports" in d["buckets"], d
        assert d["buckets"]["session_reports"]["count"] >= 2, d
        assert d["buckets"]["session_reports"]["swept"] is True, d
        assert d["retention_days"] == 30, d

        # 2. Purge with default retention (30d). Old should go, new should stay.
        r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs", headers=h, json={}, timeout=15)
        assert r.status_code == 200, r.text
        res = r.json()
        assert res["purged"] >= 1, res
        assert res["retention_days"] == 30, res

        # 3. Verify only the old blob is gone + session pointer cleared
        old_still, new_still, ses = asyncio.run(_verify(fs_old, fs_new, sid_old))
        assert old_still is None, "Old blob should be purged"
        assert new_still is not None, "Fresh blob should remain"
        assert ses.get("report_pdf_fs_id") is None, ses
        assert ses.get("report_pdf_purged_at"), ses

        # 4. days=0 disables (founder can override)
        r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs", headers=h, json={"days": 0}, timeout=15)
        assert r.status_code == 200, r.text
        res2 = r.json()
        assert res2.get("retention_days") == 0, res2
        assert "skipped" in res2, res2

        print(f"PASS: stats + purge OK. purged={res['purged']} freed={res['freed_bytes']}B")
    finally:
        asyncio.run(_cleanup(sid_old, fs_old, sid_new, fs_new))


if __name__ == "__main__":
    test_storage_stats_and_purge()
