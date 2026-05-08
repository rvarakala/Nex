"""Shared test helpers — single source of truth for credentials, API URL, and
common request boilerplate.

Why this exists
---------------
~40 legacy test files duplicate the same `_login("admin@acs.in", "admin123")`
boilerplate, hardcoding the demo admin email/password in every file. That
makes it impossible to drop the legacy `clinic-acs-demo` seed without
rewriting every file.

Migration policy (P2)
---------------------
New tests SHOULD import from this module:

    from ._helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H

Legacy tests will be migrated incrementally to the same pattern. The defaults
preserve back-compat (`admin@acs.in`/`admin123`) so existing tests keep
passing during the migration window. To run the suite against a different
identity, export at the shell:

    export TEST_ADMIN_EMAIL=founder@audinexa.com
    export TEST_ADMIN_PASSWORD=founder123
    pytest

Environment variables read
--------------------------
* `REACT_APP_BACKEND_URL` — preferred; loaded from `frontend/.env` by conftest.
* `API_URL`               — older alias, still honoured.
* `TEST_ADMIN_EMAIL`      — admin login for the seeded test clinic.
* `TEST_ADMIN_PASSWORD`   — password for that admin.
* `TEST_CLINIC_ID`        — clinic_id the bootstrap should populate (rarely needed).
"""
from __future__ import annotations

import os

import requests


def _resolve_api_url() -> str:
    raw = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("API_URL")
    if not raw:
        # Fall back to reading frontend/.env directly (matches legacy pattern).
        try:
            with open("/app/frontend/.env", "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        raw = line.split("=", 1)[1].strip()
                        break
        except OSError:
            pass
    if not raw:
        raise RuntimeError(
            "REACT_APP_BACKEND_URL is not set; cannot resolve test API URL"
        )
    raw = raw.rstrip("/")
    return raw if raw.endswith("/api") else f"{raw}/api"


API: str = _resolve_api_url()
ADMIN_EMAIL: str = os.environ.get("TEST_ADMIN_EMAIL", "admin@acs.in")
ADMIN_PASSWORD: str = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
ADMIN_CLINIC_ID: str = os.environ.get("TEST_CLINIC_ID", "clinic-acs-demo")

# Founder is always seeded (even when DISABLE_DEMO_SEED=1) so smoke tests
# and platform-level checks can rely on it.
FOUNDER_EMAIL: str = os.environ.get("FOUNDER_EMAIL", "founder@audinexa.com")
FOUNDER_PASSWORD: str = os.environ.get("FOUNDER_PASSWORD", "founder123")


def login(email: str, password: str, *, timeout: int = 20) -> str:
    """POST /auth/login → access_token (raises on failure)."""
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=timeout,
    )
    if r.status_code != 200:
        raise AssertionError(
            f"login {email} failed: {r.status_code} {r.text[:200]}"
        )
    return r.json()["access_token"]


def admin_token() -> str:
    """Convenience: log in as the configured test admin."""
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


def founder_token() -> str:
    """Convenience: log in as the platform founder."""
    return login(FOUNDER_EMAIL, FOUNDER_PASSWORD)


def H(token: str) -> dict:
    """Build an Authorization header dict from a bearer token."""
    return {"Authorization": f"Bearer {token}"}


__all__ = [
    "API",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "ADMIN_CLINIC_ID",
    "FOUNDER_EMAIL",
    "FOUNDER_PASSWORD",
    "login",
    "admin_token",
    "founder_token",
    "H",
]
