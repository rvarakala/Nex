"""MSG91 WhatsApp Business API client + per-tenant credential resolver.

AUDINEXA Connect ships in two modes:
  * BYOG     — clinic provides their own MSG91 auth key + integrated number.
               We encrypt the auth key with `MSG91_ENCRYPTION_KEY` (Fernet,
               server-side env var) and store it on the clinic's
               `whatsapp_configs` document.
  * HOSTED   — clinic uses Audinexa's shared MSG91 account. Auth key + number
               come from `MSG91_HOSTED_AUTH_KEY` / `MSG91_HOSTED_NUMBER`
               env vars on the backend.

Public surface used by routers:

  * `enc.encrypt(plaintext)`           — encrypt BYOG auth key for storage
  * `enc.decrypt(ciphertext)`          — decrypt for outbound send
  * `normalise_phone(raw)`             — collapse to "+91XXXXXXXXXX"
  * `resolve_credentials(db, clinic)`  — returns dict {auth_key, number, mode}
                                         or raises HTTPException 412 if not
                                         configured for that clinic.
  * `send_template(creds, ...)`        — POST to MSG91 bulk template endpoint.
                                         Returns (ok, request_id, error).

The send helper is intentionally low-level — higher-level callers (PR 2 will
add appointment/invoice/report triggers) compose the variables dict and
template name. PR 1 only exposes a "test send" so clinic owners can verify
their setup.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

logger = logging.getLogger(__name__)

MSG91_BULK_URL = "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/"
MSG91_GET_TEMPLATES_URL = "https://control.msg91.com/api/v5/whatsapp/get-template-client/"


# ──────────────────────────── ENCRYPTION ────────────────────────────

class _Encryptor:
    """Lazy-initialised Fernet wrapper. Reads `MSG91_ENCRYPTION_KEY` once
    on first use so module import doesn't fail in environments that don't
    use Connect."""

    def __init__(self) -> None:
        self._cipher: Optional[Fernet] = None

    def _ensure(self) -> Fernet:
        if self._cipher is None:
            key = os.environ.get("MSG91_ENCRYPTION_KEY", "").strip()
            if not key:
                raise HTTPException(
                    status_code=500,
                    detail="MSG91_ENCRYPTION_KEY not configured on server",
                )
            try:
                self._cipher = Fernet(key.encode())
            except (ValueError, TypeError) as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"MSG91_ENCRYPTION_KEY invalid Fernet key: {exc}",
                ) from exc
        return self._cipher

    def encrypt(self, plaintext: str) -> str:
        if not plaintext:
            return ""
        return self._ensure().encrypt(plaintext.encode("utf-8")).decode("utf-8")

    def decrypt(self, ciphertext: str) -> str:
        if not ciphertext:
            return ""
        try:
            return self._ensure().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise HTTPException(
                status_code=500,
                detail="Stored MSG91 auth key cannot be decrypted (key rotation?)",
            ) from exc


enc = _Encryptor()


def mask_key(plain: str) -> str:
    """Return '••••••12AB' style mask for read-back UIs."""
    if not plain:
        return ""
    if len(plain) <= 4:
        return "•" * len(plain)
    return "•" * 8 + plain[-4:]


# ──────────────────────────── PHONE NORMALISATION ───────────────────

_PHONE_DIGITS_RE = re.compile(r"\D+")


def normalise_phone(raw: Optional[str]) -> str:
    """Coerce common Indian phone formats into '+91XXXXXXXXXX'.

    Accepts: '9876543210', '+91 98765 43210', '0091-9876543210',
             '91-9876543210', '+919876543210'.
    Raises ValueError if the result is not a valid 10-digit Indian mobile.
    """
    if not raw:
        raise ValueError("phone number is empty")
    digits = _PHONE_DIGITS_RE.sub("", raw)
    # Strip leading 0 / 91 / 0091
    if digits.startswith("0091"):
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise ValueError(
            f"invalid Indian mobile number '{raw}' "
            "(expected 10 digits starting with 6/7/8/9)"
        )
    return f"+91{digits}"


# ──────────────────────────── CREDENTIAL RESOLVER ───────────────────

async def get_clinic_config(db, clinic_id: str) -> Optional[dict]:
    """Fetch the clinic's `whatsapp_configs` doc (without _id)."""
    return await db.whatsapp_configs.find_one(
        {"clinic_id": clinic_id}, {"_id": 0}
    )


async def resolve_credentials(db, clinic_id: str) -> dict[str, Any]:
    """Return {auth_key, integrated_number, mode, dpa_accepted} or raise 412.

    Logic:
      * If clinic has `mode == 'byog'` and saved auth_key+number → use them.
      * If clinic has `mode == 'hosted'` → use env vars.
      * Otherwise raise HTTPException(412) "Connect not configured".

    The clinic's DPA must be accepted (`dpa_accepted == True`) for any send
    to proceed, regardless of mode.
    """
    cfg = await get_clinic_config(db, clinic_id)
    if not cfg or not cfg.get("enabled"):
        raise HTTPException(
            status_code=412,
            detail="AUDINEXA Connect is not enabled for this clinic. "
                   "Owner must configure it under Settings → Connect.",
        )
    if not cfg.get("dpa_accepted"):
        raise HTTPException(
            status_code=412,
            detail="Data Processing Agreement not accepted yet. "
                   "Owner must accept the DPA in Settings → Connect.",
        )

    mode = cfg.get("mode", "byog")
    if mode == "byog":
        enc_key = cfg.get("auth_key_encrypted")
        number = cfg.get("integrated_number")
        if not enc_key or not number:
            raise HTTPException(
                status_code=412,
                detail="BYOG auth key or integrated number missing.",
            )
        return {
            "mode": "byog",
            "auth_key": enc.decrypt(enc_key),
            "integrated_number": number,
            "dpa_accepted": True,
        }
    elif mode == "hosted":
        auth_key = os.environ.get("MSG91_HOSTED_AUTH_KEY", "").strip()
        number = os.environ.get("MSG91_HOSTED_NUMBER", "").strip()
        if not auth_key or not number:
            raise HTTPException(
                status_code=412,
                detail="Hosted MSG91 account not yet provisioned by Audinexa. "
                       "Contact support@audinexa.com.",
            )
        return {
            "mode": "hosted",
            "auth_key": auth_key,
            "integrated_number": number,
            "dpa_accepted": True,
        }
    else:
        raise HTTPException(status_code=412, detail=f"Unknown Connect mode '{mode}'")


# ──────────────────────────── SEND PIPELINE ─────────────────────────

class Msg91Error(Exception):
    """Raised for unrecoverable MSG91 send errors."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


# Map MSG91 error codes → human-readable hints (shown in clinic UI).
MSG91_ERROR_HINTS: dict[str, str] = {
    "0":      "Authentication failed. Verify your MSG91 auth key.",
    "3":      "API method error. Check that your auth key has WhatsApp permission.",
    "10":     "Permission denied — your Meta Business Account verification may be incomplete.",
    "131016": "MSG91 service temporarily unavailable. Please retry shortly.",
    "132001": "Template not approved or not found on your MSG91 account.",
    "132005": "Variable values exceed template character limits.",
    "133010": "Your WhatsApp number is not registered on Meta yet.",
}


def hint_for_error(code: str) -> str:
    return MSG91_ERROR_HINTS.get(str(code), "")


async def send_template(
    *,
    auth_key: str,
    integrated_number: str,
    template_name: str,
    template_namespace: str,
    language_code: str,
    recipient: str,
    body_variables: list[str],
    timeout: float = 12.0,
) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
    """POST a single template message to MSG91.

    Returns (success, request_id, error_code, error_message).

    `body_variables` is the ordered list of substitutions for {{1}}, {{2}}, …
    `recipient` and `integrated_number` will both be normalised here.
    """
    try:
        sender = normalise_phone(integrated_number)
        to = normalise_phone(recipient)
    except ValueError as exc:
        return False, None, "phone_format", str(exc)

    components: dict[str, dict[str, str]] = {}
    for idx, value in enumerate(body_variables, start=1):
        components[f"body_{idx}"] = {"type": "text", "value": str(value)}

    payload = {
        "integrated_number": sender,
        "content_type": "template",
        "payload": {
            "messaging_product": "whatsapp",
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code, "policy": "deterministic"},
                "namespace": template_namespace,
                "to_and_components": [
                    {"to": [to], "components": components},
                ],
            },
        },
    }
    headers = {"authkey": auth_key, "content-type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(MSG91_BULK_URL, json=payload, headers=headers)
    except httpx.TimeoutException:
        return False, None, "timeout", "MSG91 request timed out."
    except httpx.HTTPError as exc:
        return False, None, "network", f"Network error: {exc}"

    try:
        body = r.json()
    except ValueError:
        body = {"raw": r.text[:500]}

    if r.status_code == 200 and (body.get("type") == "success" or body.get("status") == "success"):
        # MSG91 returns {"type":"success","message":"<request_id>"} on bulk endpoint.
        request_id = (
            body.get("message")
            or body.get("data", {}).get("request_id")
            or body.get("requestId")
        )
        return True, request_id, None, None

    # Non-200 OR success-flag missing — extract code + message.
    code = (
        str(body.get("code"))
        if body.get("code") is not None
        else str(body.get("error", {}).get("code", r.status_code))
    )
    msg = (
        body.get("message")
        or body.get("error", {}).get("message")
        or f"HTTP {r.status_code}"
    )
    hint = hint_for_error(code)
    if hint:
        msg = f"{msg} — {hint}"
    logger.warning("MSG91 send failed code=%s msg=%s", code, msg)
    return False, None, code, msg


async def log_message(
    db,
    *,
    clinic_id: str,
    direction: str = "outbound",
    template_name: str,
    recipient: str,
    status: str,
    request_id: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    purpose: Optional[str] = None,
    triggered_by_user_id: Optional[str] = None,
) -> None:
    """Append a row to `whatsapp_message_logs` for cost / audit."""
    from datetime import datetime, timezone
    import uuid
    await db.whatsapp_message_logs.insert_one({
        "log_id": f"WAM-{uuid.uuid4().hex[:10].upper()}",
        "clinic_id": clinic_id,
        "direction": direction,
        "template_name": template_name,
        "recipient": recipient,
        "status": status,                      # queued | failed | test_sent | test_failed
        "request_id": request_id,
        "error_code": error_code,
        "error_message": error_message,
        "purpose": purpose,                    # appointment_reminder | invoice | report_ready | …
        "triggered_by_user_id": triggered_by_user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
