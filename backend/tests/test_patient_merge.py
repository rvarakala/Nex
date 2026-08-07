"""Patient Merge Tool — backend tests.

Covers POST /api/patients/merge (dry_run + wet_run), the merged-hide
filter on list/export/check-duplicate, GET single merged patient (500
regression fix in utils/serde.py), and role/tenant guards.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

from _helpers import API, H, login, FOUNDER_EMAIL, FOUNDER_PASSWORD

OWNER_EMAIL = os.environ.get("MERGE_OWNER_EMAIL", "owner@thesoundclinic.in")
OWNER_PASSWORD = os.environ.get("MERGE_OWNER_PASSWORD", "demo123")


# ─── fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def owner_token():
    try:
        return login(OWNER_EMAIL, OWNER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Owner login failed, skipping merge suite: {e}")


@pytest.fixture(scope="module")
def founder_token_fx():
    try:
        return login(FOUNDER_EMAIL, FOUNDER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Founder login failed: {e}")


def _mk_patient(token: str, name: str, mobile: str, *, allow_dup=True) -> dict:
    payload = {
        "name": name,
        "mobile": mobile,
        "age": 40,
        "gender": "male",
    }
    params = {"allow_duplicate_phone": "true"} if allow_dup else {}
    r = requests.post(
        f"{API}/patients",
        json=payload,
        params=params,
        headers=H(token),
        timeout=20,
    )
    assert r.status_code == 200, f"create patient failed: {r.status_code} {r.text[:250]}"
    return r.json()


@pytest.fixture
def primary_and_secondary(owner_token):
    tag = f"MERGE_{uuid.uuid4().hex[:6]}"
    mobile = f"9{int(time.time()) % 1000000000:09d}"
    prim = _mk_patient(owner_token, f"TEST_Primary_{tag}", mobile)
    sec = _mk_patient(owner_token, f"TEST_Secondary_{tag}", mobile, allow_dup=True)
    return prim, sec


# ─── dry_run preview ──────────────────────────────────────────────────

def test_merge_dry_run_returns_preview(owner_token, primary_and_secondary):
    prim, sec = primary_and_secondary
    r = requests.post(
        f"{API}/patients/merge",
        json={
            "primary_patient_id": prim["patient_id"],
            "secondary_patient_id": sec["patient_id"],
            "dry_run": True,
        },
        headers=H(owner_token),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert "preview" in body
    assert "total_rows_affected" in body
    assert isinstance(body["preview"], dict)
    assert body["primary"]["patient_id"] == prim["patient_id"]
    assert body["secondary"]["patient_id"] == sec["patient_id"]

    # Verify secondary NOT modified (still visible in list)
    r2 = requests.get(f"{API}/patients?search={sec['patient_id']}", headers=H(owner_token), timeout=20)
    assert r2.status_code == 200
    items = r2.json()
    assert any(p["patient_id"] == sec["patient_id"] for p in items), "dry_run must not soft-delete secondary"


# ─── validation & guards ──────────────────────────────────────────────

def test_merge_same_id_400(owner_token, primary_and_secondary):
    prim, _ = primary_and_secondary
    r = requests.post(
        f"{API}/patients/merge",
        json={"primary_patient_id": prim["patient_id"], "secondary_patient_id": prim["patient_id"], "dry_run": True},
        headers=H(owner_token),
        timeout=20,
    )
    assert r.status_code == 400, r.text


def test_merge_cross_clinic_returns_404_or_403(owner_token, founder_token_fx):
    # Create a patient under owner clinic
    p_owner = _mk_patient(owner_token, "TEST_OwnerClinic", f"8{int(time.time())%1000000000:09d}")
    # Create a patient under founder (platform) clinic
    p_founder = _mk_patient(founder_token_fx, "TEST_FounderClinic", f"7{int(time.time())%1000000000:09d}")

    r = requests.post(
        f"{API}/patients/merge",
        json={
            "primary_patient_id": p_owner["patient_id"],
            "secondary_patient_id": p_founder["patient_id"],
            "dry_run": True,
        },
        headers=H(owner_token),
        timeout=20,
    )
    assert r.status_code in (400, 403, 404), r.text


def test_merge_role_gate_non_owner_403():
    # Try with pytest admin (which is not clinic_owner on the owner clinic)
    # We need a non-owner token in the owner's clinic — use frontdesk seed if any.
    # Fallback: try creating via receptionist role if available. If not
    # available, skip (documented limitation).
    from _helpers import FRONTDESK_EMAIL, FRONTDESK_PASSWORD
    try:
        tok = login(FRONTDESK_EMAIL, FRONTDESK_PASSWORD)
    except AssertionError:
        pytest.skip("frontdesk role not seeded")

    r = requests.post(
        f"{API}/patients/merge",
        json={"primary_patient_id": "x", "secondary_patient_id": "y", "dry_run": True},
        headers=H(tok),
        timeout=20,
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text[:200]}"


# ─── wet run + double-merge guard ─────────────────────────────────────

def test_merge_wet_run_soft_marks_secondary_and_hides_from_list(owner_token, primary_and_secondary):
    prim, sec = primary_and_secondary
    r = requests.post(
        f"{API}/patients/merge",
        json={
            "primary_patient_id": prim["patient_id"],
            "secondary_patient_id": sec["patient_id"],
            "dry_run": False,
        },
        headers=H(owner_token),
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is False
    assert "applied" in body

    # ── default list must hide the merged secondary
    r_list = requests.get(f"{API}/patients?search={sec['patient_id']}", headers=H(owner_token), timeout=20)
    assert r_list.status_code == 200
    items = r_list.json()
    assert not any(p["patient_id"] == sec["patient_id"] for p in items), "merged secondary must be hidden by default"

    # ── include_merged=true surfaces it again
    r_list2 = requests.get(f"{API}/patients?search={sec['patient_id']}&include_merged=true", headers=H(owner_token), timeout=20)
    assert r_list2.status_code == 200
    items2 = r_list2.json()
    assert any(p["patient_id"] == sec["patient_id"] for p in items2), "include_merged=true must return merged rows"

    # ── GET single merged patient must return 200 with fields populated (serde fix)
    r_get = requests.get(f"{API}/patients/{sec['patient_id']}", headers=H(owner_token), timeout=20)
    assert r_get.status_code == 200, f"GET on merged patient returned {r_get.status_code}: {r_get.text[:250]}"
    merged = r_get.json()
    assert merged.get("merged_into") == prim["patient_id"]
    assert merged.get("merged_at"), "merged_at must be populated as string"
    assert isinstance(merged.get("merged_at"), str), f"merged_at must be str, got {type(merged.get('merged_at'))}"
    assert merged.get("merged_by"), "merged_by must be populated"

    # ── double-merge attempt returns 400
    r_dbl = requests.post(
        f"{API}/patients/merge",
        json={
            "primary_patient_id": prim["patient_id"],
            "secondary_patient_id": sec["patient_id"],
            "dry_run": False,
        },
        headers=H(owner_token),
        timeout=20,
    )
    assert r_dbl.status_code == 400, f"expected 400 on double-merge, got {r_dbl.status_code}"
    assert "already merged" in r_dbl.text.lower()

    # ── check-duplicate must not surface merged secondary
    # Use mobile from the primary (both created with same mobile)
    if prim.get("mobile"):
        r_dup = requests.get(
            f"{API}/patients/check-duplicate?mobile={prim['mobile']}",
            headers=H(owner_token),
            timeout=20,
        )
        assert r_dup.status_code == 200
        matches = r_dup.json().get("matches", [])
        assert not any(m["patient_id"] == sec["patient_id"] for m in matches), \
            "check-duplicate must skip merged rows"

    # ── CSV export excludes the merged secondary
    r_csv = requests.get(
        f"{API}/patients/export.csv?search={sec['patient_id']}",
        headers=H(owner_token),
        timeout=30,
    )
    assert r_csv.status_code == 200
    assert sec["patient_id"] not in r_csv.text, "CSV export must exclude merged rows"
