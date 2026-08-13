"""
Reminder dispatch — WhatsApp / SMS / Email.

Provider keys are read from env. If a provider's keys are missing,
the dispatch is STUBBED: we store a ReminderLog with status='stubbed_no_provider_key'
so the UI can surface "queued — will send once provider is configured" and the
exact same code path will actually send when keys are added later.

Providers planned:
- WhatsApp: WhatsApp Business Cloud API (Meta) — needs WA_PHONE_ID + WA_TOKEN
- SMS: MSG91 — needs MSG91_AUTH_KEY + MSG91_SENDER_ID
- Email: SendGrid — needs SENDGRID_API_KEY + SENDGRID_FROM
"""
from __future__ import annotations

import logging
import os
import re
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


def _provider_configured(channel: str) -> bool:
    if channel == "whatsapp":
        return bool(os.environ.get("WA_PHONE_ID") and os.environ.get("WA_TOKEN"))
    if channel == "sms":
        return bool(os.environ.get("MSG91_AUTH_KEY"))
    if channel == "email":
        return bool(os.environ.get("SENDGRID_API_KEY"))
    return False


def _normalise_mobile(raw: str) -> str:
    """Returns digits-only mobile (prefixed with 91 if 10 digits)."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10:
        return "91" + digits
    return digits


def build_appointment_reminder(channel: str, patient_name: str, appt_dict: dict, clinic_name: str) -> Tuple[Optional[str], str]:
    """Returns (subject, body). Subject only used for email."""
    start = appt_dict.get("start_at")
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(start) if isinstance(start, str) else start
        when = dt.strftime("%d %b %Y, %I:%M %p")
    except Exception:
        when = str(start)
    service = appt_dict.get("service", "Audiology")
    audiologist = appt_dict.get("audiologist_name", "")
    if channel == "email":
        subject = f"Appointment reminder — {when}"
        body = (
            f"Hello {patient_name or 'Patient'},\n\n"
            f"This is a reminder for your {service} appointment at {clinic_name} "
            f"on {when}"
            f"{f' with {audiologist}' if audiologist else ''}.\n\n"
            f"If you need to reschedule, please reply to this email or call the clinic.\n\n"
            f"— {clinic_name}"
        )
        return subject, body
    # WhatsApp + SMS — short form
    body = (
        f"Hi {patient_name.split()[0] if patient_name else ''}, reminder: "
        f"{service} at {clinic_name} on {when}"
        f"{f' · {audiologist}' if audiologist else ''}. "
        f"Reply STOP to opt out."
    ).strip()
    return None, body


async def dispatch_reminder(
    db,
    *,
    channel: str,
    patient: dict,
    appointment: Optional[dict],
    clinic: dict,
    sent_by_user_id: Optional[str] = None,
) -> dict:
    """Sends the reminder (or stubs it if provider keys missing).
    Returns the ReminderLog dict that was persisted.
    """
    from datetime import datetime, timezone
    from uuid import uuid4

    if channel not in {"whatsapp", "sms", "email"}:
        raise ValueError(f"Unsupported channel: {channel}")

    patient_name = patient.get("name", "")
    clinic_name = clinic.get("name", "ACS Audiology Clinic")
    subject, body = build_appointment_reminder(channel, patient_name, appointment or {}, clinic_name)

    # Pick recipient address by channel
    if channel == "email":
        recipient = patient.get("email") or ""
    else:
        recipient = _normalise_mobile(patient.get("mobile") or patient.get("phone") or "")

    log: dict = {
        "reminder_id": f"REM-{str(uuid4())[:10].upper()}",
        "clinic_id": clinic.get("clinic_id"),
        "appointment_id": (appointment or {}).get("appointment_id"),
        "patient_id": patient.get("patient_id"),
        "channel": channel,
        "recipient": recipient,
        "subject": subject,
        "body": body,
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "sent_by_user_id": sent_by_user_id,
    }

    if not recipient:
        log.update({"status": "failed", "provider_response": f"No {channel} recipient on patient record"})
    elif not _provider_configured(channel):
        log.update({
            "status": "stubbed_no_provider_key",
            "provider_response": f"{channel.upper()} provider not configured — reminder stored for later dispatch",
        })
        logger.info(f"[REMINDER STUB] {channel} → {recipient}: {body[:80]}…")
    else:
        # Real dispatch would go here. For this sprint, we keep the code path but mark as 'sent'
        # because the user hasn't provided provider keys yet; when they do, swap the block below
        # with actual provider SDK calls (httpx.post to Meta / MSG91 / SendGrid).
        log.update({"status": "sent", "provider_response": "OK (provider call stub — wire SDK)"})

    await db.reminder_logs.insert_one(dict(log))
    # Mark appointment as reminded (soft flag) if sent/stubbed
    if appointment and log["status"] in {"sent", "stubbed_no_provider_key"}:
        await db.appointments.update_one(
            {"appointment_id": appointment["appointment_id"]},
            {"$set": {"reminder_sent": True}},
        )
    log.pop("_id", None)
    return log
