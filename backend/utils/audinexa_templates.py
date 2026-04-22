"""AUDINEXA WhatsApp templates — Phase 12.C.

Produces wa.me deep-link URLs with pre-filled text for every service-job
status change. Used by the frontend's "Notify Patient" button and by the
follow-up board.

Philosophy: keep templates *short* (under 160 chars where possible so they
work as SMS too) and Indian-English tone. All variables use `{{…}}`
placeholders — `render_template()` substitutes them.

Integration point: once real Twilio/MSG91 SDKs are wired (future), this
same registry is reused — `build_whatsapp_url()` is replaced with an
actual API call.
"""
from __future__ import annotations

import urllib.parse
from typing import Optional


# Status → template text. `None` means "no notification sent for this state".
TEMPLATES: dict[str, Optional[str]] = {
    "RECEIVED": (
        "Hi {{patient_name}}, we've received your hearing aid for service "
        "(Job #{{ticket_no}}). Our team will update you within 24 hrs. "
        "— {{clinic_name}}"
    ),
    "INSPECTED": (
        "Hi {{patient_name}}, your hearing aid (Job #{{ticket_no}}) has been "
        "inspected by our audiologist. We'll share the next steps shortly. "
        "— {{clinic_name}}"
    ),
    "DISPATCHED": (
        "Hi {{patient_name}}, your hearing aid (Job #{{ticket_no}}) has been "
        "dispatched to the service centre. AWB: {{awb_number}} "
        "({{courier_partner}}). Expected delivery: {{eta_date}}. "
        "— {{clinic_name}}"
    ),
    "DELIVERED_TO_COMPANY": (
        "Hi {{patient_name}}, good news — your hearing aid (Job #{{ticket_no}}) "
        "has reached the service centre. Estimate expected in 2-4 working days. "
        "— {{clinic_name}}"
    ),
    "ESTIMATE_PENDING": (
        "Hi {{patient_name}}, repair estimate for your hearing aid "
        "(Job #{{ticket_no}}): ₹{{amount}} "
        "({{warranty_line}}). ETA: {{eta_days}} days. "
        "Please confirm by replying APPROVE or REJECT. — {{clinic_name}}"
    ),
    "CLIENT_APPROVED": (
        "Thank you, {{patient_name}}. Repair approved for Job #{{ticket_no}}. "
        "We'll update you when the device is ready for pickup. — {{clinic_name}}"
    ),
    "CLIENT_REJECTED": (
        "Noted, {{patient_name}}. Repair declined for Job #{{ticket_no}}. "
        "The device is being shipped back unrepaired. "
        "We'll notify you on arrival. — {{clinic_name}}"
    ),
    "REPAIR_IN_PROGRESS": (
        "Hi {{patient_name}}, repair of your hearing aid (Job #{{ticket_no}}) "
        "is in progress. Expected completion: {{eta_days}} days. "
        "— {{clinic_name}}"
    ),
    "RETURN_SHIPPED": (
        "Hi {{patient_name}}, your repaired hearing aid (Job #{{ticket_no}}) "
        "is on its way back. AWB: {{awb_number}}. ETA: {{eta_date}}. "
        "— {{clinic_name}}"
    ),
    "READY_FOR_PICKUP": (
        "Hi {{patient_name}}, your hearing aid (Job #{{ticket_no}}) is "
        "*ready for pickup* at our clinic. Please visit us or book a "
        "fitting appointment. — {{clinic_name}}"
    ),
    "DELIVERED_TO_CLIENT": (
        "Hi {{patient_name}}, thank you for collecting your hearing aid "
        "(Job #{{ticket_no}}). We hope it sounds perfect — please reach "
        "out for any fitting adjustments. — {{clinic_name}}"
    ),
    "CANCELLED": (
        "Hi {{patient_name}}, Job #{{ticket_no}} has been cancelled. "
        "Please contact us if this is unexpected. — {{clinic_name}}"
    ),
    # No notification for INSPECTED/RECEIVED/AWAITING_DISPATCH — too noisy.
    "AWAITING_DISPATCH": None,
    "IN_TRANSIT":        None,
    "CLOSED":            None,
}


def render_template(status: str, ctx: dict) -> Optional[str]:
    """Fill in `{{var}}` placeholders from ctx. Unknown status → None."""
    tpl = TEMPLATES.get(status)
    if not tpl:
        return None
    txt = tpl
    for k, v in ctx.items():
        txt = txt.replace("{{" + k + "}}", str(v if v is not None else ""))
    # Final polish: collapse double-spaces from missing vars
    return " ".join(txt.split())


def build_whatsapp_url(mobile: str, message: str) -> str:
    """Build a `https://wa.me/91…?text=…` deep-link. Returns empty string
    if mobile is missing or not 10 digits after stripping."""
    if not mobile:
        return ""
    import re
    digits = re.sub(r"\D", "", mobile)
    if len(digits) < 10:
        return ""
    phone = digits[-10:]  # strip +91 etc
    return f"https://wa.me/91{phone}?text={urllib.parse.quote(message)}"
