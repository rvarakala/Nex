"""Error-spike alerter.

Fires Slack + email notifications when a single fingerprint accumulates
≥ `ERROR_ALERT_THRESHOLD` occurrences within `ERROR_ALERT_WINDOW_MINUTES`.

Trigger model
-------------
Inline-on-write: invoked from `routers.error_telemetry._write_error()` right
after a successful insert. Cheap (one count + one cooldown read), and avoids
needing a background task / cron.

Anti-spam
---------
A `error_alert_state` collection records `last_alerted_at` per fingerprint.
The same fingerprint won't re-alert within `ERROR_ALERT_COOLDOWN_MINUTES`,
even if the count keeps climbing. (You'll always see the live count on the
Errors page — the cooldown only suppresses the noisy notification.)

Configuration (all env vars, sensible defaults)
-----------------------------------------------
* `ERROR_ALERT_THRESHOLD`         (int, default 5)
* `ERROR_ALERT_WINDOW_MINUTES`    (int, default 60)
* `ERROR_ALERT_COOLDOWN_MINUTES`  (int, default 60)
* `ERROR_ALERT_SLACK_WEBHOOK`     (URL — optional)
* `ERROR_ALERT_EMAIL_TO`          (comma-separated — optional)
* `ERROR_ALERT_FRONTEND_BASE_URL` (URL of your prod app — used to deep-link
                                   into the Founder Errors page; defaults to
                                   `REACT_APP_BACKEND_URL`)

Either or both channels can be empty — when both are empty the alerter is
effectively disabled (still cheap: just a Mongo count + early return).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiohttp

from utils.email import send_email


_log = logging.getLogger("audinexa.error_alerts")


def _int_env(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (TypeError, ValueError):
        return default


def _config() -> dict:
    return {
        "threshold":        _int_env("ERROR_ALERT_THRESHOLD", 5),
        "window_minutes":   _int_env("ERROR_ALERT_WINDOW_MINUTES", 60),
        "cooldown_minutes": _int_env("ERROR_ALERT_COOLDOWN_MINUTES", 60),
        "slack_webhook":    (os.environ.get("ERROR_ALERT_SLACK_WEBHOOK") or "").strip(),
        "email_to":         [e.strip() for e in (os.environ.get("ERROR_ALERT_EMAIL_TO") or "").split(",") if e.strip()],
        "frontend_base":    (os.environ.get("ERROR_ALERT_FRONTEND_BASE_URL")
                             or os.environ.get("REACT_APP_BACKEND_URL")
                             or "").rstrip("/"),
        # Quiet hours — when "now" in IST falls inside [start, end), suppress
        # noisy notifications. Crash count still accrues; the first alert
        # *after* quiet hours expire will surface the spike. Format: HH:MM
        # (24h). End can wrap past midnight (e.g. 22:00 → 07:00). Leave both
        # blank to disable the feature entirely (default — preserves prior
        # behaviour).
        "quiet_start":      (os.environ.get("ERROR_ALERT_QUIET_HOURS_START") or "").strip(),
        "quiet_end":        (os.environ.get("ERROR_ALERT_QUIET_HOURS_END") or "").strip(),
    }


def _parse_hhmm(s: str) -> Optional[tuple[int, int]]:
    """Parse HH:MM → (hour, minute). Returns None on any bad input."""
    if not s or ":" not in s:
        return None
    try:
        hh, mm = s.split(":", 1)
        h, m = int(hh), int(mm)
        if 0 <= h <= 23 and 0 <= m <= 59:
            return (h, m)
    except ValueError:
        pass
    return None


def _in_quiet_hours(cfg: dict, now_utc: datetime) -> bool:
    """Return True if `now_utc` (in IST) falls inside the configured quiet
    window. Wrap-around windows (e.g. 22:00 → 07:00) handled correctly.
    """
    start = _parse_hhmm(cfg.get("quiet_start") or "")
    end = _parse_hhmm(cfg.get("quiet_end") or "")
    if not start or not end:
        return False
    # IST = UTC+5:30, no DST.
    ist = now_utc + timedelta(hours=5, minutes=30)
    cur = (ist.hour, ist.minute)
    if start <= end:
        return start <= cur < end
    # Wraps midnight: covers [start, 24:00) ∪ [00:00, end)
    return cur >= start or cur < end


# ---------------------------------------------------------------------------
# Public hook — called from error_telemetry._write_error()
# ---------------------------------------------------------------------------
async def maybe_alert(db, doc: dict) -> None:
    """Best-effort: never raise. If anything goes wrong (Mongo, Slack 4xx,
    SMTP timeout) we log and move on — alerter must NEVER break the request
    path on top of an already-failing request."""
    try:
        cfg = _config()
        if cfg["threshold"] <= 0:
            return  # disabled
        if not cfg["slack_webhook"] and not cfg["email_to"]:
            return  # no channels configured
        fingerprint = doc.get("fingerprint")
        if not fingerprint:
            return

        now = datetime.now(timezone.utc)
        window_start = now - timedelta(minutes=cfg["window_minutes"])

        count = await db.error_logs.count_documents({
            "fingerprint": fingerprint,
            "at": {"$gte": window_start},
        })
        if count < cfg["threshold"]:
            return

        # Quiet hours — suppress noisy alerts during user-defined sleeping
        # window. Count still accrued above; the alert will surface as soon
        # as the next error happens outside the quiet window.
        if _in_quiet_hours(cfg, now):
            _log.info("error-spike alert suppressed by quiet hours (fp=%s count=%d)",
                      fingerprint, count)
            return

        # Cooldown — refuse to re-alert the same fingerprint within the
        # cooldown window. We use $lt so the very first occurrence (no
        # state row yet) always passes through.
        cooldown_floor = now - timedelta(minutes=cfg["cooldown_minutes"])
        state = await db.error_alert_state.find_one({"fingerprint": fingerprint}, {"_id": 0})
        if state and state.get("last_alerted_at") and state["last_alerted_at"] > cooldown_floor:
            return

        # Mark first so two near-simultaneous inserts don't both fire.
        # `$setOnInsert + $set` is idempotent.
        await db.error_alert_state.update_one(
            {"fingerprint": fingerprint},
            {"$set": {
                "fingerprint": fingerprint,
                "last_alerted_at": now,
                "last_count": count,
                "last_message": (doc.get("message") or "")[:300],
                "last_path": doc.get("path"),
                "last_kind": doc.get("kind"),
            }},
            upsert=True,
        )

        # Build the alert payload once and dispatch in parallel.
        ctx = _alert_context(doc, count, cfg)
        await asyncio.gather(
            _post_slack(cfg["slack_webhook"], ctx) if cfg["slack_webhook"] else _noop(),
            _send_email(cfg["email_to"], ctx) if cfg["email_to"] else _noop(),
            return_exceptions=True,
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning("maybe_alert failed: %s", exc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _noop() -> None:
    return None


def _alert_context(doc: dict, count: int, cfg: dict) -> dict:
    """Shape the payload once so Slack and email render the same facts."""
    fp = doc.get("fingerprint", "?")
    deep_link: Optional[str] = None
    if cfg["frontend_base"]:
        deep_link = f"{cfg['frontend_base']}/admin/errors?fingerprint={fp}"
    return {
        "fingerprint":    fp,
        "count":          count,
        "window_minutes": cfg["window_minutes"],
        "kind":           doc.get("kind", "?"),
        "exception_type": doc.get("exception_type", "?"),
        "message":        (doc.get("message") or "")[:300],
        "path":           doc.get("path"),
        "clinic_id":      doc.get("clinic_id"),
        "user_id":        doc.get("user_id"),
        "deep_link":      deep_link,
    }


async def _post_slack(webhook: str, ctx: dict) -> None:
    """Single-line + structured-block Slack incoming-webhook post."""
    summary = (
        f":rotating_light: AUDINEXA — {ctx['kind']} {ctx['exception_type']} "
        f"on {ctx['path']} fired {ctx['count']}× in last "
        f"{ctx['window_minutes']} min"
    )
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": ":rotating_light: AUDINEXA error spike"}},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Type*\n`{ctx['exception_type']}`"},
            {"type": "mrkdwn", "text": f"*Kind*\n`{ctx['kind']}`"},
            {"type": "mrkdwn", "text": f"*Path*\n`{ctx['path']}`"},
            {"type": "mrkdwn", "text": f"*Count*\n*{ctx['count']}×* in {ctx['window_minutes']} min"},
            {"type": "mrkdwn", "text": f"*Clinic*\n`{ctx['clinic_id'] or '—'}`"},
            {"type": "mrkdwn", "text": f"*User*\n`{ctx['user_id'] or 'anonymous'}`"},
        ]},
        {"type": "section", "text": {"type": "mrkdwn",
            "text": f"*Message*\n```{ctx['message'][:240] or '—'}```"}},
    ]
    if ctx["deep_link"]:
        blocks.append({
            "type": "actions",
            "elements": [{
                "type": "button",
                "text": {"type": "plain_text", "text": "Open in Founder Panel"},
                "url": ctx["deep_link"], "style": "primary",
            }],
        })
    payload = {"text": summary, "blocks": blocks}
    try:
        timeout = aiohttp.ClientTimeout(total=8)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(webhook, json=payload) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    _log.warning("Slack alert failed: %s %s", resp.status, body[:200])
    except Exception as exc:  # noqa: BLE001
        _log.warning("Slack alert exception: %s", exc)


async def _send_email(recipients: list[str], ctx: dict) -> None:
    """Send via existing utils.email.send_email (ZeptoMail-backed). Runs in
    a thread because send_email is sync."""
    subject = (
        f"[AUDINEXA] error spike: {ctx['exception_type']} ×{ctx['count']} "
        f"on {ctx['path']}"
    )
    deep_link_html = (
        f'<p><a href="{ctx["deep_link"]}" style="display:inline-block;'
        f'background:#0ea5e9;color:#fff;padding:8px 14px;border-radius:6px;'
        f'text-decoration:none;font-weight:600">Open in Founder Panel</a></p>'
        if ctx["deep_link"] else ""
    )
    rows = [
        ("Type", ctx["exception_type"]),
        ("Kind", ctx["kind"]),
        ("Path", ctx["path"]),
        ("Count", f"{ctx['count']}× in last {ctx['window_minutes']} min"),
        ("Clinic", ctx["clinic_id"] or "—"),
        ("User", ctx["user_id"] or "anonymous"),
        ("Fingerprint", ctx["fingerprint"]),
    ]
    table_html = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-weight:600">{k}</td>'
        f'<td style="padding:4px 0;font-family:ui-monospace,monospace">{v}</td></tr>'
        for k, v in rows
    )
    html = f"""
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <h2 style="color:#dc2626;margin:0 0 8px">⚠ AUDINEXA error spike</h2>
      <p style="color:#475569;margin:0 0 16px">A single error fingerprint just crossed the alert threshold.</p>
      <table style="font-size:13px;border-collapse:collapse;margin-bottom:16px">{table_html}</table>
      <div style="background:#1e293b;color:#fda4af;padding:10px 12px;border-radius:6px;
                   font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;
                   word-break:break-word;margin-bottom:16px">{ctx['message'] or '—'}</div>
      {deep_link_html}
      <p style="font-size:11px;color:#94a3b8;margin-top:24px">
        You won't be alerted again about the same fingerprint for {ctx['window_minutes']} minutes
        (cooldown). Configure thresholds via <code>ERROR_ALERT_*</code> env vars.
      </p>
    </div>
    """
    try:
        await asyncio.to_thread(
            send_email,
            recipients,
            subject,
            html,
            purpose="error_alert",
            from_name="AUDINEXA Alerts",
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning("Email alert exception: %s", exc)
