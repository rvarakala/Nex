"""NAV-005 Sprint-3A regression suite.

Covers the four P1 fixes committed in this sprint:
  MERGE-001  — extended `_MERGEABLE_COLLECTIONS` (HA follow-ups,
               loaners, subscriptions, trade-ins, custom orders,
               ear-moulds, patient portal appointment requests).
  MERGE-002  — `serial_items.current_patient_id` is rewritten and
               reversible via merge undo.
  MERGE-003  — family-group cohesion across the 5 documented scenarios
               (see decision tree in `routers/patients.py::merge_patients`).
  CLIN-001   — `TestSession.clinic_id` first-class + tight tenant filter.

Also runs a cross-tenant regression: Clinic A must NEVER be able to
read Clinic B's patient / session / history via any of the standard
endpoints.

Design notes
------------
* Uses TEST DATA ONLY — every artefact is prefixed `TEST_S3A_<uuid>` so
  a search for these strings after a full pytest run yields 0 rows on a
  clean tenant. Patients are hard-DELETEd during teardown so no visible
  clutter is left in the demo tenant.
* Owner login (clinic_owner role) is required for the merge/undo API.
  Two clinics are needed for cross-tenant checks — we log in as both
  the sound-clinic owner (`owner@thesoundclinic.in`) and the founder
  (whose `clinic_id = audinexa-platform` — good enough as a second
  tenant for reads).
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

from _helpers import (
    API, H, login,
    FOUNDER_EMAIL, FOUNDER_PASSWORD,
)

OWNER_EMAIL = os.environ.get("MERGE_OWNER_EMAIL", "owner@thesoundclinic.in")
OWNER_PASSWORD = os.environ.get("MERGE_OWNER_PASSWORD", "demo123")

TAG_PREFIX = "TEST_S3A"


# ─── Direct DB helper — sync via pymongo to avoid Motor loop mgmt ─────
def _mongo():
    """Return a sync pymongo Database handle bound to the same MONGO_URL
    the app uses. Used for tests that need to write a serial_items row
    or inspect fields not exposed via public APIs."""
    from pymongo import MongoClient
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


# ═══════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def owner_token():
    try:
        return login(OWNER_EMAIL, OWNER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Owner login failed, skipping Sprint-3A suite: {e}")


@pytest.fixture(scope="module")
def founder_tok():
    try:
        return login(FOUNDER_EMAIL, FOUNDER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Founder login failed: {e}")


def _mk_patient(token: str, tag: str, mobile: str) -> dict:
    payload = {"name": f"{TAG_PREFIX}_{tag}", "mobile": mobile, "age": 40, "gender": "male"}
    r = requests.post(
        f"{API}/patients",
        json=payload,
        params={"allow_duplicate_phone": "true"},
        headers=H(token),
        timeout=20,
    )
    assert r.status_code == 200, f"create patient failed: {r.status_code} {r.text[:250]}"
    return r.json()


def _mk_pair(owner_token: str, prefix: str) -> tuple[dict, dict]:
    """Create Primary + Secondary sharing a unique mobile (so
    check-duplicate detects them). Both prefixed with `prefix` for
    per-test isolation."""
    tag = f"{prefix}_{uuid.uuid4().hex[:6]}"
    # 9-digit unique mobile (10 chars total starting with 9).
    mobile = f"9{int(time.time() * 1000) % 1000000000:09d}"
    prim = _mk_patient(owner_token, f"{tag}_P", mobile)
    sec = _mk_patient(owner_token, f"{tag}_S", mobile)
    return prim, sec


def _delete_patient(token: str, pid: str) -> None:
    """Hard-delete a test patient. Ignores 404 (already deleted / not found)."""
    try:
        requests.delete(f"{API}/patients/{pid}", headers=H(token), timeout=15)
    except Exception:
        pass


def _create_session(token: str, patient_id: str) -> dict:
    """POST /sessions helper — creates a minimal draft session."""
    r = requests.post(
        f"{API}/sessions",
        json={"patient_id": patient_id, "audiologist_name": f"{TAG_PREFIX}_Aud"},
        headers=H(token),
        timeout=20,
    )
    assert r.status_code == 200, f"create session failed: {r.status_code} {r.text[:250]}"
    return r.json()


def _create_note(token: str, patient_id: str, text: str = "S3A note") -> dict:
    r = requests.post(
        f"{API}/patient-notes",
        json={"patient_id": patient_id, "text": f"{TAG_PREFIX}: {text}"},
        headers=H(token),
        timeout=15,
    )
    assert r.status_code == 200, f"create note failed: {r.status_code} {r.text[:200]}"
    return r.json()


# ═══════════════════════════════════════════════════════════════════════
# MERGE-001 · Extended whitelist coverage
# ═══════════════════════════════════════════════════════════════════════

def test_merge_001_whitelist_includes_new_collections():
    """Direct source-level assertion: the extended whitelist must
    include the collections identified in the NAV-005 audit."""
    from routers.patients import _MERGEABLE_COLLECTIONS
    required_new = {
        "ha_followups", "ha_loaners", "ha_subscriptions", "ha_trade_ins",
        "custom_ha_orders", "ear_mould_orders", "patient_appointment_requests",
    }
    missing = required_new - set(_MERGEABLE_COLLECTIONS)
    assert not missing, f"whitelist missing required collections: {missing}"

    # And ensure legacy entries are still present (regression guard).
    required_legacy = {
        "appointments", "invoices", "test_sessions", "patient_notes",
        "ha_sales", "ha_fittings", "ha_trials", "quotations",
        "hearing_report_versions", "service_tickets", "ha_amc_contracts",
    }
    missing_legacy = required_legacy - set(_MERGEABLE_COLLECTIONS)
    assert not missing_legacy, f"legacy whitelist entries lost: {missing_legacy}"


def test_merge_001_dry_run_counts_notes_and_sessions(owner_token):
    """Dry run should count patient_notes + test_sessions attached to
    the secondary. Confirms both legacy AND new whitelist entries
    surface in the preview."""
    prim, sec = _mk_pair(owner_token, "M001DRY")
    try:
        _create_note(owner_token, sec["patient_id"])
        _create_session(owner_token, sec["patient_id"])

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
        preview = body.get("preview") or {}
        assert preview.get("patient_notes", 0) >= 1, f"note not counted: {preview}"
        assert preview.get("test_sessions", 0) >= 1, f"session not counted: {preview}"
        # Sprint-3A shape check: response now exposes alt_preview and family keys.
        assert "alt_preview" in body, "dry-run payload must include alt_preview"
        assert "family" in body, "dry-run payload must include family"
    finally:
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


def test_merge_001_wet_run_reparents_notes_to_primary(owner_token):
    """After merging, the note originally on secondary must be
    reachable via primary via `/patient-notes?patient_id=<primary>`.
    Verifies that the extended whitelist actually rewrites the FK."""
    prim, sec = _mk_pair(owner_token, "M001WET")
    try:
        note = _create_note(owner_token, sec["patient_id"], text="attached-to-secondary")
        # Sanity: note visible under secondary before merge.
        r_before = requests.get(
            f"{API}/patient-notes?patient_id={sec['patient_id']}",
            headers=H(owner_token), timeout=15,
        )
        assert r_before.status_code == 200
        assert any(n.get("note_id") == note["note_id"] for n in r_before.json())

        # Wet run.
        r_merge = requests.post(
            f"{API}/patients/merge",
            json={
                "primary_patient_id": prim["patient_id"],
                "secondary_patient_id": sec["patient_id"],
                "dry_run": False,
            },
            headers=H(owner_token),
            timeout=30,
        )
        assert r_merge.status_code == 200, r_merge.text
        applied = r_merge.json().get("applied", {})
        assert applied.get("patient_notes", 0) >= 1, f"note not rewritten: {applied}"

        # After merge — visible under primary.
        r_after = requests.get(
            f"{API}/patient-notes?patient_id={prim['patient_id']}",
            headers=H(owner_token), timeout=15,
        )
        assert r_after.status_code == 200
        assert any(n.get("note_id") == note["note_id"] for n in r_after.json()), \
            "note must be visible under primary after merge"

        # And zero orphans under secondary.
        r_orphan = requests.get(
            f"{API}/patient-notes?patient_id={sec['patient_id']}",
            headers=H(owner_token), timeout=15,
        )
        assert r_orphan.status_code == 200
        assert not any(n.get("note_id") == note["note_id"] for n in r_orphan.json()), \
            "note must NOT remain attached to merged secondary"
    finally:
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


# ═══════════════════════════════════════════════════════════════════════
# MERGE-002 · serial_items.current_patient_id ownership
# ═══════════════════════════════════════════════════════════════════════

def test_merge_002_serial_items_current_patient_id_rewritten(owner_token):
    """Direct DB write of a serial_items doc scoped to owner clinic.
    We can't easily go through the full HA lifecycle in a unit test
    (would need product / GRN / trial), so instead we insert a minimal
    serial_items row directly (via pymongo) and verify the merge
    routine touches it plus that undo reverses cleanly."""
    db = _mongo()

    prim, sec = _mk_pair(owner_token, "M002")
    # Fetch clinic_id from primary (they share it — same JWT).
    prim_full = db.patients.find_one(
        {"patient_id": prim["patient_id"]}, {"clinic_id": 1, "_id": 0},
    )
    clinic_id = prim_full["clinic_id"]

    serial_id = f"SI-{TAG_PREFIX}-{uuid.uuid4().hex[:8].upper()}"
    serial_no = f"S3A-{uuid.uuid4().hex[:10].upper()}"
    db.serial_items.insert_one({
        "serial_id": serial_id,
        "clinic_id": clinic_id,
        "branch_id": None,
        "product_id": None,
        "serial_no": serial_no,
        "state": "SOLD",
        "pool": "saleable",
        "current_patient_id": sec["patient_id"],
    })

    try:
        # Wet-run the merge.
        r_merge = requests.post(
            f"{API}/patients/merge",
            json={
                "primary_patient_id": prim["patient_id"],
                "secondary_patient_id": sec["patient_id"],
                "dry_run": False,
            },
            headers=H(owner_token),
            timeout=30,
        )
        assert r_merge.status_code == 200, r_merge.text
        applied = r_merge.json().get("applied", {})
        assert applied.get("serial_items:current_patient_id", 0) >= 1, \
            f"serial_items.current_patient_id NOT rewritten: {applied}"

        # DB truth: current_patient_id now points at primary.
        row = db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
        assert row["current_patient_id"] == prim["patient_id"], \
            f"current_patient_id not migrated: {row}"
        assert row.get("merged_from_patient_id") == sec["patient_id"], \
            "merged_from marker not set on serial_items"

        # ── Undo path: after undo, ownership must revert to secondary.
        merge_id = r_merge.json()["merge_id"]
        r_undo = requests.post(
            f"{API}/patients/merge-events/{merge_id}/undo",
            headers=H(owner_token),
            timeout=20,
        )
        assert r_undo.status_code == 200, r_undo.text
        reverted = r_undo.json().get("reverted", {})
        assert reverted.get("serial_items:current_patient_id", 0) >= 1, \
            f"serial_items current_patient_id NOT reverted on undo: {reverted}"

        row_after = db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
        assert row_after["current_patient_id"] == sec["patient_id"], \
            f"undo did not restore current_patient_id: {row_after}"
        assert "merged_from_patient_id" not in row_after, \
            "merged_from_patient_id should be unset after undo"
    finally:
        db.serial_items.delete_one({"serial_id": serial_id})
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


# ═══════════════════════════════════════════════════════════════════════
# MERGE-003 · Family group cohesion (5 scenarios)
# ═══════════════════════════════════════════════════════════════════════

def _link_family(token: str, a_pid: str, b_pid: str, relationship: str = "spouse") -> dict:
    """Link two patients into a family group via the standard API."""
    r = requests.post(
        f"{API}/patients/{a_pid}/family/link",
        json={"other_patient_id": b_pid, "relationship": relationship},
        headers=H(token),
        timeout=15,
    )
    assert r.status_code == 200, f"link family failed: {r.status_code} {r.text[:200]}"
    return r.json()


def _get_family(token: str, pid: str) -> dict:
    r = requests.get(f"{API}/patients/{pid}/family", headers=H(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_merge_003_scenario_1_same_family_group(owner_token):
    """Case 1: primary + secondary are already in the same family group.
    After merge, secondary must be REMOVED from members[]."""
    prim, sec = _mk_pair(owner_token, "M003C1")
    third = _mk_patient(owner_token, f"M003C1_third_{uuid.uuid4().hex[:6]}",
                        f"9{int(time.time() * 1000) % 1000000000:09d}")
    try:
        # Bring primary + secondary + third into one family.
        _link_family(owner_token, prim["patient_id"], sec["patient_id"])
        _link_family(owner_token, prim["patient_id"], third["patient_id"], "child")

        fam_before = _get_family(owner_token, prim["patient_id"])
        assert fam_before["group"] is not None
        member_pids_before = {m["patient_id"] for m in fam_before["group"]["members"]}
        assert {prim["patient_id"], sec["patient_id"], third["patient_id"]}.issubset(member_pids_before)

        # Merge.
        r = requests.post(
            f"{API}/patients/merge",
            json={"primary_patient_id": prim["patient_id"],
                  "secondary_patient_id": sec["patient_id"], "dry_run": False},
            headers=H(owner_token), timeout=30,
        )
        assert r.status_code == 200, r.text
        family_result = r.json().get("family_result", {})
        assert family_result.get("action") == "cleanup_same_group", family_result

        fam_after = _get_family(owner_token, prim["patient_id"])
        member_pids_after = {m["patient_id"] for m in fam_after["group"]["members"]}
        assert prim["patient_id"] in member_pids_after
        assert third["patient_id"] in member_pids_after
        assert sec["patient_id"] not in member_pids_after, "secondary must be removed from members[]"
    finally:
        _delete_patient(owner_token, third["patient_id"])
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


def test_merge_003_scenario_2_only_primary_in_group(owner_token):
    """Case 2: primary is in a group, secondary is NOT. Merge is a
    no-op on the family group."""
    prim, sec = _mk_pair(owner_token, "M003C2")
    peer = _mk_patient(owner_token, f"M003C2_peer_{uuid.uuid4().hex[:6]}",
                       f"9{int(time.time() * 1000) % 1000000000:09d}")
    try:
        _link_family(owner_token, prim["patient_id"], peer["patient_id"], "sibling")

        r = requests.post(
            f"{API}/patients/merge",
            json={"primary_patient_id": prim["patient_id"],
                  "secondary_patient_id": sec["patient_id"], "dry_run": False},
            headers=H(owner_token), timeout=30,
        )
        assert r.status_code == 200, r.text
        family_result = r.json().get("family_result", {})
        assert family_result.get("action") in ("noop", None), family_result

        # Primary still linked with peer, group intact.
        fam = _get_family(owner_token, prim["patient_id"])
        assert fam["group"] is not None
        pids = {m["patient_id"] for m in fam["group"]["members"]}
        assert {prim["patient_id"], peer["patient_id"]} == pids, pids
    finally:
        _delete_patient(owner_token, peer["patient_id"])
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


def test_merge_003_scenario_3_only_secondary_in_group_primary_inherits(owner_token):
    """Case 3: secondary is in a group, primary is NOT. Primary must
    INHERIT the group (added as member, family_group_id copied over,
    secondary removed from members[])."""
    prim, sec = _mk_pair(owner_token, "M003C3")
    peer = _mk_patient(owner_token, f"M003C3_peer_{uuid.uuid4().hex[:6]}",
                       f"9{int(time.time() * 1000) % 1000000000:09d}")
    try:
        _link_family(owner_token, sec["patient_id"], peer["patient_id"], "parent")

        # Snapshot the group_id BEFORE merge (fetched via secondary).
        fam_before = _get_family(owner_token, sec["patient_id"])
        assert fam_before["group"] is not None
        group_id_before = fam_before["group"]["group_id"]

        r = requests.post(
            f"{API}/patients/merge",
            json={"primary_patient_id": prim["patient_id"],
                  "secondary_patient_id": sec["patient_id"], "dry_run": False},
            headers=H(owner_token), timeout=30,
        )
        assert r.status_code == 200, r.text
        family_result = r.json().get("family_result", {})
        assert family_result.get("action") == "inherit_secondary", family_result

        # After merge — primary now sees the family.
        fam_after = _get_family(owner_token, prim["patient_id"])
        assert fam_after["group"] is not None, "primary should have inherited the family"
        assert fam_after["group"]["group_id"] == group_id_before
        pids_after = {m["patient_id"] for m in fam_after["group"]["members"]}
        assert prim["patient_id"] in pids_after
        assert peer["patient_id"] in pids_after
        assert sec["patient_id"] not in pids_after, \
            "secondary must be removed from members[] on inherit"
    finally:
        _delete_patient(owner_token, peer["patient_id"])
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


def test_merge_003_scenario_4_different_groups_conflict_preserved(owner_token):
    """Case 4: primary and secondary each belong to DIFFERENT family
    groups. Merge must NOT silently move members between unrelated
    groups. Primary keeps its group; secondary keeps its group.
    `family_result.action == 'conflict'`."""
    prim, sec = _mk_pair(owner_token, "M003C4")
    peer_a = _mk_patient(owner_token, f"M003C4_peerA_{uuid.uuid4().hex[:6]}",
                         f"9{int(time.time() * 1000) % 1000000000:09d}")
    peer_b = _mk_patient(owner_token, f"M003C4_peerB_{uuid.uuid4().hex[:6]}",
                         f"9{int(time.time() * 1000) % 1000000000:09d}")
    try:
        _link_family(owner_token, prim["patient_id"], peer_a["patient_id"], "spouse")
        _link_family(owner_token, sec["patient_id"], peer_b["patient_id"], "spouse")

        fam_prim_before = _get_family(owner_token, prim["patient_id"])
        fam_sec_before = _get_family(owner_token, sec["patient_id"])
        gid_prim = fam_prim_before["group"]["group_id"]
        gid_sec = fam_sec_before["group"]["group_id"]
        assert gid_prim != gid_sec

        r = requests.post(
            f"{API}/patients/merge",
            json={"primary_patient_id": prim["patient_id"],
                  "secondary_patient_id": sec["patient_id"], "dry_run": False},
            headers=H(owner_token), timeout=30,
        )
        assert r.status_code == 200, r.text
        family_result = r.json().get("family_result", {})
        assert family_result.get("action") == "conflict", family_result

        # Primary keeps its group.
        fam_prim_after = _get_family(owner_token, prim["patient_id"])
        assert fam_prim_after["group"] is not None
        assert fam_prim_after["group"]["group_id"] == gid_prim
        # peer_a still in primary's group.
        pids_prim_after = {m["patient_id"] for m in fam_prim_after["group"]["members"]}
        assert peer_a["patient_id"] in pids_prim_after
        assert prim["patient_id"] in pids_prim_after
    finally:
        _delete_patient(owner_token, peer_a["patient_id"])
        _delete_patient(owner_token, peer_b["patient_id"])
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


def test_merge_003_scenario_5_neither_in_group_noop(owner_token):
    """Case 5: neither patient is in a family group. Merge succeeds
    with family_result.action == 'noop'."""
    prim, sec = _mk_pair(owner_token, "M003C5")
    try:
        r = requests.post(
            f"{API}/patients/merge",
            json={"primary_patient_id": prim["patient_id"],
                  "secondary_patient_id": sec["patient_id"], "dry_run": False},
            headers=H(owner_token), timeout=30,
        )
        assert r.status_code == 200, r.text
        family_result = r.json().get("family_result", {})
        assert family_result.get("action") == "noop", family_result
    finally:
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


def test_merge_003_undo_restores_family_inherit(owner_token):
    """Undo of scenario 3 (inherit) must restore secondary's membership
    and REMOVE primary from the group."""
    prim, sec = _mk_pair(owner_token, "M003UNDO")
    peer = _mk_patient(owner_token, f"M003UNDO_peer_{uuid.uuid4().hex[:6]}",
                       f"9{int(time.time() * 1000) % 1000000000:09d}")
    try:
        _link_family(owner_token, sec["patient_id"], peer["patient_id"], "spouse")

        r_merge = requests.post(
            f"{API}/patients/merge",
            json={"primary_patient_id": prim["patient_id"],
                  "secondary_patient_id": sec["patient_id"], "dry_run": False},
            headers=H(owner_token), timeout=30,
        )
        assert r_merge.status_code == 200, r_merge.text
        merge_id = r_merge.json()["merge_id"]

        # Confirm inherit happened.
        fam_after_merge = _get_family(owner_token, prim["patient_id"])
        assert fam_after_merge["group"] is not None

        # Undo.
        r_undo = requests.post(
            f"{API}/patients/merge-events/{merge_id}/undo",
            headers=H(owner_token), timeout=20,
        )
        assert r_undo.status_code == 200, r_undo.text
        family_undo = r_undo.json().get("family_undo", {})
        assert family_undo.get("action") == "undo_inherit_secondary", family_undo

        # Primary no longer in the group.
        fam_prim_after_undo = _get_family(owner_token, prim["patient_id"])
        assert fam_prim_after_undo["group"] is None, \
            f"primary should no longer belong to the group after undo, got {fam_prim_after_undo}"

        # Secondary restored — reactivated + in the group.
        r_sec = requests.get(f"{API}/patients/{sec['patient_id']}",
                             headers=H(owner_token), timeout=15)
        assert r_sec.status_code == 200
        assert not r_sec.json().get("merged_into"), "secondary should be reactivated after undo"

        fam_sec_after_undo = _get_family(owner_token, sec["patient_id"])
        assert fam_sec_after_undo["group"] is not None, \
            f"secondary must be back in its family after undo, got {fam_sec_after_undo}"
        pids = {m["patient_id"] for m in fam_sec_after_undo["group"]["members"]}
        assert sec["patient_id"] in pids
        assert prim["patient_id"] not in pids
    finally:
        _delete_patient(owner_token, peer["patient_id"])
        _delete_patient(owner_token, sec["patient_id"])
        _delete_patient(owner_token, prim["patient_id"])


# ═══════════════════════════════════════════════════════════════════════
# CLIN-001 · TestSession clinic_id first-class
# ═══════════════════════════════════════════════════════════════════════

def test_clin001_session_create_stamps_clinic_id(owner_token):
    """Every newly-created session must have clinic_id stamped on the
    document (not just the response)."""
    db = _mongo()

    prim, _sec = _mk_pair(owner_token, "CLIN001CREATE")
    try:
        s = _create_session(owner_token, prim["patient_id"])
        doc = db.test_sessions.find_one({"session_id": s["session_id"]}, {"_id": 0})
        assert doc is not None
        assert doc.get("clinic_id"), f"clinic_id missing on new session: {doc}"

        # Response payload from the router now also carries clinic_id.
        assert s.get("clinic_id"), f"response payload missing clinic_id: {s}"

        # Fetch back via GET /sessions/{id} — direct clinic-scoped filter.
        r = requests.get(f"{API}/sessions/{s['session_id']}",
                         headers=H(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("clinic_id") == doc["clinic_id"]
    finally:
        _delete_patient(owner_token, prim["patient_id"])
        _delete_patient(owner_token, _sec["patient_id"])


def test_clin001_get_session_wrong_tenant_returns_404(owner_token, founder_tok):
    """A session created under the owner clinic must NOT be accessible
    via the founder clinic (or any other tenant)."""
    prim, sec = _mk_pair(owner_token, "CLIN001CROSS")
    try:
        s = _create_session(owner_token, prim["patient_id"])
        session_id = s["session_id"]

        # Founder attempts to read owner's session.
        r_founder = requests.get(f"{API}/sessions/{session_id}",
                                 headers=H(founder_tok), timeout=15)
        assert r_founder.status_code == 404, \
            f"cross-tenant session read must return 404, got {r_founder.status_code}"

        # Founder attempts to PUT.
        r_put = requests.put(
            f"{API}/sessions/{session_id}",
            json={"test_reliability": "poor"},
            headers=H(founder_tok), timeout=15,
        )
        assert r_put.status_code == 404, \
            f"cross-tenant session PUT must return 404, got {r_put.status_code}"

        # Founder attempts to DELETE.
        r_del = requests.delete(f"{API}/sessions/{session_id}",
                                headers=H(founder_tok), timeout=15)
        assert r_del.status_code == 404, \
            f"cross-tenant session DELETE must return 404, got {r_del.status_code}"

        # Owner reads normally.
        r_ok = requests.get(f"{API}/sessions/{session_id}",
                            headers=H(owner_token), timeout=15)
        assert r_ok.status_code == 200
    finally:
        _delete_patient(owner_token, prim["patient_id"])
        _delete_patient(owner_token, sec["patient_id"])


def test_clin001_list_sessions_scoped_to_current_clinic(owner_token, founder_tok):
    """GET /sessions?patient_id=<owner's pid> from a different clinic
    must return [], NOT the owner's sessions (no legacy fallback)."""
    prim, sec = _mk_pair(owner_token, "CLIN001LIST")
    try:
        _create_session(owner_token, prim["patient_id"])

        # From founder's tenant, filter by owner's patient_id.
        r = requests.get(
            f"{API}/sessions?patient_id={prim['patient_id']}",
            headers=H(founder_tok), timeout=15,
        )
        assert r.status_code == 200
        rows = r.json()
        assert rows == [], f"cross-tenant list must return empty, got {rows}"

        # Owner sees them.
        r_own = requests.get(
            f"{API}/sessions?patient_id={prim['patient_id']}",
            headers=H(owner_token), timeout=15,
        )
        assert r_own.status_code == 200
        assert len(r_own.json()) >= 1
    finally:
        _delete_patient(owner_token, prim["patient_id"])
        _delete_patient(owner_token, sec["patient_id"])


# ═══════════════════════════════════════════════════════════════════════
# Cross-tenant regression (Part 6)
# ═══════════════════════════════════════════════════════════════════════

def test_cross_tenant_patient_read_forbidden(owner_token, founder_tok):
    """Founder must not be able to read an owner-clinic patient by id."""
    prim, _sec = _mk_pair(owner_token, "XT_PATIENT")
    try:
        r = requests.get(f"{API}/patients/{prim['patient_id']}",
                         headers=H(founder_tok), timeout=15)
        assert r.status_code == 404, \
            f"cross-tenant patient read must return 404, got {r.status_code}"
    finally:
        _delete_patient(owner_token, prim["patient_id"])
        _delete_patient(owner_token, _sec["patient_id"])


def test_cross_tenant_history_read_forbidden(owner_token, founder_tok):
    """Founder must not be able to fetch owner-clinic patient's
    universal-drawer history."""
    prim, _sec = _mk_pair(owner_token, "XT_HISTORY")
    try:
        _create_session(owner_token, prim["patient_id"])
        r = requests.get(f"{API}/patients/{prim['patient_id']}/history",
                         headers=H(founder_tok), timeout=15)
        assert r.status_code == 404, \
            f"cross-tenant history must return 404, got {r.status_code}"
    finally:
        _delete_patient(owner_token, prim["patient_id"])
        _delete_patient(owner_token, _sec["patient_id"])


def test_cross_tenant_appointment_list_scoped(owner_token, founder_tok):
    """GET /appointments?patient_id=<owner's pid> under founder token
    must not surface owner's rows."""
    prim, _sec = _mk_pair(owner_token, "XT_APPTS")
    try:
        r = requests.get(
            f"{API}/appointments?patient_id={prim['patient_id']}",
            headers=H(founder_tok), timeout=15,
        )
        assert r.status_code == 200
        # If there are any rows, none should belong to owner's patient.
        rows = r.json() if isinstance(r.json(), list) else []
        assert not any(a.get("patient_id") == prim["patient_id"] for a in rows), \
            "cross-tenant appointment list must not leak owner rows"
    finally:
        _delete_patient(owner_token, prim["patient_id"])
        _delete_patient(owner_token, _sec["patient_id"])
