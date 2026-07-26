"""Email helper — pluggable provider indirection (mirrors utils/sms.py).

Providers supported:
  * `resend` — HTTPS API (primary from 2026-07-26; Zoho-Zepto free tier exhausted)
  * `zepto`  — SMTP fallback (kept for one-flip disaster recovery)
  * `mock`   — dev / CI, logs but doesn't send

Env vars:
  * `EMAIL_PROVIDER`            primary — "resend" | "zepto" | "mock" (default: "mock")
  * `EMAIL_FALLBACK_PROVIDER`   optional secondary — if primary send returns
                                `status="error"`, retry via this provider.
                                Empty by default (no fallback). Set to "zepto"
                                after your Zepto validation clears + credits
                                are on the account.
  * `EMAIL_EVENT_LOG_DISABLED`  "1" to skip writing per-send outcomes into
                                the `email_events` collection (used by the
                                Email Health banner). Off by default.

Design notes:
  * Fail-safe: missing creds or SMTP errors return `{"status": "error", ...}`
    instead of raising. Caller decides whether to treat that as critical
    (e.g. password reset must fail loudly) or silent (recall reminders).
  * Attachments — list of `{"filename": str, "content": bytes,
                              "mime": "application/pdf"}`.
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Iterable, Optional
from uuid import uuid4

log = logging.getLogger("audinexa.email")


# ---------- provider + creds helpers ----------------------------------------

def _provider() -> str:
    return os.environ.get("EMAIL_PROVIDER", "mock").strip().lower()


def _fallback_provider() -> Optional[str]:
    v = os.environ.get("EMAIL_FALLBACK_PROVIDER", "").strip().lower()
    return v if v in ("resend", "zepto") else None


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


def _resend_creds() -> Optional[dict]:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    frm     = os.environ.get("RESEND_FROM_ADDRESS", "").strip()
    name    = os.environ.get("RESEND_FROM_NAME", "AUDINEXA").strip()
    if not (api_key and frm):
        return None
    return {"api_key": api_key, "from_addr": frm, "from_name": name}


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
    if prov not in ("zepto", "resend"):
        log.info("email.mock to=%s subject=%r purpose=%s", recipients, subject[:80], purpose)
        result = {"status": "mocked", "provider": "mock", "to": recipients,
                  "message_id": make_msgid(domain="audinexa.local")}
        _record_email_event(result, subject, purpose, used_fallback=False)
        return result

    # Try primary provider first. If it errors AND a fallback is configured
    # and different from primary, retry once with the fallback. This is the
    # "single-vendor outage never blocks signups" guarantee.
    result = _send_via(prov, recipients, subject, html_body, text_body,
                       attachments, reply_to, from_name, purpose)

    fallback = _fallback_provider()
    used_fallback = False
    if (result.get("status") == "error"
            and fallback and fallback != prov):
        log.warning("email.primary_failed provider=%s err=%s — retrying via %s",
                    prov, result.get("error"), fallback)
        fb_result = _send_via(fallback, recipients, subject, html_body, text_body,
                              attachments, reply_to, from_name, purpose)
        if fb_result.get("status") == "sent":
            used_fallback = True
            fb_result["primary_error"] = result.get("error")
            fb_result["primary_provider"] = prov
            result = fb_result
        else:
            # Keep the original error but mark that fallback was tried
            result["fallback_error"] = fb_result.get("error")
            result["fallback_provider"] = fallback

    _record_email_event(result, subject, purpose, used_fallback=used_fallback)
    return result


def _send_via(prov: str, recipients: list, subject: str,
              html_body: Optional[str], text_body: Optional[str],
              attachments: Optional[list], reply_to: Optional[str],
              from_name: Optional[str], purpose: str) -> dict:
    """Dispatch to a single provider. No fallback, no event log — that's
    orchestrated by the public `send_email()` above."""
    if prov == "resend":
        return _send_via_resend(recipients, subject, html_body, text_body,
                                attachments, reply_to, from_name, purpose)
    if prov == "zepto":
        return _send_via_zepto(recipients, subject, html_body, text_body,
                               attachments, reply_to, from_name, purpose)
    return {"status": "error", "provider": prov, "to": recipients,
            "error": f"Unknown provider {prov!r}"}


def _send_via_resend(recipients, subject, html_body, text_body,
                     attachments, reply_to, from_name, purpose) -> dict:
    creds = _resend_creds()
    if not creds:
        log.error("email.resend_creds_missing purpose=%s", purpose)
        return {"status": "error", "provider": "resend", "to": recipients,
                "error": "Resend credentials not configured"}
    try:
        import resend as _resend
        _resend.api_key = creds["api_key"]
        from_field = formataddr((from_name or creds["from_name"], creds["from_addr"]))
        params: dict = {
            "from": from_field,
            "to": recipients,
            "subject": subject,
            "html": html_body or "",
            "text": text_body or _html_to_text(html_body or ""),
        }
        if reply_to:
            params["reply_to"] = reply_to
        if attachments:
            import base64 as _b64
            params["attachments"] = [
                {"filename": a["filename"],
                 "content": _b64.b64encode(a["content"]).decode("ascii"),
                 "content_type": a.get("mime", "application/octet-stream")}
                for a in attachments if a.get("content")
            ]
        result = _resend.Emails.send(params)
        msg_id = result.get("id") if isinstance(result, dict) else getattr(result, "id", None)
        log.info("email.resend_sent to=%s subject=%r purpose=%s message_id=%s",
                 recipients, subject[:80], purpose, msg_id)
        return {"status": "sent", "provider": "resend", "to": recipients,
                "message_id": msg_id}
    except Exception as exc:
        log.error("email.resend_error err=%s to=%s subject=%r purpose=%s",
                  exc, recipients, subject[:80], purpose)
        return {"status": "error", "provider": "resend", "to": recipients,
                "error": str(exc)}


def _send_via_zepto(recipients, subject, html_body, text_body,
                    attachments, reply_to, from_name, purpose) -> dict:
    creds = _zepto_creds()
    if not creds:
        log.error("email.zepto_creds_missing purpose=%s", purpose)
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": "ZeptoMail credentials not configured"}

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = formataddr((from_name or creds["from_name"], creds["from_addr"]))
    msg["To"]      = ", ".join(recipients)
    if reply_to:
        msg["Reply-To"] = reply_to
    message_id = make_msgid(domain=creds["from_addr"].split("@", 1)[-1])
    msg["Message-ID"] = message_id

    text_fallback = text_body or _html_to_text(html_body or "")
    msg.set_content(text_fallback)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    for att in (attachments or []):
        try:
            fname   = att["filename"]
            content = att["content"]
            mime    = att.get("mime", "application/octet-stream")
            maintype, _, subtype = mime.partition("/")
            msg.add_attachment(content, maintype=maintype or "application",
                               subtype=subtype or "octet-stream", filename=fname)
        except Exception as exc:
            log.warning("email.attachment_bad err=%s filename=%s", exc, att.get("filename"))

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
    except Exception as exc:
        log.error("email.zepto_unexpected err=%s to=%s", exc, recipients)
        return {"status": "error", "provider": "zepto", "to": recipients,
                "error": str(exc)}


# ---------- Best-effort event logging (fuels /email-health banner) ----------
_pymongo_client = None
_pymongo_db = None


def _get_sync_db():
    """Return a sync PyMongo db handle. Lazy-init on first use."""
    global _pymongo_client, _pymongo_db
    if _pymongo_db is not None:
        return _pymongo_db
    try:
        import pymongo
        url = os.environ.get("MONGO_URL")
        name = os.environ.get("DB_NAME", "test_database")
        if not url:
            return None
        _pymongo_client = pymongo.MongoClient(url, serverSelectionTimeoutMS=2000)
        _pymongo_db = _pymongo_client[name]
        return _pymongo_db
    except Exception as exc:
        log.warning("email.event_log_init_failed err=%s", exc)
        return None


def _record_email_event(result: dict, subject: str, purpose: str,
                        used_fallback: bool) -> None:
    """Fire-and-forget event log for the health dashboard.

    Kept minimal — one document per send attempt, TTL-indexed to 30 days.
    Never raises; never blocks the send path."""
    if os.environ.get("EMAIL_EVENT_LOG_DISABLED", "").strip() == "1":
        return
    try:
        db = _get_sync_db()
        if db is None:
            return
        db.email_events.insert_one({
            "event_id":     f"eev-{uuid4().hex[:12]}",
            "timestamp":    datetime.now(timezone.utc),
            "provider":     result.get("provider"),
            "status":       result.get("status"),  # sent | error | mocked | invalid_request
            "to":           result.get("to", []),
            "subject":      (subject or "")[:120],
            "purpose":      purpose,
            "message_id":   result.get("message_id"),
            "error":        result.get("error"),
            "used_fallback": bool(used_fallback),
            "primary_provider": result.get("primary_provider"),
            "primary_error":    result.get("primary_error"),
            "fallback_provider": result.get("fallback_provider"),
            "fallback_error":    result.get("fallback_error"),
        })
    except Exception as exc:
        # Never let a logging failure break email sending
        log.warning("email.event_log_write_failed err=%s", exc)


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


__all__ = ["send_email", "send_email_background", "enqueue_email"]


# ---------- Async / background variants -------------------------------------
#
# `send_email` above is synchronous SMTP — fine for cron jobs and CLI scripts,
# but a 1–3 second blocker if called from a FastAPI request handler. Two
# safer variants are exposed:
#
#   send_email_background(bg, ...)   — wires it into FastAPI's BackgroundTasks.
#                                      Email fires AFTER the response is sent.
#   enqueue_email(...)               — fire-and-forget; returns immediately.
#                                      Use when you don't have a BackgroundTasks
#                                      handle (e.g. inside a deeper service).
#
# Both run the SMTP work on a worker thread via asyncio.to_thread() so the
# event loop is never blocked.

import asyncio


def send_email_background(background_tasks, *args, **kwargs) -> None:
    """Schedule `send_email` to run after the current FastAPI response is sent.

    Usage:
        @router.post("/something")
        async def endpoint(bg: BackgroundTasks):
            send_email_background(bg, to=..., subject=..., html_body=...)
            return {"ok": True}
    """
    background_tasks.add_task(send_email, *args, **kwargs)


def enqueue_email(*args, **kwargs) -> None:
    """Fire-and-forget background email send. Returns immediately.

    Use when you can't accept a `BackgroundTasks` dependency (deeply nested
    service helpers, scheduled jobs called from async context, etc.).

    Safe to call from any async context; silently no-ops with a log line
    if not inside a running event loop (extremely rare — only matters for
    direct unit-test invocation).
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Not in an async context — fall back to synchronous send.
        # This branch only fires from CLI scripts / tests.
        send_email(*args, **kwargs)
        return

    async def _runner():
        try:
            await asyncio.to_thread(send_email, *args, **kwargs)
        except Exception as exc:  # pragma: no cover — should never escape
            log.error("email.enqueue_email_unexpected err=%s", exc)

    loop.create_task(_runner())
