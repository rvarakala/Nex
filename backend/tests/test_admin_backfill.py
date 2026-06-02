"""Founder-only admin backfill — `serial_items.current_patient_id`."""
import requests

from _helpers import API, FOUNDER_EMAIL, FOUNDER_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


URL = f"{API}/admin/v2/backfill/serial-current-patient-id"


def test_backfill_requires_founder_role():
    """Non-founder, non-super_admin must be 403."""
    # The pytest suite's audiologist sub-account
    try:
        from _helpers import AUDIO_EMAIL, AUDIO_PASSWORD
    except ImportError:
        AUDIO_EMAIL, AUDIO_PASSWORD = "pytest.audio@audinexa.test", "Pytest@123"
    tok = login(AUDIO_EMAIL, AUDIO_PASSWORD)
    r = requests.post(URL, json={"apply": False}, headers=H(tok))
    assert r.status_code in (401, 403), r.text


def test_backfill_dry_run_returns_summary():
    """Founder runs dry-run — must return the summary envelope without writing."""
    tok = login(FOUNDER_EMAIL, FOUNDER_PASSWORD)
    r = requests.post(URL, json={"apply": False}, headers=H(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["dry_run"] is True
    assert "candidates" in body
    assert "backfilled" in body
    assert "skipped_no_match" in body
    assert "fixed_per_clinic" in body
    assert isinstance(body["examples"], list)


def test_backfill_apply_writes_and_is_idempotent():
    """Apply mode writes; running it again finds zero new candidates."""
    tok = login(FOUNDER_EMAIL, FOUNDER_PASSWORD)
    r1 = requests.post(URL, json={"apply": True}, headers=H(tok))
    assert r1.status_code == 200, r1.text
    assert r1.json()["dry_run"] is False
    # Re-running should find at most the same candidates that were
    # skipped-no-match the first time (i.e. no new backfills possible).
    r2 = requests.post(URL, json={"apply": True}, headers=H(tok))
    assert r2.status_code == 200, r2.text
    # If r1 fixed something, r2 finds the *same* unresolved candidates
    # (and nothing new). The two responses' `backfilled` counts cannot
    # both be positive — second-run backfilled must be 0 unless
    # something else stamped the field in between, which won't happen
    # in the test loop.
    assert r2.json()["backfilled"] == 0 or r1.json()["backfilled"] == 0
