"""New-device-sign-in email alert.

Whenever a user authenticates from a device (user-agent + IP combo) that
we've never seen before for *this user*, fire a Zepto email asking them
to confirm it was them — with a one-click "That wasn't me" link landing
on Settings → Security where they can revoke the suspicious session.

This sits on top of the Sessions & Devices feature: revocation is already
possible, this just makes the user *find out* about a new sign-in the
moment it happens.

Called from `mint_session_row()` after the new row is inserted.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger("audinexa.new_device_alert")


def _frontend_origin() -> str:
    """Public origin to put in the email link. Uses APP_BASE_URL or falls
    back to the audinexa.com production domain."""
    return (
        os.environ.get("APP_BASE_URL")
        or os.environ.get("PUBLIC_BASE_URL")
        or "https://audinexa.com"
    ).rstrip("/")


def _format_time(dt: datetime) -> str:
    # Indian Standard Time without depending on pytz/zoneinfo at runtime.
    from datetime import timedelta
    ist = dt.astimezone(timezone.utc) + timedelta(hours=5, minutes=30)
    return ist.strftime("%d %b %Y, %I:%M %p IST")


async def maybe_alert_new_device(
    db,
    user: dict,
    new_session: dict,
) -> None:
    """Fire a "new device signed in" email if this UA hasn't been seen for
    this user before. Best-effort — never raises.

    `new_session` is the doc that was just inserted into `user_sessions`.
    """
    try:
        ua = (new_session.get("user_agent") or "").strip()
        # If we couldn't capture a UA, don't alert (avoids spam from curl /
        # internal tooling).
        if not ua or len(ua) < 12:
            return

        # Skip alerting on the very first session ever — every signup creates
        # one, no point sending an email to confirm "you just signed up".
        prior_count = await db.user_sessions.count_documents(
            {"user_id": user["user_id"]}
        )
        # `prior_count` includes the row we just inserted.
        if prior_count <= 1:
            return

        # Have we seen this exact user_agent for this user before? Look for
        # any session row (including revoked) older than the new one.
        seen_before = await db.user_sessions.find_one(
            {
                "user_id": user["user_id"],
                "user_agent": ua,
                "session_id": {"$ne": new_session["session_id"]},
            },
            {"_id": 0, "session_id": 1},
        )
        if seen_before:
            return  # familiar device — no alert

        # ── Build + send the alert ──
        email = user.get("email")
        if not email:
            return

        name = (user.get("name") or "").split(" ")[0] or "there"
        device = new_session.get("device_label") or "Unknown device"
        ip = new_session.get("ip") or "unknown"
        when = _format_time(new_session.get("created_at") or datetime.now(timezone.utc))
        purpose = new_session.get("purpose") or "login"
        origin = _frontend_origin()
        sessions_url = f"{origin}/settings/security"

        html = f"""
        <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#0F52BA,#1E3A8A);color:#fff;padding:24px;border-radius:12px 12px 0 0">
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;font-weight:700">Sign-in alert</div>
            <h2 style="margin:6px 0 0;font-size:22px;font-weight:700">New device signed in to AUDINEXA</h2>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:0;padding:28px;border-radius:0 0 12px 12px">
            <p style="font-size:15px;color:#0f172a;margin:0">Hi {name},</p>
            <p style="color:#334155;line-height:1.55">
              We noticed a sign-in to your AUDINEXA account from a device we haven't seen before.
              If that was you, no action needed. If not, sign that device out now.
            </p>

            <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;margin:18px 0;font-size:13px;color:#0f172a">
              <tr><td style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;width:140px">Device</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0">{device}</td></tr>
              <tr><td style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700">IP address</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-family:Menlo,Consolas,monospace">{ip}</td></tr>
              <tr><td style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700">When</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0">{when}</td></tr>
              <tr><td style="padding:10px 14px;background:#f8fafc;font-weight:700">Via</td><td style="padding:10px 14px;text-transform:capitalize">{purpose}</td></tr>
            </table>

            <p style="margin:18px 0 6px;font-weight:700;color:#0f172a">Was that you?</p>
            <p style="margin:0;color:#475569;font-size:13px">If yes — you can ignore this email.</p>

            <p style="margin:18px 0 0;font-weight:700;color:#b91c1c">If not:</p>
            <p style="margin:6px 0 0;color:#475569;font-size:13px">
              Sign that device out immediately and rotate your password.
            </p>
            <p style="margin:18px 0;text-align:center">
              <a href="{sessions_url}" style="background:#b91c1c;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;display:inline-block;font-size:14px">
                Review my sessions
              </a>
            </p>

            <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">
            <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0">
              This alert was sent because a new device signed in to your AUDINEXA account.<br>
              You can manage your sessions any time at <a href="{sessions_url}" style="color:#0F52BA">Settings → Security &amp; Privacy</a>.
            </p>
          </div>
        </div>
        """

        from utils.email import enqueue_email
        enqueue_email(
            to=email,
            subject=f"New sign-in to your AUDINEXA account — {device}",
            html_body=html,
            purpose="security_new_device",
        )
        log.info("new_device_alert sent user=%s device=%s ip=%s",
                 user.get("user_id"), device, ip)
    except Exception as exc:   # noqa: BLE001
        log.warning("new_device_alert failed (non-fatal): %s", exc)
