"""Regression: GET /api/ha/trials must return 200 even when legacy trial
documents are missing optional fields (e.g. `created_by_user_id`).

Bug summary (caught by the new error telemetry on 2026-05-08):
ResponseValidationError on `/api/ha/trials` because the Trial response model
required `created_by_user_id: str` but 3 seeded demo trials in
tenant-sound-clinic-blr predated that field. Fix: made it Optional, so
legacy docs round-trip cleanly while new trials still set it.
"""
from __future__ import annotations

import requests

from _helpers import API, H, login


def test_ha_trials_list_returns_200_for_premium_tenant():
    """The seeded PREMIUM tenant has 3 legacy trials with no
    `created_by_user_id`. Listing them must succeed."""
    tok = login("owner@thesoundclinic.in", "demo123")
    r = requests.get(f"{API}/ha/trials", headers=H(tok), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    # The seeded demo trials all show as either `active`, `returned`, or
    # `converted` — never `expired` (they're all current). The exact count
    # may grow over time so we only assert "≥1".
    assert len(body) >= 1, "expected at least 1 seeded trial"
    # Each trial must carry its identifier — the rest may legitimately be
    # null on legacy seeded docs.
    for t in body:
        assert t.get("trial_no")
        assert t.get("clinic_id") == "tenant-sound-clinic-blr"
