"""Smoke test — covers the absolute minimum needed to confirm the platform
boots and the canonical schemas haven't drifted.

Designed to run in <30 seconds. Marked ``smoke`` so it can be selected with::

    pytest -m smoke

A convenience runner is also provided at ``backend/scripts/smoke.sh``.

What this verifies
------------------
1. `conftest.py` bootstrap successfully seeded the legacy admin/clinic.
2. Health probe responds (`GET /health` and `GET /api/health`).
3. Founder + admin logins both succeed (`POST /api/auth/login`).
4. `GET /api/auth/me` returns a structurally-valid user payload.
5. Tenant-scoped `GET /api/patients?limit=1` is reachable + returns a list.
6. Forgot-password endpoint is mounted (returns 200/202 even for unknown
   emails so we don't leak account presence).

These are explicitly *thin* — feature coverage lives in the full pytest
suite; this file is the smoke-screen that prevents wasted CI minutes when
something fundamental (seed, env, auth, mongo) is broken.
"""
from __future__ import annotations

import pytest
import requests

from _helpers import (  # noqa: E402  (pytest adds tests/ to sys.path)
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    API,
    FOUNDER_EMAIL,
    FOUNDER_PASSWORD,
    H,
    login,
)


pytestmark = pytest.mark.smoke


def test_health_endpoint_responds():
    """Liveness probe target — must always return 200 on /api/health."""
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200, f"{API}/health returned {r.status_code}: {r.text[:200]}"


def test_admin_login_succeeds():
    """conftest.py bootstrap should have seeded the legacy admin user."""
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert tok and isinstance(tok, str)


def test_founder_login_succeeds():
    """Founder is seeded even when DISABLE_DEMO_SEED=1."""
    tok = login(FOUNDER_EMAIL, FOUNDER_PASSWORD)
    assert tok and isinstance(tok, str)


def test_auth_me_payload_shape():
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    r = requests.get(f"{API}/auth/me", headers=H(tok), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    user = body.get("user", body)
    for k in ("email", "role", "clinic_id"):
        assert k in user, f"auth/me payload missing '{k}': {user}"
    assert user["email"] == ADMIN_EMAIL


def test_patients_list_reachable():
    """Tenant-scoped read endpoint — confirms data plane + RBAC are wired."""
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    r = requests.get(f"{API}/patients?limit=1", headers=H(tok), timeout=15)
    assert r.status_code == 200, r.text
    payload = r.json()
    assert isinstance(payload, list)


def test_forgot_password_endpoint_mounted():
    """Should always return 200/202 (no account-existence leak)."""
    r = requests.post(
        f"{API}/auth/forgot-password",
        json={"email": "smoke-nonexistent@example.com"},
        timeout=15,
    )
    assert r.status_code in (200, 202), f"unexpected {r.status_code}: {r.text[:200]}"
