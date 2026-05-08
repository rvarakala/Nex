"""Regression: backup admin endpoints (founder-only) work, and the backup
script produces a restorable archive.

Note: the destructive restore is NOT exercised here — that's covered by
the manual drill recorded in RUNBOOK_BACKUP_RESTORE.md. Re-running it in
the test suite would wipe the pytest tenant on every run.
"""
from __future__ import annotations

import os

import pytest
import requests

from _helpers import API, FOUNDER_EMAIL, FOUNDER_PASSWORD, FRONTDESK_EMAIL, FRONTDESK_PASSWORD, H, login


def _founder_tok() -> str:
    return login(FOUNDER_EMAIL, FOUNDER_PASSWORD)


def test_backup_config_endpoint_returns_shape():
    r = requests.get(
        f"{API}/admin/v2/backups/config",
        headers=H(_founder_tok()),
        timeout=10,
    )
    assert r.status_code == 200, r.text
    cfg = r.json()
    for k in ("backup_dir", "retention_days", "scheduler_enabled",
              "schedule_time_ist", "s3_prefix", "s3_region"):
        assert k in cfg, f"backup config missing '{k}'"


def test_backup_config_blocked_for_non_admin():
    """Front desk must be 403'd from reading backup config (path leaks)."""
    r = requests.get(
        f"{API}/admin/v2/backups/config",
        headers=H(login(FRONTDESK_EMAIL, FRONTDESK_PASSWORD)),
        timeout=10,
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_backup_run_now_creates_an_archive():
    """End-to-end: hitting `run-now` should create a real, non-empty
    `.archive.gz` under BACKUP_DIR within ~30s."""
    tok = _founder_tok()
    r = requests.post(
        f"{API}/admin/v2/backups/run-now",
        headers=H(tok),
        timeout=120,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True, body
    assert body.get("filename", "").endswith(".archive.gz"), body
    assert body.get("size_bytes", 0) > 0, body

    # Confirm the file is now visible in the listing.
    listing = requests.get(
        f"{API}/admin/v2/backups",
        headers=H(tok),
        timeout=20,
    ).json()
    filenames = {f["filename"] for f in listing["local_files"]}
    assert body["filename"] in filenames, (
        f"new backup {body['filename']} not visible in listing: {filenames}"
    )

    # Confirm history row was persisted.
    hist = listing["history"]
    assert any(h.get("filename") == body["filename"] for h in hist), hist
