"""NAV-006 Sprint-P2A regression suite.

Covers three approved-only findings:

  F-006  — Reports tenant-query hardening. `clinic_id` is now filtered
           directly in every `find_one` on `test_sessions` inside the
           reports / hearing-report / share-audit paths. A foreign
           session_id is indistinguishable from a non-existent one
           (both 404).

  F-013  — Direct session tenant guard in report_handover. The
           session's own `clinic_id` is now the tenant guard; the
           patient-existence check is no longer used as an indirect
           tenant gate.

  F-007  — Merged-patient resolution via `resolve_patient_for_session`
           helper — clinic-scoped chain walk over `patients.merged_into`
           + `patient_merge_events`.

Test-authoring conventions:
* Sync test functions (codebase convention). Async helpers are exercised
  via `asyncio.run(_async_body(...))`.
* Every fixture row is prefixed `TEST_S006_P2A_<uuid>` and torn down.
* Cross-tenant fixtures use `clinic-nav006-p2a-*` decoy clinic ids
  (no real users, direct DB writes only).
* No production data written.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

from _helpers import (
    API, H, login,
    ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_CLINIC_ID,
)

TAG_PREFIX = "TEST_S006_P2A"


# ─── Shared DB handles ────────────────────────────────────────────────
def _mongo_sync():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _mongo_async():
    import motor.motor_asyncio as mma
    return mma.AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Fixtures ─────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def token() -> str:
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def db():
    return _mongo_sync()


@pytest.fixture(scope="module")
def clinic_id() -> str:
    return ADMIN_CLINIC_ID


def _seed_session_direct(db, *, clinic_id: str, patient_id: str, tag: str = "") -> str:
    sid = f"SES-{TAG_PREFIX}-{uuid.uuid4().hex[:10]}{tag}"
    db.test_sessions.insert_one({
        "session_id": sid,
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "audiologist_name": "Dr Test",
        "audiologist_user_id": None,
        "test_reliability": "good",
        "test_methods": ["headphones"],
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return sid


def _seed_patient_direct(db, *, clinic_id: str, tag: str,
                         extra: dict | None = None) -> str:
    pid = f"ACS-{TAG_PREFIX}-{uuid.uuid4().hex[:8]}"
    doc = {
        "patient_id": pid,
        "clinic_id": clinic_id,
        "name": f"{TAG_PREFIX} {tag}",
        "age": 40,
        "gender": "Male",
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        doc.update(extra)
    db.patients.insert_one(doc)
    return pid


@pytest.fixture()
def synth_patient(token: str, db) -> dict:
    tag = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/patients", headers=H(token),
        json={"name": f"{TAG_PREFIX} {tag}", "age": 40, "gender": "Female"},
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text[:200]
    p = r.json()
    yield p
    pid = p["patient_id"]
    db.patients.delete_one({"patient_id": pid})
    db.appointments.delete_many({"patient_id": pid})
    db.test_sessions.delete_many({"patient_id": pid})
    db.patient_merge_events.delete_many({
        "$or": [{"primary_patient_id": pid}, {"secondary_patient_id": pid}]
    })


# ═════════════════════════════════════════════════════════════════════
# F-006 · Reports tenant-query hardening
# ═════════════════════════════════════════════════════════════════════

def test_F006_1_same_clinic_share_audit_returns_200(token, db, clinic_id, synth_patient):
    """Same-clinic session → share-audit 200 (returns list of audit rows)."""
    sid = _seed_session_direct(db, clinic_id=clinic_id, patient_id=synth_patient["patient_id"])
    try:
        r = requests.get(f"{API}/reports/{sid}/share-audit", headers=H(token), timeout=15)
        assert r.status_code == 200, f"same-clinic share-audit should 200, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert isinstance(body, list), f"share-audit should return a list, got {type(body)}"
    finally:
        db.test_sessions.delete_one({"session_id": sid})


def test_F006_2_foreign_session_share_audit_returns_404_not_403(token, db):
    """Foreign session_id → 404. Pre-fix returned 403 (revealed existence).
    Post-fix returns 404, indistinguishable from a non-existent session_id."""
    foreign_clinic = f"clinic-nav006-p2a-{uuid.uuid4().hex[:6]}"
    foreign_pid = _seed_patient_direct(db, clinic_id=foreign_clinic, tag="foreign")
    foreign_sid = _seed_session_direct(
        db, clinic_id=foreign_clinic, patient_id=foreign_pid, tag="-FOREIGN"
    )
    try:
        r = requests.get(f"{API}/reports/{foreign_sid}/share-audit", headers=H(token), timeout=15)
        assert r.status_code == 404, (
            f"foreign session must 404, not 403. got {r.status_code}: {r.text[:200]}"
        )
        assert "not found" in r.json().get("detail", "").lower()
    finally:
        db.test_sessions.delete_one({"session_id": foreign_sid})
        db.patients.delete_one({"patient_id": foreign_pid})


def test_F006_3_pdf_endpoint_foreign_session_returns_404(token, db):
    """`GET /reports/{sid}/pdf` on a foreign session → 404 (not 403)."""
    foreign_clinic = f"clinic-nav006-p2a-{uuid.uuid4().hex[:6]}"
    foreign_pid = _seed_patient_direct(db, clinic_id=foreign_clinic, tag="foreign-pdf")
    foreign_sid = _seed_session_direct(
        db, clinic_id=foreign_clinic, patient_id=foreign_pid, tag="-PDF"
    )
    try:
        r = requests.get(f"{API}/reports/{foreign_sid}/pdf", headers=H(token),
                         timeout=15, allow_redirects=False)
        assert r.status_code == 404, (
            f"foreign PDF must 404, got {r.status_code}: {r.text[:200]}"
        )
    finally:
        db.test_sessions.delete_one({"session_id": foreign_sid})
        db.patients.delete_one({"patient_id": foreign_pid})


def test_F006_4_hearing_report_save_foreign_session_returns_404(token, db):
    """`POST /hearing-reports/save` on a foreign session → 404 (not 403)."""
    foreign_clinic = f"clinic-nav006-p2a-{uuid.uuid4().hex[:6]}"
    foreign_pid = _seed_patient_direct(db, clinic_id=foreign_clinic, tag="foreign-hrs")
    foreign_sid = _seed_session_direct(
        db, clinic_id=foreign_clinic, patient_id=foreign_pid, tag="-HRS"
    )
    try:
        r = requests.post(
            f"{API}/hearing-reports/save", headers=H(token),
            json={"session_id": foreign_sid, "kind": "audiogram",
                  "state": {"note": "attempt cross-tenant write"}},
            timeout=15,
        )
        assert r.status_code == 404, (
            f"foreign hearing-report save must 404, got {r.status_code}: {r.text[:200]}"
        )
    finally:
        db.test_sessions.delete_one({"session_id": foreign_sid})
        db.patients.delete_one({"patient_id": foreign_pid})


def test_F006_5_unknown_session_id_returns_404(token):
    """Unknown session_id → 404 (indistinguishable from a foreign session)."""
    r = requests.get(
        f"{API}/reports/SES-{TAG_PREFIX}-NEVER-EXISTED-{uuid.uuid4().hex[:6]}/share-audit",
        headers=H(token), timeout=15,
    )
    assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# F-013 · Direct session tenant guard in report_handover
# ═════════════════════════════════════════════════════════════════════

def test_F013_1_foreign_report_pdf_upload_returns_404(token, db):
    """`POST /sessions/{sid}/report-pdf` on a foreign session → 404
    (previously 403 based on patient.clinic; now 404 based on
    session.clinic_id directly)."""
    foreign_clinic = f"clinic-nav006-p2a-{uuid.uuid4().hex[:6]}"
    foreign_pid = _seed_patient_direct(db, clinic_id=foreign_clinic, tag="handover")
    foreign_sid = _seed_session_direct(
        db, clinic_id=foreign_clinic, patient_id=foreign_pid, tag="-HANDOVER"
    )
    try:
        r = requests.post(
            f"{API}/sessions/{foreign_sid}/report-pdf",
            headers=H(token),
            files={"file": ("t.pdf", b"%PDF-1.4 test", "application/pdf")},
            timeout=15,
        )
        assert r.status_code == 404, (
            f"foreign session report-pdf must 404, got {r.status_code}: {r.text[:200]}"
        )
    finally:
        db.test_sessions.delete_one({"session_id": foreign_sid})
        db.patients.delete_one({"patient_id": foreign_pid})


def test_F013_2_foreign_generate_report_returns_404(token, db):
    """`POST /sessions/{sid}/generate-report` — same F-013 fix path."""
    foreign_clinic = f"clinic-nav006-p2a-{uuid.uuid4().hex[:6]}"
    foreign_pid = _seed_patient_direct(db, clinic_id=foreign_clinic, tag="gen-report")
    foreign_sid = _seed_session_direct(
        db, clinic_id=foreign_clinic, patient_id=foreign_pid, tag="-GEN"
    )
    try:
        r = requests.post(f"{API}/sessions/{foreign_sid}/generate-report",
                          headers=H(token), timeout=15)
        assert r.status_code == 404, (
            f"foreign generate-report must 404, got {r.status_code}: {r.text[:200]}"
        )
    finally:
        db.test_sessions.delete_one({"session_id": foreign_sid})
        db.patients.delete_one({"patient_id": foreign_pid})


def test_F013_3_missing_patient_does_not_gate_same_clinic_reports(token, db, clinic_id):
    """A same-clinic session whose linked patient is HARD-DELETED must NOT
    surface as a 403 / cross-tenant lock. The session's own clinic_id is
    the authoritative gate (F-013)."""
    ghost_pid = f"GHOST-{uuid.uuid4().hex[:8]}"
    sid = _seed_session_direct(db, clinic_id=clinic_id, patient_id=ghost_pid, tag="-GHOST")
    try:
        # Sanity: reports list for this patient still works (returns [], not 403).
        r = requests.get(f"{API}/reports?patient_id={ghost_pid}",
                         headers=H(token), timeout=15)
        assert r.status_code == 200, (
            f"missing patient must not gate legitimate same-clinic queries. "
            f"got {r.status_code}: {r.text[:200]}"
        )
    finally:
        db.test_sessions.delete_one({"session_id": sid})


# ═════════════════════════════════════════════════════════════════════
# F-007 · Merged-patient resolution
# ═════════════════════════════════════════════════════════════════════
#
# We test the resolver's Python API directly via asyncio.run() — this
# exercises the merge / merged-into chain / cross-clinic guard logic
# without needing HTTP fixtures. Follows the codebase convention
# established in test_nav005_sprint3a_merge_and_isolation.py.


def _run_resolver(session_doc: dict):
    """Sync wrapper around the async resolver — codebase convention."""
    from utils.patient_resolution import resolve_patient_for_session

    async def _go():
        db = _mongo_async()
        try:
            return await resolve_patient_for_session(db, session_doc)
        finally:
            db.client.close()

    return asyncio.run(_go())


def test_F007_1_direct_patient_resolves_normally(clinic_id, db):
    """Normal case: patient exists, no merge history → returns patient as-is."""
    pid = _seed_patient_direct(db, clinic_id=clinic_id, tag="direct")
    try:
        p = _run_resolver({"patient_id": pid, "clinic_id": clinic_id})
        assert p is not None, "direct patient must resolve"
        assert p["patient_id"] == pid
        assert p["clinic_id"] == clinic_id
    finally:
        db.patients.delete_one({"patient_id": pid})


def test_F007_2_secondary_via_merged_into_resolves_to_primary(clinic_id, db):
    """Direct hit is a merged secondary → follow chain to surviving primary."""
    primary = _seed_patient_direct(db, clinic_id=clinic_id, tag="primary")
    secondary = _seed_patient_direct(db, clinic_id=clinic_id, tag="secondary",
                                     extra={"merged_into": primary, "active": False})
    try:
        p = _run_resolver({"patient_id": secondary, "clinic_id": clinic_id})
        assert p is not None, "chain must resolve"
        assert p["patient_id"] == primary, (
            f"expected surviving primary, got {p['patient_id']}"
        )
    finally:
        db.patients.delete_one({"patient_id": primary})
        db.patients.delete_one({"patient_id": secondary})


def test_F007_3_chained_merge_resolves_to_final_surviving(clinic_id, db):
    """A → B → C: session references A → chain terminates at live C."""
    c = _seed_patient_direct(db, clinic_id=clinic_id, tag="C")
    b = _seed_patient_direct(db, clinic_id=clinic_id, tag="B",
                             extra={"merged_into": c, "active": False})
    a = _seed_patient_direct(db, clinic_id=clinic_id, tag="A",
                             extra={"merged_into": b, "active": False})
    try:
        p = _run_resolver({"patient_id": a, "clinic_id": clinic_id})
        assert p is not None
        assert p["patient_id"] == c, f"chain should resolve to C, got {p['patient_id']}"
    finally:
        for pid in (a, b, c):
            db.patients.delete_one({"patient_id": pid})


def test_F007_4_undone_merge_does_not_steer_to_stale_primary(clinic_id, db):
    """After merge undo, `patients.merged_into` is $unset — chain stops
    at the (now-live-again) secondary. Even if a stale merge_event with
    `undone_at` set exists, it must be ignored."""
    a = _seed_patient_direct(db, clinic_id=clinic_id, tag="A-undone")
    db.patient_merge_events.insert_one({
        "event_id": f"EVT-{TAG_PREFIX}-{uuid.uuid4().hex[:6]}",
        "clinic_id": clinic_id,
        "primary_patient_id": "STALE-PRIMARY-DO-NOT-USE",
        "secondary_patient_id": a,
        "merged_at": datetime.now(timezone.utc),
        "undone_at": datetime.now(timezone.utc),  # ← undone
    })
    try:
        p = _run_resolver({"patient_id": a, "clinic_id": clinic_id})
        assert p is not None
        # Direct find_one succeeds (A exists, no merged_into) → step 2 never
        # runs → we should NOT resolve to STALE-PRIMARY.
        assert p["patient_id"] == a, (
            f"undone merge must not steer to stale primary; got {p['patient_id']}"
        )
    finally:
        db.patients.delete_one({"patient_id": a})
        db.patient_merge_events.delete_many({"secondary_patient_id": a})


def test_F007_5_missing_target_returns_none(clinic_id):
    """Genuinely orphaned: no patient row, no merge event → None → caller
    falls back to UNKNOWN."""
    ghost = f"GHOST-{uuid.uuid4().hex[:8]}"
    p = _run_resolver({"patient_id": ghost, "clinic_id": clinic_id})
    assert p is None, f"orphan should not resolve; got {p!r}"


def test_F007_6_patient_in_another_clinic_is_never_returned(clinic_id, db):
    """A patient exists but in ANOTHER clinic → must NOT be returned."""
    foreign_clinic = f"clinic-nav006-p2a-{uuid.uuid4().hex[:6]}"
    foreign_pid = _seed_patient_direct(db, clinic_id=foreign_clinic, tag="foreign-only")
    try:
        # session claims clinic_id=clinic_id but the patient row is under
        # foreign_clinic — the resolver must not return it.
        p = _run_resolver({"patient_id": foreign_pid, "clinic_id": clinic_id})
        assert p is None, (
            "resolver must NOT return a patient from a different clinic; "
            f"got {p!r}"
        )
    finally:
        db.patients.delete_one({"patient_id": foreign_pid})


def test_F007_7_cross_clinic_merge_event_is_ignored(clinic_id, db):
    """A merge event whose clinic_id != session.clinic_id must not
    resolve — even if it references a live primary in the caller's
    clinic."""
    primary = _seed_patient_direct(db, clinic_id=clinic_id, tag="X-primary")
    ghost_secondary = f"GHOST-{uuid.uuid4().hex[:6]}"
    foreign_clinic = f"clinic-nav006-p2a-{uuid.uuid4().hex[:6]}"
    db.patient_merge_events.insert_one({
        "event_id": f"EVT-{TAG_PREFIX}-{uuid.uuid4().hex[:6]}",
        "clinic_id": foreign_clinic,   # ← different clinic
        "primary_patient_id": primary,
        "secondary_patient_id": ghost_secondary,
        "merged_at": datetime.now(timezone.utc),
        "undone_at": None,
    })
    try:
        p = _run_resolver({"patient_id": ghost_secondary, "clinic_id": clinic_id})
        assert p is None, (
            "cross-clinic merge event must not resolve. "
            f"got: {p!r}"
        )
    finally:
        db.patients.delete_one({"patient_id": primary})
        db.patient_merge_events.delete_many({"secondary_patient_id": ghost_secondary})


def test_F007_8_hard_deleted_patient_recovered_via_merge_events(clinic_id, db):
    """A hard-deleted secondary with a live non-undone merge event →
    resolver returns the primary via the merge log."""
    primary = _seed_patient_direct(db, clinic_id=clinic_id, tag="live-primary")
    ghost_secondary = f"GHOST-DEL-{uuid.uuid4().hex[:6]}"
    # No patient row for ghost_secondary — simulates hard-delete post-merge
    db.patient_merge_events.insert_one({
        "event_id": f"EVT-{TAG_PREFIX}-{uuid.uuid4().hex[:6]}",
        "clinic_id": clinic_id,
        "primary_patient_id": primary,
        "secondary_patient_id": ghost_secondary,
        "merged_at": datetime.now(timezone.utc),
        "undone_at": None,
    })
    try:
        p = _run_resolver({"patient_id": ghost_secondary, "clinic_id": clinic_id})
        assert p is not None, "merge-log fallback should resolve to primary"
        assert p["patient_id"] == primary
    finally:
        db.patients.delete_one({"patient_id": primary})
        db.patient_merge_events.delete_many({"secondary_patient_id": ghost_secondary})
