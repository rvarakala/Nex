"""Scheduled CSV Email Exports — weekly digests for owners/accounts.

Users toggle "Email me this view weekly" on the Patients / Invoices pages.
Each Monday at 07:00 IST an APScheduler job generates the CSV for every
active subscription and emails it as an attachment.

Endpoints:
  GET    /api/csv-exports/subscriptions            — list caller's subscriptions
  POST   /api/csv-exports/subscribe                — create (idempotent per kind)
  DELETE /api/csv-exports/subscribe/{kind}         — cancel a subscription
  POST   /api/csv-exports/send-now                 — send an immediate one-off
                                                     (useful for smoke testing +
                                                     "send me now" UX)

Auth: any authenticated user can subscribe *themselves* — the email always
goes to `user.email`, never a free-form target. This eliminates the risk of
a rogue owner using the export as a data-exfil pipeline to an outside inbox.

Data model — collection `csv_export_subscriptions`:
  { sub_id, clinic_id, user_id, email, kind ('patients'|'invoices'),
    frequency ('weekly'), created_at, active, last_sent_at }

Rate-limit note: the scheduler skips a subscription if `last_sent_at` is
within the last 6 days — protects against accidental double-fires when the
worker restarts around the cron boundary.
"""
from __future__ import annotations

import csv
import io
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database import get_db
from utils.email import send_email

log = logging.getLogger("audinexa.csv_exports")

router = APIRouter(prefix="/api/csv-exports", tags=["csv-exports"])

# Roles allowed to subscribe. Everyone else gets 403.
ALLOWED_ROLES = {"clinic_owner", "accounts", "super_admin", "founder"}
ALLOWED_KINDS = {"patients", "invoices"}


# ─────────────── Pydantic ───────────────

class SubscribeIn(BaseModel):
    kind: Literal["patients", "invoices"]


class SubscriptionOut(BaseModel):
    sub_id: str
    kind: str
    email: str
    frequency: str
    active: bool
    created_at: str
    last_sent_at: Optional[str] = None


# ─────────────── Helpers ───────────────

def _require_role(user: dict) -> None:
    if user.get("role") not in ALLOWED_ROLES:
        raise HTTPException(status_code=403,
                            detail="Only owners / accounts can subscribe to scheduled exports.")


async def _build_patients_csv(db, clinic_id: str) -> bytes:
    """Return the full Patients CSV for a clinic (same columns as the
    on-demand `/api/patients/export.csv` endpoint)."""
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    w.writerow([
        "MRD", "Patient ID", "Name", "Age", "Gender",
        "Mobile", "Alt Mobile", "Email",
        "City", "State", "Pincode",
        "Chief Complaint", "Ear Side",
        "Referring Doctor", "Referral Source", "Insurance Scheme",
        "Registered At", "Last Updated",
    ])
    cursor = db.patients.find(
        {"clinic_id": clinic_id},
        {"_id": 0, "mrd": 1, "patient_id": 1, "name": 1, "age": 1,
         "gender": 1, "mobile": 1, "alternate_mobile": 1, "email": 1,
         "city": 1, "state": 1, "pincode": 1, "chief_complaint": 1,
         "ear_side": 1, "referring_physician": 1, "referral_source": 1,
         "insurance_scheme": 1, "created_at": 1, "updated_at": 1},
    ).sort([("updated_at", -1), ("patient_id", -1)])
    async for p in cursor:
        w.writerow([
            p.get("mrd") or "", p.get("patient_id") or "", p.get("name") or "",
            p.get("age") or "", p.get("gender") or "",
            p.get("mobile") or "", p.get("alternate_mobile") or "",
            p.get("email") or "", p.get("city") or "", p.get("state") or "",
            p.get("pincode") or "",
            (p.get("chief_complaint") or "").replace("\n", " ").strip(),
            p.get("ear_side") or "", p.get("referring_physician") or "",
            p.get("referral_source") or "", p.get("insurance_scheme") or "",
            str(p.get("created_at") or ""), str(p.get("updated_at") or ""),
        ])
    # Prefix a UTF-8 BOM so Excel renders unicode names correctly on double-click.
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")


async def _build_invoices_csv(db, clinic_id: str, days_lookback: int = 7) -> bytes:
    """Return the last-7-days Invoices CSV for a clinic."""
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    w.writerow([
        "Invoice #", "Date", "Patient Name", "Patient MRD",
        "Subtotal", "Discount", "Tax", "Total", "Paid", "Balance",
        "Payment Status", "Payment Mode", "Notes",
    ])
    since = (datetime.now(timezone.utc) - timedelta(days=days_lookback)).isoformat()
    cursor = db.invoices.find(
        {"clinic_id": clinic_id, "created_at": {"$gte": since}},
        {"_id": 0},
    ).sort("created_at", -1)
    async for inv in cursor:
        w.writerow([
            inv.get("invoice_number") or inv.get("invoice_id") or "",
            str(inv.get("invoice_date") or inv.get("created_at") or ""),
            inv.get("patient_name") or "",
            inv.get("mrd") or inv.get("patient_id") or "",
            inv.get("subtotal") or 0,
            inv.get("discount_amount") or inv.get("discount") or 0,
            inv.get("tax_amount") or inv.get("tax") or 0,
            inv.get("total_amount") or inv.get("total") or 0,
            inv.get("paid_amount") or inv.get("paid") or 0,
            inv.get("balance_amount") or inv.get("balance") or 0,
            inv.get("payment_status") or "",
            inv.get("payment_mode") or "",
            (inv.get("notes") or "").replace("\n", " ").strip(),
        ])
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")


async def _generate_csv(db, kind: str, clinic_id: str) -> bytes:
    if kind == "patients":
        return await _build_patients_csv(db, clinic_id)
    if kind == "invoices":
        return await _build_invoices_csv(db, clinic_id)
    raise ValueError(f"Unknown export kind: {kind}")


def _clean_clinic_slug(clinic_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", clinic_id or "clinic")[:60]


async def _send_export_email(db, sub: dict) -> dict:
    """Generate + email the CSV for a single subscription. Returns the
    send_email() result dict so the caller / job runner can log outcomes."""
    kind = sub["kind"]
    clinic_id = sub["clinic_id"]
    email = sub["email"]

    # Compose CSV
    csv_bytes = await _generate_csv(db, kind, clinic_id)

    # Clinic name for the greeting
    clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0, "name": 1})
    clinic_name = (clinic or {}).get("name") or clinic_id
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug = _clean_clinic_slug(clinic_id)
    fname = f"audinexa-{kind}-{slug}-{today}.csv"

    subj_map = {
        "patients": f"AUDINEXA · Weekly Patients Export — {clinic_name}",
        "invoices": f"AUDINEXA · Weekly Invoices Export (last 7 days) — {clinic_name}",
    }
    subject = subj_map.get(kind, f"AUDINEXA · Weekly {kind.title()} Export")

    body_html = f"""
    <p>Hi,</p>
    <p>Your weekly <b>{kind}</b> export for <b>{clinic_name}</b> is attached
    ({len(csv_bytes)//1024} KB).</p>
    <p>You subscribed to this digest inside AUDINEXA. To stop it, open the
    same page and untick <i>Email me this view weekly</i>.</p>
    <p>— AUDINEXA</p>
    """
    body_text = (
        f"Hi,\n\nYour weekly {kind} export for {clinic_name} is attached.\n"
        f"To stop these emails, open AUDINEXA and untick 'Email me this view weekly'."
    )

    result = send_email(
        to=email,
        subject=subject,
        html_body=body_html,
        text_body=body_text,
        attachments=[{
            "filename": fname,
            "content": csv_bytes,
            "mime": "text/csv",
        }],
        purpose=f"csv_export_weekly_{kind}",
    )
    return result


# ─────────────── Endpoints ───────────────

@router.get("/subscriptions", response_model=list[SubscriptionOut])
async def list_subscriptions(user=Depends(get_current_user), db=Depends(get_db)):
    """Return the caller's active subscriptions. Front-end uses this to
    hydrate the "Email me this view weekly" toggle state on page load."""
    rows = await db.csv_export_subscriptions.find(
        {"user_id": user["user_id"], "clinic_id": user["clinic_id"]},
        {"_id": 0},
    ).to_list(50)
    out: list[SubscriptionOut] = []
    for r in rows:
        out.append(SubscriptionOut(
            sub_id=r["sub_id"],
            kind=r["kind"],
            email=r["email"],
            frequency=r.get("frequency", "weekly"),
            active=bool(r.get("active", True)),
            created_at=str(r.get("created_at") or ""),
            last_sent_at=str(r.get("last_sent_at") or "") or None,
        ))
    return out


@router.post("/subscribe", response_model=SubscriptionOut)
async def subscribe(payload: SubscribeIn,
                    user=Depends(get_current_user), db=Depends(get_db)):
    """Idempotent per (user_id, clinic_id, kind). Re-subscribing an already
    active subscription is a no-op and returns the existing doc."""
    _require_role(user)
    if payload.kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported export kind")
    email = (user.get("email") or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400,
                            detail="Your account email is missing — add one on your profile first.")

    existing = await db.csv_export_subscriptions.find_one(
        {"user_id": user["user_id"], "clinic_id": user["clinic_id"], "kind": payload.kind},
        {"_id": 0},
    )
    if existing and existing.get("active"):
        return SubscriptionOut(
            sub_id=existing["sub_id"],
            kind=existing["kind"],
            email=existing["email"],
            frequency=existing.get("frequency", "weekly"),
            active=True,
            created_at=str(existing.get("created_at") or ""),
            last_sent_at=str(existing.get("last_sent_at") or "") or None,
        )

    doc = {
        "sub_id": existing["sub_id"] if existing else f"SUB-{uuid.uuid4().hex[:10].upper()}",
        "user_id": user["user_id"],
        "clinic_id": user["clinic_id"],
        "email": email,
        "kind": payload.kind,
        "frequency": "weekly",
        "active": True,
        "created_at": (existing.get("created_at") if existing else datetime.now(timezone.utc)),
        "last_sent_at": existing.get("last_sent_at") if existing else None,
    }
    if existing:
        await db.csv_export_subscriptions.update_one(
            {"sub_id": doc["sub_id"]},
            {"$set": {"active": True, "email": email}},
        )
    else:
        await db.csv_export_subscriptions.insert_one(doc)
    return SubscriptionOut(
        sub_id=doc["sub_id"],
        kind=doc["kind"],
        email=doc["email"],
        frequency=doc["frequency"],
        active=True,
        created_at=str(doc["created_at"]),
        last_sent_at=str(doc.get("last_sent_at") or "") or None,
    )


@router.delete("/subscribe/{kind}")
async def unsubscribe(kind: str,
                      user=Depends(get_current_user), db=Depends(get_db)):
    """Cancel by kind — deletes the doc entirely so re-subscription starts
    with a fresh last_sent_at."""
    if kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported export kind")
    res = await db.csv_export_subscriptions.delete_one(
        {"user_id": user["user_id"], "clinic_id": user["clinic_id"], "kind": kind},
    )
    return {"ok": True, "removed": res.deleted_count}


@router.post("/send-now")
async def send_now(payload: SubscribeIn,
                   user=Depends(get_current_user), db=Depends(get_db)):
    """Fire an immediate email — useful for "send me a sample" UX + smoke
    testing. Does NOT create a subscription; strictly one-off."""
    _require_role(user)
    if payload.kind not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported export kind")
    email = (user.get("email") or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400,
                            detail="Your account email is missing — add one on your profile first.")
    sub = {"kind": payload.kind, "clinic_id": user["clinic_id"], "email": email}
    result = await _send_export_email(db, sub)
    return {"ok": result.get("status") in ("sent", "mocked"),
            "status": result.get("status"),
            "provider": result.get("provider"),
            "to": email,
            "kind": payload.kind}


# ─────────────── Scheduler entrypoint ───────────────

async def run_weekly_csv_exports(db) -> dict:
    """APScheduler entrypoint — invoked Mondays at 07:00 IST.

    For every active subscription older-than-6-days-since-last-send:
      * Build the CSV
      * Email it as an attachment
      * Stamp last_sent_at
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=6)
    subs = await db.csv_export_subscriptions.find(
        {"active": True,
         "$or": [{"last_sent_at": None},
                 {"last_sent_at": {"$exists": False}},
                 {"last_sent_at": {"$lt": cutoff}}]},
        {"_id": 0},
    ).to_list(2000)
    sent = 0
    failed = 0
    for sub in subs:
        try:
            result = await _send_export_email(db, sub)
            if result.get("status") in ("sent", "mocked"):
                sent += 1
                await db.csv_export_subscriptions.update_one(
                    {"sub_id": sub["sub_id"]},
                    {"$set": {"last_sent_at": datetime.now(timezone.utc),
                              "last_status": result.get("status"),
                              "last_error": None}},
                )
            else:
                failed += 1
                await db.csv_export_subscriptions.update_one(
                    {"sub_id": sub["sub_id"]},
                    {"$set": {"last_status": result.get("status"),
                              "last_error": result.get("error", "unknown")}},
                )
        except Exception as e:  # noqa: BLE001 — never let one bad sub kill the run
            failed += 1
            log.exception("csv_export.weekly_error sub_id=%s err=%s", sub.get("sub_id"), e)
    log.info("csv_export.weekly_run considered=%d sent=%d failed=%d", len(subs), sent, failed)
    return {"considered": len(subs), "sent": sent, "failed": failed}
