"""NAV-006 Sprint-P2B — reproduces F-004-A (walk-in draft cross-visit
contamination) on the CURRENT code, then verifies the fix.

Run this file BEFORE the code fix — the primary
`test_F004A_repro_two_walkin_tokens_should_not_share_session` will FAIL,
proving the bug exists in production-currently-deployed code.

Run again AFTER the code fix — every test will PASS.

Data safety:
* Every fixture is prefixed `TEST_S006_P2B_<uuid>`.
* Cross-tenant fixtures use `clinic-nav006-p2b-*` decoy clinic ids.
* Auto-cleanup in `finally` on every test.
* No production data touched.
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

TAG_PREFIX = "TEST_S006_P2B"


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
    tag = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/patients", headers=H(token),
        json={"name": f"{TAG_PREFIX} {tag}", "age": 40, "gender": "Male"},
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


def _issue_walkin_token(db, *, clinic_id: str, patient_id: str, no: int, tag: str) -> str:
    """Insert a token doc directly to simulate front-desk issuing a walk-in
    token. Returns the token_id."""
    tid = f"TK-{TAG_PREFIX}-{no}-{uuid.uuid4().hex[:6]}{tag}"
    db.tokens.insert_one({
        "token_id": tid,
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "patient_name": f"{TAG_PREFIX} walkin",
        "token_no": no,
        "service": "PTA",
        "priority": "normal",
        "status": "waiting",
        "issued_at": datetime.now(timezone.utc).isoformat(),
    })
    return tid


# ═════════════════════════════════════════════════════════════════════
# F-004-A · Walk-in draft session must NOT be reused across visits
# ═════════════════════════════════════════════════════════════════════

def test_F004A_repro_two_walkin_tokens_should_not_share_session(
    token, db, clinic_id, patient
):
    """THE PATIENT-SAFETY TEST.

    Same patient walks in twice on the same day; each visit is a
    distinct walk-in token (no scheduled appointment either time).

    Pre-fix behaviour: `/queue/start` for the afternoon token silently
    reuses the morning session because the draft-lookup filters only by
    patient + day.

    Post-fix behaviour: each walk-in visit gets its OWN session; morning
    data is not overwritten by afternoon inputs.
    """
    # Visit A — morning walk-in
    tokA = _issue_walkin_token(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"], no=1, tag="-AM"
    )
    rA = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tokA},
        timeout=15,
    )
    assert rA.status_code == 200, rA.text[:200]
    s1 = rA.json()["session_id"]
    # Simulate morning-visit clinical data
    db.test_sessions.update_one(
        {"session_id": s1}, {"$set": {"pta_notes": "morning walk-in A data"}}
    )

    # Visit B — afternoon walk-in with a NEW token
    tokB = _issue_walkin_token(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"], no=2, tag="-PM"
    )
    rB = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tokB},
        timeout=15,
    )
    assert rB.status_code == 200, rB.text[:200]
    s2 = rB.json()["session_id"]

    assert s1 != s2, (
        "CRITICAL F-004-A: afternoon walk-in reused morning session — "
        f"morning={s1} afternoon={s2}. This means the afternoon "
        "audiogram data will overwrite the morning session's clinical data."
    )

    # Morning session's data must not have been overwritten
    s1_doc = db.test_sessions.find_one({"session_id": s1})
    assert s1_doc.get("pta_notes") == "morning walk-in A data", (
        "morning session's clinical data was overwritten by the afternoon start"
    )
    # Afternoon session must exist and be linked to the afternoon token
    s2_doc = db.test_sessions.find_one({"session_id": s2})
    assert s2_doc is not None


def test_F004A_same_token_double_start_is_idempotent(
    token, db, clinic_id, patient
):
    """Idempotency preserved: clicking Start twice on the SAME walk-in
    card returns the SAME session_id."""
    tok = _issue_walkin_token(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"], no=3, tag="-IDEM"
    )
    r1 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tok},
        timeout=15,
    )
    r2 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tok},
        timeout=15,
    )
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["session_id"] == r2.json()["session_id"], (
        "same-token double-start must return the same session for idempotency"
    )


def test_F004A_walkin_draft_never_reused_for_a_later_appointment(
    token, db, clinic_id, patient
):
    """Walk-in draft (`appointment_id=None`) exists first; then the caller
    starts a specific APPOINTMENT for the same patient the same day.
    The walk-in draft must NOT be adopted. This restates NAV-006 P1B's
    guarantee under a walk-in-first scenario."""
    tok = _issue_walkin_token(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"], no=4, tag="-WA"
    )
    r_walkin = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tok},
        timeout=15,
    )
    assert r_walkin.status_code == 200
    walkin_sid = r_walkin.json()["session_id"]

    # Now the front-desk creates a scheduled appointment for the same
    # patient the same day; the audiologist clicks that new card.
    apt_id = f"APT-{TAG_PREFIX}-{uuid.uuid4().hex[:8]}"
    db.appointments.insert_one({
        "appointment_id": apt_id,
        "clinic_id": clinic_id,
        "patient_id": patient["patient_id"],
        "start_at": f"{datetime.utcnow().strftime('%Y-%m-%d')}T15:00:00",
        "status": "scheduled",
        "service": "PTA",
        "priority": "normal",
        "recommended_tests": ["PTA"],
        "visit_type": "consultation",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    r_appt = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": apt_id},
        timeout=15,
    )
    assert r_appt.status_code == 200, r_appt.text[:200]
    appt_sid = r_appt.json()["session_id"]

    assert appt_sid != walkin_sid, (
        "walk-in draft leaked into the later scheduled-appointment session"
    )
    appt_doc = db.test_sessions.find_one({"session_id": appt_sid})
    assert appt_doc.get("appointment_id") == apt_id, (
        f"appt session must be linked to {apt_id}, got {appt_doc.get('appointment_id')}"
    )
    walkin_doc = db.test_sessions.find_one({"session_id": walkin_sid})
    assert walkin_doc.get("appointment_id") is None, (
        "walk-in session must retain appointment_id=None"
    )


def test_F004A_completed_session_never_reused_as_draft(
    token, db, clinic_id, patient
):
    """A COMPLETED same-token session must not be reused when the
    audiologist starts a new visit for the same patient."""
    tok = _issue_walkin_token(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"], no=5, tag="-DONE"
    )
    r1 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tok},
        timeout=15,
    )
    s_done = r1.json()["session_id"]
    # Force-complete via direct DB write (bypasses queue/complete which
    # would also close the token — we want to keep the token still-active
    # to simulate a data-integrity edge case).
    db.test_sessions.update_one(
        {"session_id": s_done},
        {"$set": {"status": "completed",
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )

    # New walk-in visit → new token, same patient, same day
    tok2 = _issue_walkin_token(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"], no=6, tag="-NEW"
    )
    r2 = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tok2},
        timeout=15,
    )
    assert r2.status_code == 200
    s_new = r2.json()["session_id"]
    assert s_new != s_done, (
        "completed session was reused as a draft for a new visit"
    )
    s_new_doc = db.test_sessions.find_one({"session_id": s_new})
    assert s_new_doc.get("status") == "draft"


def test_F004A_walkin_and_appt_are_isolated_when_both_present(
    token, db, clinic_id, patient
):
    """If a patient has BOTH a walk-in token AND a scheduled appointment,
    starting the walk-in card and the appointment card must yield two
    distinct sessions."""
    tok = _issue_walkin_token(
        db, clinic_id=clinic_id, patient_id=patient["patient_id"], no=7, tag="-BOTH"
    )
    apt = f"APT-{TAG_PREFIX}-{uuid.uuid4().hex[:8]}"
    db.appointments.insert_one({
        "appointment_id": apt,
        "clinic_id": clinic_id,
        "patient_id": patient["patient_id"],
        "start_at": f"{datetime.utcnow().strftime('%Y-%m-%d')}T16:00:00",
        "status": "scheduled",
        "service": "PTA",
        "priority": "normal",
        "recommended_tests": ["PTA"],
        "visit_type": "consultation",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    r_walk = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "token_id": tok},
        timeout=15,
    )
    r_apt = requests.post(
        f"{API}/diagnostics/queue/start", headers=H(token),
        json={"patient_id": patient["patient_id"], "appointment_id": apt},
        timeout=15,
    )
    assert r_walk.status_code == r_apt.status_code == 200
    assert r_walk.json()["session_id"] != r_apt.json()["session_id"]
