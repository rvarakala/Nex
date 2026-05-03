"""Regression tests for admin-driven tenant user creation.

Covers: POST /api/admin/v2/tenant-users (founder/super_admin create a clinic
user manually with email + password — no invite-accept flow).
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
def founder_token():
    return _login("founder@audinexa.com", "founder123")


@pytest.fixture(scope="module")
def frontdesk_token():
    return _login("meera@thesoundclinic.in", "demo123")


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def fresh_email():
    return f"pytest-tenant-user-{int(time.time() * 1000)}@example.in"


def test_create_tenant_user_happy_path(founder_token, fresh_email):
    r = requests.post(
        f"{API}/admin/v2/tenant-users",
        headers=_h(founder_token),
        json={
            "clinic_id": "tenant-sound-clinic-blr",
            "email": fresh_email,
            "name": "Pytest Created",
            "password": "PytestPass!99",
            "role": "front_desk",
        },
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == fresh_email.lower()
    assert body["clinic_id"] == "tenant-sound-clinic-blr"
    assert body["role"] == "front_desk"
    assert "password_hash" not in body
    assert body["created_via"] == "admin_manual"

    # The new user can actually log in with those credentials.
    login = requests.post(
        f"{API}/auth/login",
        json={"email": fresh_email, "password": "PytestPass!99"},
        timeout=10,
    )
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "front_desk"


def test_create_tenant_user_rejects_platform_roles(founder_token, fresh_email):
    r = requests.post(
        f"{API}/admin/v2/tenant-users",
        headers=_h(founder_token),
        json={
            "clinic_id": "tenant-sound-clinic-blr",
            "email": fresh_email, "name": "X",
            "password": "PytestPass!99", "role": "founder",  # platform role
        },
        timeout=10,
    )
    assert r.status_code == 400
    assert "clinic role" in r.text.lower() or "valid" in r.text.lower()


def test_create_tenant_user_duplicate_email(founder_token, fresh_email):
    payload = {
        "clinic_id": "tenant-sound-clinic-blr",
        "email": fresh_email, "name": "First",
        "password": "PytestPass!99", "role": "audiologist",
    }
    r1 = requests.post(f"{API}/admin/v2/tenant-users", headers=_h(founder_token), json=payload, timeout=10)
    assert r1.status_code == 200
    r2 = requests.post(f"{API}/admin/v2/tenant-users", headers=_h(founder_token), json=payload, timeout=10)
    assert r2.status_code == 409


def test_create_tenant_user_unknown_clinic(founder_token, fresh_email):
    r = requests.post(
        f"{API}/admin/v2/tenant-users",
        headers=_h(founder_token),
        json={
            "clinic_id": "definitely-does-not-exist",
            "email": fresh_email, "name": "X",
            "password": "PytestPass!99", "role": "audiologist",
        },
        timeout=10,
    )
    assert r.status_code == 404


def test_create_tenant_user_requires_founder_or_super_admin(frontdesk_token, fresh_email):
    r = requests.post(
        f"{API}/admin/v2/tenant-users",
        headers=_h(frontdesk_token),
        json={
            "clinic_id": "tenant-sound-clinic-blr",
            "email": fresh_email, "name": "X",
            "password": "PytestPass!99", "role": "audiologist",
        },
        timeout=10,
    )
    assert r.status_code == 403


def test_create_tenant_user_rejects_short_password(founder_token, fresh_email):
    r = requests.post(
        f"{API}/admin/v2/tenant-users",
        headers=_h(founder_token),
        json={
            "clinic_id": "tenant-sound-clinic-blr",
            "email": fresh_email, "name": "X",
            "password": "short", "role": "audiologist",  # 5 chars
        },
        timeout=10,
    )
    # FastAPI 422 for pydantic validation (min_length=8).
    assert r.status_code == 422
