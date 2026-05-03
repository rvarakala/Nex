"""Email helper — pluggable provider indirection (mirrors utils/sms.py).

Phase 1: ZeptoMail via SMTP (587 STARTTLS). The username is literally the
string "emailapikey" and the password is the ZeptoMail Send Mail Token.

Design notes:
  * `EMAIL_PROVIDER` env toggle: "zepto" (prod) or "mock" (dev/CI). Unset
    defaults to "mock" so unit tests don't inadvertently fire real mail.
  * Fail-safe: missing creds or SMTP errors return `{"status": "error", ...}`
    with a human-readable message instead of raising. Caller decides whether
    to treat that as critical (e.g. password reset must fail loudly) or
    silent (e.g. secondary recall reminder).
  * SMTP over TLS (587). SSL (465) is a small code path (`if port == 465:`)
    kept for parity with the ZeptoMail sample but normally unused.
  * Attachments supported for invoice PDFs — list of
    `{"filename": str, "content": bytes, "mime": "application/pdf"}`.

Usage:
    from utils.email import send_email
    send_email(
        to="patient@example.com",
        subject="Your invoice #INV-123",
        html_body="<p>See attached.</p>",
        text_body="See attached.",
        attachments=[{"filename": "invoice.pdf", "content": pdf_bytes,
                      "mime": "application/pdf"}],
        purpose="invoice_delivery",
    )
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Iterable, Optional

log = logging.getLogger("audinexa.email")


# ---------- provider + creds helpers ----------------------------------------

def _provider() -> str:
    return os.environ.get("EMAIL_PROVIDER", "mock").strip().lower()


def _zepto_creds() -> Optional[dict]:
    host = os.environ.get("ZEPTO_SMTP_HOST", "smtp.zeptomail.com").strip()
    port = int(os.environ.get("ZEPTO_SMTP_PORT", "587").strip() or "587")
    user = os.environ.get("ZEPTO_SMTP_USER", "emailapikey").strip()
    pw   = os.environ.get("ZEPTO_SMTP_PASSWORD", "").strip()
    frm  = os.environ.get("ZEPTO_FROM_ADDRESS", "").strip()
    name = os.environ.get("ZEPTO_FROM_NAME", "AUDINEXA").strip()
    if not (host and port and user and pw and frm):
        return None
    return {"host": host, "port": port, "user": user, "password": pw,
            "from_addr": frm, "from_name": name}


# ---------- public API ------------------------------------------------------

def send_email(
    to: str | Iterable[str],
    subject: str,
    html_body: Optional[str] = None,
    *,
    text_body: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
    reply_to: Optional[str] = None,
    from_name: Optional[str] = None,
    purpose: str = "generic",
) -> dict:
    """Send one email. Returns a dict summarising the outcome.

    Shape:
      {
        "status":     "sent" | "mocked" | "error" | "invalid_request",
        "provider":   "zepto" | "mock",
        "to":         [list of recipients],
        "message_id": "<...@audinexa.com>"       # present on success
        "error":      "human-readable reason"     # present on error
      }
    """
    recipients = [to] if isinstance(to, str) else list(to)
    recipients = [r.strip() for r in recipients if r and "@" in r]
    if not recipients:
        return {"status": "invalid_request", "provider": _provider(), "to": [],
                "error": "No valid recipients"}
    if not subject or not subject.strip():
        return {"status": "invalid_request", "provider": _provider(), "to": recipients,
                "error": "Subject is required"}
    if not (html_body or text_body):
        return {"status": "invalid_request", "provider": _provider(), "to": recipients,
                "error": "Either html_body or text_body is required"}

    prov = _provider()

    # ---- Mock provider — dev / CI. Log and return as if successful. -------
    if prov != "zepto":
        log.info("email.mock to=%s subject=%r purpose=%s", recipients, subject[:80], purpose)
        return {"status": "mocked", "provider": "mock", "to": recipients,
                "message_id": make_msgid(domain="audinexa.local")}

    # ---- ZeptoMail SMTP provider ------------------------------------------
    creds = _zepto_creds()
    if not creds:
        log.error("email.zepto_creds_missing purpose=%s", purpose)
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": "ZeptoMail credentials not configured"}

    # Build the message.
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = formataddr((from_name or creds["from_name"], creds["from_addr"]))
    msg["To"]      = ", ".join(recipients)
    if reply_to:
        msg["Reply-To"] = reply_to
    message_id = make_msgid(domain=creds["from_addr"].split("@", 1)[-1])
    msg["Message-ID"] = message_id

    # Body — set plain first, then add HTML alternative. ZeptoMail is fine
    # with either or both; a plain-text fallback boosts deliverability.
    text_fallback = text_body or _html_to_text(html_body or "")
    msg.set_content(text_fallback)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    # Attach files (we expect pre-read bytes, not file handles).
    for att in (attachments or []):
        try:
            fname   = att["filename"]
            content = att["content"]
            mime    = att.get("mime", "application/octet-stream")
            maintype, _, subtype = mime.partition("/")
            msg.add_attachment(content, maintype=maintype or "application",
                               subtype=subtype or "octet-stream", filename=fname)
        except Exception as exc:  # pragma: no cover — bad attachment shouldn't kill the email
            log.warning("email.attachment_bad err=%s filename=%s", exc, att.get("filename"))

    # Send.
    try:
        if creds["port"] == 465:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(creds["host"], creds["port"], context=ctx, timeout=20) as server:
                server.login(creds["user"], creds["password"])
                server.send_message(msg)
        else:
            with smtplib.SMTP(creds["host"], creds["port"], timeout=20) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                server.login(creds["user"], creds["password"])
                server.send_message(msg)

        log.info("email.zepto_sent to=%s subject=%r purpose=%s message_id=%s",
                 recipients, subject[:80], purpose, message_id)
        return {"status": "sent", "provider": "zepto", "to": recipients,
                "message_id": message_id}

    except smtplib.SMTPAuthenticationError as exc:
        log.error("email.zepto_auth_error err=%s to=%s", exc, recipients)
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": "ZeptoMail authentication failed — check ZEPTO_SMTP_PASSWORD"}
    except smtplib.SMTPRecipientsRefused as exc:
        log.error("email.zepto_refused err=%s to=%s", exc, recipients)
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": f"Recipient(s) refused: {exc.recipients}"}
    except smtplib.SMTPSenderRefused as exc:
        log.error("email.zepto_sender_refused err=%s from=%s", exc, creds["from_addr"])
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": f"Sender refused — domain may not be verified. {exc.smtp_error.decode() if hasattr(exc, 'smtp_error') and isinstance(exc.smtp_error, bytes) else exc}"}
    except smtplib.SMTPException as exc:
        log.error("email.zepto_smtp_error err=%s to=%s", exc, recipients)
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": f"SMTP error: {exc}"}
    except Exception as exc:  # pragma: no cover — catch-all for network blips
        log.error("email.zepto_unexpected err=%s to=%s", exc, recipients)
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": str(exc)}


# ---------- HTML→text fallback ----------------------------------------------

def _html_to_text(html: str) -> str:
    """Crude HTML-to-text for the plain-text alternative. Not perfect, but
    good enough for transactional emails (deliverability boost > fidelity)."""
    import re
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    # Decode the most common HTML entities.
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
                 ("&gt;", ">"), ("&#39;", "'"), ("&quot;", '"')):
        text = text.replace(a, b)
    return text or "(HTML-only email — open in an HTML-capable client to view)"


__all__ = ["send_email"]
