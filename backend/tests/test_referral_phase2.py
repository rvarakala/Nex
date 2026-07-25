"""Backend tests for Referral Corner Phase 2 (pathways + doctor drill-down)
and extended referring-doctors CRUD (cut config on create/update).

Endpoints exercised:
  POST   /api/referring-doctors                       (with diag/ha cut fields)
  PUT    /api/referring-doctors/{doctor_id}
  DELETE /api/referring-doctors/{doctor_id}
  GET    /api/referrals/pathways
  GET    /api/referrals/doctors/{doctor_id}/detail
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

API = os.environ.get("API_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/") + "/api"

OWNER_EMAIL = "owner@thesoundclinic.in"
OWNER_PASSWORD = "demo123"


@pytest.fixture(scope="module")
def owner_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"owner login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("access_token")
    if not tok:
        pytest.skip("no access_token in login response")
    return {"Authorization": f"Bearer {tok}"}


# ── Referring-doctors CRUD with cut config ──────────────────────────

def test_create_referring_doctor_with_cut_config(owner_headers):
    payload = {
        "name": f"Dr. API Test {uuid.uuid4().hex[:6]}",
        "specialty": "ENT",
        "clinic": "QA Clinic",
        "phone": "9998887777",
        "diag_cut_mode": "percent",
        "diag_cut_value": 20,
        "ha_cut_mode": "flat",
        "ha_cut_value": 5000,
    }
    r = requests.post(f"{API}/referring-doctors", json=payload, headers=owner_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == payload["name"]
    assert body["diag_cut_mode"] == "percent"
    assert float(body["diag_cut_value"]) == 20.0
    assert body["ha_cut_mode"] == "flat"
    assert float(body["ha_cut_value"]) == 5000.0
    assert body.get("doctor_id")

    doctor_id = body["doctor_id"]

    # Verify persistence via list
    r2 = requests.get(f"{API}/referring-doctors", headers=owner_headers, timeout=15)
    assert r2.status_code == 200
    found = next((d for d in r2.json() if d["doctor_id"] == doctor_id), None)
    assert found is not None
    assert float(found["diag_cut_value"]) == 20.0

    # PUT to update diag_cut_value → 25
    update_payload = dict(payload)
    update_payload["diag_cut_value"] = 25
    r3 = requests.put(
        f"{API}/referring-doctors/{doctor_id}",
        json=update_payload, headers=owner_headers, timeout=15,
    )
    assert r3.status_code == 200, r3.text
    assert float(r3.json()["diag_cut_value"]) == 25.0

    # DELETE
    r4 = requests.delete(f"{API}/referring-doctors/{doctor_id}", headers=owner_headers, timeout=15)
    assert r4.status_code == 200
    # verify gone
    r5 = requests.get(f"{API}/referring-doctors", headers=owner_headers, timeout=15)
    still = next((d for d in r5.json() if d["doctor_id"] == doctor_id), None)
    assert still is None


def test_create_referring_doctor_percent_capped_at_100(owner_headers):
    payload = {
        "name": f"Dr. Cap Test {uuid.uuid4().hex[:6]}",
        "diag_cut_mode": "percent",
        "diag_cut_value": 250,   # should get clamped to 100
    }
    r = requests.post(f"{API}/referring-doctors", json=payload, headers=owner_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert float(body["diag_cut_value"]) == 100.0
    # cleanup
    requests.delete(f"{API}/referring-doctors/{body['doctor_id']}", headers=owner_headers)


# ── Pathways breakdown ──────────────────────────────────────────────

def test_pathways_returns_expected_schema(owner_headers):
    r = requests.get(
        f"{API}/referrals/pathways",
        params={"start": "2026-07-01", "end": "2026-07-31"},
        headers=owner_headers, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pathways" in body
    assert isinstance(body["pathways"], list)
    # Expect the canonical 8-pathway set
    labels = {p["pathway"] for p in body["pathways"]}
    assert "Doctor" in labels
    assert "Walk-in" in labels
    for p in body["pathways"]:
        assert "patient_count" in p
        assert "diagnostics_revenue" in p
        assert "ha_sales_revenue" in p
        assert "total_revenue" in p


# ── Doctor drill-down ───────────────────────────────────────────────

def test_doctor_drill_down_schema(owner_headers):
    # find any doctor for this owner's tenant
    r_list = requests.get(f"{API}/referring-doctors", headers=owner_headers, timeout=15)
    assert r_list.status_code == 200
    docs = r_list.json()
    if not docs:
        pytest.skip("no referring doctors seeded for tenant")
    doctor_id = docs[0]["doctor_id"]

    r = requests.get(
        f"{API}/referrals/doctors/{doctor_id}/detail",
        params={"start": "2026-07-01", "end": "2026-07-31"},
        headers=owner_headers, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("doctor", "patients", "patient_total", "test_breakdown",
                "revenue", "ha_fittings", "payout", "window"):
        assert key in body, f"missing key {key} in drill-down response"
    assert body["doctor"]["doctor_id"] == doctor_id
    assert "diagnostics" in body["revenue"]
    assert "total" in body["payout"]


def test_doctor_drill_down_404_for_unknown(owner_headers):
    r = requests.get(
        f"{API}/referrals/doctors/definitely-not-a-real-id/detail",
        headers=owner_headers, timeout=15,
    )
    assert r.status_code == 404
