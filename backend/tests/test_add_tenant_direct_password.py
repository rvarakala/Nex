"""Regression tests for direct-password tenant creation.

Extends coverage of POST /api/admin/v2/tenants — specifically the new
`initial_password` branch that lets a founder provision a clinic + the
clinic_owner user with a password in one shot (no invite-accept flow).
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


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def stamp():
    return str(int(time.time() * 1000))


def test_add_tenant_with_direct_password(founder_token, stamp):
    r = requests.post(
        f"{API}/admin/v2/tenants",
        headers=_h(founder_token),
        json={
            "clinic_name": f"Pytest Direct Clinic {stamp}",
            "owner_name": "Dr Pytest Direct",
            "owner_email": f"pytest-direct-{stamp}@example.in",
            "tier": "PREMIUM",
            "trial_days": 30,
            "initial_password": "DirectPytestPass!99",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["direct_login_password"] == "DirectPytestPass!99"
    assert body["direct_login_name"] == "Dr Pytest Direct"
    assert body["tier"] == "PREMIUM"
    # Invite fields are null in direct mode.
    assert body["accept_url"] is None
    assert body["invite_token"] is None

    # Owner can log in immediately at the correct tier.
    login = requests.post(
        f"{API}/auth/login",
        json={"email": f"pytest-direct-{stamp}@example.in", "password": "DirectPytestPass!99"},
        timeout=10,
    )
    assert login.status_code == 200
    data = login.json()
    assert data["user"]["role"] == "clinic_owner"
    assert data["clinic"]["subscription_tier"] == "PREMIUM"


def test_add_tenant_invite_flow_still_works(founder_token, stamp):
    r = requests.post(
        f"{API}/admin/v2/tenants",
        headers=_h(founder_token),
        json={
            "clinic_name": f"Pytest Invite Clinic {stamp}",
            "owner_name": "Dr Pytest Invite",
            "owner_email": f"pytest-invite-{stamp}@example.in",
            "tier": "BASIC",
            "trial_days": 15,
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accept_url"] and body["accept_url"].startswith("http")
    assert body["invite_token"]
    # Direct-password fields stay null in invite mode.
    assert body.get("direct_login_password") is None


def test_direct_password_rejects_too_short(founder_token, stamp):
    r = requests.post(
        f"{API}/admin/v2/tenants",
        headers=_h(founder_token),
        json={
            "clinic_name": f"Short Pw Clinic {stamp}",
            "owner_name": "X",
            "owner_email": f"shortpw-{stamp}@example.in",
            "tier": "BASIC",
            "trial_days": 0,
            "initial_password": "short",  # 5 chars — below min_length=8
        },
        timeout=10,
    )
    assert r.status_code == 422  # pydantic validation


def test_direct_password_rejects_duplicate_email(founder_token, stamp):
    payload = {
        "clinic_name": f"Pytest Dup Clinic {stamp}",
        "owner_name": "Dr Dup",
        "owner_email": f"pytest-dup-{stamp}@example.in",
        "tier": "STANDARD",
        "trial_days": 30,
        "initial_password": "DupPytestPass!99",
    }
    r1 = requests.post(f"{API}/admin/v2/tenants", headers=_h(founder_token), json=payload, timeout=15)
    assert r1.status_code == 200
    r2 = requests.post(f"{API}/admin/v2/tenants", headers=_h(founder_token), json=payload, timeout=10)
    assert r2.status_code == 409
