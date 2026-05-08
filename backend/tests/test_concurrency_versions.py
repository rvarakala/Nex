"""Optimistic concurrency control + 3-way merge contract.

Tests the version-fencing infrastructure on the highest-conflict surface:
the Service Ticket pipeline (transition + PUT update). Verifies:
 1. New tickets start at version=1
 2. version increments on every successful $set
 3. Stale `If-Match` (and body `expected_version`) returns 409 + current doc
 4. Fresh write succeeds and the response carries the new version
"""
from __future__ import annotations

import os

import pytest
import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
API = (
    os.environ.get("API_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
)
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", ADMIN_EMAIL)
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def patient_id(auth_headers):
    return requests.get(f"{API}/patients?limit=1", headers=auth_headers).json()[0]["patient_id"]


@pytest.fixture(scope="module")
def branch_id(auth_headers):
    return requests.get(f"{API}/branches", headers=auth_headers).json()[0]["branch_id"]


def _new_ticket(headers, patient_id, branch_id):
    r = requests.post(f"{API}/ha/service-tickets", headers=headers, json={
        "branch_id": branch_id, "patient_id": patient_id, "kind": "repair",
        "complaint": "Concurrency test", "warranty_covered": False,
    })
    assert r.status_code == 201
    return r.json()["ticket_no"]


def test_new_ticket_starts_at_version_one(auth_headers, patient_id, branch_id):
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t.get("version") == 1


def test_transition_increments_version(auth_headers, patient_id, branch_id):
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    r = requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                      json={"to_status": "INSPECTED", "note": "ok"})
    assert r.status_code == 200
    assert r.json().get("version") == 2

    # Reload — DB is in sync
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["version"] == 2


def test_stale_expected_version_returns_409_with_current_doc(auth_headers, patient_id, branch_id):
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    # Move ticket to INSPECTED so version bumps to 2
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "INSPECTED"})

    # Client thinks they have v1, tries to transition with stale version
    r = requests.post(
        f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
        json={"to_status": "AWAITING_DISPATCH", "expected_version": 1},
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "VERSION_MISMATCH"
    assert detail["expected_version"] == 1
    assert detail["current_version"] == 2
    # The current server doc is embedded for 3-way diff
    assert detail["current"]["ticket_no"] == tno
    assert detail["current"]["status"] == "INSPECTED"
    assert detail["current"]["version"] == 2
    assert "_id" not in detail["current"]


def test_fresh_expected_version_succeeds(auth_headers, patient_id, branch_id):
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                  json={"to_status": "INSPECTED"})

    r = requests.post(
        f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
        json={"to_status": "AWAITING_DISPATCH", "expected_version": 2},
    )
    assert r.status_code == 200
    assert r.json()["version"] == 3


def test_if_match_header_works_too(auth_headers, patient_id, branch_id):
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    h = {**auth_headers, "If-Match": "1"}
    r = requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=h,
                      json={"to_status": "INSPECTED"})
    assert r.status_code == 200
    assert r.json()["version"] == 2

    # Stale header should now 409
    h_stale = {**auth_headers, "If-Match": "1"}
    r = requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=h_stale,
                      json={"to_status": "AWAITING_DISPATCH"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "VERSION_MISMATCH"


def test_put_update_also_version_fenced(auth_headers, patient_id, branch_id):
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    # First PUT bumps version 1 → 2
    r = requests.put(f"{API}/ha/service-tickets/{tno}", headers=auth_headers,
                     json={"diagnosis": "Receiver crackling", "expected_version": 1})
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2
    assert r.json()["diagnosis"] == "Receiver crackling"

    # Second PUT with stale version → 409
    r = requests.put(f"{API}/ha/service-tickets/{tno}", headers=auth_headers,
                     json={"diagnosis": "Different", "expected_version": 1})
    assert r.status_code == 409
    assert r.json()["detail"]["current"]["diagnosis"] == "Receiver crackling"


def test_unversioned_caller_skips_check_but_still_bumps(auth_headers, patient_id, branch_id):
    """Backwards compat: legacy clients without expected_version still succeed."""
    tno = _new_ticket(auth_headers, patient_id, branch_id)
    # No If-Match, no expected_version → write goes through
    r = requests.post(f"{API}/ha/service-tickets/{tno}/transition", headers=auth_headers,
                      json={"to_status": "INSPECTED"})
    assert r.status_code == 200
    # But version still bumped (so concurrent versioned writers can detect it)
    t = requests.get(f"{API}/ha/service-tickets/{tno}", headers=auth_headers).json()
    assert t["version"] == 2
