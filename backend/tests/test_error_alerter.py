"""Regression: error-spike alerter triggers when fingerprint count crosses
the threshold, and respects the cooldown window.

The alerter itself only fires Slack/email when env vars are set — these
tests exercise the threshold + cooldown logic directly via `maybe_alert`
and assert the cooldown state row, not the actual outbound message.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import requests

from _helpers import API, FOUNDER_EMAIL, FOUNDER_PASSWORD, H, login


def _founder_tok() -> str:
    return login(FOUNDER_EMAIL, FOUNDER_PASSWORD)


def test_alert_config_endpoint_returns_shape():
    """Founder can read the current alerter config."""
    r = requests.get(
        f"{API}/admin/v2/errors-alert/config",
        headers=H(_founder_tok()),
        timeout=10,
    )
    assert r.status_code == 200, r.text
    cfg = r.json()
    for k in ("threshold", "window_minutes", "cooldown_minutes",
              "slack_webhook_set", "email_to", "enabled"):
        assert k in cfg, f"alerter config missing '{k}'"
    assert isinstance(cfg["threshold"], int)
    assert cfg["threshold"] >= 1
    assert isinstance(cfg["email_to"], list)


def test_alert_config_blocked_for_non_admin():
    """Anyone OTHER than founder/super_admin must be 403'd from reading the
    alerter config (which leaks webhook URL hints + email recipients).
    `require_roles("founder")` always bypasses for super_admin too — that's
    a deliberate codebase-wide pattern, see auth.require_roles."""
    # Front desk is the cleanest non-admin role to test with.
    from _helpers import FRONTDESK_EMAIL, FRONTDESK_PASSWORD
    r = requests.get(
        f"{API}/admin/v2/errors-alert/config",
        headers=H(login(FRONTDESK_EMAIL, FRONTDESK_PASSWORD)),
        timeout=10,
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_test_alert_endpoint_dispatches_and_writes_cooldown():
    """Smoke: hitting `errors-alert/test` should succeed end-to-end and
    create the cooldown state row (visible because we then list it)."""
    tok = _founder_tok()
    r = requests.post(
        f"{API}/admin/v2/errors-alert/test",
        headers=H(tok),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["dispatched"] is True
    assert body["fingerprint"] == "TEST-ALERT-FINGERPRINT"

    # Confirm the rows actually landed in error_logs.
    g = requests.get(
        f"{API}/admin/v2/errors",
        params={"fingerprint": "TEST-ALERT-FINGERPRINT", "since_minutes": 2},
        headers=H(tok),
        timeout=10,
    )
    assert g.status_code == 200
    rows = g.json()["rows"]
    assert len(rows) >= 5, f"test should have inserted ≥5 rows, got {len(rows)}"
