"""Family Group Linking — backend tests.

Covers:
- POST /api/patients/{id}/family/link (create, extend, self-link 400,
  already-in-different-groups 409)
- GET /api/patients/{id}/family (null when unlinked, populated when linked,
  merged members filtered)
- POST /api/patients/{id}/family/unlink (drop-below-2 dissolves group)
- Cross-clinic scoping
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

from _helpers import API, H, login, FOUNDER_EMAIL, FOUNDER_PASSWORD

OWNER_EMAIL = os.environ.get("FAMILY_OWNER_EMAIL", "owner@thesoundclinic.in")
OWNER_PASSWORD = os.environ.get("FAMILY_OWNER_PASSWORD", "demo123")


# ─── fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def owner_token():
    try:
        return login(OWNER_EMAIL, OWNER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Owner login failed, skipping family suite: {e}")


@pytest.fixture(scope="module")
def founder_token_fx():
    try:
        return login(FOUNDER_EMAIL, FOUNDER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Founder login failed: {e}")


def _mk_patient(token: str, name: str, mobile: str) -> dict:
    payload = {"name": name, "mobile": mobile, "age": 40, "gender": "male"}
    r = requests.post(
        f"{API}/patients",
        json=payload,
        params={"allow_duplicate_phone": "true"},
        headers=H(token),
        timeout=20,
    )
    assert r.status_code == 200, f"create patient failed: {r.status_code} {r.text[:250]}"
    return r.json()


def _cleanup_unlink(token: str, pid: str):
    try:
        requests.post(f"{API}/patients/{pid}/family/unlink", headers=H(token), timeout=10)
    except Exception:
        pass


@pytest.fixture
def three_patients(owner_token):
    mobile = f"90000{uuid.uuid4().hex[:5]}"
    a = _mk_patient(owner_token, "TEST_Fam A", mobile)
    b = _mk_patient(owner_token, "TEST_Fam B", mobile)
    c = _mk_patient(owner_token, "TEST_Fam C", mobile)
    a_id = a.get("patient_id") or a.get("id")
    b_id = b.get("patient_id") or b.get("id")
    c_id = c.get("patient_id") or c.get("id")
    yield a_id, b_id, c_id
    for pid in (a_id, b_id, c_id):
        _cleanup_unlink(owner_token, pid)


# ─── tests ────────────────────────────────────────────────────────────

class TestFamilyGroupLifecycle:

    def test_get_family_unlinked_returns_null_group(self, owner_token, three_patients):
        a_id, _, _ = three_patients
        r = requests.get(f"{API}/patients/{a_id}/family", headers=H(owner_token), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json() == {"group": None}

    def test_get_family_404_for_missing_patient(self, owner_token):
        r = requests.get(
            f"{API}/patients/NOPE-{uuid.uuid4().hex[:6]}/family",
            headers=H(owner_token), timeout=10,
        )
        assert r.status_code == 404

    def test_link_self_returns_400(self, owner_token, three_patients):
        a_id, _, _ = three_patients
        r = requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": a_id, "relationship": "spouse"},
            headers=H(owner_token), timeout=10,
        )
        assert r.status_code == 400

    def test_link_creates_group_and_populates_members(self, owner_token, three_patients):
        a_id, b_id, _ = three_patients
        r = requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": b_id, "relationship": "spouse"},
            headers=H(owner_token), timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        group = body["group"]
        assert group["group_id"].startswith("FAM-")
        assert "name" in group
        members = group["members"]
        assert len(members) == 2
        ids = {m["patient_id"] for m in members}
        assert ids == {a_id, b_id}
        for m in members:
            assert "name" in m and "patient_id" in m
            if m["patient_id"] == b_id:
                assert m["relationship"] == "spouse"

        # GET reflects same group
        r2 = requests.get(f"{API}/patients/{a_id}/family", headers=H(owner_token), timeout=10)
        assert r2.status_code == 200
        assert r2.json()["group"]["group_id"] == group["group_id"]

    def test_link_third_patient_extends_group_preserves_relationship(self, owner_token, three_patients):
        a_id, b_id, c_id = three_patients
        # First link A + B
        r = requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": b_id, "relationship": "spouse"},
            headers=H(owner_token), timeout=15,
        )
        assert r.status_code == 200
        gid = r.json()["group"]["group_id"]

        # Extend by linking C into it via B
        r2 = requests.post(
            f"{API}/patients/{b_id}/family/link",
            json={"other_patient_id": c_id, "relationship": "child"},
            headers=H(owner_token), timeout=15,
        )
        assert r2.status_code == 200, r2.text
        group = r2.json()["group"]
        assert group["group_id"] == gid
        assert len(group["members"]) == 3
        rel_map = {m["patient_id"]: m.get("relationship") for m in group["members"]}
        assert rel_map[c_id] == "child"
        assert rel_map[b_id] == "spouse"

    def test_link_conflict_when_both_in_different_groups(self, owner_token, three_patients):
        a_id, b_id, c_id = three_patients
        # Create another isolated patient
        d = _mk_patient(owner_token, "TEST_Fam D", f"90000{uuid.uuid4().hex[:5]}")
        d_id = d.get("patient_id") or d.get("id")
        try:
            # Group1: A+B
            r1 = requests.post(
                f"{API}/patients/{a_id}/family/link",
                json={"other_patient_id": b_id, "relationship": "spouse"},
                headers=H(owner_token), timeout=15,
            )
            assert r1.status_code == 200
            # Group2: C+D
            r2 = requests.post(
                f"{API}/patients/{c_id}/family/link",
                json={"other_patient_id": d_id, "relationship": "sibling"},
                headers=H(owner_token), timeout=15,
            )
            assert r2.status_code == 200
            # Try to link A (group1) + C (group2)
            r3 = requests.post(
                f"{API}/patients/{a_id}/family/link",
                json={"other_patient_id": c_id, "relationship": "sibling"},
                headers=H(owner_token), timeout=15,
            )
            assert r3.status_code == 409, r3.text
            detail = r3.json().get("detail")
            # FastAPI wraps dict details under "detail"
            assert isinstance(detail, dict)
            assert detail.get("code") == "already_in_different_families"
        finally:
            _cleanup_unlink(owner_token, d_id)

    def test_unlink_dissolves_group_below_two_members(self, owner_token, three_patients):
        a_id, b_id, _ = three_patients
        r = requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": b_id, "relationship": "spouse"},
            headers=H(owner_token), timeout=15,
        )
        assert r.status_code == 200
        gid = r.json()["group"]["group_id"]

        # Unlink A → group should dissolve, B should be unlinked too
        r2 = requests.post(f"{API}/patients/{a_id}/family/unlink", headers=H(owner_token), timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("ok") is True

        # Both patients now have group=null
        for pid in (a_id, b_id):
            g = requests.get(f"{API}/patients/{pid}/family", headers=H(owner_token), timeout=10).json()
            assert g == {"group": None}, f"expected null for {pid}, got {g}"

        _ = gid  # keep reference; group_id doc should be deleted

    def test_unlink_keeps_group_when_three_members(self, owner_token, three_patients):
        a_id, b_id, c_id = three_patients
        requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": b_id, "relationship": "spouse"},
            headers=H(owner_token), timeout=15,
        )
        requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": c_id, "relationship": "child"},
            headers=H(owner_token), timeout=15,
        )
        # Unlink C → group stays (2 remaining)
        r = requests.post(f"{API}/patients/{c_id}/family/unlink", headers=H(owner_token), timeout=10)
        assert r.status_code == 200

        g = requests.get(f"{API}/patients/{a_id}/family", headers=H(owner_token), timeout=10).json()
        assert g["group"] is not None
        assert len(g["group"]["members"]) == 2

    def test_unlink_when_not_in_group_returns_400(self, owner_token, three_patients):
        a_id, _, _ = three_patients
        r = requests.post(f"{API}/patients/{a_id}/family/unlink", headers=H(owner_token), timeout=10)
        assert r.status_code == 400


class TestClinicScoping:
    def test_cross_clinic_link_returns_404(self, owner_token, founder_token_fx, three_patients):
        # Founder is a different clinic. Create a patient in founder clinic.
        r = requests.post(
            f"{API}/patients",
            json={"name": "TEST_Founder Fam", "mobile": f"88888{uuid.uuid4().hex[:5]}",
                  "age": 30, "gender": "female"},
            params={"allow_duplicate_phone": "true"},
            headers=H(founder_token_fx), timeout=15,
        )
        if r.status_code != 200:
            pytest.skip(f"Founder cannot create patient in own clinic: {r.status_code}")
        founder_pid = r.json().get("patient_id") or r.json().get("id")

        a_id, _, _ = three_patients
        # Try to link founder's patient to a soundclinic patient using owner token
        resp = requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": founder_pid, "relationship": "spouse"},
            headers=H(owner_token), timeout=15,
        )
        assert resp.status_code == 404, f"Expected 404 for cross-clinic, got {resp.status_code}: {resp.text}"


class TestMergedMemberFilter:
    def test_merged_patient_hidden_from_populated_members(self, owner_token, three_patients):
        a_id, b_id, c_id = three_patients
        # Link A + B + C
        requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": b_id, "relationship": "spouse"},
            headers=H(owner_token), timeout=15,
        )
        requests.post(
            f"{API}/patients/{a_id}/family/link",
            json={"other_patient_id": c_id, "relationship": "child"},
            headers=H(owner_token), timeout=15,
        )
        # Merge C into A
        merge = requests.post(
            f"{API}/patients/merge",
            json={"primary_patient_id": a_id, "secondary_patient_id": c_id, "dry_run": False},
            headers=H(owner_token), timeout=30,
        )
        if merge.status_code != 200:
            pytest.skip(f"merge endpoint unavailable: {merge.status_code} {merge.text[:200]}")

        g = requests.get(f"{API}/patients/{a_id}/family", headers=H(owner_token), timeout=10).json()
        assert g["group"] is not None
        ids = {m["patient_id"] for m in g["group"]["members"]}
        assert c_id not in ids, "merged patient should be filtered from populated members"
        assert a_id in ids and b_id in ids
