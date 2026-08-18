"""NAV-006 Sprint-P2C — reproduces F-003 (IST/UTC "today" boundary) and
F-004-B (naive datetime writes to `test_sessions.updated_at`) on the
CURRENT code, then verifies the surgical fix.

Scope: F-003 and F-004-B ONLY. Nothing else in NAV-006 (F-001, F-002,
F-004-A, F-005, F-006, F-007, F-008-F-012, F-013) is exercised or
modified here.

Approach
--------
Both defects live inside `backend/routers/test_sessions.py`:

* F-003 · line 66: `today_prefix = datetime.utcnow().strftime("%Y-%m-%d")`
  — auto-discover branch of `POST /api/sessions`. During 00:00–05:30
  IST, UTC clock is on the *previous* day, so the regex prefix filters
  YESTERDAY (UTC) and misses IST-today's scheduled appointment. Fix:
  swap to `ist_today_ymd()`.
* F-004-B · line 130: `update_data["updated_at"] = datetime.utcnow()`
  — writes a *naive* datetime while every other write in the codebase
  uses `datetime.now(timezone.utc)` (aware). Mixed-source comparisons
  can raise `TypeError`. Fix: swap to `datetime.now(timezone.utc)`.

To reproduce F-003 without waiting for 02:00 IST, we monkeypatch the
`datetime` class in `routers.test_sessions` AND in `utils.ist` to a
subclass whose `.utcnow()` / `.now(tz)` return a frozen instant. The
frozen instant is 20:30 UTC on day D  ↔  02:00 IST on day D+1.

Data safety
-----------
* Every fixture prefixed `TEST_S006_P2C_<uuid>`.
* Each test builds a scratch clinic (`clinic-nav006-p2c-*`) so the
  pytest tenant's dashboards never see this data.
* Every insert is undone in the `finally` block.
* No production data touched. Preview-only.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from _helpers import ADMIN_CLINIC_ID  # noqa: F401 — imported for parity with other P2 files


# ────────────────────────────────────────────────────────────────
# Common infrastructure
# ────────────────────────────────────────────────────────────────

TAG_PREFIX = "TEST_S006_P2C"
IST = timezone(timedelta(hours=5, minutes=30))


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _mkdb():
    """Motor client bound to the same MONGO_URL / DB_NAME the server uses."""
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


def _make_frozen_datetime(fake_utc: datetime):
    """Return a `datetime`-subclass whose classmethods (`utcnow`, `now`)
    always return the supplied UTC-naive instant (or its projection
    into a caller-supplied tz).

    Applied to both `routers.test_sessions.datetime` (F-003 direct
    utcnow site) and `utils.ist.datetime` (so `ist_today_ymd()`
    consults the same frozen clock)."""
    if fake_utc.tzinfo is not None:
        raise ValueError("fake_utc must be UTC-naive (matches datetime.utcnow() shape)")
    fake_utc_aware = fake_utc.replace(tzinfo=timezone.utc)

    class _FakeDT(datetime):
        @classmethod
        def utcnow(cls):
            return fake_utc

        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fake_utc
            return fake_utc_aware.astimezone(tz)

    return _FakeDT


async def _seed_clinic_and_patient(db, tag: str) -> dict:
    """Create a scratch clinic + patient. Returns identifiers."""
    clinic_id = f"clinic-nav006-p2c-{tag}"
    patient_id = f"PT-{TAG_PREFIX}-{tag}"
    await db.clinics.insert_one({
        "clinic_id": clinic_id,
        "name": f"{TAG_PREFIX} clinic {tag}",
        "subscription_tier": "PREMIUM",
    })
    await db.patients.insert_one({
        "patient_id": patient_id,
        "clinic_id": clinic_id,
        "name": f"{TAG_PREFIX} patient {tag}",
        "age": 45,
        "gender": "Male",
        "active": True,
    })
    return {"clinic_id": clinic_id, "patient_id": patient_id}


async def _cleanup(db, clinic_id: str) -> None:
    for coll in ("clinics", "patients", "appointments", "test_sessions", "tokens"):
        await db[coll].delete_many({"clinic_id": clinic_id})


# ────────────────────────────────────────────────────────────────
# F-003 · IST/UTC "today" boundary in auto-discover
# ────────────────────────────────────────────────────────────────

async def _call_create_test_session(*, patient_id: str, clinic_id: str, db,
                                    appointment_id: str | None = None):
    """Direct in-process call to `POST /api/sessions` handler — bypasses
    HTTP so we can monkeypatch the module clock atomically per test."""
    from models import TestSessionCreate
    from routers.test_sessions import create_test_session

    payload = TestSessionCreate(
        patient_id=patient_id,
        audiologist_name="P2C Audiologist",
        appointment_id=appointment_id,
    )
    user_stub = {"clinic_id": clinic_id, "user_id": f"USR-{TAG_PREFIX}"}
    return await create_test_session(payload, user=user_stub, db=db)


def test_F003_repro_ist_midnight_walkin_should_link_ist_today_appointment():
    """THE PRIMARY F-003 SAFETY TEST.

    At 02:00 IST (i.e. 20:30 UTC of the *previous* UTC-day), a walk-in
    session created without an explicit `appointment_id` must be
    auto-linked to the patient's IST-today morning appointment.

    Pre-fix (uses UTC prefix): the regex is `^<UTC-D-1>` → misses the
    IST-today appointment (`start_at="<IST-D>T04:30:00"`) → session
    persists with `appointment_id=None`, `visit_type="walkin"`, and no
    prefilled recommended_tests. Bug reproduced.

    Post-fix (uses `ist_today_ymd()`): the regex is `^<IST-D>` → matches
    → session persists with the appointment_id and inherits its
    `visit_type` / `recommended_tests` / `referred_by`.
    """
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            # 20:30 UTC on day D  ↔  02:00 IST on day D+1
            fake_utc = datetime(2026, 8, 17, 20, 30, 0)
            ist_today_ymd = "2026-08-18"  # (D+1) in IST

            apt_id = f"APT-{TAG_PREFIX}-{tag}"
            await db.appointments.insert_one({
                "appointment_id": apt_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                # Appointments are stored as IST-wall-clock ISO strings.
                "start_at": f"{ist_today_ymd}T04:30:00",
                "status": "scheduled",
                "service": "PTA",
                "priority": "normal",
                "recommended_tests": ["PTA", "Immittance"],
                "visit_type": "consultation",
                "referred_by": "Dr F003 Referral",
            })

            _FakeDT = _make_frozen_datetime(fake_utc)
            with patch("routers.test_sessions.datetime", _FakeDT), \
                 patch("utils.ist.datetime", _FakeDT):
                sess = await _call_create_test_session(
                    patient_id=seeded["patient_id"],
                    clinic_id=seeded["clinic_id"],
                    db=db,
                )

            assert sess.appointment_id == apt_id, (
                f"F-003: at 02:00 IST the auto-discover missed today's "
                f"IST appointment. Expected appointment_id={apt_id!r}, "
                f"got {sess.appointment_id!r}. UTC prefix used instead "
                "of IST prefix — swap to `ist_today_ymd()`."
            )
            assert sess.visit_type == "consultation", (
                "F-003: visit_type should be inherited from the linked "
                f"appointment; got {sess.visit_type!r}"
            )
            assert sess.recommended_tests == ["PTA", "Immittance"], (
                "F-003: recommended_tests should be inherited from the "
                f"linked appointment; got {sess.recommended_tests!r}"
            )
            assert sess.referred_by == "Dr F003 Referral"
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F003_previous_ist_day_appointment_not_linked_after_boundary():
    """Guard against over-matching. If we're at 02:00 IST on day D+1
    and the only appointment for this patient was scheduled on day D
    (IST), the auto-discover must NOT link it.

    Pre-fix: UTC-D matches an IST-D appointment (regex `^<UTC-D>`
    picks up `start_at="<IST-D>T09:00:00"`). WRONG — the audiologist
    is starting a fresh visit on day D+1 and the yesterday's appointment
    is stale.

    Post-fix: IST prefix is <D+1>. IST-D appointment doesn't match.
    Session persists with `appointment_id=None` — correct clean walk-in.
    """
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            # 20:30 UTC on day D  ↔  02:00 IST on day D+1
            fake_utc = datetime(2026, 8, 17, 20, 30, 0)
            ist_yesterday_ymd = "2026-08-17"  # (D) in IST

            apt_id = f"APT-{TAG_PREFIX}-{tag}-YDAY"
            await db.appointments.insert_one({
                "appointment_id": apt_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "start_at": f"{ist_yesterday_ymd}T09:00:00",
                "status": "scheduled",
                "service": "PTA",
                "recommended_tests": ["PTA"],
                "visit_type": "consultation",
            })

            _FakeDT = _make_frozen_datetime(fake_utc)
            with patch("routers.test_sessions.datetime", _FakeDT), \
                 patch("utils.ist.datetime", _FakeDT):
                sess = await _call_create_test_session(
                    patient_id=seeded["patient_id"],
                    clinic_id=seeded["clinic_id"],
                    db=db,
                )

            assert sess.appointment_id is None, (
                "F-003 (reverse): yesterday's IST appointment was "
                f"wrongly auto-linked. Got appointment_id={sess.appointment_id!r} "
                f"(expected None). Auto-discover leaked yesterday into today."
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F003_daytime_ist_no_boundary_regression_link_works():
    """Regression control. At mid-day IST (UTC and IST agree), the
    existing behaviour must be preserved."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            # 08:30 UTC ↔ 14:00 IST — same calendar date on both clocks
            fake_utc = datetime(2026, 8, 18, 8, 30, 0)
            same_day_ymd = "2026-08-18"

            apt_id = f"APT-{TAG_PREFIX}-{tag}-NOON"
            await db.appointments.insert_one({
                "appointment_id": apt_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "start_at": f"{same_day_ymd}T15:00:00",
                "status": "scheduled",
                "service": "PTA",
                "recommended_tests": ["PTA"],
                "visit_type": "walkin",
            })

            _FakeDT = _make_frozen_datetime(fake_utc)
            with patch("routers.test_sessions.datetime", _FakeDT), \
                 patch("utils.ist.datetime", _FakeDT):
                sess = await _call_create_test_session(
                    patient_id=seeded["patient_id"],
                    clinic_id=seeded["clinic_id"],
                    db=db,
                )

            assert sess.appointment_id == apt_id, (
                f"F-003 regression: daytime-IST auto-link broke. "
                f"Expected {apt_id!r}, got {sess.appointment_id!r}"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F003_explicit_appointment_id_unaffected_by_boundary():
    """Sanity — the with-explicit-id branch was fixed by NAV-006 F-002.
    It uses a direct lookup and must be immune to the IST/UTC boundary."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            fake_utc = datetime(2026, 8, 17, 20, 30, 0)  # 02:00 IST boundary
            ist_today_ymd = "2026-08-18"

            apt_id = f"APT-{TAG_PREFIX}-{tag}-EXP"
            await db.appointments.insert_one({
                "appointment_id": apt_id,
                "clinic_id": seeded["clinic_id"],
                "patient_id": seeded["patient_id"],
                "start_at": f"{ist_today_ymd}T04:30:00",
                "status": "scheduled",
                "service": "PTA",
                "recommended_tests": ["PTA"],
                "visit_type": "consultation",
            })

            _FakeDT = _make_frozen_datetime(fake_utc)
            with patch("routers.test_sessions.datetime", _FakeDT), \
                 patch("utils.ist.datetime", _FakeDT):
                sess = await _call_create_test_session(
                    patient_id=seeded["patient_id"],
                    clinic_id=seeded["clinic_id"],
                    db=db,
                    appointment_id=apt_id,
                )

            assert sess.appointment_id == apt_id, (
                f"explicit-id branch must link regardless of boundary; "
                f"got {sess.appointment_id!r}"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F003_no_matching_appointment_still_creates_walkin_session():
    """Fallback — no appointment exists for the patient today. The
    endpoint must still create a walk-in session with appointment_id=None."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            fake_utc = datetime(2026, 8, 17, 20, 30, 0)  # 02:00 IST boundary

            _FakeDT = _make_frozen_datetime(fake_utc)
            with patch("routers.test_sessions.datetime", _FakeDT), \
                 patch("utils.ist.datetime", _FakeDT):
                sess = await _call_create_test_session(
                    patient_id=seeded["patient_id"],
                    clinic_id=seeded["clinic_id"],
                    db=db,
                )

            assert sess.appointment_id is None
            assert sess.status == "draft"
            assert sess.clinic_id == seeded["clinic_id"]
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


# ────────────────────────────────────────────────────────────────
# F-004-B · Timezone-aware `updated_at` on PUT /api/sessions/{id}
# ────────────────────────────────────────────────────────────────

async def _seed_session(db, seeded: dict, *, updated_at: datetime | str | None = None) -> str:
    """Insert a draft session directly (bypasses the create endpoint)
    so F-004-B tests can construct a specific starting state."""
    from models import TestSession
    from utils.serde import serialize_datetime

    sess = TestSession(
        patient_id=seeded["patient_id"],
        clinic_id=seeded["clinic_id"],
    )
    doc = serialize_datetime(sess.model_dump())
    if updated_at is not None:
        # For the legacy-naive test we want to inject a naive ISO string
        # or a datetime object that bypasses `serialize_datetime`.
        doc["updated_at"] = updated_at if isinstance(updated_at, str) else updated_at.isoformat()
    await db.test_sessions.insert_one(doc)
    return sess.session_id


async def _call_update_test_session(*, session_id: str, clinic_id: str, db,
                                    chief_complaint: str = "F004B updated"):
    """Direct in-process call to `PUT /api/sessions/{id}` handler."""
    from models import TestSessionUpdate
    from routers.test_sessions import update_test_session

    payload = TestSessionUpdate(chief_complaint=chief_complaint)
    user_stub = {"clinic_id": clinic_id, "user_id": f"USR-{TAG_PREFIX}"}
    return await update_test_session(session_id, payload, user=user_stub, db=db)


def test_F004B_update_writes_timezone_aware_updated_at():
    """THE PRIMARY F-004-B TEST.

    Spy on the dict passed into `serialize_datetime` from inside
    `update_test_session`. The `updated_at` value at that call-site
    must be a *tz-aware* datetime.

    Pre-fix: `datetime.utcnow()` → `datetime` instance with
    `tzinfo is None`. **Fails.**

    Post-fix: `datetime.now(timezone.utc)` → `datetime` instance with
    `tzinfo == timezone.utc`. **Passes.**

    (Both variants happen to serialise to strings that look identical
    at the wire, because `serialize_datetime` stamps `+00:00` on naive
    values. The bug lies in the in-memory object type — see
    NAV-006 P2 audit § F-004-B.)
    """
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            sid = await _seed_session(db, seeded)

            captured: dict = {}
            import routers.test_sessions as ts_mod
            real_serialize = ts_mod.serialize_datetime

            def _spy(obj):
                if isinstance(obj, dict) and "updated_at" in obj:
                    captured["updated_at"] = obj["updated_at"]
                return real_serialize(obj)

            with patch("routers.test_sessions.serialize_datetime", _spy):
                await _call_update_test_session(
                    session_id=sid, clinic_id=seeded["clinic_id"], db=db,
                )

            ua = captured.get("updated_at")
            assert isinstance(ua, datetime), (
                f"F-004-B spy missed the `updated_at` write; captured={captured!r}"
            )
            assert ua.tzinfo is not None, (
                "F-004-B: `updated_at` is a *naive* datetime — must be "
                "tz-aware (e.g., `datetime.now(timezone.utc)`). Naive/aware "
                "comparisons elsewhere in the codebase will raise TypeError."
            )
            # Additionally confirm it is UTC-anchored (the audit's specific
            # remediation), not some arbitrary offset.
            assert ua.utcoffset() == timedelta(0), (
                f"F-004-B: `updated_at` tzinfo is not UTC; got {ua.tzinfo!r}"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F004B_response_updated_at_iso_string_has_utc_offset():
    """API response wire-contract stability. `updated_at` in the JSON
    response must be an ISO string with an explicit UTC offset so JS
    `new Date(...)` parses it correctly."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            sid = await _seed_session(db, seeded)

            resp = await _call_update_test_session(
                session_id=sid, clinic_id=seeded["clinic_id"], db=db,
            )

            # Direct-call returns the deserialised dict. `updated_at` is
            # projected to an ISO string with an explicit offset by
            # `deserialize_datetime` (the key is in STRING_DATE_KEYS).
            # HTTP-mode Pydantic then parses this string back to a
            # tz-aware `datetime` for the wire.
            ua = resp.get("updated_at") if isinstance(resp, dict) else resp.updated_at
            assert ua is not None
            if isinstance(ua, str):
                # Must be ISO with an explicit offset — `+00:00` or `Z`.
                assert ua.endswith("+00:00") or ua.endswith("Z"), (
                    f"F-004-B wire contract: `updated_at` string must carry UTC offset; got {ua!r}"
                )
                parsed = datetime.fromisoformat(ua.replace("Z", "+00:00"))
                assert parsed.tzinfo is not None
                assert parsed.utcoffset() == timedelta(0)
            else:
                assert ua.tzinfo is not None, (
                    f"F-004-B: response `updated_at` should be tz-aware; got {ua!r}"
                )
                assert ua.utcoffset() == timedelta(0)
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F004B_legacy_naive_updated_at_still_readable_via_get():
    """Backwards-compat: pre-fix rows stored `updated_at` as ISO strings
    without an offset. GET /api/sessions/{id} must continue to render
    them (the deserialiser stamps +00:00). Prevents any P2C regression
    from breaking already-persisted rows."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            # Simulate a legacy row: naive ISO string (no +00:00 suffix).
            legacy_iso = "2026-01-15T09:30:00"
            sid = await _seed_session(db, seeded, updated_at=legacy_iso)

            from routers.test_sessions import get_test_session
            user_stub = {"clinic_id": seeded["clinic_id"], "user_id": f"USR-{TAG_PREFIX}"}
            resp = await get_test_session(sid, user=user_stub, db=db)

            ua = resp.get("updated_at") if isinstance(resp, dict) else resp.updated_at
            assert ua is not None
            # `updated_at` is kept as an ISO string by `deserialize_datetime`
            # (it's in STRING_DATE_KEYS). The legacy naive string gets the
            # `+00:00` suffix stamped so JS clients parse it as UTC.
            if isinstance(ua, str):
                assert ua.endswith("+00:00") or ua.endswith("Z"), (
                    f"legacy naive `updated_at` should be up-converted with "
                    f"a UTC offset; got {ua!r}"
                )
                # The moment itself must be preserved.
                assert ua.startswith("2026-01-15T09:30:00"), (
                    f"legacy value drifted; got {ua!r}"
                )
            else:
                assert ua.tzinfo is not None
                assert ua.strftime("%Y-%m-%dT%H:%M:%S") == "2026-01-15T09:30:00"
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F004B_mixed_sources_sort_by_updated_at_no_typeerror():
    """Latent-bug guard: after the fix, sessions written by BOTH the
    legacy naive path AND the new tz-aware path can be sorted together
    in Python without a `TypeError: can't compare offset-naive and
    offset-aware datetimes`.

    We simulate two rows (one legacy naive ISO, one modern aware ISO),
    fetch them via GET /api/sessions, and sort the returned Pydantic
    objects by `updated_at` in Python — must not raise."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            legacy_sid = await _seed_session(db, seeded, updated_at="2026-01-15T09:30:00")
            modern_sid = await _seed_session(
                db, seeded, updated_at="2026-01-15T10:30:00+00:00",
            )

            from routers.test_sessions import get_test_sessions
            user_stub = {"clinic_id": seeded["clinic_id"], "user_id": f"USR-{TAG_PREFIX}"}
            rows = await get_test_sessions(
                patient_id=seeded["patient_id"], user=user_stub, db=db,
            )

            # get_test_sessions returns List[dict] when called directly (the
            # `response_model=List[TestSession]` projection only fires on the
            # HTTP path).
            def _sid(r):
                return r.get("session_id") if isinstance(r, dict) else r.session_id

            def _ua(r):
                return r.get("updated_at") if isinstance(r, dict) else r.updated_at

            our = [r for r in rows if _sid(r) in (legacy_sid, modern_sid)]
            assert len(our) == 2, f"expected 2 rows, got {len(our)}"

            # This must not raise TypeError.
            sorted_rows = sorted(our, key=_ua)
            # Legacy 09:30 < modern 10:30, both UTC.
            assert _sid(sorted_rows[0]) == legacy_sid
            assert _sid(sorted_rows[1]) == modern_sid
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


# ────────────────────────────────────────────────────────────────
# Source-level confirmation — locks the fix in place
# ────────────────────────────────────────────────────────────────

def test_F003_and_F004B_source_no_datetime_utcnow_in_router():
    """Static AST check: `routers/test_sessions.py` must no longer contain
    any actual `datetime.utcnow()` call sites after the P2C fix. Guards
    against regression from copy-paste refactors. Comments and docstrings
    that *mention* the phrase are ignored (this test walks the AST)."""
    import ast
    import routers.test_sessions as ts_mod

    src = inspect.getsource(ts_mod)
    tree = ast.parse(src)

    offenders: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        # Match `datetime.utcnow(...)` — Attribute(value=Name('datetime'), attr='utcnow')
        func = node.func
        if (
            isinstance(func, ast.Attribute)
            and func.attr == "utcnow"
            and isinstance(func.value, ast.Name)
            and func.value.id == "datetime"
        ):
            offenders.append(f"line {node.lineno}")

    assert not offenders, (
        "P2C regression: `datetime.utcnow()` call site(s) reintroduced in "
        f"backend/routers/test_sessions.py at {offenders}. F-003 requires "
        "`ist_today_ymd()` for the today-prefix; F-004-B requires "
        "`datetime.now(timezone.utc)` for `updated_at`."
    )
