"""Regression tests for self-service profile + change-password endpoints.

Covers:
  GET    /api/settings/me/profile
  PATCH  /api/settings/me/profile
  POST   /api/settings/me/change-password
  POST   /api/settings/me/avatar       (skipped — multipart / GridFS)
"""
import time

import pytest
import requests


API = "http://localhost:8001/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner@thesoundclinic.in", "demo123")


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def test_get_my_profile_returns_user_and_clinic(owner_token):
    r = requests.get(f"{API}/settings/me/profile", headers=_h(owner_token), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "owner@thesoundclinic.in"
    assert body["user"]["role"] == "clinic_owner"
    assert body["clinic"]["clinic_id"] == "tenant-sound-clinic-blr"
    assert body["clinic"]["name"]
    # Sensitive fields must not leak.
    assert "password_hash" not in body["user"]


def test_patch_my_profile_industry_fields(owner_token):
    fields = {
        "designation": "Senior Audiologist & Director",
        "qualifications": "MASLP, M.Sc. Audiology",
        "rci_registration_no": f"A-{int(time.time())%100000}",
        "specialization": "Pediatric audiology · Hearing aid fitting",
        "years_of_experience": 15,
        "languages": ["English", "Hindi", "Kannada"],
        "bio": "20+ years of clinical practice in Bengaluru.",
    }
    r = requests.patch(f"{API}/settings/me/profile", headers=_h(owner_token), json=fields, timeout=10)
    assert r.status_code == 200
    assert set(fields.keys()).issubset(set(r.json()["updated_fields"]))

    r2 = requests.get(f"{API}/settings/me/profile", headers=_h(owner_token), timeout=10)
    u = r2.json()["user"]
    for k, v in fields.items():
        assert u[k] == v, f"{k}: expected {v}, got {u.get(k)}"


def test_patch_with_no_fields_is_400(owner_token):
    r = requests.patch(f"{API}/settings/me/profile", headers=_h(owner_token), json={}, timeout=10)
    assert r.status_code == 400


def test_change_password_flow(owner_token):
    # 1) wrong current → 401
    r1 = requests.post(
        f"{API}/settings/me/change-password",
        headers=_h(owner_token),
        json={"current_password": "deliberatelywrong", "new_password": "ValidNewPass!1"},
        timeout=10,
    )
    assert r1.status_code == 401

    # 2) new password too short → 422
    r2 = requests.post(
        f"{API}/settings/me/change-password",
        headers=_h(owner_token),
        json={"current_password": "demo123", "new_password": "short"},
        timeout=10,
    )
    assert r2.status_code == 422

    # 3) happy path: current=demo123 → new=PytestNewPass!1
    r3 = requests.post(
        f"{API}/settings/me/change-password",
        headers=_h(owner_token),
        json={"current_password": "demo123", "new_password": "PytestNewPass!1"},
        timeout=10,
    )
    assert r3.status_code == 200
    assert r3.json()["ok"] is True

    # 4) old token still valid for /me/profile (we only invalidate other sessions
    #    via token_version bump, but the current token retains its original
    #    token_version). The new login proves the password persisted.
    login = requests.post(
        f"{API}/auth/login",
        json={"email": "owner@thesoundclinic.in", "password": "PytestNewPass!1"},
        timeout=10,
    )
    assert login.status_code == 200

    # 5) restore original password — using the new token.
    new_tok = login.json()["access_token"]
    r5 = requests.post(
        f"{API}/settings/me/change-password",
        headers=_h(new_tok),
        json={"current_password": "PytestNewPass!1", "new_password": "demo1234"},
        timeout=10,
    )
    # This will succeed; we then need to put it back to demo123 via DB. The
    # test cleanup after this test handles that.
    assert r5.status_code == 200

    # Restore via direct DB hash so we don't violate min_length.
    import asyncio
    import os
    from pathlib import Path
    import bcrypt
    from motor.motor_asyncio import AsyncIOMotorClient

    for raw in Path("/app/backend/.env").read_text().splitlines():
        if "=" in raw and not raw.strip().startswith("#"):
            k, _, v = raw.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    async def restore():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        h = bcrypt.hashpw(b"demo123", bcrypt.gensalt()).decode()
        await db.users.update_one({"email": "owner@thesoundclinic.in"}, {"$set": {"password_hash": h}})

    asyncio.run(restore())

    # Confirm restore.
    final = requests.post(
        f"{API}/auth/login",
        json={"email": "owner@thesoundclinic.in", "password": "demo123"},
        timeout=10,
    )
    assert final.status_code == 200
