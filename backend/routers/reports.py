"""PDF report generation + short-lived signed share-link endpoints."""
import hashlib
import io
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from auth import get_current_user
from database import get_db
from pdf_generator import generate_report_pdf
from share_token import create_share_token, decode_share_token
from utils.patient_resolution import resolve_patient_for_session
from utils.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def _token_hash(token: str) -> str:
    """SHA-256 of the raw JWT — used as a stable audit-log key without storing the token itself."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _load_session_and_patient(db, session_id: str, clinic_id: str) -> tuple[dict, dict]:
    # NAV-006 F-006 (2026-08-18) — clinic_id is filtered DIRECTLY in the query
    # so that a foreign session_id is indistinguishable from a non-existent
    # one (both return 404 here). Removes the "find first, tenant-check
    # later" defence-in-depth gap.
    session = await db.test_sessions.find_one(
        {"session_id": session_id, "clinic_id": clinic_id}, {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=404, detail="Test session not found")
    # NAV-006 F-007 (2026-08-18) — walk `patients.merged_into` + the
    # `patient_merge_events` log to find the surviving primary patient
    # when a session references a merged/hard-deleted secondary. The
    # helper is strictly clinic-scoped so no cross-tenant patient can
    # be substituted.
    patient = await resolve_patient_for_session(db, session)
    if not patient:
        # Truly orphaned — fall back to a synthetic UNKNOWN patient
        # inheriting the session's clinic so downstream renderers stay
        # tenant-safe. Reached only when direct + merge-log resolution
        # both fail (rare — patient hard-deleted with no merge trail).
        patient = {
            "patient_id": session.get("patient_id", "UNKNOWN"),
            "name": session.get("patient_name", "Unknown Patient"),
            "clinic_id": session.get("clinic_id"),
            "age": None, "gender": None, "dob": None, "phone": None,
            "referring_physician": None,
        }
    return session, patient


async def _load_user_signature_and_seal(
    db, *, user_id: Optional[str], clinic_id: str,
    include_seal_for_doc: str,
) -> tuple[Optional[bytes], Optional[bytes]]:
    """Look up the signature + (optionally) seal blobs for the signing user.

    The seal is ONLY returned when the user has opted in to the given doc
    type (`include_seal_for_doc`) via their `seal_include_on` preference.
    Failures are non-fatal — the PDF renders fine with the typed name.
    """
    if not user_id:
        return None, None
    udoc = await db.users.find_one(
        {"user_id": user_id, "clinic_id": clinic_id},
        {"_id": 0, "signature_image_fs_id": 1, "seal_image_fs_id": 1,
         "seal_include_on": 1},
    ) or {}

    sig_bytes: Optional[bytes] = None
    if udoc.get("signature_image_fs_id"):
        try:
            bucket = AsyncIOMotorGridFSBucket(db, bucket_name="user_signatures")
            stream = await bucket.open_download_stream(ObjectId(udoc["signature_image_fs_id"]))
            sig_bytes = await stream.read()
        except Exception as e:
            logger.warning(f"signature blob unreadable for user={user_id}: {e}")

    seal_bytes: Optional[bytes] = None
    seal_prefs = list(udoc.get("seal_include_on") or [])
    if include_seal_for_doc in seal_prefs and udoc.get("seal_image_fs_id"):
        try:
            bucket = AsyncIOMotorGridFSBucket(db, bucket_name="user_seals")
            stream = await bucket.open_download_stream(ObjectId(udoc["seal_image_fs_id"]))
            seal_bytes = await stream.read()
        except Exception as e:
            logger.warning(f"seal blob unreadable for user={user_id}: {e}")

    return sig_bytes, seal_bytes


async def _stream_uploaded_pdf(db, session: dict) -> StreamingResponse | None:
    """Return the client-uploaded (as-printed) PDF from GridFS, if any.

    When the audiologist clicked "Save & Print Report" we captured the live
    Report preview DOM into a PDF and stored it. That blob *is* the patient's
    report — fall through to the template generator only if the upload is missing.
    """
    fs_id = session.get("report_pdf_fs_id")
    if not fs_id:
        return None
    try:
        bucket = AsyncIOMotorGridFSBucket(db, bucket_name="session_reports")
        stream = await bucket.open_download_stream(ObjectId(fs_id))
        raw = await stream.read()
    except Exception as e:
        logger.warning(f"uploaded pdf missing or unreadable for {session.get('session_id')}: {e}")
        return None
    return StreamingResponse(
        io.BytesIO(raw),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="audiogram_report_{session.get("session_id")}.pdf"'},
    )


async def _stream_pdf(
    db, session_id: str, session: dict, patient: dict,
    *, signing_user_id: Optional[str] = None,
) -> StreamingResponse:
    uploaded = await _stream_uploaded_pdf(db, session)
    if uploaded is not None:
        return uploaded
    try:
        # Resolve signing-user identity: explicit caller wins (e.g. share-link),
        # else use the audiologist recorded on the session, else fall through
        # with no embedded image (the report still renders, just with the
        # typed name + License underline as before).
        user_id = signing_user_id or session.get("audiologist_user_id") or session.get("user_id")
        sig_png, seal_png = (None, None)
        if user_id:
            sig_png, seal_png = await _load_user_signature_and_seal(
                db,
                user_id=user_id,
                clinic_id=session.get("clinic_id") or patient.get("clinic_id") or "",
                include_seal_for_doc="audiogram",
            )
        pdf_buffer = generate_report_pdf(
            session_id, session, patient,
            signature_png=sig_png, seal_png=seal_png,
        )
        return StreamingResponse(
            pdf_buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="audiogram_report_{session_id}.pdf"'},
        )
    except Exception as e:
        logger.error(f"Error generating PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {e}")


# ---- Internal (app-authenticated) PDF fetch ----
@router.get("/reports/{session_id}/pdf")
async def generate_session_report(session_id: str,
                                  user=Depends(get_current_user), db=Depends(get_db)):
    session, patient = await _load_session_and_patient(db, session_id, user["clinic_id"])
    # NAV-006 F-006 — tenant guard is now baked into the session find_one.
    # No redundant post-fetch clinic check needed (foreign session_id → 404).
    # Use the requesting user as the signer when the session has no explicit
    # `audiologist_user_id` (covers older sessions that pre-date that field).
    return await _stream_pdf(db, session_id, session, patient,
                             signing_user_id=user.get("user_id"))


# ---- Short-lived share-link ----

@router.post("/reports/{session_id}/share-link")
async def create_report_share_link(session_id: str, request: Request,
                                   user=Depends(get_current_user), db=Depends(get_db)):
    """Mint a signed, time-limited URL that a patient can open without logging in.

    Optional body: `{"ttl_hours": <int>}` (default 168 = 7 days, max 720 = 30 days).
    """
    if user["role"] not in {"super_admin", "founder", "clinic_owner",
                            "front_desk", "accounts", "audiologist"}:
        raise HTTPException(status_code=403, detail="Not authorised to share reports")

    session, patient = await _load_session_and_patient(db, session_id, user["clinic_id"])
    # NAV-006 F-006 — tenant guard baked into the find_one. Foreign session
    # → 404 above. No redundant post-fetch clinic check.

    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    ttl_hours = int(body.get("ttl_hours") or 168)
    token, expires_at = create_share_token(session_id, user["clinic_id"], ttl_hours=ttl_hours)

    path = f"/api/reports/shared/{token}"

    # Audit. We hash the token so we can $inc a counter on access without
    # persisting the bearer secret itself.
    await db.report_share_links.insert_one({
        "session_id": session_id,
        "clinic_id": user["clinic_id"],
        "created_by_user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires_at.isoformat(),
        "ttl_hours": ttl_hours,
        "token_hash": _token_hash(token),
        "access_count": 0,
        "last_accessed_at": None,
        "last_accessed_ip": None,
    })
    return {"path": path, "token": token, "expires_at": expires_at.isoformat(), "ttl_hours": ttl_hours}


@router.get("/reports/shared/{token}")
async def get_shared_report_pdf(token: str, request: Request, db=Depends(get_db)):
    """PUBLIC endpoint — validates the signed token and streams the PDF.
    Rate-limited per IP (20 req / 60s). Access events are audited for HIPAA review."""
    enforce_rate_limit(request, "reports_shared", max_requests=20, window_seconds=60)

    payload = decode_share_token(token)
    session_id = payload["session_id"]
    claim_clinic = payload["clinic_id"]

    # NAV-006 F-006 — the signed token IS the tenant assertion for the
    # public share path. Feed `claim_clinic` into the session find_one:
    # any mismatch (forged/stolen session_id in a valid token) will 404
    # here instead of silently loading a foreign session and 401'ing
    # after the fact.
    session, patient = await _load_session_and_patient(db, session_id, claim_clinic)

    # Successful access — audit $inc. We only write if a matching mint-record
    # exists (silent no-op on legacy mints that predate the token_hash field).
    try:
        await db.report_share_links.update_one(
            {"token_hash": _token_hash(token)},
            {"$inc": {"access_count": 1},
             "$set": {"last_accessed_at": datetime.now(timezone.utc).isoformat(),
                      "last_accessed_ip": _client_ip(request)}},
        )
    except Exception as e:
        logger.warning(f"share_link.audit_update_failed: {e}")

    return await _stream_pdf(db, session_id, session, patient)


# ---- Read-only audit surface for the app ----

@router.get("/reports/{session_id}/share-audit")
async def list_share_audit(session_id: str,
                           user=Depends(get_current_user), db=Depends(get_db)):
    """Lists all share-links minted for a session (most-recent first), including
    access_count + last_accessed_at. Tenant-scoped."""
    # NAV-006 F-006 — clinic_id in the find_one; foreign session → 404
    # (existence not revealed).
    session = await db.test_sessions.find_one(
        {"session_id": session_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=404, detail="Test session not found")

    rows = await db.report_share_links.find(
        {"session_id": session_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "token_hash": 0},  # never expose the hash to the frontend
    ).sort("created_at", -1).to_list(50)
    return rows
