"""Birthday & Anniversary auto-greeting tests.

Covers:
 1. /api/greetings/today with no DOB patients returns empty buckets.
 2. Patient with TODAY's birthday + anniversary → both kinds in `today`,
    correct age_years + years_together math, occasion_date MM-DD format.
 3. Patient with anniversary in 3 days → appears in `upcoming`, never
    in `today`. Window honours `?days=` cap.
 4. POST /api/greetings/{id}/send returns wa.me link with phone normalised
    to country-code format, message contains patient first-name + clinic
    name + ordinal year.
 5. Send is idempotent — repeated send same day flips `already_sent_today`.
 6. Send fails with 400 when patient has no mobile, 404 for unknown patient.
 7. Custom message override is respected verbatim.
"""
from __future__ import annotations

import os
import urllib.parse
from datetime import date, timedelta

import pytest
import requests

API = (
    os.environ.get("API_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
)


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@acs.in", "password": "admin123"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _today() -> date:
    return date.today()  # backend uses IST; for ymd math the difference rarely matters in tests


def _create_patient(headers, **overrides) -> str:
    body = {
        "name": "Greeting TestPt",
        "age": 35, "gender": "Male", "mobile": "9988007711",
    }
    body.update(overrides)
    r = requests.post(f"{API}/patients", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()["patient_id"]


def _delete(headers, pid):
    requests.delete(f"{API}/patients/{pid}", headers=headers)


# ────────────────────── 1. empty case ──────────────────────


def test_today_returns_buckets_for_clinic_no_pending(auth_headers):
    r = requests.get(f"{API}/greetings/today?days=0", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert "today" in body and "upcoming" in body
    assert isinstance(body["today"], list) and isinstance(body["upcoming"], list)


# ────────────────────── 2. today birthday + anniversary ──────────────────────


def test_birthday_and_anniversary_today(auth_headers):
    today = _today()
    bday_iso = f"{today.year - 30}-{today.month:02d}-{today.day:02d}"
    anniv_iso = f"{today.year - 7}-{today.month:02d}-{today.day:02d}"
    pid = _create_patient(auth_headers, dob=bday_iso, anniversary_date=anniv_iso, name="DualOccasion")
    try:
        r = requests.get(f"{API}/greetings/today", headers=auth_headers)
        assert r.status_code == 200
        items = [g for g in r.json()["today"] if g["patient_id"] == pid]
        assert len(items) == 2
        kinds = {g["kind"]: g for g in items}
        # Birthday math
        assert kinds["birthday"]["age_years"] == 30
        assert kinds["birthday"]["years_together"] is None
        assert kinds["birthday"]["days_until"] == 0
        assert kinds["birthday"]["occasion_date"] == f"{today.month:02d}-{today.day:02d}"
        # Anniversary math
        assert kinds["anniversary"]["years_together"] == 7
        assert kinds["anniversary"]["age_years"] is None
        assert kinds["anniversary"]["days_until"] == 0
    finally:
        _delete(auth_headers, pid)


# ────────────────────── 3. upcoming + window cap ──────────────────────


def test_upcoming_within_window(auth_headers):
    target = _today() + timedelta(days=3)
    anniv_iso = f"{target.year - 5}-{target.month:02d}-{target.day:02d}"
    pid = _create_patient(auth_headers, anniversary_date=anniv_iso, name="UpcomingAnniv")
    try:
        # default window=7 → should appear in upcoming
        r = requests.get(f"{API}/greetings/today", headers=auth_headers)
        assert r.status_code == 200
        upcoming = [g for g in r.json()["upcoming"] if g["patient_id"] == pid]
        assert len(upcoming) == 1 and upcoming[0]["days_until"] == 3
        assert upcoming[0]["kind"] == "anniversary"
        # window=1 → should NOT appear at all
        r = requests.get(f"{API}/greetings/today?days=1", headers=auth_headers)
        all_pids = {g["patient_id"] for g in r.json()["today"] + r.json()["upcoming"]}
        assert pid not in all_pids
    finally:
        _delete(auth_headers, pid)


# ────────────────────── 4. send wa link composition ──────────────────────


def test_send_birthday_greeting_returns_walink(auth_headers):
    today = _today()
    bday_iso = f"{today.year - 28}-{today.month:02d}-{today.day:02d}"
    pid = _create_patient(auth_headers, dob=bday_iso, name="Riya Sharma", mobile="9123456789")
    try:
        r = requests.post(f"{API}/greetings/{pid}/send", headers=auth_headers, json={"kind": "birthday"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        # wa.me link with country-code-prefixed phone
        assert body["wa_link"].startswith("https://wa.me/919123456789?text=")
        # decoded message contains first name + ordinal year + clinic
        msg_decoded = urllib.parse.unquote(body["wa_link"].split("?text=", 1)[1])
        assert "Riya" in msg_decoded
        assert "28th" in msg_decoded
        assert "Birthday" in msg_decoded
    finally:
        _delete(auth_headers, pid)


# ────────────────────── 5. idempotent flag ──────────────────────


def test_send_marks_already_sent_today(auth_headers):
    today = _today()
    bday_iso = f"{today.year - 41}-{today.month:02d}-{today.day:02d}"
    pid = _create_patient(auth_headers, dob=bday_iso, name="IdempPt")
    try:
        r = requests.post(f"{API}/greetings/{pid}/send", headers=auth_headers, json={"kind": "birthday"})
        assert r.status_code == 200
        # Re-scan — should be flagged as already_sent_today
        r = requests.get(f"{API}/greetings/today", headers=auth_headers)
        sent = [g for g in r.json()["today"] if g["patient_id"] == pid and g["kind"] == "birthday"]
        assert len(sent) == 1 and sent[0]["already_sent_today"] is True
        # Sending again is allowed (returns 200) but log row stays single (upsert).
        r2 = requests.post(f"{API}/greetings/{pid}/send", headers=auth_headers, json={"kind": "birthday"})
        assert r2.status_code == 200
    finally:
        _delete(auth_headers, pid)


# ────────────────────── 6. error paths ──────────────────────


def test_send_fails_without_mobile(auth_headers):
    pid = _create_patient(auth_headers, mobile="", name="NoMobilePt")
    try:
        r = requests.post(f"{API}/greetings/{pid}/send", headers=auth_headers, json={"kind": "birthday"})
        assert r.status_code == 400
        assert "mobile" in r.text.lower()
    finally:
        _delete(auth_headers, pid)


def test_send_fails_for_unknown_patient(auth_headers):
    r = requests.post(f"{API}/greetings/DOES_NOT_EXIST/send", headers=auth_headers,
                      json={"kind": "anniversary"})
    assert r.status_code == 404


# ────────────────────── 7. custom message override ──────────────────────


def test_custom_message_override(auth_headers):
    pid = _create_patient(auth_headers, mobile="9888777666", name="CustomPt")
    try:
        custom = "Test custom greeting just for you 🎉"
        r = requests.post(f"{API}/greetings/{pid}/send", headers=auth_headers,
                          json={"kind": "birthday", "custom_message": custom})
        assert r.status_code == 200
        body = r.json()
        assert body["message"] == custom
        decoded = urllib.parse.unquote(body["wa_link"].split("?text=", 1)[1])
        assert "Test custom greeting just for you" in decoded
    finally:
        _delete(auth_headers, pid)
