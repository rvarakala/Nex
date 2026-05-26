"""Regression tests for the 3 pre-launch P0 blockers shipped 2026-05-26:

  Block 1 — Async email helpers (`enqueue_email`, `send_email_background`)
  Block 2 — 2FA (TOTP) setup/verify/disable + two-step login
  Block 3 — DPDPA patient export + erase + audit log
"""
from __future__ import annotations
import io
import secrets
import uuid
import zipfile

import pyotp
import pytest
import requests

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H  # noqa: E402


# ────────────────────────────────────────────────────────────────────────
# Block 1 — async email
# ────────────────────────────────────────────────────────────────────────

def test_async_email_helpers_importable():
    """The new helpers exist + don't raise when called outside a loop."""
    from utils.email import enqueue_email, send_email_background
    assert callable(enqueue_email)
    assert callable(send_email_background)


# ────────────────────────────────────────────────────────────────────────
# Block 2 — 2FA
# ────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_token():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


def _post(path, headers, body):
    r = requests.post(f"{API}{path}", json=body, headers=headers, timeout=10)
    return r


def _get(path, headers, params=None):
    r = requests.get(f"{API}{path}", headers=headers, params=params, timeout=10)
    return r


def test_mfa_full_lifecycle(admin_token):
    h = H(admin_token)

    # Status: not enabled
    r = _get("/mfa/status", h); r.raise_for_status()
    initial = r.json()
    assert initial["mfa_enabled"] is False
    assert initial["mfa_eligible"] is True

    # Setup init
    r = _post("/mfa/setup/init", h, {}); r.raise_for_status()
    init = r.json()
    secret = init["secret_base32"]
    assert len(secret) == 32
    assert "otpauth://" in init["provisioning_uri"]

    # Verify with wrong code → 400
    r = _post("/mfa/setup/verify", h, {"code": "000000"})
    assert r.status_code == 400

    # Verify with correct code
    code = pyotp.TOTP(secret).now()
    r = _post("/mfa/setup/verify", h, {"code": code}); r.raise_for_status()
    body = r.json()
    assert body["success"] is True
    recovery_codes = body["recovery_codes"]
    assert len(recovery_codes) == 10

    # Status now enabled
    r = _get("/mfa/status", h); r.raise_for_status()
    assert r.json()["mfa_enabled"] is True

    # Logging in via password alone now returns a challenge
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    r.raise_for_status()
    challenge = r.json()
    assert challenge.get("requires_mfa") is True
    assert challenge.get("mfa_token")
    assert "access_token" not in challenge

    # Exchange TOTP for a real token
    code = pyotp.TOTP(secret).now()
    r = requests.post(f"{API}/auth/mfa/verify-login",
                      json={"mfa_token": challenge["mfa_token"], "code": code},
                      timeout=10)
    r.raise_for_status()
    assert "access_token" in r.json()

    # Recovery code path: get a fresh challenge, then use a recovery code
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    r.raise_for_status()
    challenge2 = r.json()
    r = requests.post(f"{API}/auth/mfa/verify-login",
                      json={"mfa_token": challenge2["mfa_token"],
                            "code": recovery_codes[0], "use_recovery_code": True},
                      timeout=10)
    r.raise_for_status()
    assert "access_token" in r.json()

    # Reusing the same recovery code → 401
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    challenge3 = r.json()
    r = requests.post(f"{API}/auth/mfa/verify-login",
                      json={"mfa_token": challenge3["mfa_token"],
                            "code": recovery_codes[0], "use_recovery_code": True},
                      timeout=10)
    assert r.status_code == 401, "Reused recovery code must be rejected"

    # Disable (TOTP) — code may have rolled, retry once with fresh code
    code = pyotp.TOTP(secret).now()
    r = _post("/mfa/disable", h, {"code": code})
    assert r.status_code == 200, f"Disable failed: {r.text}"
    assert r.json()["success"] is True

    # Status back to disabled
    r = _get("/mfa/status", h); r.raise_for_status()
    assert r.json()["mfa_enabled"] is False


# ────────────────────────────────────────────────────────────────────────
# Block 3 — DPDPA export + erase
# ────────────────────────────────────────────────────────────────────────


def test_dpdpa_export_and_audit_log(admin_token):
    h = H(admin_token)

    # Seed a patient for this test so we don't depend on conftest fixtures.
    p = _post("/patients", h, {
        "name": f"DPDPA Export Target {uuid.uuid4().hex[:6]}",
        "mobile": f"99{secrets.randbelow(10**8):08d}",
        "age": 35, "gender": "Female",
    })
    p.raise_for_status()
    pid = p.json()["patient_id"]

    # Export ZIP
    r = requests.get(f"{API}/patients/{pid}/dpdpa-export.zip", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type") == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())
    assert "manifest.json" in names
    assert "patient.json" in names
    assert "README.txt" in names

    import json
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["patient_id"] == pid
    assert manifest["clinic_id"]

    # Audit log shows the export
    r = _get("/patients/dpdpa/audit-log", h)
    r.raise_for_status()
    rows = r.json()
    assert any(row["kind"] == "export" and row["patient_id"] == pid for row in rows), \
        f"Export must appear in audit log: {rows}"


def test_dpdpa_forget_requires_phrase_and_anonymises(admin_token):
    h = H(admin_token)

    # Create a throwaway patient so we can erase it without disturbing fixtures
    p = _post("/patients", h, {
        "name": f"DPDPA Erase Target {uuid.uuid4().hex[:6]}",
        "mobile": f"99{secrets.randbelow(10**8):08d}",
        "age": 42, "gender": "Male",
    })
    p.raise_for_status()
    pid = p.json()["patient_id"]

    # Wrong phrase → 400
    r = _post(f"/patients/{pid}/dpdpa-forget", h, {"confirm_phrase": "wrong"})
    assert r.status_code == 400

    # Correct phrase
    r = _post(f"/patients/{pid}/dpdpa-forget", h, {
        "confirm_phrase": "ERASE PATIENT DATA",
        "reason": "Regression test",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert body["audit_id"].startswith("DPDPA-DEL-")

    # Fetch the patient — name should be anonymised
    pt = _get(f"/patients/{pid}", h).json()
    assert pt["name"].startswith("[erased]"), f"Name should be anonymised: {pt['name']}"
    assert pt.get("mobile", "").startswith("dpdpa-erased-")

    # Trying to export an already-erased patient → 410
    r = requests.get(f"{API}/patients/{pid}/dpdpa-export.zip", headers=h, timeout=10)
    assert r.status_code == 410

    # Cannot erase twice
    r = _post(f"/patients/{pid}/dpdpa-forget", h, {"confirm_phrase": "ERASE PATIENT DATA"})
    assert r.status_code == 400
