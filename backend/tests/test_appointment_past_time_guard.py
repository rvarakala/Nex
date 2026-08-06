"""Regression tests for the past-time / double-booking guards.

Covers the production bug fix (2026-01):
  * POST /api/appointments rejects past start_at with 400.
  * PUT  /api/appointments/{id} rejects backward moves when start_at is
    supplied (impacts_schedule=True), but still allows metadata-only
    edits on past appointments.
  * /api/availability/slots marks past-time slots with reason
    "Time has passed", and this is NOT bypassed by override=true.
  * Existing double-booking (409) still fires alongside the new guard.
  * Happy-path future bookings still succeed.

Timezone rule: all wall-clock comparisons are done in IST (Asia/Kolkata,
UTC+5:30) regardless of the server's clock timezone.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import requests

from _helpers import API, H, admin_token, ADMIN_CLINIC_ID  # noqa: E402

import random
IST = timezone(timedelta(hours=5, minutes=30))
_RUN_JITTER_MIN = random.randint(0, 20) * 15  # deterministic per-run offset in 15-min steps


# ─── Shared fixtures ────────────────────────────────────────────────
@pytest.fixture(scope="module")
def token() -> str:
    return admin_token()


@pytest.fixture(scope="module")
def staff_id(token: str) -> str:
    """Any active audiologist in the pytest tenant."""
    r = requests.get(f"{API}/users", headers=H(token), timeout=20)
    assert r.status_code == 200, r.text
    for u in r.json():
        if u.get("role") == "audiologist" and u.get("active", True):
            return u["user_id"]
    # Fallback: create one on the fly (shouldn't be needed — conftest seeds one)
    pytest.skip("No audiologist available in pytest tenant")


@pytest.fixture(scope="module")
def patient_id() -> str:
    return "PT-PYTEST-BOOTSTRAP-001"


# ─── IST helpers ────────────────────────────────────────────────────
def _ist_now() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


def _iso(dt: datetime) -> str:
    """Naive wall-clock ISO string (what the modal sends)."""
    return dt.replace(microsecond=0).isoformat()


def _future_slot(minutes_ahead: int = 60) -> datetime:
    # Round to next quarter hour, apply per-run jitter to avoid collisions
    # with leftover appointments from previous runs.
    now = _ist_now() + timedelta(minutes=minutes_ahead + _RUN_JITTER_MIN)
    q = (now.minute // 15 + 1) * 15
    now = now.replace(minute=0, second=0, microsecond=0) + timedelta(minutes=q)
    return now


# ─── POST /appointments — past-time guard ───────────────────────────
class TestPostPastTimeGuard:
    def test_yesterday_10am_rejected(self, token, staff_id, patient_id):
        yesterday_10 = (_ist_now() - timedelta(days=1)).replace(
            hour=10, minute=0, second=0, microsecond=0
        )
        r = requests.post(
            f"{API}/appointments",
            headers=H(token),
            json={
                "staff_id": staff_id,
                "patient_id": patient_id,
                "start_at": _iso(yesterday_10),
                "duration_minutes": 30,
            },
            timeout=20,
        )
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", {})
        assert isinstance(detail, dict), f"Expected structured detail, got {detail!r}"
        assert "already passed" in detail.get("message", "").lower()
        assert "attempted_start" in detail and "now" in detail

    def test_now_minus_3min_rejected(self, token, staff_id, patient_id):
        past = _ist_now() - timedelta(minutes=3)
        r = requests.post(
            f"{API}/appointments",
            headers=H(token),
            json={
                "staff_id": staff_id,
                "patient_id": patient_id,
                "start_at": _iso(past),
                "duration_minutes": 30,
            },
            timeout=20,
        )
        assert r.status_code == 400, r.text

    def test_current_minute_within_grace_allowed(self, token, staff_id, patient_id):
        """The 2-min grace lets a booking with start_at == now succeed
        (front-desk clock-tick tolerance). We accept either 200 (created)
        or 409 (conflicting with a busy slot from earlier tests) — the
        important thing is that it's NOT a 400 past-time rejection."""
        near_now = _ist_now().replace(second=0, microsecond=0)
        r = requests.post(
            f"{API}/appointments",
            headers=H(token),
            json={
                "staff_id": staff_id,
                "patient_id": patient_id,
                "start_at": _iso(near_now),
                "duration_minutes": 30,
            },
            timeout=20,
        )
        # Must not be a past-time 400. 200 = booked; 409 = existing overlap; both OK.
        assert r.status_code != 400, (
            f"grace window did not tolerate current-minute booking: {r.text}"
        )
        if r.status_code == 200:
            # cleanup
            aid = r.json().get("appointment_id")
            if aid:
                requests.delete(f"{API}/appointments/{aid}", headers=H(token), timeout=10)


# ─── POST /appointments — happy path + double-booking ──────────────
class TestPostHappyPath:
    def test_future_booking_succeeds(self, token, staff_id, patient_id):
        # Find a free slot (retry with different offsets to skip leftovers).
        aid, start, r_final = None, None, None
        for offset_hours in range(24, 240, 3):
            start = _future_slot(minutes_ahead=60 * offset_hours)
            r = requests.post(
                f"{API}/appointments",
                headers=H(token),
                json={
                    "staff_id": staff_id,
                    "patient_id": patient_id,
                    "start_at": _iso(start),
                    "duration_minutes": 30,
                    "service": "Consultation",
                },
                timeout=20,
            )
            r_final = r
            if r.status_code == 200:
                aid = r.json()["appointment_id"]
                break
        assert aid, f"couldn't find free slot: {r_final.text if r_final else 'no attempts'}"

        # Double-booking guard: same staff, same slot ⇒ 409
        r2 = requests.post(
            f"{API}/appointments",
            headers=H(token),
            json={
                "staff_id": staff_id,
                "patient_id": patient_id,
                "start_at": _iso(start),
                "duration_minutes": 30,
                "service": "Consultation",
            },
            timeout=20,
        )
        assert r2.status_code == 409, r2.text
        conflict = r2.json().get("detail", {})
        assert conflict.get("conflict_with", {}).get("appointment_id") == aid

        # cleanup
        requests.delete(f"{API}/appointments/{aid}", headers=H(token), timeout=10)


# ─── PUT /appointments/{id} — conditional past-time check ──────────
class TestPutPastTimeGuard:
    @pytest.fixture
    def future_appt_id(self, token, staff_id, patient_id):
        """Create a future appointment; yield its id; cleanup after.
        Retries with progressively later slots to sidestep leftover
        collisions from prior runs."""
        aid = None
        last_err = None
        for offset_hours in range(48, 240, 3):
            start = _future_slot(minutes_ahead=60 * offset_hours + 15)
            r = requests.post(
                f"{API}/appointments",
                headers=H(token),
                json={
                    "staff_id": staff_id,
                    "patient_id": patient_id,
                    "start_at": _iso(start),
                    "duration_minutes": 30,
                },
                timeout=20,
            )
            if r.status_code == 200:
                aid = r.json()["appointment_id"]
                break
            last_err = r.text
        assert aid, f"could not create fixture appointment; last error: {last_err}"
        yield aid, start
        requests.delete(f"{API}/appointments/{aid}", headers=H(token), timeout=10)

    def test_moving_start_backward_to_past_rejected(self, token, future_appt_id):
        aid, _ = future_appt_id
        past = (_ist_now() - timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        r = requests.put(
            f"{API}/appointments/{aid}",
            headers=H(token),
            json={"start_at": _iso(past)},
            timeout=20,
        )
        assert r.status_code == 400, r.text
        assert "already passed" in r.json().get("detail", {}).get("message", "").lower()

    def test_metadata_only_edit_on_future_appt_ok(self, token, future_appt_id):
        aid, _ = future_appt_id
        # Editing only notes / status — impacts_schedule=False; guard must skip.
        r = requests.put(
            f"{API}/appointments/{aid}",
            headers=H(token),
            json={"notes": "TEST past-time guard: metadata-only edit"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("notes") == "TEST past-time guard: metadata-only edit"


# ─── GET /availability/slots — past-time slot marking ──────────────
class TestAvailabilitySlots:
    def _fetch(self, token, staff_id, date_str, override=False):
        params = {"date": date_str, "staff_id": staff_id, "duration_minutes": 30}
        if override:
            params["override"] = "true"
        r = requests.get(
            f"{API}/availability/slots",
            headers=H(token),
            params=params,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_yesterday_all_slots_past(self, token, staff_id):
        yday = (_ist_now() - timedelta(days=1)).date().isoformat()
        data = self._fetch(token, staff_id, yday)
        slots = data.get("slots", [])
        assert slots, "expected slots list for yesterday"
        for s in slots:
            assert s["available"] is False, f"yesterday slot still available: {s}"
            assert s.get("reason") == "Time has passed", (
                f"yesterday slot missing past-time reason: {s}"
            )
        # next_available must be null for yesterday
        assert data.get("next_available") in (None, {}), data.get("next_available")

    def test_tomorrow_no_slots_past(self, token, staff_id):
        tmrw = (_ist_now() + timedelta(days=1)).date().isoformat()
        data = self._fetch(token, staff_id, tmrw)
        past_slots = [s for s in data["slots"] if s.get("reason") == "Time has passed"]
        assert not past_slots, f"tomorrow shouldn't have past slots, got: {past_slots[:3]}"

    def test_today_past_slots_marked(self, token, staff_id):
        """When there ARE past slots on today (test runs after 06:00 IST),
        every past one is flagged with reason='Time has passed'."""
        today = _ist_now().date().isoformat()
        now_wall = _ist_now()
        data = self._fetch(token, staff_id, today)
        found_past = False
        for s in data["slots"]:
            slot_start = datetime.fromisoformat(s["start_at"])
            if slot_start <= now_wall:
                found_past = True
                assert s["available"] is False, f"past slot still available: {s}"
                assert s["reason"] == "Time has passed", (
                    f"today past slot wrong reason: {s}"
                )
        if not found_past:
            pytest.skip(
                f"No past slots on today ({today}) at IST {now_wall.time()} — "
                "slot-walk starts at 06:00, likely running before 06:30 IST."
            )

    def test_override_does_not_resurrect_past(self, token, staff_id):
        today = _ist_now().date().isoformat()
        now_wall = _ist_now()
        data = self._fetch(token, staff_id, today, override=True)
        for s in data["slots"]:
            slot_start = datetime.fromisoformat(s["start_at"])
            if slot_start <= now_wall:
                assert s["available"] is False, (
                    f"override=true resurrected a past slot: {s}"
                )
                assert s["reason"] == "Time has passed"

    def test_yesterday_next_available_null(self, token, staff_id):
        yday = (_ist_now() - timedelta(days=1)).date().isoformat()
        data = self._fetch(token, staff_id, yday)
        assert data.get("next_available") in (None, {})
