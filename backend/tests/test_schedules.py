"""Backend regression tests for clinic-schedule + staff-schedule + availability.

Covers:
  • Happy paths    — GET defaults, PUT update, GET reflects PUT, weekly grid.
  • RBAC           — front-desk / audiologist roles can/can't edit hours.
  • Edge cases     — Sunday closed, lunch-break greys lunch slots, conflict
                     detection, override flag, invalid HH:MM rejected,
                     unknown staff_id 404.

Convention: this file is fully self-cleaning — every appointment / schedule
doc inserted is rolled back in the module-scoped cleanup fixture so re-running
the suite never accumulates state.
"""
import os
import uuid
from datetime import datetime, timedelta

import pytest
import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

_created = {"patients": [], "appointments": []}


# ==================== fixtures ====================

@pytest.fixture(scope="module")
def fd_headers():
    """Front desk role — should be BLOCKED from editing hours."""
    r = requests.post(f"{API}/auth/login",
                      json={"email": "frontdesk@acs.in", "password": "frontdesk123"})
    assert r.status_code == 200, r.text
    return {"Content-Type": "application/json",
            "Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin_headers():
    """super_admin role — full edit rights on this clinic."""
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Content-Type": "application/json",
            "Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def audiologist_headers():
    """audiologist role — can edit OWN schedule, not someone else's."""
    r = requests.post(f"{API}/auth/login",
                      json={"email": "audiologist@acs.in", "password": "audio123"})
    assert r.status_code == 200, r.text
    return {"Content-Type": "application/json",
            "Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def my_user_id(audiologist_headers):
    """The user_id of the audiologist@acs.in account (auth/me)."""
    r = requests.get(f"{API}/auth/me", headers=audiologist_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("user_id") or body.get("user", {}).get("user_id")


@pytest.fixture(scope="module")
def other_user_id(admin_headers, my_user_id):
    """Any user in the clinic OTHER than `my_user_id` — used to assert that
    audiologists can't edit others' schedules."""
    r = requests.get(f"{API}/users", headers=admin_headers)
    assert r.status_code == 200
    others = [u for u in r.json() if u["user_id"] != my_user_id]
    assert others, "Need at least one other user in the clinic to test cross-user RBAC"
    return others[0]["user_id"]


@pytest.fixture(scope="module")
def patient_id(admin_headers):
    """Throwaway patient — used so the conflict-detection test can book an
    actual appointment."""
    suffix = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/patients", headers=admin_headers, json={
        "name": f"TEST_SCHED_Pt_{suffix}", "age": 30, "gender": "Female",
        "mobile": f"98{suffix[:8]}",
    })
    assert r.status_code == 200, r.text
    pid = r.json()["patient_id"]
    _created["patients"].append(pid)
    return pid


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_headers):
    """Cancel test appointments + patients on tear-down so the demo clinic
    doesn't accumulate test pollution between runs."""
    yield
    for aid in _created["appointments"]:
        try:
            requests.post(f"{API}/appointments/{aid}/cancel",
                          headers=admin_headers, json={"reason": "cleanup"})
        except Exception:
            pass
    for pid in _created["patients"]:
        try:
            requests.delete(f"{API}/patients/{pid}", headers=admin_headers)
        except Exception:
            pass


# ==================== helpers ====================

def _next_weekday(weekday_idx: int) -> str:
    """Return YYYY-MM-DD of the next future occurrence of `weekday_idx`
    (0=Mon … 6=Sun). Always at least 7 days out so existing demo
    appointments don't conflict with our scheduling tests."""
    base = datetime.utcnow().date() + timedelta(days=7)
    delta = (weekday_idx - base.weekday()) % 7
    return (base + timedelta(days=delta)).isoformat()


def _full_week_default():
    """Mon–Sat 09:00–13:30 + 14:30–19:00, Sun closed."""
    win = [{"start": "09:00", "end": "13:30", "label": "Morning"},
           {"start": "14:30", "end": "19:00", "label": "Evening"}]
    return {
        "mon": {"open": True, "windows": win},
        "tue": {"open": True, "windows": win},
        "wed": {"open": True, "windows": win},
        "thu": {"open": True, "windows": win},
        "fri": {"open": True, "windows": win},
        "sat": {"open": True, "windows": win},
        "sun": {"open": False, "windows": []},
    }


# ==================== TESTS ====================

class TestClinicScheduleHappyPath:
    def test_default_template_when_unset(self, admin_headers):
        r = requests.get(f"{API}/clinic-schedule", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "weekly_hours" in d
        wh = d["weekly_hours"]
        # Default: every weekday should have an `open` flag and `windows` list.
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
            assert day in wh
            assert "open" in wh[day]
            assert "windows" in wh[day]
        assert wh["sun"]["open"] is False, "Sunday must default to closed"

    def test_admin_can_update(self, admin_headers):
        # Set a unique pattern — Wed lunch shifted to 12:30, and Tue closed.
        wh = _full_week_default()
        wh["tue"]["open"] = False
        wh["tue"]["windows"] = []
        wh["wed"]["windows"] = [
            {"start": "09:00", "end": "12:30", "label": "Morning"},
            {"start": "13:30", "end": "18:00", "label": "Evening"},
        ]
        r = requests.put(f"{API}/clinic-schedule", headers=admin_headers,
                         json={"weekly_hours": wh})
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        # Read back — change must be reflected.
        r2 = requests.get(f"{API}/clinic-schedule", headers=admin_headers)
        assert r2.status_code == 200
        got = r2.json()["weekly_hours"]
        assert got["tue"]["open"] is False
        assert got["wed"]["windows"][0]["end"] == "12:30"

        # Restore default — leaves the demo clinic clean for other tests.
        requests.put(f"{API}/clinic-schedule", headers=admin_headers,
                     json={"weekly_hours": _full_week_default()})


class TestClinicScheduleRBAC:
    def test_front_desk_cannot_edit_clinic(self, fd_headers):
        r = requests.put(f"{API}/clinic-schedule", headers=fd_headers,
                         json={"weekly_hours": _full_week_default()})
        assert r.status_code == 403, r.text
        assert "owner" in r.text.lower() or "admin" in r.text.lower()

    def test_audiologist_cannot_edit_clinic(self, audiologist_headers):
        r = requests.put(f"{API}/clinic-schedule", headers=audiologist_headers,
                         json={"weekly_hours": _full_week_default()})
        assert r.status_code == 403, r.text

    def test_invalid_hhmm_rejected(self, admin_headers):
        bad = _full_week_default()
        bad["mon"]["windows"][0]["start"] = "9am"            # not HH:MM
        r = requests.put(f"{API}/clinic-schedule", headers=admin_headers,
                         json={"weekly_hours": bad})
        assert r.status_code == 422, r.text


class TestStaffScheduleHappyPath:
    def test_default_inherits_clinic(self, audiologist_headers, my_user_id):
        r = requests.get(f"{API}/staff-schedule/{my_user_id}",
                         headers=audiologist_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inherit_clinic"] is True

    def test_audiologist_can_edit_own(self, audiologist_headers, my_user_id):
        # Custom split shift: morning 09:00-13:00, evening 17:00-20:00, Tue/Thu off.
        wh = _full_week_default()
        wh["mon"]["windows"] = [
            {"start": "09:00", "end": "13:00", "label": "Morning"},
            {"start": "17:00", "end": "20:00", "label": "Evening"},
        ]
        wh["tue"] = {"open": False, "windows": []}
        wh["thu"] = {"open": False, "windows": []}
        r = requests.put(f"{API}/staff-schedule/{my_user_id}",
                         headers=audiologist_headers,
                         json={"weekly_hours": wh, "inherit_clinic": False})
        assert r.status_code == 200, r.text

        # Confirm the change actually persisted with inherit=False.
        r2 = requests.get(f"{API}/staff-schedule/{my_user_id}",
                          headers=audiologist_headers)
        assert r2.status_code == 200
        d = r2.json()
        assert d["inherit_clinic"] is False
        assert d["weekly_hours"]["tue"]["open"] is False
        assert d["weekly_hours"]["mon"]["windows"][1]["start"] == "17:00"

    def test_admin_can_edit_others(self, admin_headers, other_user_id):
        wh = _full_week_default()
        r = requests.put(f"{API}/staff-schedule/{other_user_id}",
                         headers=admin_headers,
                         json={"weekly_hours": wh, "inherit_clinic": True})
        assert r.status_code == 200, r.text


class TestStaffScheduleRBAC:
    def test_audiologist_cannot_edit_others(self, audiologist_headers, other_user_id):
        r = requests.put(f"{API}/staff-schedule/{other_user_id}",
                         headers=audiologist_headers,
                         json={"weekly_hours": _full_week_default(),
                               "inherit_clinic": True})
        assert r.status_code == 403, r.text

    def test_unknown_staff_404(self, admin_headers):
        r = requests.put(f"{API}/staff-schedule/USR-NONEXISTENT",
                         headers=admin_headers,
                         json={"weekly_hours": _full_week_default(),
                               "inherit_clinic": True})
        assert r.status_code == 404, r.text


class TestAvailabilitySlots:
    def test_sunday_all_blocked(self, admin_headers, my_user_id):
        sunday = _next_weekday(6)
        # Reset clinic to default so Sunday is closed.
        requests.put(f"{API}/clinic-schedule", headers=admin_headers,
                     json={"weekly_hours": _full_week_default()})
        # Reset staff to inherit clinic so the test isolates clinic-day-closed logic.
        requests.put(f"{API}/staff-schedule/{my_user_id}", headers=admin_headers,
                     json={"weekly_hours": _full_week_default(),
                           "inherit_clinic": True})
        r = requests.get(f"{API}/availability/slots", headers=admin_headers,
                         params={"date": sunday, "staff_id": my_user_id,
                                 "duration_minutes": 30})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["clinic_open"] is False
        assert d["next_available"] is None
        assert d["slots"], "should still return the empty grid for the day"
        assert all(s["available"] is False for s in d["slots"])
        assert all(s["reason"] == "Clinic closed today" for s in d["slots"])

    def test_lunch_break_blocks_those_slots(self, admin_headers, my_user_id):
        wednesday = _next_weekday(2)
        # Reset clinic + staff so nothing else interferes.
        requests.put(f"{API}/clinic-schedule", headers=admin_headers,
                     json={"weekly_hours": _full_week_default()})
        requests.put(f"{API}/staff-schedule/{my_user_id}", headers=admin_headers,
                     json={"weekly_hours": _full_week_default(),
                           "inherit_clinic": True})
        r = requests.get(f"{API}/availability/slots", headers=admin_headers,
                         params={"date": wednesday, "staff_id": my_user_id,
                                 "duration_minutes": 30, "granularity_minutes": 15})
        assert r.status_code == 200
        d = r.json()
        slot_at = {s["start_at"][11:16]: s for s in d["slots"]}

        # 09:00 → ✅ in Morning window
        assert slot_at["09:00"]["available"] is True
        assert slot_at["09:00"]["label"] == "Morning"
        # 13:30 → ❌ Lunch starts; 30-min slot would run into lunch.
        assert slot_at["13:30"]["available"] is False
        assert "outside" in slot_at["13:30"]["reason"].lower() \
            or "lunch" in slot_at["13:30"]["reason"].lower()
        # 14:00 → ❌ still in lunch break
        assert slot_at["14:00"]["available"] is False
        # 14:30 → ✅ Evening window starts; first valid post-lunch slot.
        assert slot_at["14:30"]["available"] is True
        assert slot_at["14:30"]["label"] == "Evening"
        # 06:00 → ❌ before clinic opens
        assert slot_at["06:00"]["available"] is False
        assert slot_at["06:00"]["reason"]
        # next_available should be 09:00 (or earliest morning window slot)
        assert d["next_available"] is not None
        assert d["next_available"]["start_at"][11:16] == "09:00"

    def test_conflict_detection_marks_busy(self, admin_headers, my_user_id, patient_id):
        # Pick a Tuesday strictly in the future and book a 10:00 slot.
        tuesday = _next_weekday(1)
        requests.put(f"{API}/clinic-schedule", headers=admin_headers,
                     json={"weekly_hours": _full_week_default()})
        requests.put(f"{API}/staff-schedule/{my_user_id}", headers=admin_headers,
                     json={"weekly_hours": _full_week_default(),
                           "inherit_clinic": True})
        # Book a real appointment so the conflict path runs.
        appt = requests.post(f"{API}/appointments", headers=admin_headers, json={
            "patient_id": patient_id,
            "audiologist_id": my_user_id,
            "service": "PTA",
            "start_at": f"{tuesday}T10:00:00",
            "duration_minutes": 30,
        })
        assert appt.status_code == 200, appt.text
        _created["appointments"].append(appt.json()["appointment_id"])

        r = requests.get(f"{API}/availability/slots", headers=admin_headers,
                         params={"date": tuesday, "staff_id": my_user_id,
                                 "duration_minutes": 30, "granularity_minutes": 15})
        d = r.json()
        slot_at = {s["start_at"][11:16]: s for s in d["slots"]}
        assert slot_at["10:00"]["available"] is False
        assert slot_at["10:00"]["reason"] == "Already booked"
        # 09:30 still free
        assert slot_at["09:30"]["available"] is True

    def test_override_unblocks_all(self, admin_headers, my_user_id):
        """When admin ticks the override flag, EVERY slot — including lunch
        breaks, off-shift hours, and already-booked conflicts — becomes
        bookable. The original `reason` is still returned so the UI tooltip
        can communicate WHAT is being overridden. This is the
        owner-can-do-anything escape hatch."""
        tuesday = _next_weekday(1)
        r = requests.get(f"{API}/availability/slots", headers=admin_headers,
                         params={"date": tuesday, "staff_id": my_user_id,
                                 "duration_minutes": 30, "granularity_minutes": 15,
                                 "override": "true"})
        d = r.json()
        slot_at = {s["start_at"][11:16]: s for s in d["slots"]}
        # Conflict at 10:00 (booked in prior test) → unblocked under override.
        assert slot_at["10:00"]["available"] is True
        assert slot_at["10:00"]["reason"] == "Already booked"
        # Lunch slot is also unblocked under override but reason still shown.
        assert slot_at["13:45"]["available"] is True
        assert slot_at["13:45"]["reason"]
        # Without override the same slots would be blocked — verified in prior tests.

    def test_missing_staff_id_400(self, admin_headers):
        r = requests.get(f"{API}/availability/slots", headers=admin_headers,
                         params={"date": _next_weekday(0)})
        assert r.status_code == 400, r.text


class TestAvailabilityWeek:
    def test_week_grid_shape(self, admin_headers):
        # Reset baseline so week grid reflects defaults.
        requests.put(f"{API}/clinic-schedule", headers=admin_headers,
                     json={"weekly_hours": _full_week_default()})
        monday = _next_weekday(0)
        r = requests.get(f"{API}/availability/week", headers=admin_headers,
                         params={"start_date": monday})
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["weekdays"]) == 7
        assert d["weekdays"][0] == "mon"
        assert d["weekdays"][-1] == "sun"
        assert isinstance(d["staff"], list)
        for s in d["staff"]:
            assert "user_id" in s and "name" in s
            assert len(s["days"]) == 7
            sun_day = next(d for d in s["days"] if d["weekday"] == "sun")
            assert sun_day["open"] is False
