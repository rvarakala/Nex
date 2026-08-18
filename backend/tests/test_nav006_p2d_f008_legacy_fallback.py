"""NAV-006 · F-008 · Regression proving the legacy `db.sessions` fallback
is no longer required inside `hearing_report_versions._load_session`.

Scope this file covers ONLY F-008. F-005, F-009, F-010, F-011, F-012 are
covered elsewhere; NAV-006 P1 / P1B / P2A / P2B / P2C fixes are exercised
by their own suites.

Contract this suite locks:
  1. Valid same-clinic session in `test_sessions` → returned correctly.
  2. Unknown session_id → HTTP 404 with the exact detail contract.
  3. Foreign-clinic session_id → HTTP 404 (tenant isolation preserved).
  4. A row deliberately inserted into the legacy `db.sessions` collection
     is NEVER returned by `_load_session` — proving the fallback code
     path is gone. This is the primary post-fix guarantee.
  5. Source guard: `db.sessions.find_one(...)` no longer appears in
     `hearing_report_versions.py`.

Data safety:
  * Every fixture prefixed `TEST_S006_P2D_F008_<uuid>`.
  * Scratch clinics `clinic-nav006-p2d-f008-*` so live dashboards never
    see this data.
  * The single test that DOES write to preview `db.sessions` cleans up
    in `finally` and drops the collection if it became empty as a
    result of our test — leaves preview in exactly the state we found it.
  * NO production writes. NO burner account. NO net environment mutation.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

TAG_PREFIX = "TEST_S006_P2D_F008"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _mkdb():
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


async def _seed_clinic_and_session(db, tag: str) -> dict:
    from models import TestSession
    from utils.serde import serialize_datetime

    clinic_id = f"clinic-nav006-p2d-f008-{tag}"
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
        "active": True,
    })
    sess = TestSession(patient_id=patient_id, clinic_id=clinic_id)
    await db.test_sessions.insert_one(serialize_datetime(sess.model_dump()))
    return {
        "clinic_id": clinic_id,
        "patient_id": patient_id,
        "session_id": sess.session_id,
    }


async def _cleanup(db, clinic_id: str) -> None:
    for coll in ("clinics", "patients", "test_sessions"):
        await db[coll].delete_many({"clinic_id": clinic_id})


# ═══════════════════════════════════════════════════════════════════
# F-008 · Positive path — valid session loads from test_sessions
# ═══════════════════════════════════════════════════════════════════

def test_F008_valid_session_loads_from_test_sessions():
    """Happy path — `_load_session` returns the same-clinic session row
    from `test_sessions`. Contract identical to pre-fix behaviour."""
    async def _test():
        from routers.hearing_report_versions import _load_session
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_session(db, tag)
        try:
            doc = await _load_session(db, seeded["session_id"], seeded["clinic_id"])
            assert doc is not None
            assert doc.get("session_id") == seeded["session_id"]
            assert doc.get("clinic_id") == seeded["clinic_id"]
            assert doc.get("patient_id") == seeded["patient_id"]
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


# ═══════════════════════════════════════════════════════════════════
# F-008 · Unknown session_id → 404 preserved
# ═══════════════════════════════════════════════════════════════════

def test_F008_unknown_session_returns_404_with_existing_contract():
    """Unknown session_id must still raise HTTP 404. The exact detail
    string is preserved from the pre-fix contract so any callers that
    string-match on it don't regress."""
    async def _test():
        from routers.hearing_report_versions import _load_session
        client, db = _mkdb()
        bogus_sid = f"SES-{TAG_PREFIX}-DOES-NOT-EXIST-{uuid.uuid4().hex[:6]}"
        try:
            raised: HTTPException | None = None
            try:
                await _load_session(db, bogus_sid, "clinic-does-not-exist")
            except HTTPException as exc:
                raised = exc
            assert raised is not None
            assert raised.status_code == 404
            assert raised.detail == f"Session {bogus_sid} not found", (
                f"F-008 must preserve the exact pre-fix 404 detail; got {raised.detail!r}"
            )
        finally:
            client.close()

    _run(_test())


# ═══════════════════════════════════════════════════════════════════
# F-008 · Cross-clinic session → 404 (tenant isolation preserved)
# ═══════════════════════════════════════════════════════════════════

def test_F008_foreign_clinic_session_returns_404():
    """A session that exists in `test_sessions` but belongs to a
    different clinic must return 404 — foreign existence not revealed.
    Locks the P2A (F-006) tenant hardening in place through the F-008
    removal."""
    async def _test():
        from routers.hearing_report_versions import _load_session
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_session(db, tag)
        foreign_clinic = f"clinic-nav006-p2d-f008-{tag}-FOREIGN"
        try:
            raised: HTTPException | None = None
            try:
                await _load_session(db, seeded["session_id"], foreign_clinic)
            except HTTPException as exc:
                raised = exc
            assert raised is not None
            assert raised.status_code == 404, (
                "F-008: foreign-clinic caller must get 404 (existence not "
                f"revealed). Got {raised.status_code} instead."
            )
            assert raised.detail == f"Session {seeded['session_id']} not found"
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


# ═══════════════════════════════════════════════════════════════════
# F-008 · Legacy `db.sessions` row is NOT reachable — primary post-fix guarantee
# ═══════════════════════════════════════════════════════════════════

def test_F008_legacy_sessions_row_is_never_returned():
    """PRIMARY POST-FIX TEST.

    Insert a row into the legacy `db.sessions` collection carrying a
    same-clinic session_id (deliberately the SAME shape the pre-fix
    fallback would have returned). Then call `_load_session` and assert
    it raises 404. This proves the fallback code path is genuinely gone
    and cannot be re-introduced by an accident (would immediately fail
    this test).

    Fixture-safety: the row is prefix-tagged, the clinic is scratch,
    and the row is deleted in `finally`. If we were the only writer
    to the collection AND it is now empty, we also drop the collection
    so preview state matches production (empty)."""
    async def _test():
        from routers.hearing_report_versions import _load_session
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        clinic_id = f"clinic-nav006-p2d-f008-{tag}"
        bogus_sid = f"SES-{TAG_PREFIX}-LEGACY-{uuid.uuid4().hex[:6]}"

        # Seed a matching legacy row that a working fallback would have
        # returned. Same clinic, same session_id shape.
        await db.clinics.insert_one({
            "clinic_id": clinic_id, "name": f"{TAG_PREFIX} clinic {tag}",
        })
        legacy_doc = {
            "session_id": bogus_sid,
            "clinic_id": clinic_id,
            "patient_id": f"PT-{TAG_PREFIX}-{tag}",
            "status": "draft",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "_p2d_f008_fixture": True,  # so the finally block can be precise
        }
        await db.sessions.insert_one(legacy_doc)

        try:
            raised: HTTPException | None = None
            try:
                await _load_session(db, bogus_sid, clinic_id)
            except HTTPException as exc:
                raised = exc
            assert raised is not None, (
                "F-008 regression: `_load_session` returned a row from the "
                "legacy `db.sessions` collection. The fallback branch has "
                "been re-introduced."
            )
            assert raised.status_code == 404, (
                f"F-008: legacy row should be invisible; got {raised.status_code}"
            )
            assert raised.detail == f"Session {bogus_sid} not found"
        finally:
            # Remove ONLY our fixture. Never touch rows we didn't create.
            await db.sessions.delete_one({
                "session_id": bogus_sid, "_p2d_f008_fixture": True,
            })
            await db.clinics.delete_many({"clinic_id": clinic_id})
            # If we were the only writer to `sessions` and it is now
            # empty, drop the collection so the preview DB matches
            # production (which has no `sessions` collection at all).
            try:
                if await db.sessions.count_documents({}) == 0:
                    await db.drop_collection("sessions")
            except Exception:  # noqa: BLE001
                # Collection ops are best-effort cleanup only. Test
                # correctness never depends on this succeeding.
                pass
            client.close()

    _run(_test())


# ═══════════════════════════════════════════════════════════════════
# F-008 · Source guard — no more `db.sessions.` in hearing_report_versions
# ═══════════════════════════════════════════════════════════════════

def test_F008_source_no_legacy_db_sessions_reference():
    """Static guard: `hearing_report_versions.py` must contain zero
    `db.sessions.` references. Locks the fix against copy-paste
    reintroduction. (Note: `db.hearing_report_versions.` and
    `db.test_sessions.` are separate identifiers and MUST NOT be
    flagged — we look for the exact literal `db.sessions.` token.)"""
    import routers.hearing_report_versions as hrv_mod
    src = inspect.getsource(hrv_mod)
    # Line-by-line scan so we can report line numbers cleanly.
    offenders: list[str] = []
    for i, line in enumerate(src.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("#") or stripped.startswith('"'):
            # Ignore comments and docstrings — the fix's own docstring
            # legitimately mentions `db.sessions` in prose.
            continue
        if "db.sessions." in line:
            offenders.append(f"line {i}: {line.strip()!r}")

    assert not offenders, (
        "F-008 regression: `db.sessions.` reference reintroduced in "
        f"backend/routers/hearing_report_versions.py:\n  " + "\n  ".join(offenders)
    )
