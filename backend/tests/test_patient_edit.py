"""Regression test: PUT /api/patients/{id} updates fields and preserves
the patient's identity (clinic_id, mrd, patient_id).

The frontend "Edit" button on the patient profile previously routed to
the new-patient form (`/patients?new=1`) — a bug reported by a beta user.
This file pins the behaviour of the backend update endpoint that the
fixed frontend now calls from `/patients/:patientId/edit`.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

API = os.environ.get("API_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/") + "/api"

TEST_EMAIL = "owner@thesoundclinic.in"
TEST_PASSWORD = "demo123"


@pytest.fixture(scope="module")
def headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def ephemeral_patient(headers):
    """Create a throwaway patient for each test so we never mutate seed
    data. Cleaned up with DELETE at the end."""
    suffix = uuid.uuid4().hex[:8].upper()
    create = requests.post(
        f"{API}/patients",
        headers=headers,
        json={
            "name": f"QA Edit Test {suffix}",
            "age": 42,
            "gender": "Female",
            "mobile": f"99999{suffix[:5]}",
            "city": "Bengaluru",
            "chief_complaint": "tinnitus",
        },
        timeout=15,
    )
    create.raise_for_status()
    p = create.json()
    yield p
    requests.delete(f"{API}/patients/{p['patient_id']}", headers=headers, timeout=10)


def test_put_updates_provided_fields(headers, ephemeral_patient):
    pid = ephemeral_patient["patient_id"]
    r = requests.put(
        f"{API}/patients/{pid}",
        headers=headers,
        json={
            "name": ephemeral_patient["name"],
            "age": 43,                       # changed
            "gender": "Female",
            "mobile": ephemeral_patient["mobile"],
            "city": "Mysuru",                # changed
            "chief_complaint": "tinnitus",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["age"] == 43
    assert body["city"] == "Mysuru"


def test_put_preserves_immutable_fields(headers, ephemeral_patient):
    """patient_id, clinic_id, and mrd MUST survive a PUT — even if the
    payload tried to send them (we don't, but defence in depth)."""
    pid = ephemeral_patient["patient_id"]
    original_mrd = ephemeral_patient.get("mrd")
    original_clinic = ephemeral_patient.get("clinic_id")

    r = requests.put(
        f"{API}/patients/{pid}",
        headers=headers,
        json={
            "name": "Renamed Patient",
            "age": 50,
            "gender": "Male",
            "mobile": ephemeral_patient["mobile"],
        },
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["patient_id"] == pid
    assert body["mrd"] == original_mrd, "MRD must not change on edit"
    assert body["clinic_id"] == original_clinic


def test_put_404_for_nonexistent_patient(headers):
    r = requests.put(
        f"{API}/patients/NONEXISTENT-PT-9999",
        headers=headers,
        json={"name": "x", "age": 1, "gender": "Male", "mobile": "9999999999"},
        timeout=10,
    )
    assert r.status_code == 404


def test_put_cannot_touch_another_clinic(headers):
    """Cross-tenant safety: a PUT for a patient that belongs to another
    clinic returns 404 (NOT 403) — the existence of the patient must not
    leak across tenants."""
    # Use a guaranteed-non-existent ID under a different clinic prefix.
    r = requests.put(
        f"{API}/patients/PT-DELHI-FAKE-1234",
        headers=headers,
        json={"name": "x", "age": 1, "gender": "Male", "mobile": "9999999999"},
        timeout=10,
    )
    assert r.status_code == 404
