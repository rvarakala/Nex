"""Notify a referring doctor when their referred patient hits a milestone.

Fires WhatsApp thank-you messages via MSG91 IFF the doctor has explicitly
opted in for that stream (`notify_on_diag=True` or `notify_on_ha=True`).

Design decisions:
  • **Fire-and-forget** — call sites `asyncio.create_task(notify_...)`
    so the milestone (session complete / HA delivered) is never blocked
    by MSG91 latency or downtime.
  • **Silent no-op** when the doctor hasn't opted in, has no phone, or
    the clinic's MSG91 isn't configured. Every attempt (success OR
    silent skip) is written to `referral_notifications` so owners can
    audit what was actually sent.
  • **Templated messaging** — uses a well-known template name so it's
    easy to swap providers without touching business logic.

The message text mirrors the existing `audinexa_templates` module style
(informal, one line, patient anonymised beyond first-name to protect PII).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

log = logging.getLogger("audinexa.ref_docs.notify")

# Stream literal — matches the two opt-in flags on ReferringDoctor
Stream = Literal["diagnostics", "ha_sales"]

# Templates registered on our MSG91 hosted account. When rolling to a
# BYOG clinic, they need to approve identical template names on their
# own MSG91 workspace. Both templates take ONE {{1}} substitution:
# the patient's first name.
TEMPLATE_NAMES = {
    "diagnostics": "audinexa_refdoc_thanks_diagnostics",
    "ha_sales":    "audinexa_refdoc_thanks_ha",
}
TEMPLATE_NAMESPACE = "audinexa_v1"
LANGUAGE_CODE = "en"

# Fallback message text used only for the audit log — the actual copy
# on WhatsApp comes from the approved MSG91 template. Keeps the log
# reviewable even if the template body changes upstream.
FALLBACK_MSG = {
    "diagnostics": (
        "Thanks for referring {patient_first} to our clinic. "
        "Their hearing evaluation is complete — report can be shared on request."
    ),
    "ha_sales": (
        "Thanks for referring {patient_first} to our clinic. "
        "They've been fitted with hearing aids — we appreciate your trust."
    ),
}


async def notify_referring_doctor(
    db,
    clinic_id: str,
    patient_id: str,
    stream: Stream,
) -> dict:
    """Send a WhatsApp thank-you to a patient's referring doctor.

    Never raises. Returns a status dict for logging + tests.
    Everything is journalled to `referral_notifications` regardless
    of outcome so owners can audit what was and wasn't sent.
    """
    now = datetime.now(timezone.utc)
    entry = {
        "notif_id":   f"REFNOTIF-{uuid4().hex[:10].upper()}",
        "clinic_id":  clinic_id,
        "patient_id": patient_id,
        "stream":     stream,
        "created_at": now,
        "status":     "skipped",
        "reason":     None,
        "provider":   None,
        "request_id": None,
    }

    try:
        patient = await db.patients.find_one(
            {"clinic_id": clinic_id, "patient_id": patient_id},
            {"_id": 0, "name": 1, "referring_doctor_id": 1},
        )
        if not patient:
            entry["reason"] = "patient_not_found"
            await db.referral_notifications.insert_one(entry)
            return {"ok": False, "status": "skipped", "reason": entry["reason"]}

        doctor_id = patient.get("referring_doctor_id")
        if not doctor_id:
            entry["reason"] = "no_referring_doctor"
            await db.referral_notifications.insert_one(entry)
            return {"ok": False, "status": "skipped", "reason": entry["reason"]}
        entry["doctor_id"] = doctor_id

        doctor = await db.referring_doctors.find_one(
            {"doctor_id": doctor_id, "clinic_id": clinic_id}, {"_id": 0},
        )
        if not doctor:
            entry["reason"] = "doctor_not_found"
            await db.referral_notifications.insert_one(entry)
            return {"ok": False, "status": "skipped", "reason": entry["reason"]}

        # Opt-in gate — the whole point of these two boolean flags is to
        # let the owner enable notifications PER STREAM independently.
        opt_in_key = "notify_on_diag" if stream == "diagnostics" else "notify_on_ha"
        if not doctor.get(opt_in_key):
            entry["reason"] = f"opt_out_{stream}"
            await db.referral_notifications.insert_one(entry)
            return {"ok": False, "status": "skipped", "reason": entry["reason"]}

        phone = (doctor.get("phone") or "").strip()
        if not phone:
            entry["reason"] = "no_phone"
            await db.referral_notifications.insert_one(entry)
            return {"ok": False, "status": "skipped", "reason": entry["reason"]}
        entry["doctor_phone"] = phone

        first_name = (patient.get("name") or "your patient").strip().split(" ")[0]
        entry["message_preview"] = FALLBACK_MSG[stream].format(patient_first=first_name)

        # Resolve MSG91 credentials. If Connect isn't configured for this
        # clinic yet, silently queue the notif as "waiting_msg91" so it's
        # visible in the audit log — no exception bubbles up.
        try:
            from utils.msg91 import resolve_credentials, send_template
            creds = await resolve_credentials(db, clinic_id)
        except Exception as e:  # noqa: BLE001
            entry["reason"] = "msg91_not_configured"
            entry["error"] = str(e)[:200]
            await db.referral_notifications.insert_one(entry)
            log.info("refdoc.notify.skip msg91_not_configured clinic=%s doctor=%s", clinic_id, doctor_id)
            return {"ok": False, "status": "queued_no_provider", "reason": entry["reason"]}

        ok, req_id, err_code, err_msg = await send_template(
            auth_key=creds["auth_key"],
            integrated_number=creds["integrated_number"],
            template_name=TEMPLATE_NAMES[stream],
            template_namespace=TEMPLATE_NAMESPACE,
            language_code=LANGUAGE_CODE,
            recipient=phone,
            body_variables=[first_name],
        )
        entry["provider"] = "msg91"
        entry["request_id"] = req_id
        if ok:
            entry["status"] = "sent"
            entry["reason"] = None
        else:
            entry["status"] = "failed"
            entry["reason"] = f"{err_code}:{(err_msg or '')[:140]}"
        await db.referral_notifications.insert_one(entry)
        log.info("refdoc.notify.%s clinic=%s doctor=%s stream=%s", entry["status"], clinic_id, doctor_id, stream)
        return {"ok": ok, "status": entry["status"], "reason": entry["reason"], "request_id": req_id}

    except Exception as e:  # noqa: BLE001 — never let the caller crash
        log.exception("refdoc.notify.error clinic=%s patient=%s stream=%s err=%s", clinic_id, patient_id, stream, e)
        try:
            entry["status"] = "error"
            entry["reason"] = str(e)[:200]
            await db.referral_notifications.insert_one(entry)
        except Exception:
            pass
        return {"ok": False, "status": "error", "reason": str(e)[:200]}


def schedule_notify(db, clinic_id: str, patient_id: str, stream: Stream) -> None:
    """Fire-and-forget wrapper. Never awaits — callers stay non-blocking."""
    try:
        asyncio.create_task(notify_referring_doctor(db, clinic_id, patient_id, stream))
    except RuntimeError:
        # No running event loop (extremely rare — happens only from unit
        # tests that manually create a synchronous context). Skip silently.
        log.debug("refdoc.notify.schedule_no_loop clinic=%s patient=%s", clinic_id, patient_id)


async def list_notifications(
    db, clinic_id: str, doctor_id: Optional[str] = None, limit: int = 200,
) -> list[dict]:
    """Owner-facing audit query used by the Referral Corner UI."""
    q = {"clinic_id": clinic_id}
    if doctor_id:
        q["doctor_id"] = doctor_id
    rows = await db.referral_notifications.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return rows
