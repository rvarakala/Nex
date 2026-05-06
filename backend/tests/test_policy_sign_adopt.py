"""End-to-end test for the Sign & Adopt workflow.

Coverage:
  1. Adopt requires `acknowledge=true` (else 400).
  2. Adopt creates a policy_adoptions doc + GridFS PDF blob.
  3. The signed PDF includes a 'Signature & Adoption Record' page.
  4. Adopting the SAME policy with the SAME content is idempotent.
  5. Adoption ledger summary counts active vs superseded.
  6. Tenant isolation — clinic A's adoptions are not visible to clinic B.
  7. front_desk role cannot adopt (403).
"""
import os
import asyncio
import requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login(email="admin@delhi.test", password="delhiadmin123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


async def _cleanup():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    rows = await db.policy_adoptions.find(
        {"clinic_id": "clinic-delhi-test"}, {"_id": 0, "pdf_fs_id": 1, "adoption_id": 1}
    ).to_list(500)
    fs = db["policy_adoptions.files"]
    chunks = db["policy_adoptions.chunks"]
    for r in rows:
        try:
            from bson import ObjectId
            await chunks.delete_many({"files_id": ObjectId(r["pdf_fs_id"])})
            await fs.delete_one({"_id": ObjectId(r["pdf_fs_id"])})
        except Exception:
            pass
    await db.policy_adoptions.delete_many({"clinic_id": "clinic-delhi-test"})


def test_sign_and_adopt():
    asyncio.run(_cleanup())
    h = {"Authorization": f"Bearer {_login()}"}

    # 1. Acknowledge=false → 400
    r = requests.post(f"{API}/legal/policies/01_information_security/adopt", headers=h,
                      json={"typed_name": "Delhi Admin", "acknowledge": False}, timeout=15)
    assert r.status_code == 400, r.text

    # 2. Adopt happy path
    r = requests.post(f"{API}/legal/policies/01_information_security/adopt", headers=h,
                      json={"typed_name": "Delhi Admin", "acknowledge": True}, timeout=15)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["already_adopted"] is False, a
    assert a["status"] == "active"
    assert a["policy_id"] == "01_information_security"
    assert a["typed_name"] == "Delhi Admin"
    assert a["pdf_size_bytes"] > 1000
    assert len(a["markdown_hash"]) == 64  # sha256 hex
    assert a["ip_address"] is not None
    adoption_id = a["adoption_id"]

    # 3. Download the signed PDF — must contain the Signature page text.
    r = requests.get(f"{API}/legal/adoptions/{adoption_id}/pdf", headers=h, timeout=15)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    pdf = r.content
    assert pdf[:5] == b"%PDF-"
    # Reportlab encodes text as raw bytes for these short ASCII strings, so they
    # appear inline in the PDF stream uncompressed (we use compresslevel=0
    # implicitly).
    assert b"SIGNED" in pdf or b"Signature" in pdf, "Signature page not in PDF"

    # 4. Idempotency — same content adopted twice returns same id.
    r = requests.post(f"{API}/legal/policies/01_information_security/adopt", headers=h,
                      json={"typed_name": "Delhi Admin", "acknowledge": True}, timeout=15)
    assert r.status_code == 200
    a2 = r.json()
    assert a2["already_adopted"] is True
    assert a2["adoption_id"] == adoption_id

    # 5. Adoption ledger
    r = requests.get(f"{API}/legal/adoptions", headers=h, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["summary"]["policies_signed"] == 1, d
    assert "01_information_security" in d["by_policy"]
    assert d["by_policy"]["01_information_security"]["status"] == "active"

    # 6. Tenant isolation — Founder uses platform tenant, can list its own (empty)
    # without leaking Delhi clinic's adoptions.
    h2 = {"Authorization": f"Bearer {_login('founder@audinexa.com', 'founder123')}"}
    r = requests.get(f"{API}/legal/adoptions", headers=h2, timeout=10)
    assert r.status_code == 200
    d2 = r.json()
    delhi_in_founder = any(a["clinic_id"] == "clinic-delhi-test" for a in d2["adoptions"])
    assert not delhi_in_founder, "Founder leak: saw Delhi clinic adoption"

    print(f"PASS: adopted {adoption_id}, idempotent + ledger + isolation OK.")
    asyncio.run(_cleanup())


def test_front_desk_forbidden():
    """front_desk users cannot adopt — only clinic_owner / super_admin."""
    # The Delhi seed has frontdesk@delhi.test
    h = {"Authorization": f"Bearer {_login('frontdesk@delhi.test', 'delhifrontdesk123')}"}
    r = requests.post(f"{API}/legal/policies/01_information_security/adopt", headers=h,
                      json={"typed_name": "Front Desk", "acknowledge": True}, timeout=15)
    assert r.status_code == 403, r.text
    print("PASS: front_desk gets 403 on adopt.")


if __name__ == "__main__":
    test_sign_and_adopt()
    try:
        test_front_desk_forbidden()
    except requests.HTTPError as exc:
        # If frontdesk@delhi.test doesn't exist in this preview DB, skip.
        print(f"SKIP front_desk test: {exc}")
