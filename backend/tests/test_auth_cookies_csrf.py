"""P1 XSS hardening — cookie-auth + CSRF double-submit regression tests."""
import pytest
import requests

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD


def _fresh_session_login():
    s = requests.Session()
    r = s.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return s, body


def test_login_sets_both_cookies_and_returns_csrf():
    s, body = _fresh_session_login()
    assert body.get("csrf_token"), "login response must include csrf_token"
    assert "access_token" in s.cookies, "access_token cookie should be set"
    assert "audinexa_csrf" in s.cookies, "audinexa_csrf cookie should be set"
    # JS-readable cookie value matches the body
    assert s.cookies["audinexa_csrf"] == body["csrf_token"]


def test_cookie_only_auth_works_for_get():
    s, _ = _fresh_session_login()
    # No Authorization header — relies purely on the access_token cookie.
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == ADMIN_EMAIL


def test_state_change_without_csrf_header_is_blocked():
    s, _ = _fresh_session_login()
    # POST without the X-CSRF-Token header → 403 from CsrfMiddleware.
    r = s.post(f"{API}/auth/switch-clinic", json={"clinic_id": "audinexa-platform"})
    assert r.status_code == 403, r.text
    assert "csrf" in r.text.lower()


def test_state_change_with_matching_csrf_header_passes():
    s, body = _fresh_session_login()
    r = s.post(
        f"{API}/auth/switch-clinic",
        json={"clinic_id": "audinexa-platform"},
        headers={"X-CSRF-Token": body["csrf_token"]},
    )
    # The endpoint may return 400/403 for tenant ACL reasons, but it MUST
    # have cleared the CSRF gate (not 403 with "csrf" in body).
    assert not (r.status_code == 403 and "csrf" in r.text.lower()), r.text


def test_bearer_auth_bypasses_csrf_gate():
    # API clients / pytest existing test suite use Authorization header.
    # They MUST keep working without an X-CSRF-Token (no browser, no CSRF).
    s = requests.Session()
    r = s.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    token = r.json()["access_token"]
    s2 = requests.Session()  # no cookies
    r2 = s2.post(
        f"{API}/auth/switch-clinic",
        json={"clinic_id": "audinexa-platform"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert not (r2.status_code == 403 and "csrf" in r2.text.lower()), r2.text


def test_logout_clears_cookies():
    s, body = _fresh_session_login()
    r = s.post(f"{API}/auth/logout", headers={"X-CSRF-Token": body["csrf_token"]})
    assert r.status_code == 200
    # After logout, both cookies should be gone (browser/requests honor Max-Age=0).
    assert "access_token" not in s.cookies
    assert "audinexa_csrf" not in s.cookies
    # /auth/me without any auth → 401
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 401
