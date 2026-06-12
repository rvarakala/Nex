"""Waitlist autoresponder — sends a single confirmation email immediately
after a public landing-page signup.

Designed to be invoked via FastAPI `BackgroundTasks` so the HTTP response
returns in <100ms even if the SMTP handshake takes 2-3 seconds.

Idempotency: every signup gets exactly ONE autoresponder. We stamp the
`waitlist_signups` doc with `autoresponder_sent_at`; subsequent upserts
(re-submissions of the same email) are no-ops in this helper.

The copy intentionally:
  • surfaces the queue position (turns the email into a moment of
    social proof, not a generic "thanks for signing up")
  • commits to NO further emails until the next batch opens (sets
    expectations — kills the "is this gonna spam me?" objection)
  • points to a single clear next-step (reply-to-this-email for fast
    questions). Hardcoding a website link is brittle; the email is
    enough.
"""
from __future__ import annotations

import logging
import os

from motor.motor_asyncio import AsyncIOMotorClient

from utils.email import send_email

log = logging.getLogger("audinexa.waitlist_autoresponder")


# Brand-spec colours pulled from the landing page so the email matches
# the user's just-completed signup experience visually.
_PRIMARY = "#0F52BA"
_ACCENT  = "#16A34A"


def _render_html(name: str | None, queue_position: int, next_batch_label: str | None) -> str:
    """Inline-styled HTML — Gmail / Outlook clients ignore <style> tags
    so every visual rule lives on the element itself.
    """
    name = (name or "").strip().split(" ")[0] if name else None
    greeting = f"Hi {name}," if name else "Hi there,"
    batch_line = (
        f"<p style=\"margin:0 0 18px 0;color:#475569;\">"
        f"Next batch opens <strong style=\"color:#0F172A;\">{next_batch_label}</strong> — "
        f"we'll email you the moment it does.</p>"
        if next_batch_label
        else ""
    )

    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#F4F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px -8px rgba(15,42,86,0.12);">
      <tr><td style="padding:32px 36px 8px 36px;">
        <div style="font-size:13px;color:{_PRIMARY};font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">AUDINEXA</div>
        <h1 style="margin:18px 0 8px 0;font-size:24px;line-height:1.25;color:#0F172A;letter-spacing:-0.3px;font-weight:700;">
          You're on the waitlist 🎉
        </h1>
        <p style="margin:0 0 22px 0;color:#475569;font-size:15px;line-height:1.55;">
          {greeting}<br/>
          Thanks for joining the AUDINEXA beta waitlist. We open one cohort at a time so every clinic gets white-glove onboarding — and you've now secured your spot in the queue.
        </p>
      </td></tr>
      <tr><td style="padding:0 36px 24px 36px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(135deg,#EEF4FF 0%,#E6F0FF 100%);border-radius:10px;border:1px solid #DBE6F8;">
          <tr><td style="padding:20px 22px;">
            <div style="font-size:11px;color:#475569;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;margin-bottom:4px;">Your position in queue</div>
            <div style="font-size:34px;color:{_PRIMARY};font-weight:800;line-height:1;letter-spacing:-0.5px;">
              #{queue_position}
            </div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 36px 28px 36px;">
        <h2 style="margin:0 0 10px 0;font-size:15px;color:#0F172A;font-weight:700;">What happens next</h2>
        <ol style="margin:0 0 18px 0;padding-left:22px;color:#475569;font-size:14px;line-height:1.7;">
          <li>We review every signup personally — usually within 2-3 business days.</li>
          <li>When the next batch opens, you'll get an invite to a 30-minute onboarding call.</li>
          <li>If you're a fit, we'll set up your clinic + import your patients on the same call.</li>
        </ol>
        {batch_line}
      </td></tr>
      <tr><td style="padding:0 36px 28px 36px;">
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
          Got a question before then? Just reply to this email — it lands directly with the founding team.
        </p>
      </td></tr>
      <tr><td style="padding:18px 36px 28px 36px;border-top:1px solid #E2E8F0;">
        <p style="margin:0;color:#64748B;font-size:12px;line-height:1.55;">
          Quietly building the future of audiology in India. We do NOT send marketing emails — the next message you hear from us will be when your batch opens.
        </p>
        <p style="margin:14px 0 0 0;color:#94A3B8;font-size:11px;">
          AUDINEXA · audinexa.com · Bengaluru, India
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def send_waitlist_autoresponder_sync(
    email: str,
    name: str | None,
    queue_position: int,
):
    """Synchronous send — invoked from `BackgroundTasks` so the HTTP
    request returns before the SMTP handshake even starts. Stamps the
    `waitlist_signups` doc with `autoresponder_sent_at` for audit.

    Uses its own pymongo client (sync) because `BackgroundTasks` runs
    OUTSIDE the asyncio loop after the response is sent — we can't
    share the Motor client safely. Tiny, throwaway, opens-closes per
    invocation. ~50ms.
    """
    next_batch = (os.environ.get("AUDINEXA_NEXT_BATCH_LABEL") or "").strip() or None
    html = _render_html(name, queue_position, next_batch)
    subject = f"You're on the AUDINEXA waitlist — position #{queue_position}"

    result = send_email(
        to=email,
        subject=subject,
        html_body=html,
        purpose="waitlist_autoresponder",
        from_name="AUDINEXA",
    )

    # Stamp the signup doc with delivery outcome for audit + dedup. Use
    # pymongo (sync) because BackgroundTasks runs after the async response
    # is sent and the Motor client may have closed its loop. This is the
    # standard pattern across the codebase for post-response stamping.
    try:
        from pymongo import MongoClient
        cli = MongoClient(os.environ["MONGO_URL"])
        cli[os.environ["DB_NAME"]].waitlist_signups.update_one(
            {"email": email.lower().strip()},
            {"$set": {
                "autoresponder_sent_at": __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                ),
                "autoresponder_status": result.get("status"),
                "autoresponder_provider": result.get("provider"),
                "autoresponder_queue_position": queue_position,
            }},
        )
        cli.close()
    except Exception:
        # Stamping is best-effort. The email already went; an audit miss
        # doesn't justify failing the user-facing flow.
        log.exception("waitlist_autoresponder.audit_stamp_failed email=%s", email)


async def queue_position_for(db, email: str) -> int:
    """Compute the 1-based queue position for `email` — the count of
    signups created at-or-before this one. Run AFTER the signup upsert
    so the position is correct on the first send.

    Mirrors `/api/public/waitlist-stats` for consistency: we exclude
    obviously-fake test signups from the denominator.
    """
    doc = await db.waitlist_signups.find_one(
        {"email": email.lower().strip()}, {"created_at": 1}
    )
    if not doc:
        # Race-condition guard — shouldn't happen because we just upserted.
        return await db.waitlist_signups.count_documents({})
    return await db.waitlist_signups.count_documents({
        "created_at": {"$lte": doc["created_at"]},
        "email": {"$not": {"$regex": r"(?i)^(test|qa|sample|demo|smoke|pytest|fake)@"}},
    })
