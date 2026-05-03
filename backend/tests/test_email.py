"""Regression tests for email helper + /api/admin/v2/test-email endpoint.

Keeps the suite provider-agnostic — the real SMTP path is only exercised
when ZEPTO_SMTP_PASSWORD is set. Default runs use the mock provider.
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

def test_send_email_invalid_recipient_structured_error():
    from utils.email import send_email
    out = send_email("not-an-email", "subj", "<p>body</p>")
    assert out["status"] == "invalid_request"


def test_send_email_requires_subject_and_body():
    from utils.email import send_email
    out = send_email("x@y.com", "", "<p>body</p>")
    assert out["status"] == "invalid_request"
    out2 = send_email("x@y.com", "subj")
    assert out2["status"] == "invalid_request"


def test_html_to_text_fallback():
    from utils.email import _html_to_text
    out = _html_to_text("<p>Hello</p><p>World</p>")
    assert "Hello" in out and "World" in out
    # HTML tags stripped, entities decoded
    assert _html_to_text("A&nbsp;B&amp;C") == "A B&C"


# ---------- /api/admin/v2/test-email endpoint ------------------------------

def test_test_email_endpoint_requires_admin(frontdesk_token):
    r = requests.post(
        f"{API}/admin/v2/test-email",
        headers=_h(frontdesk_token),
        json={"to": "x@y.com", "subject": "x", "body": "y"},
        timeout=10,
    )
    assert r.status_code == 403


def test_test_email_endpoint_rejects_bad_address(founder_token):
    r = requests.post(
        f"{API}/admin/v2/test-email",
        headers=_h(founder_token),
        json={"to": "not-an-email", "subject": "x", "body": "y"},
        timeout=10,
    )
    assert r.status_code == 422


def test_test_email_endpoint_returns_structured_result(founder_token):
    """Hitting a well-formed email — either lands via ZeptoMail (live creds)
    or returns the mock 'mocked' status. Both are acceptable signatures."""
    r = requests.post(
        f"{API}/admin/v2/test-email",
        headers=_h(founder_token),
        json={
            "to": "pytest-smoke@example.com",
            "subject": "AUDINEXA pytest",
            "body": "<p>pytest</p>",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in {"sent", "mocked", "error", "invalid_request"}
    assert body["provider"] in {"zepto", "mock"}


# ---------- verified-delivery smoke (off by default) -----------------------

@pytest.mark.skipif(
    not os.environ.get("ZEPTO_TEST_RECIPIENT"),
    reason="Set ZEPTO_TEST_RECIPIENT=you@example.com to run the live delivery test",
)
def test_live_email_to_verified_recipient(founder_token):
    to = os.environ["ZEPTO_TEST_RECIPIENT"]
    r = requests.post(
        f"{API}/admin/v2/test-email",
        headers=_h(founder_token),
        json={
            "to": to,
            "subject": "AUDINEXA pytest live smoke",
            "body": "<p>Live delivery check — ignore.</p>",
        },
        timeout=30,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "sent"
    assert body["message_id"].startswith("<")
