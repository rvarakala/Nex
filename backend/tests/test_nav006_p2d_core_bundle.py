"""NAV-006 Sprint-P2D — regression suite for F-005 + F-010.

Scope this file covers:
  * F-005 · `queue/complete` must log a WARN when the linked appointment
    update matches 0 rows, must NOT warn for the happy path, sessions
    without an appointment, or a session that was already completed
    (idempotency).
  * F-010 · `_stream_pdf` must NOT leak `str(e)` into the HTTPException
    detail. Server-side log line MUST still capture the full error.

F-008 is intentionally NOT covered here — it is BLOCKED on a production
DB probe the agent cannot perform (see delivery report).
F-009 and F-011 are DEFERRED per user directive.
F-012 is a frontend fix and covered by `src/__tests__/`.

Data safety
-----------
* Every fixture prefixed `TEST_S006_P2D_<uuid>`.
* Scratch clinic `clinic-nav006-p2d-*`.
* No authentication against production. No production writes.
* Every insert is undone in the `finally` block.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from motor.motor_asyncio import AsyncIOMotorClient

TAG_PREFIX = "TEST_S006_P2D"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _mkdb():
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


async def _seed_clinic_and_patient(db, tag: str) -> dict:
    clinic_id = f"clinic-nav006-p2d-{tag}"
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
        "age": 45, "gender": "Male", "active": True,
    })
    return {"clinic_id": clinic_id, "patient_id": patient_id}


async def _cleanup(db, clinic_id: str) -> None:
    for coll in ("clinics", "patients", "appointments", "test_sessions", "tokens"):
        await db[coll].delete_many({"clinic_id": clinic_id})


async def _seed_appointment(db, seeded: dict, tag: str) -> str:
    apt_id = f"APT-{TAG_PREFIX}-{tag}"
    await db.appointments.insert_one({
        "appointment_id": apt_id,
        "clinic_id": seeded["clinic_id"],
        "patient_id": seeded["patient_id"],
        "start_at": "2026-08-18T10:00:00",
        "status": "in_progress",
        "service": "PTA",
        "recommended_tests": ["PTA"],
        "visit_type": "consultation",
    })
    return apt_id


async def _seed_session(db, seeded: dict, tag: str, *,
                       appointment_id: str | None = None) -> str:
    from models import TestSession
    from utils.serde import serialize_datetime
    sess = TestSession(
        patient_id=seeded["patient_id"],
        clinic_id=seeded["clinic_id"],
        appointment_id=appointment_id,
        status="draft",
    )
    doc = serialize_datetime(sess.model_dump())
    await db.test_sessions.insert_one(doc)
    return sess.session_id


# ═══════════════════════════════════════════════════════════════════
# F-005 · queue/complete audit-log on 0-match appointment update
# ═══════════════════════════════════════════════════════════════════

async def _call_complete_diagnostics(*, session_id: str, clinic_id: str, db):
    """Direct in-process call to `POST /api/diagnostics/queue/complete`
    handler so we can capture log output without going through HTTP."""
    from routers.diagnostics_queue import complete_diagnostics, CompleteIn
    payload = CompleteIn(session_id=session_id)
    user_stub = {"clinic_id": clinic_id, "user_id": f"USR-{TAG_PREFIX}"}
    return await complete_diagnostics(payload, user=user_stub, db=db)


def test_F005_complete_with_valid_appointment_no_warning(caplog):
    """Happy path — session linked to a real appointment. Complete
    endpoint updates the appointment (matched_count == 1). No warn log."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            apt_id = await _seed_appointment(db, seeded, tag)
            sid = await _seed_session(db, seeded, tag, appointment_id=apt_id)

            with caplog.at_level(logging.WARNING, logger="audinexa.diagnostics_queue"):
                result = await _call_complete_diagnostics(
                    session_id=sid, clinic_id=seeded["clinic_id"], db=db,
                )

            assert result == {"ok": True, "session_id": sid}
            # Appointment status flipped
            apt_doc = await db.appointments.find_one({"appointment_id": apt_id})
            assert apt_doc.get("status") == "completed"
            # NO warn line
            warns = [r for r in caplog.records
                     if "appointment_update_zero" in r.getMessage()]
            assert not warns, (
                f"F-005: unexpected warn logged for happy path: {[r.getMessage() for r in warns]}"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F005_complete_with_missing_appointment_logs_warning(caplog):
    """THE PRIMARY F-005 TEST — session references an appointment that
    no longer exists in the clinic. Complete succeeds, session flips to
    completed, but a WARN line is emitted with clinic_id + session_id
    + appointment_id."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            apt_id = await _seed_appointment(db, seeded, tag)
            sid = await _seed_session(db, seeded, tag, appointment_id=apt_id)
            # Now HARD-DELETE the appointment to simulate the F-005 scenario.
            await db.appointments.delete_one({"appointment_id": apt_id})

            with caplog.at_level(logging.WARNING, logger="audinexa.diagnostics_queue"):
                result = await _call_complete_diagnostics(
                    session_id=sid, clinic_id=seeded["clinic_id"], db=db,
                )

            assert result == {"ok": True, "session_id": sid}
            sess_doc = await db.test_sessions.find_one({"session_id": sid})
            assert sess_doc.get("status") == "completed"

            warns = [r for r in caplog.records
                     if "appointment_update_zero" in r.getMessage()]
            assert len(warns) == 1, (
                "F-005: expected exactly ONE warn line on missing appointment; "
                f"got {len(warns)}: {[r.getMessage() for r in warns]}"
            )
            msg = warns[0].getMessage()
            # Structured audit trail: clinic_id, session_id, appointment_id all present.
            assert seeded["clinic_id"] in msg, (
                f"F-005: warn line missing clinic_id: {msg!r}"
            )
            assert sid in msg, f"F-005: warn line missing session_id: {msg!r}"
            assert apt_id in msg, f"F-005: warn line missing appointment_id: {msg!r}"
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F005_complete_without_linked_appointment_no_log_line(caplog):
    """Session with `appointment_id=None` (pure walk-in). The complete
    endpoint never enters the appointment-update branch, so no log line
    is emitted about a missing appointment."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            sid = await _seed_session(db, seeded, tag, appointment_id=None)

            with caplog.at_level(logging.WARNING, logger="audinexa.diagnostics_queue"):
                result = await _call_complete_diagnostics(
                    session_id=sid, clinic_id=seeded["clinic_id"], db=db,
                )

            assert result == {"ok": True, "session_id": sid}
            warns = [r for r in caplog.records
                     if "appointment_update_zero" in r.getMessage()]
            assert not warns, (
                f"F-005: unexpected warn for walk-in (no appointment): "
                f"{[r.getMessage() for r in warns]}"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F005_repeat_completion_remains_idempotent_and_no_second_warn(caplog):
    """Calling complete twice on the same session must remain idempotent
    (returns {"ok": True} both times, session stays completed). If the
    appointment still exists on the second call, the matched_count is
    still 1 (Mongo matches on filter, not on delta), so no warn line
    on either call."""
    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            apt_id = await _seed_appointment(db, seeded, tag)
            sid = await _seed_session(db, seeded, tag, appointment_id=apt_id)

            with caplog.at_level(logging.WARNING, logger="audinexa.diagnostics_queue"):
                r1 = await _call_complete_diagnostics(
                    session_id=sid, clinic_id=seeded["clinic_id"], db=db,
                )
                r2 = await _call_complete_diagnostics(
                    session_id=sid, clinic_id=seeded["clinic_id"], db=db,
                )

            assert r1 == r2 == {"ok": True, "session_id": sid}
            warns = [r for r in caplog.records
                     if "appointment_update_zero" in r.getMessage()]
            assert not warns, (
                f"F-005: no warns expected for idempotent success; "
                f"got {[r.getMessage() for r in warns]}"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


# ═══════════════════════════════════════════════════════════════════
# F-010 · _stream_pdf sanitised exception detail
# ═══════════════════════════════════════════════════════════════════

async def _call_stream_pdf(*, session_id: str, session: dict, patient: dict, db):
    """Direct in-process call to the internal `_stream_pdf` helper."""
    from routers.reports import _stream_pdf
    return await _stream_pdf(db, session_id, session, patient)


def test_F010_pdf_generation_failure_returns_generic_message(caplog):
    """THE PRIMARY F-010 TEST — force `generate_report_pdf` to raise with
    a fake sensitive detail. The HTTPException raised MUST NOT contain
    that detail. Server-side log MUST contain the full detail."""
    from fastapi import HTTPException

    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            sid = await _seed_session(db, seeded, tag)
            session = await db.test_sessions.find_one({"session_id": sid}, {"_id": 0})
            patient = {"patient_id": seeded["patient_id"], "clinic_id": seeded["clinic_id"]}

            SECRET = "SECRET_TOKEN=abc123 /etc/audinexa/private.key"

            def _boom(*a, **k):
                raise RuntimeError(SECRET)

            with caplog.at_level(logging.ERROR, logger="routers.reports"), \
                 patch("routers.reports.generate_report_pdf", side_effect=_boom):
                raised: HTTPException | None = None
                try:
                    await _call_stream_pdf(session_id=sid, session=session, patient=patient, db=db)
                except HTTPException as exc:
                    raised = exc

            assert raised is not None, "F-010: _stream_pdf must raise HTTPException on failure"
            assert raised.status_code == 500
            # ── (1) Client-facing detail must NOT contain the secret. ──
            assert SECRET not in str(raised.detail), (
                f"F-010: sensitive detail leaked in HTTPException.detail: {raised.detail!r}"
            )
            assert raised.detail == "Failed to generate PDF", (
                f"F-010: expected exact generic message; got {raised.detail!r}"
            )
            # ── (2) Server-side log MUST contain the full error. ──
            log_output = "\n".join(r.getMessage() for r in caplog.records)
            assert SECRET in log_output, (
                "F-010: full error should be logged server-side for support triage; "
                f"log did not contain the sensitive string: {log_output!r}"
            )
            assert sid in log_output, (
                f"F-010: log line should contain session_id for triage; got: {log_output!r}"
            )
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F010_uploaded_pdf_path_success_no_500(caplog):
    """Regression: when GridFS-uploaded PDF exists, `_stream_pdf` returns
    it directly and does NOT touch `generate_report_pdf`. Nothing should
    hit the F-010 exception path in the happy case."""
    from bson import ObjectId
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket

    async def _test():
        tag = uuid.uuid4().hex[:8]
        client, db = _mkdb()
        seeded = await _seed_clinic_and_patient(db, tag)
        try:
            # Upload a minimal placeholder "PDF" to GridFS.
            bucket = AsyncIOMotorGridFSBucket(db, bucket_name="session_reports")
            fs_id = await bucket.upload_from_stream(
                f"{TAG_PREFIX}-{tag}.pdf",
                b"%PDF-1.4\n%%EOF\n",
            )
            sid = await _seed_session(db, seeded, tag)
            await db.test_sessions.update_one(
                {"session_id": sid},
                {"$set": {"report_pdf_fs_id": str(fs_id)}},
            )
            session = await db.test_sessions.find_one({"session_id": sid}, {"_id": 0})
            patient = {"patient_id": seeded["patient_id"], "clinic_id": seeded["clinic_id"]}

            with caplog.at_level(logging.ERROR, logger="routers.reports"):
                resp = await _call_stream_pdf(
                    session_id=sid, session=session, patient=patient, db=db,
                )

            assert resp is not None
            # No F-010 error path traversed.
            errors = [r for r in caplog.records
                      if "pdf_generation_failed" in r.getMessage()]
            assert not errors, f"F-010: unexpected error log on happy path: {[r.getMessage() for r in errors]}"

            # Clean up the GridFS blob to keep the DB tidy.
            try:
                await bucket.delete(ObjectId(str(fs_id)))
            except Exception:  # noqa: BLE001
                pass
        finally:
            await _cleanup(db, seeded["clinic_id"])
            client.close()

    _run(_test())


def test_F010_source_no_str_e_in_stream_pdf_httpexception():
    """AST-level source guard. `_stream_pdf`'s HTTPException must not
    include an f-string with `{e}` in `detail=`. Locks the fix in place."""
    import ast
    import inspect
    import routers.reports as rpt_mod

    src = inspect.getsource(rpt_mod._stream_pdf)
    tree = ast.parse(src)

    offenders: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        # Match HTTPException(status_code=500, detail=<something with `e`>)
        func = node.func
        is_http_exc = (
            (isinstance(func, ast.Name) and func.id == "HTTPException")
            or (isinstance(func, ast.Attribute) and func.attr == "HTTPException")
        )
        if not is_http_exc:
            continue
        # Search kwargs for detail= f-string that references `e`
        for kw in node.keywords or []:
            if kw.arg != "detail":
                continue
            # detail=f"Failed to generate PDF: {e}"  → JoinedStr with a
            # FormattedValue whose value is Name('e').
            if isinstance(kw.value, ast.JoinedStr):
                for part in kw.value.values:
                    if isinstance(part, ast.FormattedValue):
                        v = part.value
                        if isinstance(v, ast.Name) and v.id == "e":
                            offenders.append(f"line {node.lineno}")
                        elif isinstance(v, ast.Attribute):
                            offenders.append(f"line {node.lineno}")

    assert not offenders, (
        f"F-010 regression: `_stream_pdf` raises HTTPException with a formatted "
        f"`detail={{e}}` at {offenders}. This leaks internal error strings to "
        "the client (especially concerning on the public share-link path). "
        "Return a generic message and log the full error server-side instead."
    )


# ═══════════════════════════════════════════════════════════════════
# F-012 · Frontend source guard — ReportsPanel re-derives patient
# ═══════════════════════════════════════════════════════════════════
#
# The frontend has no `@testing-library/react` installed and the P2D
# directive forbids introducing unrelated code changes (dependency bumps
# included). We therefore lock the F-012 fix in place with a targeted
# source-scan: the fix is small enough that a source-guard is a robust
# regression net.

def test_F012_source_reports_panel_rederives_patient_from_session():
    """`ReportsPanel.js` must contain the F-012 wiring:
      1. `livePatient` state initialised from the `patient` prop.
      2. A `useEffect` gated by `hideBuilder` that fetches
         `/api/sessions/${sessionId}` and then `/api/patients/${pid}`.
      3. `livePatient` binding used in preference to the raw prop.
    Locks the fix against future refactors that might revert to the
    stale-prop-only behaviour flagged by the P2D audit."""
    src = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "ReportsPanel.js"
    body = src.read_text(encoding="utf-8")

    assert "livePatient" in body, (
        "F-012 regression: `livePatient` state removed from ReportsPanel.js. "
        "Live editing mode will resume showing stale `activeTest.patient`."
    )
    assert "useState(patient)" in body, (
        "F-012: `livePatient` must be initialised from the `patient` prop "
        "so the first render never blanks out."
    )
    # Gate on hideBuilder so snapshot / preview viewers stay frozen.
    assert "hideBuilder" in body and "if (hideBuilder" in body, (
        "F-012: the re-derive useEffect must short-circuit when "
        "`hideBuilder` is true — snapshot viewers must not overwrite "
        "the frozen historical patient with a live fetch."
    )
    # Actual fetch pair (session → patient) must be present.
    assert "/sessions/${sessionId}" in body, (
        "F-012: ReportsPanel must fetch `/api/sessions/${sessionId}` to "
        "learn the session's authoritative patient_id."
    )
    assert "/patients/${pid}" in body, (
        "F-012: ReportsPanel must then fetch `/api/patients/${pid}` to "
        "derive the fresh patient record."
    )

