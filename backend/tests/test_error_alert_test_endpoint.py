"""Regression — /api/admin/v2/errors-alert/test must default to DRY RUN.

Bug (2026-06-03): the founder reported ~10 spam emails titled
`[AUDINEXA] error spike: TestSpikeAlert ×40` flooding their inbox.
Root cause: the test endpoint was triggering REAL email dispatches
*and* leaving synthetic error_logs rows behind (105 stale rows). Both
fixed by:
  • defaulting `send=0` (dry-run) — real email only when `?send=1`
  • auto-purging the synthetic error_logs rows in a `finally` block
    so DB-level metrics are never polluted
  • new `/errors-alert/purge-test-data` for cleanup of legacy stale rows

Run: `cd /app/backend && pytest tests/test_error_alert_test_endpoint.py -x -q`
"""
import os
import requests
import pytest

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


@pytest.fixture(scope="module")
def founder_tok():
    # Founder is required (require_roles("founder")).
    return login("founder@audinexa.com", "founder123")


def _count_stale(db_url, db_name):
    """Count any TestSpikeAlert rows that leaked past the auto-purge."""
    from pymongo import MongoClient
    cli = MongoClient(db_url)
    db = cli[db_name]
    n_logs = db.error_logs.count_documents({"fingerprint": "TEST-ALERT-FINGERPRINT"})
    n_state = db.error_alert_state.count_documents({"fingerprint": "TEST-ALERT-FINGERPRINT"})
    cli.close()
    return n_logs, n_state


def test_default_is_dry_run_and_no_rows_leak(founder_tok):
    r = requests.post(
        f"{API}/admin/v2/errors-alert/test", headers=H(founder_tok)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True, "default behaviour MUST be dry-run"
    assert body["dispatched"] is False
    assert body["synthetic_rows_inserted"] == body["synthetic_rows_purged"], (
        "every row inserted must be cleaned up"
    )
    assert "payload_preview" in body
    # No stale rows in DB after dry-run.
    n_logs, n_state = _count_stale(os.environ["MONGO_URL"], os.environ["DB_NAME"])
    assert n_logs == 0, f"expected 0 stale error_logs rows, found {n_logs}"
    assert n_state == 0, f"expected 0 stale alert_state rows, found {n_state}"


def test_send_true_still_purges_synthetic_rows(founder_tok):
    """When the founder explicitly opts into real send via ?send=1, the
    synthetic rows still get cleaned up. We can't easily assert that an
    email was actually sent (would require live SMTP) — but we can
    assert the DB is left clean."""
    r = requests.post(
        f"{API}/admin/v2/errors-alert/test?send=1", headers=H(founder_tok)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is False
    # Even when dispatched, synthetic rows are purged.
    n_logs, n_state = _count_stale(os.environ["MONGO_URL"], os.environ["DB_NAME"])
    assert n_logs == 0
    assert n_state == 0


def test_purge_test_data_endpoint(founder_tok):
    """Manual purge endpoint clears any historical leak from before the
    auto-cleanup landed. Idempotent — runs harmlessly when nothing is
    there to purge."""
    r = requests.post(
        f"{API}/admin/v2/errors-alert/purge-test-data", headers=H(founder_tok)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "error_logs_purged" in body
    assert "alert_state_purged" in body
    assert body["error_logs_purged"] >= 0
    # Calling twice should not crash.
    r2 = requests.post(
        f"{API}/admin/v2/errors-alert/purge-test-data", headers=H(founder_tok)
    )
    assert r2.status_code == 200
    assert r2.json()["error_logs_purged"] == 0  # idempotent
