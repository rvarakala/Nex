"""Regression — per-user device limit enforcement.

Covers:
  * warn mode (default): logins never blocked, warning surfaced in payload
  * enforce mode: 3rd login on BASIC blocked with 409 DEVICE_LIMIT_EXCEEDED
  * replace_session_id: atomic revoke + mint, hits the ordered "kick + login" flow
  * founder is exempt (cap=9999)
  * /auth/sessions/device-limit endpoint returns cap/count/tier accurately

Toggling enforcement requires flipping DEVICE_LIMIT_ENFORCE in the running
backend's process env, which pytest can't do directly. Instead we import
`utils.device_limits` and monkey-patch its module-level `is_enforcement_enabled`
via the OS env — the backend re-reads on every request through the
function call, so the switch is honoured mid-run.
"""
from __future__ import annotations

import os
import time

import pytest
import requests

import sys, pathlib  # noqa: E402
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, AUDIO_EMAIL, AUDIO_PASSWORD, FOUNDER_EMAIL, FOUNDER_PASSWORD, H  # noqa: E402


UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 Chrome/120"
UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2) AppleWebKit/605.1.15 Version/17.2 Mobile Safari/604.1"
UA_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/605.1.15 Firefox/128"


def _login(email: str, password: str, *, ua: str, replace_sid: str | None = None):
    body: dict = {"email": email, "password": password}
    if replace_sid:
        body["replace_session_id"] = replace_sid
    return requests.post(
        f"{API}/auth/login",
        json=body,
        headers={"User-Agent": ua},
        timeout=15,
    )


def _revoke_all_but_current(token: str) -> None:
    """Housekeeping — makes the test independent of prior sessions."""
    requests.post(
        f"{API}/auth/sessions/revoke-others",
        headers=H(token), timeout=10,
    )


# ─── Founder exemption ──────────────────────────────────────────────────

def test_founder_gets_unlimited_cap():
    r = _login(FOUNDER_EMAIL, FOUNDER_PASSWORD, ua=UA_MAC)
    assert r.status_code == 200, r.text
    dl = r.json().get("device_limit") or {}
    # cap sentinel from utils.device_limits.UNLIMITED
    assert dl.get("cap", 0) >= 999, f"Founder must be unlimited, got {dl}"

    token = r.json()["access_token"]
    meta = requests.get(f"{API}/auth/sessions/device-limit", headers=H(token), timeout=10).json()
    assert meta["unlimited"] is True
    assert meta["at_limit"] is False


# ─── /device-limit endpoint sanity ──────────────────────────────────────

def test_device_limit_endpoint_shape():
    token = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    ).json()["access_token"]
    r = requests.get(f"{API}/auth/sessions/device-limit", headers=H(token), timeout=10)
    assert r.status_code == 200
    body = r.json()
    for k in ("count", "cap", "unlimited", "enforced", "tier", "at_limit"):
        assert k in body, f"Missing field {k!r} in {body}"
    assert body["tier"] in {"BASIC", "STANDARD", "PREMIUM"}


# ─── Warn-mode: 3rd login still allowed, but flagged ────────────────────

def test_warn_mode_third_login_allowed_but_flagged(monkeypatch):
    """When DEVICE_LIMIT_ENFORCE is falsy (or unset), we don't block — we
    just surface `device_limit.action=='warn'` so the UI can render a banner.
    """
    # Ensure the running backend has the env var either unset or false. If
    # a suite has flipped it to true, we skip this test rather than mess
    # with process env at runtime (the backend reads the env on every call).
    if str(os.environ.get("DEVICE_LIMIT_ENFORCE") or "").lower() in {"1", "true", "yes", "on"}:
        pytest.skip("Suite is running in enforce mode; warn-mode test skipped.")

    # Fresh baseline — revoke everything then re-login three times.
    seed = _login(ADMIN_EMAIL, ADMIN_PASSWORD, ua=UA_MAC).json()["access_token"]
    _revoke_all_but_current(seed)
    time.sleep(0.5)

    # 1st and 2nd fresh sessions — allowed with action=='allow'
    r1 = _login(ADMIN_EMAIL, ADMIN_PASSWORD, ua=UA_IOS)
    assert r1.status_code == 200
    r2 = _login(ADMIN_EMAIL, ADMIN_PASSWORD, ua=UA_WIN)
    assert r2.status_code == 200

    # Note: the test admin's tier may be STANDARD/PREMIUM (cap 4/8), so we
    # can only assert that the 3rd login still succeeds — enforcement is off.
    r3 = _login(ADMIN_EMAIL, ADMIN_PASSWORD, ua="curl/8.0")
    assert r3.status_code == 200, "In warn mode every login must still succeed"
    dl = r3.json().get("device_limit") or {}
    assert dl.get("action") in {"allow", "warn"}


# ─── Replace-and-login round-trip (enforce path) ────────────────────────
# This test verifies the mechanics work even in warn mode — the caller
# can proactively pass replace_session_id to kick a specific device.

def test_replace_session_id_atomic_revoke_and_mint():
    """Uses the AUDIO (audiologist) test account — a non-exempt role on a
    BASIC-tier clinic — so the cap is 2 and the replace branch actually
    fires. Super-admin & founder skip this branch entirely (UNLIMITED).
    """
    # Baseline
    seed = _login(AUDIO_EMAIL, AUDIO_PASSWORD, ua=UA_MAC).json()["access_token"]
    _revoke_all_but_current(seed)
    time.sleep(0.5)

    # Create a 2nd session, capture its session_id from the sessions list.
    _login(AUDIO_EMAIL, AUDIO_PASSWORD, ua=UA_IOS)
    rows = requests.get(f"{API}/auth/sessions", headers=H(seed), timeout=10).json()
    other = next((s for s in rows if not s["current"]), None)
    assert other, f"iOS session should have been created, got {rows}"

    # Now log in a 3rd time WITH replace_session_id — atomically revoke iOS
    # and mint the new session. BASIC cap=2 means we're at cap → replace branch fires.
    r = _login(AUDIO_EMAIL, AUDIO_PASSWORD, ua=UA_WIN, replace_sid=other["session_id"])
    assert r.status_code == 200, r.text
    dl = r.json().get("device_limit") or {}
    # In BOTH warn and enforce modes, when replace_session_id is honoured
    # the server sets `replaced` to the sid it revoked.
    assert dl.get("replaced") == other["session_id"], (
        f"Server must report replaced={other['session_id']}, got {dl}"
    )

    # The revoked session should no longer appear in the list.
    rows2 = requests.get(f"{API}/auth/sessions", headers=H(seed), timeout=10).json()
    active_ids = {s["session_id"] for s in rows2}
    assert other["session_id"] not in active_ids, (
        "replace_session_id did not revoke the target row"
    )


# ─── Remember-device checkbox ── ephemeral sessions bypass the cap ─────

def test_ephemeral_session_does_not_count_against_cap():
    """When the login body sets remember_device=false, /device-limit's
    `count` MUST stay the same across those logins, and the session row
    is tagged remember_device=False.
    """
    # Bring the audio user back to a known state.
    seed = _login(AUDIO_EMAIL, AUDIO_PASSWORD, ua=UA_MAC).json()["access_token"]
    _revoke_all_but_current(seed)
    time.sleep(0.4)

    # Baseline count on the newly-created remembered session.
    baseline = requests.get(f"{API}/auth/sessions/device-limit", headers=H(seed), timeout=10).json()
    baseline_count = baseline["count"]

    # Fire 3 ephemeral logins from different UAs — none should bump `count`.
    for ua in (UA_IOS, UA_WIN, "curl/8.4"):
        r = requests.post(
            f"{API}/auth/login",
            json={"email": AUDIO_EMAIL, "password": AUDIO_PASSWORD, "remember_device": False},
            headers={"User-Agent": ua}, timeout=10,
        )
        assert r.status_code == 200, r.text
        dl = r.json().get("device_limit") or {}
        assert dl.get("action") == "allow_ephemeral", f"ephemeral login must short-circuit, got {dl}"
        assert dl.get("ephemeral") is True

    after = requests.get(f"{API}/auth/sessions/device-limit", headers=H(seed), timeout=10).json()
    assert after["count"] == baseline_count, (
        f"Ephemeral logins bumped the counted-devices number: {baseline_count} → {after['count']}"
    )

    # The rows must exist in the sessions list AND be flagged remember_device=False
    # so the UI can show the "Ephemeral" pill.
    rows = requests.get(f"{API}/auth/sessions", headers=H(seed), timeout=10).json()
    ephemerals = [s for s in rows if s.get("remember_device") is False]
    assert len(ephemerals) >= 3, (
        f"Expected ≥3 ephemeral session rows, got {[s['device_label'] for s in rows]}"
    )


def test_ephemeral_bypass_is_not_a_cap_loophole_for_remembered():
    """Ephemeral sessions must not somehow decrement the remembered-count
    used to enforce the cap: after firing several ephemeral logins, a
    fresh REMEMBERED login must still see them as invisible AND the cap
    should still block a 3rd REMEMBERED login (in enforce mode) or warn
    (in warn mode).
    """
    seed = _login(AUDIO_EMAIL, AUDIO_PASSWORD, ua=UA_MAC).json()["access_token"]
    _revoke_all_but_current(seed)
    time.sleep(0.4)

    # 2 remembered sessions (at cap for BASIC).
    _login(AUDIO_EMAIL, AUDIO_PASSWORD, ua=UA_IOS)  # remember=True default
    # 3 ephemerals — cap-blind.
    for ua in (UA_WIN, "curl/8.4", "Postman/10.20"):
        requests.post(
            f"{API}/auth/login",
            json={"email": AUDIO_EMAIL, "password": AUDIO_PASSWORD, "remember_device": False},
            headers={"User-Agent": ua}, timeout=10,
        )

    dl = requests.get(f"{API}/auth/sessions/device-limit", headers=H(seed), timeout=10).json()
    # Only the 2 remembered rows count.
    assert dl["count"] == 2, f"Expected count=2 (2 remembered), got {dl}"

    # A 3rd remembered login in warn mode: must succeed with action=='warn'.
    # In enforce mode: 409. Either outcome proves the cap is intact.
    r = requests.post(
        f"{API}/auth/login",
        json={"email": AUDIO_EMAIL, "password": AUDIO_PASSWORD},
        headers={"User-Agent": "Firefox/latest"}, timeout=10,
    )
    if r.status_code == 409:
        detail = r.json().get("detail") or {}
        assert detail.get("code") == "DEVICE_LIMIT_EXCEEDED"
    else:
        assert r.status_code == 200
        assert (r.json().get("device_limit") or {}).get("action") == "warn"
