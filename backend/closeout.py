"""Daily Close-out
==================
Computes an end-of-day summary for each clinic and stores it in the `daily_closeouts`
collection. Scheduled daily at 21:00 IST (15:30 UTC) via APScheduler.

A summary includes:
- walkins_today          (OPD tokens issued today)
- appointments_today     (scheduled)
- appointments_completed (status=completed)
- appointments_no_show   (status=no_show)
- tokens_served          (status=completed)
- tokens_cancelled       (status=cancelled)
- collections_total      (sum of payments today)
- collections_by_method  (split cash / upi / card / bank_transfer / insurance)
- invoices_created       (count)
- invoices_paid          (count)
- invoices_pending_due   (count with status=partial OR draft)
- pending_due_amount     (sum of due_total on non-cancelled non-paid invoices)
- pending_reports        (test_sessions with no report_delivery logged)

No real email / SMS integration — delivery is via the Dashboard card and a wa.me
deep-link button (user chose wa.me-only).
"""
from datetime import datetime, timezone, timedelta
from uuid import uuid4
import logging

IST = timezone(timedelta(hours=5, minutes=30))
log = logging.getLogger("closeout")


def _ist_today_ymd(reference: datetime | None = None) -> str:
    """YYYY-MM-DD in IST for the given UTC reference (or now)."""
    ref = reference or datetime.now(timezone.utc)
    return ref.astimezone(IST).strftime("%Y-%m-%d")


def _ist_day_start_utc(ymd: str) -> datetime:
    """UTC naive datetime for 00:00 IST of the given IST YYYY-MM-DD."""
    y, m, d = [int(x) for x in ymd.split("-")]
    ist_midnight = datetime(y, m, d, 0, 0, 0, tzinfo=IST)
    return ist_midnight.astimezone(timezone.utc).replace(tzinfo=None)


async def compute_daily_summary(db, clinic_id: str, ymd: str | None = None) -> dict:
    """Compute the daily close-out summary for the given clinic + IST date.

    If ymd is None, uses today's IST date. Returns a plain dict (all JSON-serialisable).
    """
    ymd = ymd or _ist_today_ymd()
    start_utc = _ist_day_start_utc(ymd)
    end_utc = _ist_day_start_utc(
        (datetime(*[int(x) for x in ymd.split("-")]) + timedelta(days=1)).strftime("%Y-%m-%d")
    )

    # ---- Tokens / walk-ins ----
    token_q = {"clinic_id": clinic_id, "issued_at": {"$gte": start_utc.isoformat(), "$lt": end_utc.isoformat()}}
    walkins_today = await db.tokens.count_documents(token_q)
    tokens_served = await db.tokens.count_documents({**token_q, "status": "completed"})
    tokens_cancelled = await db.tokens.count_documents({**token_q, "status": "cancelled"})

    # ---- Appointments (stored as IST-local ISO strings without TZ) ----
    appt_q = {
        "clinic_id": clinic_id,
        "start_at": {"$gte": f"{ymd}T00:00:00", "$lte": f"{ymd}T23:59:59"},
    }
    appointments_today = await db.appointments.count_documents(appt_q)
    appointments_completed = await db.appointments.count_documents({**appt_q, "status": "completed"})
    appointments_no_show = await db.appointments.count_documents({**appt_q, "status": "no_show"})
    appointments_cancelled = await db.appointments.count_documents({**appt_q, "status": "cancelled"})

    # ---- Collections ----
    pay_q = {"clinic_id": clinic_id, "paid_at": {"$gte": start_utc.isoformat(), "$lt": end_utc.isoformat()}}
    pay_rows = await db.payments.find(pay_q, {"_id": 0, "method": 1, "amount": 1}).to_list(1000)
    collections_total = 0.0
    collections_by_method: dict[str, float] = {}
    for p in pay_rows:
        amt = float(p.get("amount", 0.0))
        collections_total += amt
        m = p.get("method", "other")
        collections_by_method[m] = round(collections_by_method.get(m, 0.0) + amt, 2)
    collections_total = round(collections_total, 2)

    # ---- Invoices ----
    inv_q = {
        "clinic_id": clinic_id,
        "invoice_date": {"$gte": f"{ymd}T00:00:00", "$lte": f"{ymd}T23:59:59"},
    }
    invoices_created = await db.invoices.count_documents(inv_q)
    invoices_paid = await db.invoices.count_documents({**inv_q, "status": "paid"})

    # Pending-due invoices aren't limited to today — those are the clinic's total outstanding ledger.
    pending_cursor = db.invoices.find(
        {"clinic_id": clinic_id, "status": {"$in": ["partial", "draft"]}},
        {"_id": 0, "due_total": 1},
    )
    invoices_pending_due = 0
    pending_due_amount = 0.0
    async for inv in pending_cursor:
        due = float(inv.get("due_total", 0.0))
        if due > 0.01:
            invoices_pending_due += 1
            pending_due_amount += due
    pending_due_amount = round(pending_due_amount, 2)

    # ---- Pending reports (sessions without delivery log) ----
    # Cheap count: sessions with test_date on or before today that have no report_deliveries row.
    delivered_ids: set[str] = set()
    async for d in db.report_deliveries.find({"clinic_id": clinic_id}, {"_id": 0, "session_id": 1}):
        if d.get("session_id"):
            delivered_ids.add(d["session_id"])
    pending_reports = 0
    async for s in db.test_sessions.find(
        {"clinic_id": clinic_id},
        {"_id": 0, "session_id": 1},
    ):
        if s.get("session_id") and s["session_id"] not in delivered_ids:
            pending_reports += 1

    return {
        "date": ymd,
        "clinic_id": clinic_id,
        "walkins_today": walkins_today,
        "tokens_served": tokens_served,
        "tokens_cancelled": tokens_cancelled,
        "appointments_today": appointments_today,
        "appointments_completed": appointments_completed,
        "appointments_no_show": appointments_no_show,
        "appointments_cancelled": appointments_cancelled,
        "collections_total": collections_total,
        "collections_by_method": collections_by_method,
        "payments_count": len(pay_rows),
        "invoices_created": invoices_created,
        "invoices_paid": invoices_paid,
        "invoices_pending_due": invoices_pending_due,
        "pending_due_amount": pending_due_amount,
        "pending_reports": pending_reports,
    }


async def generate_and_store_closeout(db, clinic_id: str, ymd: str | None = None,
                                      generated_by: str = "scheduled") -> dict:
    """Compute and upsert a close-out row for (clinic_id, date). Idempotent."""
    summary = await compute_daily_summary(db, clinic_id, ymd)
    summary["generated_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    summary["generated_by"] = generated_by
    summary["read"] = False
    new_closeout_id = f"CO-{str(uuid4())[:8].upper()}"
    # Upsert on (clinic_id, date) so today's summary rolls up during the day if manually regenerated.
    await db.daily_closeouts.update_one(
        {"clinic_id": summary["clinic_id"], "date": summary["date"]},
        {"$set": summary, "$setOnInsert": {"closeout_id": new_closeout_id}},
        upsert=True,
    )
    # Fetch the canonical row (so we return the persisted closeout_id whether just-inserted or updated)
    stored = await db.daily_closeouts.find_one(
        {"clinic_id": clinic_id, "date": summary["date"]},
        {"_id": 0},
    )
    log.info(f"Close-out stored for {clinic_id} on {summary['date']}: ₹{summary['collections_total']} · {summary['walkins_today']} walk-ins")
    return stored


async def run_daily_closeout_for_all_clinics(db):
    """Scheduler entry point. Fires at 21:00 IST every day."""
    try:
        async for c in db.clinics.find({}, {"_id": 0, "clinic_id": 1}):
            try:
                await generate_and_store_closeout(db, c["clinic_id"], ymd=_ist_today_ymd(), generated_by="scheduled")
            except Exception as e:
                log.error(f"Close-out failed for {c.get('clinic_id')}: {e}")
    except Exception as e:
        log.error(f"Close-out scheduler loop error: {e}")


def start_scheduler(db) -> "AsyncIOScheduler":
    """Create and start an APScheduler AsyncIOScheduler that fires at 21:00 IST daily.
    Returns the scheduler so the caller can shut it down."""
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger

    sched = AsyncIOScheduler(timezone=IST)
    sched.add_job(
        run_daily_closeout_for_all_clinics,
        trigger=CronTrigger(hour=21, minute=0, timezone=IST),
        args=[db],
        id="daily_closeout_21_ist",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    sched.start()
    log.info("APScheduler started: daily_closeout_21_ist (21:00 IST)")
    return sched
