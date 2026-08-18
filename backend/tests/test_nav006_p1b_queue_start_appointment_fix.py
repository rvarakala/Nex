"""NAV-006 Sprint-P1B regression suite — /api/diagnostics/queue/start
appointment / session linkage hardening.

Covers the two F-002-sibling defects discovered on `/queue/start`:

  B1  — Silent appointment substitution when caller supplies a foreign
        or invalid `appointment_id`. The pre-fix endpoint fell through
        to an auto-discovered same-day appointment and linked the
        resulting session to that substitute instead of failing hard.

  B2  — Draft-session reuse across appointments. The pre-fix endpoint
        found ANY draft for this patient today at this clinic
        (appointment-agnostic) and reused it — silently writing A2's
        inputs into A1's session document.

Test matrix (mirrors the 8 acceptance criteria):
  1. Explicit valid same-clinic appointment → exact appointment retained.
  2. Explicit invalid appointment_id       → 404.
  3. Explicit foreign appointment_id       → 404.
  4. Explicit foreign appointment_id       → NO auto-discovery, no
     substitution.
  5. No appointment_id                     → auto-discovery keeps working.
  6. Two same-day appointments             → starting each yields the
     correct appointment-specific session (no cross-contamination).
  7. Existing draft for A1                 → starting A2 does NOT reuse
     it (bug B2 no longer triggers).
  8. Repeated start of A1                  → idempotent, same draft
     returned.
"""
from __future__ import annotations

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

TAG_PREFIX = "TEST_S006B"


def _mongo():
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


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
    """Fresh patient inside the caller's clinic; teardown deletes every
    artefact so the burner tenant stays clean."""
    tag = f"{TAG_PREFIX}_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/patients", headers=H(token),
        json={"name": f"{tag} Patient", "age": 42, "gender": "Male"},
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text[:200]
    p = r.json()
    yield p
    pid = p["patient_id"]
    db.patients.delete_one({"patient_id": pid})
    db.appointments.delete_many({"patient_id": pid})
    db.test_sessions.delete_many({"patient_id": pid})
    db.tokens.delete_many({"patient_id": pid})


def _seed_appointment(db, *, clinic_id, patient_id, start_at_iso, status="scheduled", tag=""):
    aid = f"APT-{TAG_PREFIX}-{uuid.uuid4().hex[:10]}{tag}"
    db.appointments.insert_one({
        "appointment_id": aid,
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "patient_name": f"{TAG_PREFIX} Patient",
        "start_at": start_at_iso,
        "status": status,
        "service": "PTA",
        "priority": "normal",
        "recommended_tests": ["PTA"],
        # `visit_type` on TestSession is a Literal['referral','walkin','consultation'];
        # 'consultation' is the closest match for a routine diagnostic slot.
        "visit_type": "consultation",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return aid


def _today_at(hour, minute=0):
    return f"{datetime.utcnow().strftime('%Y-%m-%d')}T{hour:02d}:{minute:02d}:00"


# ══════════════════════════════════════════════════════════════════════
# B1 · Silent appointment substitution
# ══════════════════════════════════════════════════════════════════════

def test_B1_1_valid_same_clinic_appointment_id_is_linked_verbatim(
    token, db, clinic_id, patient
):
    """Case B: explicit same-clinic appointment_id → session linked to it exactly."""
    a1 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(9), tag="-A1")
    a2 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(15), tag="-A2")
    r = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a2},
        timeout=15,
    )
    assert r.status_code == 200, r.text[:200]
    sid = r.json()["session_id"]
    doc = db.test_sessions.find_one({"session_id": sid})
    assert doc["appointment_id"] == a2, (
        f"session must be linked to the supplied {a2}, got {doc['appointment_id']}"
    )
    db.test_sessions.delete_one({"session_id": sid})


def test_B1_2_unknown_appointment_id_returns_404(token, db, patient):
    """Case C: appointment_id that does not exist anywhere → 404."""
    bogus = f"APT-{TAG_PREFIX}-DOES-NOT-EXIST-{uuid.uuid4().hex[:6]}"
    before = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
    r = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": bogus},
        timeout=15,
    )
    assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text[:200]}"
    assert "not found" in r.json().get("detail", "").lower()
    after = db.test_sessions.count_documents({"patient_id": patient["patient_id"]})
    assert after == before, "no session should have been created"


def test_B1_3_foreign_clinic_appointment_id_returns_404(token, db, clinic_id, patient):
    """Case D: appointment_id belonging to another clinic → 404, non-revealing."""
    foreign = _seed_appointment(
        db, clinic_id="clinic-nav006b-foreign-decoy",
        patient_id=patient["patient_id"], start_at_iso=_today_at(11),
        tag="-FOREIGN",
    )
    try:
        r = requests.post(
            f"{API}/diagnostics/queue/start", headers=H(token),
            json={"patient_id": patient["patient_id"], "appointment_id": foreign},
            timeout=15,
        )
        assert r.status_code == 404, r.text[:200]
        # detail must be a fixed non-revealing string
        assert r.json().get("detail", "").lower() == "appointment not found in this clinic."
    finally:
        db.appointments.delete_one({"appointment_id": foreign})


def test_B1_4_foreign_appointment_id_does_not_trigger_auto_discovery(
    token, db, clinic_id, patient
):
    """Belt-and-braces: even when a SAME-CLINIC same-day appointment exists,
    supplying a foreign id must NOT silently substitute the same-clinic decoy."""
    decoy = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                              start_at_iso=_today_at(10), tag="-DECOY")
    foreign = _seed_appointment(
        db, clinic_id="clinic-nav006b-foreign-decoy-2",
        patient_id=patient["patient_id"], start_at_iso=_today_at(13),
        tag="-FOREIGN2",
    )
    try:
        before = db.test_sessions.count_documents({
            "patient_id": patient["patient_id"], "appointment_id": decoy
        })
        r = requests.post(
            f"{API}/diagnostics/queue/start", headers=H(token),
            json={"patient_id": patient["patient_id"], "appointment_id": foreign},
            timeout=15,
        )
        assert r.status_code == 404, r.text[:200]
        after = db.test_sessions.count_documents({
            "patient_id": patient["patient_id"], "appointment_id": decoy
        })
        assert after == before, (
            f"decoy appointment must NOT have been silently attached; before={before} after={after}"
        )
    finally:
        db.appointments.delete_one({"appointment_id": foreign})


def test_B1_5_no_appointment_id_supplied_auto_discovers(token, db, clinic_id, patient):
    """Case A: omit appointment_id → auto-discover today's appointment (unchanged)."""
    a = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                          start_at_iso=_today_at(9), tag="-AUTO")
    r = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"]},   # ← no appointment_id
        timeout=15,
    )
    assert r.status_code == 200, r.text[:200]
    sid = r.json()["session_id"]
    doc = db.test_sessions.find_one({"session_id": sid})
    assert doc["appointment_id"] == a, (
        f"auto-discovered {a}, got {doc['appointment_id']}"
    )
    db.test_sessions.delete_one({"session_id": sid})


# ══════════════════════════════════════════════════════════════════════
# B2 · Draft-session reuse across appointments
# ══════════════════════════════════════════════════════════════════════

def test_B2_6_two_same_day_appointments_yield_two_distinct_sessions(
    token, db, clinic_id, patient
):
    """The critical patient-safety test: same patient, 2 appointments today
    → starting each yields DIFFERENT session_ids, each linked to its own
    appointment. Never lets afternoon test data overwrite morning."""
    a1 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(9), tag="-MORN")
    a2 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(15), tag="-AFTN")

    # Morning visit
    r1 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a1},
        timeout=15,
    )
    assert r1.status_code == 200
    s1_id = r1.json()["session_id"]

    # Simulate some morning-visit test data being saved
    db.test_sessions.update_one({"session_id": s1_id}, {"$set": {"pta_notes": "morning A1 data"}})

    # Afternoon visit — MUST get a different session
    r2 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a2},
        timeout=15,
    )
    assert r2.status_code == 200
    s2_id = r2.json()["session_id"]

    assert s1_id != s2_id, (
        f"CRITICAL: afternoon click reused morning's session {s1_id} — B2 bug still present"
    )

    s1_doc = db.test_sessions.find_one({"session_id": s1_id})
    s2_doc = db.test_sessions.find_one({"session_id": s2_id})
    assert s1_doc["appointment_id"] == a1, f"morning session must stay linked to {a1}"
    assert s2_doc["appointment_id"] == a2, f"afternoon session must be linked to {a2}"
    assert s1_doc.get("pta_notes") == "morning A1 data", (
        "morning session data must NOT have been overwritten by the afternoon start"
    )


def test_B2_7_existing_walkin_draft_is_not_reused_for_a_specific_appointment(
    token, db, clinic_id, patient
):
    """Case E variant: a walk-in draft (appointment_id=None) exists. When the
    caller now supplies an explicit appointment_id, the walk-in draft must
    NOT be silently snapped to that appointment — a fresh session must be
    created."""
    # Manually insert a walk-in draft that predates today's appointment.
    walkin_sid = f"SES-{TAG_PREFIX}-WALKIN-{uuid.uuid4().hex[:6]}"
    db.test_sessions.insert_one({
        "session_id": walkin_sid,
        "clinic_id": clinic_id,
        "patient_id": patient["patient_id"],
        "appointment_id": None,
        "status": "draft",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "audiologist_name": "walk-in run",
        "test_reliability": "good",
        "test_methods": ["headphones"],
    })

    a1 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(10), tag="-APT")

    r = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a1},
        timeout=15,
    )
    assert r.status_code == 200, r.text[:200]
    new_sid = r.json()["session_id"]
    assert new_sid != walkin_sid, (
        "walk-in draft must NOT be reused for an explicit appointment start"
    )
    # walk-in draft must remain untouched
    walkin_still = db.test_sessions.find_one({"session_id": walkin_sid})
    assert walkin_still is not None, "walk-in draft was deleted unexpectedly"
    assert walkin_still.get("appointment_id") is None, (
        "walk-in draft must retain appointment_id=None"
    )
    # the new session must carry a1
    new_doc = db.test_sessions.find_one({"session_id": new_sid})
    assert new_doc.get("appointment_id") == a1


def test_B2_8_starting_same_appointment_twice_is_idempotent(
    token, db, clinic_id, patient
):
    """The good idempotency behaviour must survive: two consecutive starts
    of the SAME appointment_id return the SAME session_id."""
    a1 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(9), tag="-IDEM")

    r1 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a1},
        timeout=15,
    )
    r2 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a1},
        timeout=15,
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["session_id"] == r2.json()["session_id"], (
        "idempotent double-start on the SAME appointment must return the SAME session"
    )


def test_B2_9_pinned_session_id_wrong_appointment_falls_back_to_fresh_session(
    token, db, clinic_id, patient
):
    """Extra safety: if the caller pins a session_id that is tied to a
    DIFFERENT appointment than the one they now click, the endpoint must
    NOT reuse it — it must create a fresh session for the requested
    appointment."""
    a1 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(9), tag="-P1")
    a2 = _seed_appointment(db, clinic_id=clinic_id, patient_id=patient["patient_id"],
                           start_at_iso=_today_at(15), tag="-P2")

    # Start A1 to create a session S1 tied to A1
    r1 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": a1},
        timeout=15,
    )
    assert r1.status_code == 200
    s1_id = r1.json()["session_id"]

    # Now start A2 but pin S1 as the session_id — this should NOT reuse S1
    r2 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={
            "patient_id": patient["patient_id"],
            "appointment_id": a2,
            "session_id": s1_id,   # ← pinned to a different appointment
        },
        timeout=15,
    )
    assert r2.status_code == 200, r2.text[:200]
    s2_id = r2.json()["session_id"]
    assert s2_id != s1_id, (
        "pinned session tied to a different appointment must NOT be reused"
    )
    s2_doc = db.test_sessions.find_one({"session_id": s2_id})
    assert s2_doc.get("appointment_id") == a2, (
        f"new session must be linked to the requested appointment {a2}"
    )
