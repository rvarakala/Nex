"""Regression — Sessions & Devices: list, revoke one, revoke others, cannot revoke self."""
from __future__ import annotations
import pytest
import requests

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H  # noqa: E402


def _login_with_ua(ua: str) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"User-Agent": ua},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def test_sessions_list_revoke_one_and_revoke_others():
    # Two distinct logins → two session rows
    t_desktop = _login_with_ua("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537.36")
    t_mobile  = _login_with_ua("Mozilla/5.0 (iPhone; iOS 17) Version/17.0 Mobile Safari/604.1")

    # From desktop, list sessions — at least 2, our row marked current
    rows = requests.get(f"{API}/auth/sessions", headers=H(t_desktop), timeout=10).json()
    assert isinstance(rows, list)
    desktop_row = next((s for s in rows if s["current"]), None)
    assert desktop_row, f"Desktop session must be marked current: {rows}"
    other_rows  = [s for s in rows if not s["current"]]
    assert other_rows, "Mobile session should appear as a non-current session"

    # device_label is humanised
    assert "macOS" in desktop_row["device_label"] or "Chrome" in desktop_row["device_label"]
    mobile_row = next((s for s in other_rows if "iPhone" in s["device_label"]), None)
    assert mobile_row, f"iPhone session not found: {other_rows}"

    # Revoking own current session → 400
    r = requests.post(f"{API}/auth/sessions/{desktop_row['session_id']}/revoke",
                      headers=H(t_desktop), timeout=10)
    assert r.status_code == 400, f"Cannot revoke current session: {r.text}"

    # Revoke the iPhone session — mobile token must immediately 401
    r = requests.post(f"{API}/auth/sessions/{mobile_row['session_id']}/revoke",
                      headers=H(t_desktop), timeout=10)
    assert r.status_code == 200, r.text

    # Mobile token now invalid
    r = requests.get(f"{API}/patients?limit=1", headers=H(t_mobile), timeout=10)
    assert r.status_code == 401, f"Revoked mobile token must 401, got {r.status_code}: {r.text}"

    # Desktop token still works
    r = requests.get(f"{API}/patients?limit=1", headers=H(t_desktop), timeout=10)
    assert r.status_code == 200

    # Re-listing should NOT include the revoked iPhone (we only return revoked_at=null)
    rows2 = requests.get(f"{API}/auth/sessions", headers=H(t_desktop), timeout=10).json()
    assert all(s["session_id"] != mobile_row["session_id"] for s in rows2), \
        "Revoked session should be hidden from the list"

    # Re-revoking the now-revoked session → 404
    r = requests.post(f"{API}/auth/sessions/{mobile_row['session_id']}/revoke",
                      headers=H(t_desktop), timeout=10)
    assert r.status_code == 404


def test_revoke_other_sessions_bulk():
    # 3 fresh logins
    tokens = [_login_with_ua(f"Mozilla/5.0 (Test Browser {i})") for i in range(3)]
    keeper = tokens[0]

    # Revoke everything except `keeper`
    r = requests.post(f"{API}/auth/sessions/revoke-others", headers=H(keeper), timeout=10)
    r.raise_for_status()
    revoked_count = r.json()["revoked"]
    assert revoked_count >= 2, f"Expected at least 2 revoked, got {revoked_count}"

    # Other tokens are dead
    for t in tokens[1:]:
        r = requests.get(f"{API}/patients?limit=1", headers=H(t), timeout=10)
        assert r.status_code == 401, f"Token must be invalidated: {r.status_code}"

    # Keeper still alive
    r = requests.get(f"{API}/patients?limit=1", headers=H(keeper), timeout=10)
    assert r.status_code == 200


def test_token_without_sid_still_works():
    """Backward-compat: tokens minted before per-session tracking carry no
    `sid` claim. They must continue to authenticate (until they expire) so
    we don't accidentally log every user out on the day this code ships."""
    from auth import create_access_token
    import requests as _rq

    # Mint a token with no session_id (legacy code path)
    # We need a real existing user — use the test admin
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)  # this stamps a session
    # Decode it to grab the user payload, then re-mint without sid
    import jwt as _jwt
    from auth import _jwt_secret
    payload = _jwt.decode(tok, _jwt_secret(), algorithms=["HS256"])

    legacy = create_access_token(
        payload["sub"], payload["email"], payload["role"], payload["clinic_id"],
        token_version=int(payload.get("tv", 0)),
        # session_id omitted → no `sid` claim
    )
    r = _rq.get(f"{API}/patients?limit=1", headers=H(legacy), timeout=10)
    assert r.status_code == 200, f"Legacy token without sid must still authenticate: {r.text}"
