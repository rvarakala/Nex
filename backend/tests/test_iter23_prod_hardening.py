"""Iter23 — Production hardening regression tests.

Covers:
  - Health endpoint
  - Auth login (success + 429 rate-limit at 10/min)
  - /auth/me + /auth/my-clinics
  - Vault status (mode field), state machine, setup round-trip
  - Vault unlock-verify rate-limit at 10/min
  - Vault recovery-redeem rate-limit at 5/min
  - Patients + Appointments regression (still 200)
  - CORS preflight headers

Each rate-limit-sensitive test uses a UNIQUE X-Forwarded-For header so the
slowapi proxy_aware_key buckets each test independently — prevents tests from
starving each other's budgets.
"""
import base64
import hashlib
import os
import secrets
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@acs.in")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


# ---------------- helpers ----------------

def _login_with_xff(email, password, xff):
    """Login using a synthetic X-Forwarded-For so this caller has its own
    rate-limit bucket.  Returns the requests.Response object."""
    return requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": xff},
        timeout=15,
    )


@pytest.fixture(scope="module")
def admin_token():
    """Single shared admin token for all read-only checks. Uses its own XFF
    so it cannot be starved by the brute-force test."""
    xff = "203.0.113.10"
    r = _login_with_xff(ADMIN_EMAIL, ADMIN_PASSWORD, xff)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body
    return body["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------------- Health ----------------

class TestHealth:
    def test_health_200(self):
        r = requests.get(f"{API}/health", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "healthy"


# ---------------- Auth ----------------

class TestAuth:
    def test_login_valid_credentials(self):
        r = _login_with_xff(ADMIN_EMAIL, ADMIN_PASSWORD, "203.0.113.11")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("access_token"), str) and len(body["access_token"]) > 20
        assert body.get("user", {}).get("email") == ADMIN_EMAIL
        assert body.get("user", {}).get("role") == "super_admin"
        assert body.get("clinic", {}).get("clinic_id") == "clinic-acs-demo"

    def test_login_invalid_credentials(self):
        r = _login_with_xff(ADMIN_EMAIL, "wrong-pwd-XYZ", "203.0.113.12")
        assert r.status_code == 401
        assert "detail" in r.json()

    def test_login_rate_limit_fires_after_10(self):
        """11th login attempt within 60s from same IP -> 429."""
        xff = "203.0.113.99"  # dedicated bucket
        statuses = []
        for _ in range(11):
            r = _login_with_xff(ADMIN_EMAIL, "wrong-pwd-RL", xff)
            statuses.append(r.status_code)
        # First 10 should be 401 (or maybe 429 if the bucket bled in).
        # The 11th MUST be 429.
        assert statuses[-1] == 429, f"Expected 429 on 11th attempt, got statuses: {statuses}"
        # Sanity: at least one of the first 10 should have been 401 (i.e. limiter
        # didn't fire on the very first call).
        assert 401 in statuses, f"Limiter fired too early: {statuses}"

    def test_auth_me_with_valid_token(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("user", {}).get("email") == ADMIN_EMAIL
        assert body.get("clinic", {}).get("clinic_id") == "clinic-acs-demo"

    def test_auth_me_no_token(self):
        r = requests.get(f"{API}/auth/me", timeout=10)
        assert r.status_code in (401, 403)

    def test_my_clinics(self, admin_headers):
        r = requests.get(f"{API}/auth/my-clinics", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "active_clinic_id" in body
        assert "primary_clinic_id" in body
        assert isinstance(body.get("clinics"), list)
        assert any(c.get("clinic_id") == body["active_clinic_id"] for c in body["clinics"])


# ---------------- Regression: patients / appointments ----------------

class TestRegression:
    def test_patients_list(self, admin_headers):
        r = requests.get(f"{API}/patients", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        # Could be a list or a paginated dict — accept either.
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_appointments_list(self, admin_headers):
        # Appointments endpoint typically requires a date range; try without first.
        r = requests.get(f"{API}/appointments", headers=admin_headers, timeout=15)
        # 200 or 422 (missing required param) both prove the route is wired & not 5xx.
        assert r.status_code in (200, 422), f"Got {r.status_code}: {r.text[:300]}"


# ---------------- CORS ----------------

class TestCORS:
    def test_preflight_options(self):
        r = requests.options(
            f"{API}/health",
            headers={
                "Origin": "https://app.audinexa.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
            timeout=10,
        )
        # Starlette CORSMiddleware returns 200 on preflight.
        assert r.status_code in (200, 204), f"Preflight got {r.status_code}: {r.text}"
        assert "access-control-allow-origin" in {k.lower() for k in r.headers.keys()}
        assert "access-control-allow-methods" in {k.lower() for k in r.headers.keys()}


# ---------------- Vault ----------------

def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _prep_vault_to_standard(headers, current_mode):
    """Best-effort: bring the demo clinic's vault state to 'standard' so the
    state-machine test starts from a known baseline."""
    if current_mode == "vault_enabled":
        # Tear down — needs confirm_disable
        requests.post(
            f"{API}/vault/mode",
            json={"mode": "standard", "confirm_disable": True},
            headers=headers, timeout=10,
        )
    elif current_mode == "vault_pending":
        requests.post(
            f"{API}/vault/mode",
            json={"mode": "standard"},
            headers=headers, timeout=10,
        )


class TestVault:
    def test_status_returns_mode_field(self, admin_headers):
        r = requests.get(f"{API}/vault/status", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "mode" in body, f"vault/status missing 'mode': {body}"
        assert body["mode"] in {"standard", "vault_pending", "vault_enabled"}
        assert "enabled" in body

    def test_mode_state_machine_standard_pending_standard(self, admin_headers):
        # Baseline: get current mode; force-down to standard.
        r0 = requests.get(f"{API}/vault/status", headers=admin_headers, timeout=10)
        _prep_vault_to_standard(admin_headers, r0.json().get("mode"))

        # standard -> vault_pending (allowed)
        r1 = requests.post(
            f"{API}/vault/mode",
            json={"mode": "vault_pending"},
            headers=admin_headers, timeout=10,
        )
        assert r1.status_code == 200, r1.text
        assert r1.json().get("mode") == "vault_pending"

        # vault_pending -> standard (allowed; cancel)
        r2 = requests.post(
            f"{API}/vault/mode",
            json={"mode": "standard"},
            headers=admin_headers, timeout=10,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json().get("mode") == "standard"

    def test_mode_direct_to_vault_enabled_rejected(self, admin_headers):
        # Make sure not currently enabled — set to standard first.
        r0 = requests.get(f"{API}/vault/status", headers=admin_headers, timeout=10)
        _prep_vault_to_standard(admin_headers, r0.json().get("mode"))

        r = requests.post(
            f"{API}/vault/mode",
            json={"mode": "vault_enabled"},
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"

    def test_setup_round_trip_or_idempotent_409(self, admin_headers):
        """Either (a) vault not yet set up -> 200 + we tear down, or (b) already
        set up -> 409. Both are acceptable per the spec ("setup still works")."""
        # First move to vault_pending so setup is the natural next step.
        s = requests.get(f"{API}/vault/status", headers=admin_headers, timeout=10).json()
        if s.get("mode") == "vault_enabled":
            # Already set up — verify endpoint returns 409 (idempotency guard).
            payload = self._fake_setup_payload()
            r = requests.post(f"{API}/vault/setup", json=payload, headers=admin_headers, timeout=10)
            assert r.status_code == 409, f"Expected 409 on already-setup vault, got {r.status_code}: {r.text}"
            return

        if s.get("mode") != "vault_pending":
            requests.post(
                f"{API}/vault/mode", json={"mode": "vault_pending"},
                headers=admin_headers, timeout=10,
            )

        payload = self._fake_setup_payload()
        r = requests.post(f"{API}/vault/setup", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, f"Setup failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("enabled") is True
        assert body.get("mode") == "vault_enabled"

        # Round-trip: status now reflects vault_enabled
        s2 = requests.get(f"{API}/vault/status", headers=admin_headers, timeout=10).json()
        assert s2.get("enabled") is True
        assert s2.get("mode") == "vault_enabled"

        # Tear down so we leave the demo clinic at 'standard'
        requests.post(
            f"{API}/vault/mode",
            json={"mode": "standard", "confirm_disable": True},
            headers=admin_headers, timeout=10,
        )

    @staticmethod
    def _fake_setup_payload():
        # Server doesn't validate the cipher — only sizes — so synthetic values
        # are fine for round-trip plumbing test.
        master = secrets.token_bytes(32)
        verifier = hashlib.sha256(master).hexdigest()
        return {
            "kdf_salt": _b64(secrets.token_bytes(16)),
            "kdf_iterations": 600000,
            "kdf_algo": "pbkdf2-sha256-aesgcm-v1",
            "verifier": verifier,
            "encrypted_dek": _b64(secrets.token_bytes(48)),
            "dek_iv": _b64(secrets.token_bytes(12)),
            "recovery_slots": [],
        }


# ---------------- Vault Rate Limiting ----------------

class TestVaultRateLimits:
    def test_unlock_verify_rate_limited_at_10(self, admin_token):
        """11th call within 60s from same IP -> 429."""
        xff = "203.0.113.55"
        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
            "X-Forwarded-For": xff,
        }
        # Body schema: arbitrary JSON works — the endpoint will reject on auth/lookup
        # before/after rate-limit check, but the limiter fires regardless.
        body = {"verifier": "0" * 64}
        statuses = []
        for _ in range(11):
            r = requests.post(f"{API}/vault/unlock-verify", json=body, headers=headers, timeout=10)
            statuses.append(r.status_code)
        assert statuses[-1] == 429, f"Expected 429 on 11th call, got: {statuses}"

    def test_recovery_redeem_rate_limited_at_5(self, admin_token):
        """6th call within 60s from same IP -> 429."""
        xff = "203.0.113.66"
        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
            "X-Forwarded-For": xff,
        }
        body = {
            "code_hash": "0" * 64,
            "new_kdf_salt": _b64(secrets.token_bytes(16)),
            "new_kdf_iterations": 600000,
            "new_kdf_algo": "pbkdf2-sha256-aesgcm-v1",
            "new_verifier": "0" * 64,
            "new_encrypted_dek": _b64(secrets.token_bytes(48)),
            "new_dek_iv": _b64(secrets.token_bytes(12)),
        }
        statuses = []
        for _ in range(6):
            r = requests.post(f"{API}/vault/recovery-redeem", json=body, headers=headers, timeout=10)
            statuses.append(r.status_code)
        assert statuses[-1] == 429, f"Expected 429 on 6th call, got: {statuses}"
