"""NAV-006 Sprint-P1 regression suite.

Covers the two P1 findings approved for this sprint:

  F-001  — Diagnostics Queue must dedupe by (patient_id, appointment_id),
           not by patient_id alone. Two same-day appointments for the
           same patient must appear as TWO Kanban cards; a token that
           shadows an appointment must still MERGE into that single
           card (unambiguous same-visit); a walk-in with no appointment
           must remain its own card.

  F-002  — POST /api/sessions must fail hard with 404 when the caller
           supplies an appointment_id that cannot be resolved in the
           caller's clinic (unknown OR foreign). Previously the
           endpoint silently substituted an auto-discovered same-day
           appointment, turning the session's `appointment_id` into a
           lie.

Design notes
------------
* Uses TEST DATA ONLY — every artefact is prefixed `TEST_S006_<uuid>` so
  a search after a full pytest run yields 0 leftovers on a clean tenant.
* Direct-DB writes (via sync `pymongo`) are used for the cross-tenant
  case (seeding an appointment inside a second clinic without needing
  a second HTTP-login), because `POST /api/appointments` is out of
  scope for this sprint.
* The suite is self-contained: it does not depend on demo seed data
  (i.e. `DISABLE_DEMO_SEED=1` is fine).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
import requests

from _helpers import (
    API, H, login,
    ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_CLINIC_ID,
)

TAG_PREFIX = "TEST_S006"


# ─── Direct DB helper ─────────────────────────────────────────────────
def _mongo():
    """Sync pymongo Database handle bound to the same MONGO_URL the app uses."""
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ─── Fixtures ─────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def token() -> str:
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def db():
    return _mongo()


@pytest.fixture(scope="module")
def clinic_id() -> str:
    return ADMIN_CLINIC_ID


@pytest.fixture()
def patient(token: str, db) -> dict:
    """Create a fresh patient inside the caller's clinic and return it.
    Hard-deletes it after the test to keep the tenant clean.
    """
    tag = f"{TAG_PREFIX}_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/patients",
        headers=H(token),
        json={"name": f"{tag} Patient", "age": 42, "gender": "Male", "mobile": None},
        timeout=15,
    )
    assert r.status_code in (200, 201), f"patient create failed: {r.status_code} {r.text[:200]}"
    p = r.json()
    yield p
    # teardown
    db.patients.delete_one({"patient_id": p["patient_id"]})
    db.appointments.delete_many({"patient_id": p["patient_id"]})
    db.test_sessions.delete_many({"patient_id": p["patient_id"]})
    db.tokens.delete_many({"patient_id": p["patient_id"]})


def _seed_appointment(
    db,
    *,
    clinic_id: str,
    patient_id: str,
    start_at_iso: str,
    status: str = "scheduled",
    tag_suffix: str = "",
) -> str:
    """Insert an appointment directly and return its appointment_id."""
    aid = f"APT-{TAG_PREFIX}-{uuid.uuid4().hex[:10]}{tag_suffix}"
    db.appointments.insert_one({
        "appointment_id": aid,
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "patient_name": f"{TAG_PREFIX} Patient",
        "start_at": start_at_iso,
        "status": status,
        "service": "PTA",
        "priority": "normal",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return aid


def _ist_today_ymd() -> str:
    """UTC-based today prefix — matches server behaviour (test_sessions.py:50)."""
    return datetime.utcnow().strftime("%Y-%m-%d")


def _iso_today_at(hour: int, minute: int = 0) -> str:
    y = _ist_today_ymd()
    return f"{y}T{hour:02d}:{minute:02d}:00"


# ══════════════════════════════════════════════════════════════════════
# F-001 · QUEUE DEDUPE — (patient_id, appointment_id)
# ══════════════════════════════════════════════════════════════════════

def test_F001_two_appointments_same_patient_show_as_two_cards(
    token, db, clinic_id, patient
):
    """Same patient + two DISTINCT appointment_ids today → 2 queue cards."""
    a1 = _seed_appointment(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"],
        start_at_iso=_iso_today_at(9), status="scheduled", tag_suffix="-M",
    )
    a2 = _seed_appointment(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"],
        start_at_iso=_iso_today_at(15), status="scheduled", tag_suffix="-A",
    )
    r = requests.get(f"{API}/diagnostics/queue", headers=H(token), timeout=15)
    assert r.status_code == 200, f"queue GET failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    all_rows = [row for col in data["columns"].values() for row in col]
    mine = [row for row in all_rows if row["patient_id"] == patient["patient_id"]]
    assert len(mine) == 2, f"expected 2 cards for the same patient, got {len(mine)}: {mine!r}"
    appt_ids = {row.get("appointment_id") for row in mine}
    assert appt_ids == {a1, a2}, f"expected both appointment_ids on the cards, got {appt_ids}"


def test_F001_same_appointment_via_multiple_sources_stays_one_card(
    token, db, clinic_id, patient
):
    """Appointment + token (same visit, no ambiguity) → 1 card, not 2."""
    aid = _seed_appointment(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"],
        start_at_iso=_iso_today_at(10), status="scheduled",
    )
    # Simulate a token issued by the front desk for the same patient today
    # (tokens carry NO appointment_id — the collapse must happen server-side).
    db.tokens.insert_one({
        "token_id": f"TK-{TAG_PREFIX}-{uuid.uuid4().hex[:8]}",
        "clinic_id": clinic_id,
        "patient_id": patient["patient_id"],
        "patient_name": f"{TAG_PREFIX} Patient",
        "token_no": 42,
        "service": "PTA",
        "priority": "normal",
        "status": "waiting",
        "issued_at": datetime.now(timezone.utc).isoformat(),
    })

    r = requests.get(f"{API}/diagnostics/queue", headers=H(token), timeout=15)
    assert r.status_code == 200
    all_rows = [row for col in r.json()["columns"].values() for row in col]
    mine = [row for row in all_rows if row["patient_id"] == patient["patient_id"]]
    assert len(mine) == 1, (
        f"token + single appointment same day should collapse to 1 card, got {len(mine)}: {mine!r}"
    )
    # And the surviving card must carry BOTH the token_id AND the appointment_id
    # so /start can dispatch to the right appointment.
    row = mine[0]
    assert row.get("appointment_id") == aid, f"card must retain the appointment_id, got {row!r}"


def test_F001_different_patients_stay_separate(token, db, clinic_id):
    """Two DIFFERENT patients each with 1 appointment → 2 separate cards."""
    # Two patients, minimal
    def _mk_patient(tag: str) -> dict:
        r = requests.post(
            f"{API}/patients", headers=H(token),
            json={"name": f"{TAG_PREFIX}_{tag}", "age": 40, "gender": "Female"},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text[:200]
        return r.json()

    p1 = _mk_patient("P1")
    p2 = _mk_patient("P2")
    try:
        a1 = _seed_appointment(db, clinic_id=clinic_id, patient_id=p1["patient_id"],
                               start_at_iso=_iso_today_at(11), status="scheduled")
        a2 = _seed_appointment(db, clinic_id=clinic_id, patient_id=p2["patient_id"],
                               start_at_iso=_iso_today_at(11), status="scheduled")

        r = requests.get(f"{API}/diagnostics/queue", headers=H(token), timeout=15)
        assert r.status_code == 200
        all_rows = [row for col in r.json()["columns"].values() for row in col]
        found = {row["patient_id"] for row in all_rows if row["patient_id"] in (p1["patient_id"], p2["patient_id"])}
        assert found == {p1["patient_id"], p2["patient_id"]}, (
            f"expected both patients on the board separately, got {found}"
        )
    finally:
        for pid in (p1["patient_id"], p2["patient_id"]):
            db.patients.delete_one({"patient_id": pid})
            db.appointments.delete_many({"patient_id": pid})


def test_F001_walkin_without_appointment_remains_visible(token, db, clinic_id, patient):
    """Walk-in (token only, no appointment) → 1 walk-in card."""
    db.tokens.insert_one({
        "token_id": f"TK-{TAG_PREFIX}-{uuid.uuid4().hex[:8]}",
        "clinic_id": clinic_id,
        "patient_id": patient["patient_id"],
        "patient_name": f"{TAG_PREFIX} Patient",
        "token_no": 7,
        "service": "Consultation",
        "priority": "normal",
        "status": "waiting",
        "issued_at": datetime.now(timezone.utc).isoformat(),
    })

    r = requests.get(f"{API}/diagnostics/queue", headers=H(token), timeout=15)
    assert r.status_code == 200
    all_rows = [row for col in r.json()["columns"].values() for row in col]
    mine = [row for row in all_rows if row["patient_id"] == patient["patient_id"]]
    assert len(mine) == 1, f"walk-in must appear once, got {len(mine)}: {mine!r}"
    # A pure walk-in has no appointment_id
    assert not mine[0].get("appointment_id"), f"walk-in card must NOT carry an appointment_id"


def test_F001_start_endpoint_associates_session_with_specific_appointment(
    token, db, clinic_id, patient
):
    """`/queue/start` with an explicit appointment_id must attach the newly-created
    session to THAT appointment. F-001 requirement #6 & #7."""
    a1 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_iso_today_at(9), status="scheduled")
    a2 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_iso_today_at(15), status="scheduled")

    r = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a2},
        timeout=15,
    )
    assert r.status_code == 200, f"start failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    session_id = body["session_id"]
    # The persisted session MUST carry a2, not a1
    sess = db.test_sessions.find_one({"session_id": session_id})
    assert sess is not None, f"session {session_id} not persisted"
    assert sess.get("appointment_id") == a2, (
        f"session was linked to the wrong appointment: expected {a2}, got {sess.get('appointment_id')}"
    )
    # cleanup
    db.test_sessions.delete_one({"session_id": session_id})


# ══════════════════════════════════════════════════════════════════════
# F-002 · POST /api/sessions — fail hard on foreign / invalid appointment_id
# ══════════════════════════════════════════════════════════════════════

def test_F002_case_A_no_appointment_id_auto_discovers(token, db, clinic_id, patient):
    """CASE A: appointment_id omitted → auto-discover today's appointment."""
    a = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                          start_at_iso=_iso_today_at(11), status="scheduled")
    r = requests.post(
        f"{API}/sessions", headers=H(token),
        json={
            "patient_id": patient["patient_id"],
            "audiologist_name": "Dr. Test",
            "test_reliability": "good",
            "test_methods": ["headphones"],
        },
        timeout=15,
    )
    assert r.status_code in (200, 201), f"expected success, got {r.status_code} {r.text[:200]}"
    body = r.json()
    session_id = body["session_id"]
    sess = db.test_sessions.find_one({"session_id": session_id})
    assert sess.get("appointment_id") == a, (
        f"auto-discover should have linked to today's appointment {a}, got {sess.get('appointment_id')}"
    )
    db.test_sessions.delete_one({"session_id": session_id})


def test_F002_case_B_valid_same_clinic_appointment_links(token, db, clinic_id, patient):
    """CASE B: valid same-clinic appointment_id → linked verbatim."""
    _ = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                          start_at_iso=_iso_today_at(9), status="scheduled")
    target = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                               start_at_iso=_iso_today_at(15), status="scheduled")
    r = requests.post(
        f"{API}/sessions", headers=H(token),
        json={
            "patient_id": patient["patient_id"],
            "appointment_id": target,
            "audiologist_name": "Dr. Test",
            "test_reliability": "good",
            "test_methods": ["headphones"],
        },
        timeout=15,
    )
    assert r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}"
    session_id = r.json()["session_id"]
    sess = db.test_sessions.find_one({"session_id": session_id})
    assert sess.get("appointment_id") == target, (
        f"session must be linked to the SUPPLIED appointment {target}, got {sess.get('appointment_id')}"
    )
    db.test_sessions.delete_one({"session_id": session_id})


def test_F002_case_C_unknown_appointment_id_returns_404(token, patient, db):
    """CASE C: appointment_id that does NOT exist anywhere → 404, no session created."""
    bogus = f"APT-{TAG_PREFIX}-DOES-NOT-EXIST-{uuid.uuid4().hex[:6]}"
    before = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
    r = requests.post(
        f"{API}/sessions", headers=H(token),
        json={
            "patient_id": patient["patient_id"],
            "appointment_id": bogus,
            "audiologist_name": "Dr. Test",
            "test_reliability": "good",
            "test_methods": ["headphones"],
        },
        timeout=15,
    )
    assert r.status_code == 404, (
        f"unknown appointment_id must be rejected 404, got {r.status_code} {r.text[:200]}"
    )
    body = r.json()
    assert "not found" in body.get("detail", "").lower(), (
        f"detail must mention 'not found', got {body!r}"
    )
    after = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
    assert after == before, (
        f"no session should have been created; before={before} after={after}"
    )


def test_F002_case_D_foreign_clinic_appointment_returns_404(token, db, patient):
    """CASE D: appointment_id belonging to ANOTHER clinic → 404 (same message as C).
    We do NOT reveal whether the foreign appointment exists."""
    foreign_clinic = "clinic-nav006-foreign-decoy"
    foreign_appt = _seed_appointment(
        db, clinic_id=foreign_clinic, patient_id=patient["patient_id"],
        start_at_iso=_iso_today_at(12), status="scheduled", tag_suffix="-FOREIGN",
    )
    try:
        before = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
        r = requests.post(
            f"{API}/sessions", headers=H(token),
            json={
                "patient_id": patient["patient_id"],
                "appointment_id": foreign_appt,
                "audiologist_name": "Dr. Test",
                "test_reliability": "good",
                "test_methods": ["headphones"],
            },
            timeout=15,
        )
        assert r.status_code == 404, (
            f"foreign appointment_id must be rejected 404, got {r.status_code} {r.text[:200]}"
        )
        body = r.json()
        # Same detail string as the unknown case — no info leak about foreign existence.
        assert body.get("detail", "").lower() == "appointment not found in this clinic.", (
            f"detail must be a fixed non-revealing string; got {body!r}"
        )
        after = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
        assert after == before, "no session should have been created for a foreign appointment"
    finally:
        db.appointments.delete_one({"appointment_id": foreign_appt})


def test_F002_case_E_malformed_appointment_id_returns_404(token, patient, db):
    """CASE E: malformed appointment_id (garbage) → 404."""
    before = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
    r = requests.post(
        f"{API}/sessions", headers=H(token),
        json={
            "patient_id": patient["patient_id"],
            "appointment_id": "%%%not-a-valid-id%%%",
            "audiologist_name": "Dr. Test",
            "test_reliability": "good",
            "test_methods": ["headphones"],
        },
        timeout=15,
    )
    assert r.status_code == 404, f"malformed appointment_id must be rejected 404, got {r.status_code} {r.text[:200]}"
    after = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
    assert after == before, "no session should have been created for a malformed appointment_id"


def test_F002_verify_no_substitute_appointment_selected_for_foreign_id(
    token, db, clinic_id, patient
):
    """Belt-and-braces: even when a SAME-CLINIC same-day appointment exists,
    supplying a FOREIGN appointment_id must NOT silently substitute it."""
    # Same-clinic decoy for THIS patient today — the pre-fix behaviour would
    # have quietly picked this one when a foreign id was supplied.
    same_clinic_decoy = _seed_appointment(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"],
        start_at_iso=_iso_today_at(10), status="scheduled", tag_suffix="-DECOY",
    )
    # Foreign appointment for the same patient in another clinic
    foreign_clinic = "clinic-nav006-foreign-decoy-2"
    foreign_appt = _seed_appointment(
        db, clinic_id=foreign_clinic, patient_id=patient["patient_id"],
        start_at_iso=_iso_today_at(13), status="scheduled", tag_suffix="-FOREIGN-2",
    )
    try:
        before = db.test_sessions.count_documents({
            "patient_id": patient["patient_id"], "appointment_id": same_clinic_decoy
        })
        r = requests.post(
            f"{API}/sessions", headers=H(token),
            json={
                "patient_id": patient["patient_id"],
                "appointment_id": foreign_appt,
                "audiologist_name": "Dr. Test",
                "test_reliability": "good",
                "test_methods": ["headphones"],
            },
            timeout=15,
        )
        assert r.status_code == 404, (
            f"expected 404 refusing to silently substitute; got {r.status_code} {r.text[:200]}"
        )
        after = db.test_sessions.count_documents({
            "patient_id": patient["patient_id"], "appointment_id": same_clinic_decoy
        })
        assert after == before, (
            "the same-clinic decoy appointment must NOT have been silently attached; "
            f"before={before} after={after}"
        )
    finally:
        db.appointments.delete_one({"appointment_id": foreign_appt})
