"""Regression tests for SMS helper + /api/admin/v2/test-sms endpoint.

Provider-agnostic — the Twilio `send_sms()` path is exercised separately in
a smoke test that's marked skipped by default (requires live creds + a
verified caller ID). The default suite only needs the mock provider.
"""
import os

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


# ---------- helper unit tests (no HTTP) ------------------------------------

def test_normalise_e164_variants():
    from utils.sms import normalise_e164
    assert normalise_e164("9876543210") == "+919876543210"
    assert normalise_e164("+919876543210") == "+919876543210"
    assert normalise_e164("919876543210") == "+919876543210"
    assert normalise_e164("09876543210") == "+919876543210"  # trunk 0 stripped
    assert normalise_e164("+1 (570) 942-5660") == "+15709425660"
    assert normalise_e164("") is None
    assert normalise_e164("12345") is None


def test_send_sms_invalid_number_returns_structured_error():
    from utils.sms import send_sms
    out = send_sms("abc", "hi", purpose="pytest")
    assert out["status"] == "invalid_number"


# ---------- /api/admin/v2/test-sms endpoint --------------------------------

def test_test_sms_endpoint_requires_admin(frontdesk_token):
    r = requests.post(
        f"{API}/admin/v2/test-sms",
        headers=_h(frontdesk_token),
        json={"to": "+919876543210", "body": "ignore"},
        timeout=10,
    )
    assert r.status_code == 403


def test_test_sms_endpoint_validates_payload(founder_token):
    r = requests.post(
        f"{API}/admin/v2/test-sms",
        headers=_h(founder_token),
        json={"to": "abc", "body": "ignore"},  # 'to' below min_length
        timeout=10,
    )
    assert r.status_code == 422


def test_test_sms_endpoint_returns_twilio_structured_result(founder_token):
    """Hitting the real Twilio API with an unverified trial number should
    surface a Twilio error 21608. If creds aren't set (local dev), we get a
    `creds missing` error instead — both outcomes are acceptable."""
    r = requests.post(
        f"{API}/admin/v2/test-sms",
        headers=_h(founder_token),
        json={"to": "+919000000001", "body": "AUDINEXA pytest smoke"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # We should always see a recognised status field.
    assert body["status"] in {"sent", "mocked", "error", "invalid_number"}
    assert body["provider"] in {"twilio", "mock"}
    # If running under real Twilio creds against an unverified trial number,
    # we expect a 21608 error — confirms the provider is actually being hit.
    if body["provider"] == "twilio" and body["status"] == "error":
        assert ("21608" in body.get("error", "")) or ("credentials" in body.get("error", "").lower())


# ---------- verified-number live smoke (off by default) --------------------

@pytest.mark.skipif(
    not os.environ.get("TWILIO_VERIFIED_TEST_NUMBER"),
    reason="Set TWILIO_VERIFIED_TEST_NUMBER=+91… to run the live delivery test",
)
def test_live_sms_to_verified_number(founder_token):
    """Opt-in live delivery — runs only when the env var is set to a number
    that's on Twilio's Verified Caller IDs list."""
    to = os.environ["TWILIO_VERIFIED_TEST_NUMBER"]
    r = requests.post(
        f"{API}/admin/v2/test-sms",
        headers=_h(founder_token),
        json={"to": to, "body": "AUDINEXA pytest live smoke — ignore."},
        timeout=20,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "sent"
    assert body["sid"].startswith("SM")  # Twilio message SIDs start with "SM"
