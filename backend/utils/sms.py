"""SMS helper — pluggable provider indirection.

Phase 1: Twilio only. `send_sms(to, body)` returns a structured dict the
caller logs / audits without having to think about provider specifics.

Design notes:
  * `SMS_PROVIDER` env toggle: "twilio" (prod) or "mock" (dev/CI). Unset
    defaults to "mock" so local / test runs never hit a paid provider by
    accident.
  * E.164 normalisation for Indian mobiles:
      - 10 digits            → +91XXXXXXXXXX
      - 91 + 10 digits       → +91XXXXXXXXXX
      - +91... / +1...       → as-is (trusted)
      - anything else        → validated-then-rejected
  * Fail-safe: if provider creds are missing or the Twilio call fails, we
    log loudly and return {"status": "error", ...}. Caller decides whether
    to surface the error (e.g. OTP flow must fail) or silently continue
    (e.g. secondary status-update SMS).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

log = logging.getLogger("audinexa.sms")


# ---------- provider + creds helpers ----------------------------------------

def _provider() -> str:
    return os.environ.get("SMS_PROVIDER", "mock").strip().lower()


def _twilio_creds() -> Optional[dict]:
    sid   = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    frm   = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
    if not (sid and token and frm):
        return None
    return {"sid": sid, "token": token, "from": frm}


# ---------- E.164 normalisation --------------------------------------------

_DIGITS_ONLY = re.compile(r"\D+")


def normalise_e164(raw: str, default_country_code: str = "91") -> Optional[str]:
    """Return a `+<cc><number>` string or None if unrecognisable.

    Indian market is the primary target — bare 10-digit input is assumed to
    be Indian. Anything starting with `+` passes through untouched so we
    don't clobber legitimate international numbers.
    """
    if not raw:
        return None
    raw = raw.strip()
    if raw.startswith("+"):
        # Trust the caller, just strip non-digits after the plus.
        digits = _DIGITS_ONLY.sub("", raw)
        return f"+{digits}" if digits else None

    digits = _DIGITS_ONLY.sub("", raw)
    if len(digits) == 10:
        return f"+{default_country_code}{digits}"
    if len(digits) == 12 and digits.startswith(default_country_code):
        return f"+{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        # Strip India's trunk prefix (0) and apply country code.
        return f"+{default_country_code}{digits[1:]}"
    # Unknown shape — refuse rather than silently guess.
    return None


# ---------- public API ------------------------------------------------------

def send_sms(to: str, body: str, *, purpose: str = "generic") -> dict:
    """Send one SMS. Returns a dict summarising the outcome.

    Shape:
        {
          "status":   "sent" | "mocked" | "error" | "invalid_number",
          "provider": "twilio" | "mock",
          "to":       "<E.164>",
          "sid":      "<twilio message sid>"   # present on success
          "error":    "<human-readable reason>" # present on error
        }
    """
    to_e164 = normalise_e164(to)
    if not to_e164:
        log.warning("sms.invalid_number raw=%r purpose=%s", to, purpose)
        return {"status": "invalid_number", "provider": _provider(), "to": to}

    prov = _provider()

    # ---- Mock provider — dev / CI. Log and return as if successful. ------
    if prov != "twilio":
        log.info("sms.mock to=%s purpose=%s body=%r", to_e164, purpose, body[:120])
        return {"status": "mocked", "provider": "mock", "to": to_e164}

    # ---- Twilio provider -------------------------------------------------
    creds = _twilio_creds()
    if not creds:
        log.error("sms.twilio_creds_missing purpose=%s", purpose)
        return {
            "status": "error", "provider": "twilio", "to": to_e164,
            "error": "Twilio credentials not configured",
        }

    try:
        from twilio.rest import Client
        from twilio.base.exceptions import TwilioRestException

        client = Client(creds["sid"], creds["token"])
        msg = client.messages.create(
            to=to_e164,
            from_=creds["from"],
            body=body,
        )
        log.info("sms.twilio_sent to=%s sid=%s purpose=%s", to_e164, msg.sid, purpose)
        return {
            "status": "sent", "provider": "twilio", "to": to_e164,
            "sid": msg.sid,
        }
    except TwilioRestException as exc:  # pragma: no cover — exercised via integration test
        # Twilio errors are structured — code 21608 = unverified trial number,
        # 21211 = invalid 'To', 20003 = bad creds, etc. Log the code for ops.
        log.error("sms.twilio_error code=%s status=%s msg=%s to=%s",
                  getattr(exc, "code", "?"), getattr(exc, "status", "?"),
                  getattr(exc, "msg", str(exc)), to_e164)
        return {
            "status": "error", "provider": "twilio", "to": to_e164,
            "error": f"Twilio {getattr(exc, 'code', '?')}: {getattr(exc, 'msg', str(exc))}",
        }
    except Exception as exc:  # pragma: no cover — guard against network blips
        log.error("sms.twilio_unexpected err=%s to=%s", exc, to_e164)
        return {
            "status": "error", "provider": "twilio", "to": to_e164,
            "error": str(exc),
        }


__all__ = ["send_sms", "normalise_e164"]
