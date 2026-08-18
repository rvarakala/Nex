"""NAV-005 Sprint-3C — REG-001 through REG-004 regression suite.

Backend guards for the four registration-hardening fixes. Frontend
counterparts are exercised via the shared validators (email format,
IST-today, digits-only) but their UI wiring is verified separately in
the screenshot smoke tests.

Uses TEST DATA ONLY — every patient is prefixed `TEST_S3C_<uuid>` and
hard-deleted in the finally block so no clutter is left in the demo
tenant.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

from _helpers import API, H, login

OWNER_EMAIL = os.environ.get("MERGE_OWNER_EMAIL", "owner@thesoundclinic.in")
OWNER_PASSWORD = os.environ.get("MERGE_OWNER_PASSWORD", "demo123")

TAG_PREFIX = "TEST_S3C"


def _ist_today_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date().isoformat()


def _shift_ist(days: int) -> str:
    d = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()
    return (d + timedelta(days=days)).isoformat()


def _uniq_mobile() -> str:
    """10-digit mobile from a uuid — avoids collision with stale data."""
    return f"9{int(uuid.uuid4().int) % 1000000000:09d}"


@pytest.fixture(scope="module")
def owner_token():
    try:
        return login(OWNER_EMAIL, OWNER_PASSWORD)
    except AssertionError as e:
        pytest.skip(f"Owner login failed, skipping Sprint-3C suite: {e}")


def _create(token: str, payload: dict, *, allow_dup_phone: bool = False,
            allow_dup_email: bool = False):
    params = {}
    if allow_dup_phone:
        params["allow_duplicate_phone"] = "true"
    if allow_dup_email:
        params["allow_duplicate_email"] = "true"
    return requests.post(
        f"{API}/patients", json=payload, params=params,
        headers=H(token), timeout=15,
    )


def _delete(token: str, pid: str):
    try:
        requests.delete(f"{API}/patients/{pid}", headers=H(token), timeout=10)
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════
# REG-001 · Mobile is optional; registration without mobile still works
# ═══════════════════════════════════════════════════════════════════════

def test_reg001_mobile_omitted_still_succeeds(owner_token):
    """Walk-in / emergency patient without a mobile must register OK.
    Guards against a future accidental hard-required flip."""
    payload = {
        "name": f"{TAG_PREFIX}_no_mobile_{uuid.uuid4().hex[:6]}",
        "age": 40,
        "gender": "male",
        # NO mobile.
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, f"registration without mobile must succeed: {r.status_code} {r.text[:200]}"
        body = r.json()
        pid = body["patient_id"]
        assert body["name"] == payload["name"]
        assert body.get("mobile") in (None, "")
    finally:
        if pid:
            _delete(owner_token, pid)


# ═══════════════════════════════════════════════════════════════════════
# REG-002 · DOB / Anniversary future-date rejection (IST-based)
# ═══════════════════════════════════════════════════════════════════════

def test_reg002_dob_today_accepted(owner_token):
    """DOB == today (IST) is a legitimate newborn — must be accepted."""
    payload = {
        "name": f"{TAG_PREFIX}_dob_today_{uuid.uuid4().hex[:6]}",
        "age": 0, "gender": "female",
        "dob": _ist_today_iso(),
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, f"today's DOB must be accepted: {r.text[:200]}"
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg002_dob_yesterday_accepted(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_dob_yesterday_{uuid.uuid4().hex[:6]}",
        "age": 0, "gender": "male",
        "dob": _shift_ist(-1),
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg002_dob_tomorrow_rejected(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_dob_tomorrow_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "dob": _shift_ist(+1),
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    assert r.status_code == 422, f"future DOB must 422: got {r.status_code}"
    body = r.json()
    msg = str(body).lower()
    assert "dob" in msg and "future" in msg, f"error must mention DOB + future: {body}"


def test_reg002_dob_far_future_rejected(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_dob_2030_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "dob": "2030-01-01",
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    assert r.status_code == 422, r.text[:200]


def test_reg002_anniversary_today_accepted(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_anniv_today_{uuid.uuid4().hex[:6]}",
        "age": 40, "gender": "female",
        "anniversary_date": _ist_today_iso(),
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg002_anniversary_tomorrow_rejected(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_anniv_tomorrow_{uuid.uuid4().hex[:6]}",
        "age": 40, "gender": "female",
        "anniversary_date": _shift_ist(+1),
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    assert r.status_code == 422, r.text[:200]
    body = r.json()
    msg = str(body).lower()
    assert "anniversary" in msg and "future" in msg, f"error must mention anniversary + future: {body}"


def test_reg002_age_over_120_still_accepted(owner_token):
    """Per audit decision: age > 120 is a soft warning, NOT a rejection.
    The backend must still accept the payload; the UI is expected to
    surface the warning inline (out of scope for this backend test)."""
    payload = {
        "name": f"{TAG_PREFIX}_age_130_{uuid.uuid4().hex[:6]}",
        "age": 130, "gender": "male",
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, f"age > 120 must be a warning, not a hard reject: {r.text[:200]}"
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


# ═══════════════════════════════════════════════════════════════════════
# REG-003 · Email format validation + normalisation
# ═══════════════════════════════════════════════════════════════════════

def test_reg003_empty_email_accepted(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_no_email_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
        assert r.json().get("email") in (None, "")
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg003_valid_email_accepted_and_normalised(owner_token):
    """Uppercase + surrounding whitespace + plus-addressing all lands
    stored as trimmed lowercase per the shared validator."""
    payload = {
        "name": f"{TAG_PREFIX}_email_ok_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "email": "  Ravi.Test+Clinic@Gmail.COM  ",
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
        stored = r.json().get("email")
        assert stored == "ravi.test+clinic@gmail.com", f"expected trimmed+lowercased, got {stored!r}"
    finally:
        if pid:
            _delete(owner_token, pid)


@pytest.mark.parametrize("bad_email", [
    "raviyahoo.com",
    "ravi@",
    "@google.com",
    "ravi @gmail.com",
    "ravi@gmail",
    "no_at_sign_here.com",
])
def test_reg003_invalid_email_rejected(owner_token, bad_email):
    payload = {
        "name": f"{TAG_PREFIX}_email_bad_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "email": bad_email,
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    assert r.status_code == 422, f"bad email {bad_email!r} must 422: got {r.status_code} {r.text[:200]}"
    msg = str(r.json()).lower()
    assert "valid email" in msg or "email" in msg


@pytest.mark.parametrize("good_email", [
    "ravi@gmail.com",
    "ravi.varakala@gmail.com",
    "ravi+clinic@gmail.com",
    "ravi@subdomain.example.com",
])
def test_reg003_practical_emails_accepted(owner_token, good_email):
    payload = {
        "name": f"{TAG_PREFIX}_email_good_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "email": good_email,
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload, allow_dup_email=True)
    pid = None
    try:
        assert r.status_code == 200, f"{good_email!r} must be accepted: {r.text[:200]}"
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


# ═══════════════════════════════════════════════════════════════════════
# REG-004 · Mobile === Alternate Mobile self-collision
# ═══════════════════════════════════════════════════════════════════════

def test_reg004_mobile_only_accepted(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_mobonly_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg004_alternate_only_accepted(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_altonly_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "alternate_mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg004_different_numbers_accepted(owner_token):
    payload = {
        "name": f"{TAG_PREFIX}_bothdiff_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "mobile": _uniq_mobile(),
        "alternate_mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg004_identical_digits_rejected(owner_token):
    same = _uniq_mobile()
    payload = {
        "name": f"{TAG_PREFIX}_same_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "mobile": same,
        "alternate_mobile": same,
    }
    r = _create(owner_token, payload)
    assert r.status_code == 422, r.text[:200]
    msg = str(r.json()).lower()
    assert "mobile and alternate mobile cannot be the same" in msg


def test_reg004_same_digits_different_formatting_rejected(owner_token):
    """+91-prefix, spaces, hyphens must all collapse to the same
    last-10 comparison — behaviour must match the check-duplicate
    guard for cross-clinic phone matching."""
    base = _uniq_mobile()
    payload = {
        "name": f"{TAG_PREFIX}_format_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "mobile": base,
        "alternate_mobile": f"+91 {base[:5]} {base[5:]}",
    }
    r = _create(owner_token, payload)
    assert r.status_code == 422, f"same last-10 digits in different formats must reject: {r.status_code}"


def test_reg004_empty_both_no_collision_check(owner_token):
    """Neither mobile nor alternate provided — REG-004 is a no-op."""
    payload = {
        "name": f"{TAG_PREFIX}_bothempty_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
    }
    r = _create(owner_token, payload)
    pid = None
    try:
        assert r.status_code == 200, r.text[:200]
        pid = r.json()["patient_id"]
    finally:
        if pid:
            _delete(owner_token, pid)


def test_reg004_duplicate_phone_family_workflow_unchanged(owner_token):
    """Guardrail: REG-004 must NOT affect the existing cross-patient
    duplicate-phone workflow. Two distinct patients sharing a family
    phone must still 409 first, then 200 with the Create-Anyway
    override. This test explicitly proves REG-004 does NOT tamper
    with the family workflow."""
    shared = _uniq_mobile()
    p1_payload = {
        "name": f"{TAG_PREFIX}_family_a_{uuid.uuid4().hex[:6]}",
        "age": 55, "gender": "male",
        "mobile": shared,
    }
    r1 = _create(owner_token, p1_payload)
    pid1 = pid2 = None
    try:
        assert r1.status_code == 200, r1.text[:200]
        pid1 = r1.json()["patient_id"]

        # Second family member with same phone. First attempt → 409 (existing behaviour).
        p2_payload = {
            "name": f"{TAG_PREFIX}_family_b_{uuid.uuid4().hex[:6]}",
            "age": 52, "gender": "female",
            "mobile": shared,
        }
        r2 = _create(owner_token, p2_payload)
        assert r2.status_code == 409, f"family-share phone must still 409 (existing dup-phone workflow): {r2.status_code}"
        assert r2.json().get("detail", {}).get("code") == "duplicate_phone"

        # Retry with allow_duplicate_phone=true → 200.
        r2b = _create(owner_token, p2_payload, allow_dup_phone=True)
        assert r2b.status_code == 200, f"Create-Anyway override must still work: {r2b.text[:200]}"
        pid2 = r2b.json()["patient_id"]
    finally:
        for pid in (pid1, pid2):
            if pid:
                _delete(owner_token, pid)


# ═══════════════════════════════════════════════════════════════════════
# Cross-fix: PUT edit endpoint also enforces the same validators
# (guarding against a future refactor that decouples POST/PUT models).
# ═══════════════════════════════════════════════════════════════════════

def test_edit_flow_also_enforces_reg002_and_reg003(owner_token):
    """PUT /patients/{id} shares the PatientCreate body model, so all
    Sprint-3C validators apply symmetrically. Regression guard against
    someone splitting into PatientCreate + PatientUpdate later."""
    payload = {
        "name": f"{TAG_PREFIX}_edit_target_{uuid.uuid4().hex[:6]}",
        "age": 30, "gender": "male",
        "mobile": _uniq_mobile(),
    }
    r = _create(owner_token, payload)
    assert r.status_code == 200
    pid = r.json()["patient_id"]
    try:
        # 1. Edit → future DOB → 422
        r_bad_dob = requests.put(
            f"{API}/patients/{pid}",
            json={**payload, "dob": _shift_ist(+3)},
            headers=H(owner_token), timeout=15,
        )
        assert r_bad_dob.status_code == 422, r_bad_dob.text[:200]

        # 2. Edit → invalid email → 422
        r_bad_email = requests.put(
            f"{API}/patients/{pid}",
            json={**payload, "email": "notanemail"},
            headers=H(owner_token), timeout=15,
        )
        assert r_bad_email.status_code == 422, r_bad_email.text[:200]

        # 3. Edit → valid update → 200 with normalised email
        r_ok = requests.put(
            f"{API}/patients/{pid}",
            json={**payload, "email": "  Post.Edit@Test.Com  ", "dob": _shift_ist(-100)},
            headers=H(owner_token), timeout=15,
        )
        assert r_ok.status_code == 200, r_ok.text[:200]
        assert r_ok.json().get("email") == "post.edit@test.com"
    finally:
        _delete(owner_token, pid)
