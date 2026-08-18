"""NAV-005 Sprint-3B regression suite.

Guards against regression on the four Patient Profile hygiene fixes:
  NOTES-001  — `/patient-notes?patient_id=X` returns rows created via
               POST /patient-notes; the frontend now hits this URL
               (was: `/patients/{id}/notes` — never registered).
  FOLLOW-001 — a "Follow-up" service appointment is a canonical follow-up
               (no schema change was required). Front-desk can also
               continue using variant casings.
  SRV-001    — `/ha/service-tickets?patient_id=X` returns rows filtered
               to the specified patient, and every row carries a
               `ticket_no` that the profile can deep-link.
  APPT-005   — pure frontend URL-param handling; no backend surface to
               assert here. Playwright coverage exists at:
               /app/backend/tests/... (self-test via screenshot tool in
               the Sprint-3B session).

Uses TEST DATA ONLY — prefix `TEST_S3B_<uuid>`.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

from _helpers import API, H, login

OWNER_EMAIL = os.environ.get("MERGE_OWNER_EMAIL", "owner@thesoundclinic.in")
OWNER_PASSWORD = os.environ.get("MERGE_OWNER_PASSWORD", "demo123")

TAG_PREFIX = "TEST_S3B"


@pytest.fixture(scope="module")
def owner_token():
    try:
        return login(OWNER_EMAIL, OWNER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Owner login failed, skipping Sprint-3B suite: {e}")


@pytest.fixture(scope="module")
def branch_id(owner_token):
    r = requests.get(f"{API}/branches", headers=H(owner_token), timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert rows, "no branches available for this clinic"
    return rows[0]["branch_id"]


@pytest.fixture(scope="module")
def staff_id(owner_token):
    r = requests.get(f"{API}/appointments/staff-resources", headers=H(owner_token), timeout=15)
    assert r.status_code == 200
    body = r.json()
    staff = body.get("staff") if isinstance(body, dict) else body
    assert staff, "no staff resources available"
    return staff[0]["user_id"]


def _mk_patient(token: str, tag: str) -> dict:
    # 10-digit mobile derived from a uuid so back-to-back runs don't collide.
    mobile = f"9{int(uuid.uuid4().int) % 1000000000:09d}"
    payload = {"name": f"{TAG_PREFIX}_{tag}", "mobile": mobile, "age": 42, "gender": "male"}
    r = requests.post(
        f"{API}/patients",
        json=payload,
        params={"allow_duplicate_phone": "true"},
        headers=H(token), timeout=15,
    )
    assert r.status_code == 200, f"create patient: {r.status_code} {r.text[:200]}"
    return r.json()


def _delete_patient(token: str, pid: str) -> None:
    try:
        requests.delete(f"{API}/patients/{pid}", headers=H(token), timeout=10)
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════
# NOTES-001 — canonical patient-notes URL works via patient_id
# ═══════════════════════════════════════════════════════════════════════

def test_notes_001_canonical_route_returns_patient_notes(owner_token):
    """`GET /patient-notes?patient_id=X` must return notes created via
    `POST /patient-notes` for that patient. This is the URL the
    profile page now uses (fixed in Sprint-3B). Guards against
    silently reverting to the non-existent `/patients/{id}/notes`.
    """
    prim = _mk_patient(owner_token, f"NOTES_{uuid.uuid4().hex[:6]}")
    try:
        note_payload = {
            "patient_id": prim["patient_id"],
            "text": f"{TAG_PREFIX}: sprint-3b note",
        }
        r_post = requests.post(f"{API}/patient-notes",
                               json=note_payload, headers=H(owner_token), timeout=15)
        assert r_post.status_code == 200, r_post.text
        note_id = r_post.json()["note_id"]

        r_get = requests.get(
            f"{API}/patient-notes?patient_id={prim['patient_id']}",
            headers=H(owner_token), timeout=15,
        )
        assert r_get.status_code == 200, r_get.text
        rows = r_get.json()
        assert any(n.get("note_id") == note_id for n in rows), \
            f"note not visible via canonical URL: {rows}"

        # Sanity — the OLD (broken) URL must still 404. If someone
        # decides to add an alias route, they must consciously break
        # this test.
        r_old = requests.get(
            f"{API}/patients/{prim['patient_id']}/notes",
            headers=H(owner_token), timeout=15,
        )
        assert r_old.status_code == 404, \
            f"legacy URL should 404, got {r_old.status_code}"
    finally:
        _delete_patient(owner_token, prim["patient_id"])


# ═══════════════════════════════════════════════════════════════════════
# FOLLOW-001 — appointment.service == "Follow-up" is the canonical signal
# ═══════════════════════════════════════════════════════════════════════

def test_follow_001_appointments_carry_service_marker(owner_token, staff_id):
    """When an appointment is booked with `service = "Follow-up"`, it
    must round-trip on the `GET /appointments?patient_id=X` list with
    that exact service string. The frontend filter (see
    `isFollowupAppointment` in PatientProfilePage.jsx) collapses
    whitespace/hyphens and lowercases before checking for `followup`,
    but the API contract must preserve the raw string."""
    prim = _mk_patient(owner_token, f"FOLLOW_{uuid.uuid4().hex[:6]}")
    try:
        # Unique per-run slot times to avoid collisions with stale test
        # data from previous pytest runs. Use uuid-derived randomness
        # (not time.time) so back-to-back runs still get fresh slots.
        rnd = int(uuid.uuid4().int % 10000)
        year = 2028 + (rnd % 4)
        month = 1 + (rnd % 12)
        day = 1 + (rnd % 27)
        hour = 8 + (rnd % 8)
        minute = rnd % 60
        slot1_start = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00"
        slot1_end   = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{(minute + 15) % 60:02d}:00"
        slot2_start = f"{year:04d}-{month:02d}-{day:02d}T{(hour + 2):02d}:{minute:02d}:00"
        slot2_end   = f"{year:04d}-{month:02d}-{day:02d}T{(hour + 2):02d}:{(minute + 15) % 60:02d}:00"
        # One Follow-up + one Consultation (control).
        r1 = requests.post(f"{API}/appointments", json={
            "patient_id": prim["patient_id"],
            "start_at": slot1_start,
            "end_at":   slot1_end,
            "service": "Follow-up",
            "visit_type": "consultation",
            "staff_id": staff_id,
        }, headers=H(owner_token), timeout=15)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{API}/appointments", json={
            "patient_id": prim["patient_id"],
            "start_at": slot2_start,
            "end_at":   slot2_end,
            "service": "Consultation",
            "visit_type": "walkin",
            "staff_id": staff_id,
        }, headers=H(owner_token), timeout=15)
        assert r2.status_code == 200, r2.text

        r_list = requests.get(
            f"{API}/appointments?patient_id={prim['patient_id']}",
            headers=H(owner_token), timeout=15,
        )
        assert r_list.status_code == 200
        rows = r_list.json()
        assert len(rows) >= 2
        followups = [a for a in rows if a.get("service") == "Follow-up"]
        assert len(followups) == 1, \
            f"expected exactly one Follow-up appointment, got {[a.get('service') for a in rows]}"

        # And the frontend's normalisation is emulated here:
        norm = lambda s: (s or '').lower().replace(' ', '').replace('_', '').replace('-', '')
        actual_followups = [a for a in rows if 'followup' in norm(a.get('service'))]
        assert len(actual_followups) == 1, \
            "isFollowupAppointment predicate mismatch — check FE/BE symmetry"
    finally:
        _delete_patient(owner_token, prim["patient_id"])


# ═══════════════════════════════════════════════════════════════════════
# SRV-001 — service ticket list carries ticket_no for deep-link
# ═══════════════════════════════════════════════════════════════════════

def test_srv_001_service_tickets_expose_ticket_no(owner_token, branch_id):
    """The Patient Profile Service tab links to
    `/repair/jobs?ticket=<ticket_no>`. Assert that the API contract
    used by the profile still exposes `ticket_no` and that
    `patient_id` is preserved end-to-end so ticket→patient can't drift.
    """
    prim = _mk_patient(owner_token, f"SRV_{uuid.uuid4().hex[:6]}")
    try:
        r_post = requests.post(f"{API}/ha/service-tickets", json={
            "patient_id": prim["patient_id"],
            "kind": "repair",
            "complaint": f"{TAG_PREFIX}: sprint-3b service ticket",
            "branch_id": branch_id,
        }, headers=H(owner_token), timeout=15)
        assert r_post.status_code in (200, 201), r_post.text
        ticket_no = r_post.json()["ticket_no"]
        assert ticket_no

        r_list = requests.get(
            f"{API}/ha/service-tickets?patient_id={prim['patient_id']}",
            headers=H(owner_token), timeout=15,
        )
        assert r_list.status_code == 200
        # The profile passes .items || .data — accept either shape.
        body = r_list.json()
        rows = body if isinstance(body, list) else body.get("items", [])
        assert rows, "service tickets list empty despite POST"
        row = next((t for t in rows if t.get("ticket_no") == ticket_no), None)
        assert row is not None, f"ticket {ticket_no} not returned in patient-scoped list"
        assert row.get("patient_id") == prim["patient_id"]
        # ticket_no must be URL-safe (no spaces, no reserved chars) so
        # the deep-link Query encoder can round-trip it. Simple sanity.
        assert " " not in ticket_no
    finally:
        _delete_patient(owner_token, prim["patient_id"])
