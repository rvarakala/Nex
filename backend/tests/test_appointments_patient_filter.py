"""Regression: `GET /api/appointments?patient_id=...` must filter by patient.

Bug summary (2026-05-08): The Patient Profile History tab fetched
`/api/appointments?patient_id={id}` to populate the timeline. The endpoint
did NOT declare `patient_id` as a query parameter, so FastAPI silently
dropped it and returned every appointment in the clinic — flooding every
patient's profile with random imported visits.

Fix: added `patient_id: Optional[str]` query param to `list_appointments`.
"""
from __future__ import annotations

import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD, API, H, login


def test_appointments_endpoint_filters_by_patient_id():
    """Sanity: the endpoint now narrows to a single patient when asked."""
    tok = login("owner@thesoundclinic.in", "demo123")

    # Find a patient that actually has at least 1 appointment so the filter
    # has something to keep.
    apts = requests.get(f"{API}/appointments", headers=H(tok), timeout=20).json()
    assert isinstance(apts, list), apts
    pid_with_apts = next(
        (a["patient_id"] for a in apts if a.get("patient_id")),
        None,
    )
    if not pid_with_apts:
        # No data → can't run a positive-filter assertion. Negative-filter
        # check (below) is still meaningful.
        pid_with_apts = "PT-DOES-NOT-EXIST"

    # Filtered call.
    filt = requests.get(
        f"{API}/appointments",
        params={"patient_id": pid_with_apts},
        headers=H(tok),
        timeout=20,
    ).json()
    assert isinstance(filt, list), filt

    # Every returned row must belong to the asked patient — zero cross-patient
    # leakage.
    leaked = [a for a in filt if a.get("patient_id") != pid_with_apts]
    assert not leaked, (
        f"appointments leaked across patients when filtering by "
        f"{pid_with_apts}: {[a.get('appointment_id') for a in leaked][:5]}"
    )

    # And: filtered count must be < unfiltered count (unless one patient
    # owns every appointment in the clinic, which is implausible but we
    # only assert ≤ to keep the test stable).
    assert len(filt) <= len(apts)


def test_appointments_endpoint_returns_empty_for_nonexistent_patient():
    tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    r = requests.get(
        f"{API}/appointments",
        params={"patient_id": "PT-DEFINITELY-DOES-NOT-EXIST"},
        headers=H(tok),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) == 0
