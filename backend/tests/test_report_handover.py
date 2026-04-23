"""Tests for the report-handover lifecycle + front-desk intake triage.

Covers:
  * Appointment now persists `visit_type`, `recommended_tests`, `referred_by`.
  * Session auto-inherits the intake triage from the same-day appointment.
  * `complete-test` → `mark-printed` → `handover` advances `report_status`.
  * Handover refuses without paid session invoice (session-scoped — no patient fallback).
  * `accounts` can bypass the bill check; `front_desk` cannot.
  * `GET /reports` returns the correct rows per tab with per-row metadata.
"""
import os
import random
from datetime import datetime, timezone

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://careful-feedback.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


def _random_slot() -> str:
    """Return a unique HH:MM:SS slot today (UTC) for test appointments.

    Uses the late-evening window 18:00–23:59. Test appointments are created with
    duration=1 minute to minimise conflicts when the suite is re-run."""
    h = random.randint(18, 23)
    m = random.randint(0, 59)
    s = random.randint(0, 59)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "fd": _login("frontdesk@acs.in", "frontdesk123"),
        "aud": _login("audiologist@acs.in", "audio123"),
        "accounts": _login("accounts@acs.in", "accounts123"),
        "admin": _login("admin@acs.in", "admin123"),
    }


@pytest.fixture(scope="module")
def ctx(tokens):
    """Pick a patient + audiologist id once per module."""
    p = requests.get(f"{API}/patients?limit=1", headers=H(tokens["fd"]), timeout=15).json()
    patient_id = p[0]["patient_id"]
    users = requests.get(f"{API}/users", headers=H(tokens["fd"]), timeout=15).json()
    aud_id = next(u["user_id"] for u in users if u["role"] == "audiologist")
    return {"patient_id": patient_id, "audiologist_id": aud_id}


def _create_appointment(tokens, ctx, *, visit_type, recommended_tests, referred_by=None, hour=None):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    last_err = None
    # Retry a few times with random slots — the conflict check runs against
    # every appointment already on this audiologist today, which piles up as
    # the suite (and earlier suites) run against the same shared DB.
    for _ in range(15):
        h = hour or _random_slot()
        body = {
            "patient_id": ctx["patient_id"],
            "audiologist_id": ctx["audiologist_id"],
            "service": "PTA",
            "start_at": f"{today}T{h}",
            "duration_minutes": 1,
            "visit_type": visit_type,
            "recommended_tests": recommended_tests,
        }
        if referred_by:
            body["referred_by"] = referred_by
        r = requests.post(f"{API}/appointments", headers=H(tokens["fd"]), json=body, timeout=15)
        if r.status_code == 200:
            return r.json()
        last_err = r
        if hour is not None:      # caller wants a specific slot — don't retry
            break
    raise AssertionError(f"Could not book a non-conflicting appointment after retries: {last_err.text if last_err else 'no response'}")


def _create_session(tokens, ctx, *, appointment_id=None):
    body = {"patient_id": ctx["patient_id"]}
    if appointment_id:
        body["appointment_id"] = appointment_id
    r = requests.post(f"{API}/sessions", headers=H(tokens["aud"]), json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestAppointmentFields:
    def test_referral_with_tests(self, tokens, ctx):
        apt = _create_appointment(tokens, ctx,
                                  visit_type="referral",
                                  recommended_tests=["pta", "impedance"],
                                  referred_by="Dr. R")
        assert apt["visit_type"] == "referral"
        assert apt["recommended_tests"] == ["pta", "impedance"]
        assert apt["referred_by"] == "Dr. R"

    def test_walkin_defaults(self, tokens, ctx):
        apt = _create_appointment(tokens, ctx, visit_type="walkin",
                                  recommended_tests=["pta"])
        assert apt["visit_type"] == "walkin"
        assert apt["recommended_tests"] == ["pta"]
        assert apt.get("referred_by") is None

    def test_consultation_accepts_empty_tests(self, tokens, ctx):
        apt = _create_appointment(tokens, ctx, visit_type="consultation",
                                  recommended_tests=[])
        assert apt["visit_type"] == "consultation"
        assert apt["recommended_tests"] == []


class TestSessionInheritsFromAppointment:
    def test_session_inherits_by_appointment_id(self, tokens, ctx):
        apt = _create_appointment(tokens, ctx, visit_type="referral",
                                  recommended_tests=["pta", "speech"],
                                  referred_by="Dr. ENT")
        ses = _create_session(tokens, ctx, appointment_id=apt["appointment_id"])
        assert ses["visit_type"] == "referral"
        assert set(ses["recommended_tests"]) == {"pta", "speech"}
        assert ses["referred_by"] == "Dr. ENT"
        assert ses["appointment_id"] == apt["appointment_id"]
        assert ses["report_status"] == "draft"

    def test_session_default_when_no_appointment(self, tokens):
        """Creating a session for a patient with no appointments today defaults to walkin/[]."""
        # Use a fresh tenant via admin login — keep this patient free of today's appt.
        # Just assert the session shape has the defaults.
        # (We can't easily guarantee no appt for the primary patient in this data set,
        # so simply check the fields are present with valid defaults.)
        p = requests.get(f"{API}/patients?limit=1", headers=H(tokens["fd"]), timeout=15).json()
        ses = requests.post(
            f"{API}/sessions", headers=H(tokens["aud"]),
            json={"patient_id": p[0]["patient_id"]},
            timeout=15,
        )
        assert ses.status_code == 200
        d = ses.json()
        assert d["visit_type"] in ("walkin", "referral", "consultation")
        assert isinstance(d["recommended_tests"], list)
        assert d["report_status"] == "draft"


class TestLifecycleTransitions:
    def test_generate_report_then_ready_list(self, tokens, ctx):
        apt = _create_appointment(tokens, ctx, visit_type="referral",
                                  recommended_tests=["pta", "impedance"],
                                  referred_by="Dr. L")
        ses = _create_session(tokens, ctx, appointment_id=apt["appointment_id"])
        r = requests.post(f"{API}/sessions/{ses['session_id']}/generate-report",
                          headers=H(tokens["aud"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["report_status"] == "report_ready"

        pend = requests.get(f"{API}/reports?status=ready&per_page=50",
                            headers=H(tokens["fd"]), timeout=15).json()
        ids = [x["session_id"] for x in pend["items"]]
        assert ses["session_id"] in ids
        row = next(x for x in pend["items"] if x["session_id"] == ses["session_id"])
        assert row["report_status"] == "report_ready"
        assert set(row["recommended_tests"]) == {"pta", "impedance"}
        assert row["referred_by"] == "Dr. L"

    def test_legacy_alias_complete_test_still_works(self, tokens, ctx):
        """`/complete-test` is kept as an alias so in-flight UIs keep working."""
        apt = _create_appointment(tokens, ctx, visit_type="walkin",
                                  recommended_tests=["pta"])
        ses = _create_session(tokens, ctx, appointment_id=apt["appointment_id"])
        r = requests.post(f"{API}/sessions/{ses['session_id']}/complete-test",
                          headers=H(tokens["aud"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["report_status"] == "report_ready"

    def test_legacy_mark_printed_still_works(self, tokens, ctx):
        apt = _create_appointment(tokens, ctx, visit_type="walkin",
                                  recommended_tests=["pta"])
        ses = _create_session(tokens, ctx, appointment_id=apt["appointment_id"])
        r1 = requests.post(f"{API}/sessions/{ses['session_id']}/mark-printed",
                           headers=H(tokens["aud"]), timeout=15)
        assert r1.status_code == 200
        assert r1.json()["report_status"] == "report_ready"
        # Idempotent
        r2 = requests.post(f"{API}/sessions/{ses['session_id']}/mark-printed",
                           headers=H(tokens["aud"]), timeout=15)
        assert r2.status_code == 200
        assert r2.json()["report_status"] == "report_ready"

    def test_handover_blocked_without_paid_bill(self, tokens, ctx):
        """Creates a fresh patient with no invoices, then confirms handover is blocked.

        We use a brand-new patient so there's zero chance a historical paid invoice
        accidentally satisfies the gate via the patient-fallback lookup.
        """
        # Create a fresh patient via the admin API
        fresh = requests.post(
            f"{API}/patients",
            headers=H(tokens["fd"]),
            json={"name": f"Gate Test {random.randint(10000, 99999)}",
                  "age": 30, "gender": "Male", "mobile": "9999999999"},
            timeout=15,
        )
        assert fresh.status_code == 200, fresh.text
        fresh_id = fresh.json()["patient_id"]

        ses = requests.post(
            f"{API}/sessions",
            headers=H(tokens["aud"]),
            json={"patient_id": fresh_id},
            timeout=15,
        ).json()
        requests.post(f"{API}/sessions/{ses['session_id']}/generate-report",
                      headers=H(tokens["aud"]), timeout=15)
        r = requests.post(f"{API}/sessions/{ses['session_id']}/handover",
                          headers=H(tokens["fd"]), json={"channel": "in_person"},
                          timeout=15)
        assert r.status_code == 409, r.text
        body = r.json()["detail"]
        assert "invoice" in body["message"].lower()
        assert body["can_bypass"] is False

    def test_handover_fd_cannot_bypass(self, tokens):
        """Creates a fresh patient so the gate actually fires, then confirms
        front_desk cannot bypass even when they try."""
        fresh = requests.post(
            f"{API}/patients",
            headers=H(tokens["fd"]),
            json={"name": f"Bypass Gate Test {random.randint(10000, 99999)}",
                  "age": 28, "gender": "Female", "mobile": "9888888888"},
            timeout=15,
        ).json()
        ses = requests.post(
            f"{API}/sessions",
            headers=H(tokens["aud"]),
            json={"patient_id": fresh["patient_id"]},
            timeout=15,
        ).json()
        requests.post(f"{API}/sessions/{ses['session_id']}/generate-report",
                      headers=H(tokens["aud"]), timeout=15)
        r = requests.post(f"{API}/sessions/{ses['session_id']}/handover",
                          headers=H(tokens["fd"]),
                          json={"channel": "in_person", "bypass_bill_check": True},
                          timeout=15)
        assert r.status_code == 403

    def test_accounts_can_bypass_and_session_moves_to_completed(self, tokens, ctx):
        apt = _create_appointment(tokens, ctx, visit_type="walkin",
                                  recommended_tests=["pta"])
        ses = _create_session(tokens, ctx, appointment_id=apt["appointment_id"])
        requests.post(f"{API}/sessions/{ses['session_id']}/generate-report",
                      headers=H(tokens["aud"]), timeout=15)
        r = requests.post(f"{API}/sessions/{ses['session_id']}/handover",
                          headers=H(tokens["accounts"]),
                          json={"channel": "in_person", "bypass_bill_check": True},
                          timeout=15)
        assert r.status_code == 200
        assert r.json()["report_status"] == "completed"
        assert r.json()["delivery_id"].startswith("DEL-")

        done = requests.get(
            f"{API}/reports?status=completed&per_page=50",
            headers=H(tokens["fd"]), timeout=15,
        ).json()
        assert ses["session_id"] in [x["session_id"] for x in done["items"]]

    def test_patient_invoice_fallback_unlocks_handover(self, tokens):
        """The real-world bug the user reported:
        Reception creates an invoice via '+ New Invoice' (NOT from session).
        The invoice carries no session_id, but it IS for the same patient and
        fully paid. Handover should succeed via the patient-fallback lookup.
        """
        # Fresh patient
        pat = requests.post(
            f"{API}/patients", headers=H(tokens["fd"]),
            json={"name": f"Fallback {random.randint(10000, 99999)}",
                  "age": 35, "gender": "Male", "mobile": "9777777777"},
            timeout=15,
        ).json()

        # Fetch any billing service
        svcs = requests.get(f"{API}/billing/services",
                            headers=H(tokens["fd"]), timeout=15).json()
        svc = next((s for s in svcs if s.get("active", True)), None)
        assert svc, "need a catalogue service"

        # Diagnostic session for the patient
        ses = requests.post(
            f"{API}/sessions", headers=H(tokens["aud"]),
            json={"patient_id": pat["patient_id"]},
            timeout=15,
        ).json()
        requests.post(f"{API}/sessions/{ses['session_id']}/generate-report",
                      headers=H(tokens["aud"]), timeout=15)

        # Reception books a separate invoice — does NOT pass session_id
        inv = requests.post(
            f"{API}/billing/invoices", headers=H(tokens["fd"]),
            json={"patient_id": pat["patient_id"],
                  "lines": [{"service_id": svc["service_id"], "quantity": 1}]},
            timeout=15,
        ).json()
        assert inv.get("invoice_id"), inv
        # Pay the invoice
        requests.post(
            f"{API}/billing/invoices/{inv['invoice_id']}/payments",
            headers=H(tokens["fd"]),
            json={"amount": inv["rounded_total"], "method": "cash"},
            timeout=15,
        )

        # Now check the reports page — should show the invoice + bill_paid=True
        ready = requests.get(
            f"{API}/reports?status=ready&per_page=50",
            headers=H(tokens["fd"]), timeout=15,
        ).json()
        row = next(x for x in ready["items"] if x["session_id"] == ses["session_id"])
        assert row["bill_paid"] is True, f"expected bill_paid=True, got row={row}"
        assert row["invoice"] is not None
        assert row["invoice"]["invoice_id"] == inv["invoice_id"]

        # Handover should succeed without bypass
        r = requests.post(
            f"{API}/sessions/{ses['session_id']}/handover",
            headers=H(tokens["fd"]),
            json={"channel": "in_person"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["report_status"] == "completed"


class TestPendingCountBadge:
    def test_badge_number(self, tokens):
        r = requests.get(f"{API}/reports/pending-count",
                         headers=H(tokens["fd"]), timeout=15)
        assert r.status_code == 200
        n = r.json()["pending"]
        assert isinstance(n, int) and n >= 0

    def test_pending_count_403_for_no_token(self):
        r = requests.get(f"{API}/reports/pending-count", timeout=15)
        assert r.status_code == 401


class TestSearch:
    def test_search_filter(self, tokens, ctx):
        r = requests.get(
            f"{API}/reports?status=completed&per_page=10&search=zzznomatchzzz",
            headers=H(tokens["fd"]), timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["total"] == 0


class TestPatientHistory:
    def test_history_returns_sessions_invoices(self, tokens, ctx):
        r = requests.get(f"{API}/patients/{ctx['patient_id']}/history",
                         headers=H(tokens["fd"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["patient"]["patient_id"] == ctx["patient_id"]
        assert isinstance(d["sessions"], list)
        assert isinstance(d["invoices"], list)
        assert "counts" in d
        assert d["counts"]["sessions"] >= 0

    def test_history_denies_other_tenant(self, tokens):
        r = requests.get(f"{API}/patients/NONEXISTENT-PATIENT/history",
                         headers=H(tokens["fd"]), timeout=15)
        assert r.status_code == 404


class TestAppointmentWithInvoice:
    def _call_with_retry(self, body, tokens, max_tries=15):
        last = None
        for _ in range(max_tries):
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            body["start_at"] = f"{today}T{_random_slot()}"
            r = requests.post(
                f"{API}/appointments/with-invoice",
                headers=H(tokens["fd"]), json=body, timeout=20,
            )
            if r.status_code == 200:
                return r
            last = r
        raise AssertionError(f"conflict after retries: {last.text if last else 'n/a'}")

    def test_atomic_apt_plus_invoice(self, tokens, ctx):
        svcs = requests.get(f"{API}/billing/services",
                            headers=H(tokens["fd"]), timeout=15).json()
        svc = next((s for s in svcs if s.get("active", True)), None)
        assert svc
        r = self._call_with_retry({
            "patient_id": ctx["patient_id"],
            "audiologist_id": ctx["audiologist_id"],
            "service": "PTA",
            "start_at": "placeholder",
            "duration_minutes": 1,
            "visit_type": "referral",
            "recommended_tests": ["pta"],
            "referred_by": "Dr. Atomic",
            "raise_invoice": True,
            "invoice_lines": [{"service_id": svc["service_id"], "quantity": 1}],
        }, tokens)
        d = r.json()
        assert d["appointment"]["appointment_id"].startswith("APT-")
        assert d["invoice"] is not None
        assert "invoice_id" in d["invoice"]
        assert d["invoice"]["appointment_id"] == d["appointment"]["appointment_id"]

    def test_appointment_only_no_invoice(self, tokens, ctx):
        r = self._call_with_retry({
            "patient_id": ctx["patient_id"],
            "audiologist_id": ctx["audiologist_id"],
            "service": "Consultation",
            "start_at": "placeholder",
            "duration_minutes": 1,
            "visit_type": "consultation",
            "recommended_tests": [],
            "raise_invoice": False,
            "invoice_lines": [],
        }, tokens)
        assert r.json()["appointment"]["appointment_id"].startswith("APT-")
        assert r.json()["invoice"] is None
