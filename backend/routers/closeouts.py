"""Close-out report endpoints.
Extracted from server.py for modularity. Uses `attach_db()` for DI.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from utils.ist import IST, ist_today_ymd, ist_day_start_utc, ist_next_day_start_utc
import closeout as closeout_module


router = APIRouter(prefix="/api")

_DB = None


def attach_db(database):
    global _DB
    _DB = database


def _db():
    if _DB is None:
        raise RuntimeError("closeouts router: DB not attached")
    return _DB


# ---- Sparkline / trend ----

@router.get("/closeouts/trend/collections")
async def collections_trend(days: int = 30, user=Depends(get_current_user)):
    """Last `days` days of collections (₹) bucketed by IST date for the current clinic.
    Response includes week-on-week delta + min/max/avg for the sparkline render."""
    db = _db()
    days = max(1, min(days, 90))
    today = ist_today_ymd()
    start_utc = ist_day_start_utc(
        (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    )
    end_utc = ist_next_day_start_utc(today)

    buckets: dict[str, float] = {}
    for i in range(days):
        d = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        buckets[d] = 0.0

    async for p in db.payments.find(
        {
            "clinic_id": user["clinic_id"],
            "paid_at": {"$gte": start_utc.isoformat(), "$lt": end_utc.isoformat()},
        },
        {"_id": 0, "paid_at": 1, "amount": 1},
    ):
        try:
            paid_at_utc = datetime.fromisoformat(str(p["paid_at"]).replace("Z", "+00:00"))
            if paid_at_utc.tzinfo is None:
                paid_at_utc = paid_at_utc.replace(tzinfo=timezone.utc)
            ist_date = paid_at_utc.astimezone(IST).strftime("%Y-%m-%d")
            if ist_date in buckets:
                buckets[ist_date] = round(buckets[ist_date] + float(p.get("amount", 0.0)), 2)
        except Exception:
            continue

    series = [{"date": d, "total": buckets[d]} for d in sorted(buckets)]
    totals = [s["total"] for s in series]

    this_week_total = round(sum(totals[-7:]), 2) if len(totals) >= 1 else 0.0
    last_week_total = round(sum(totals[-14:-7]), 2) if len(totals) >= 14 else 0.0
    wow_delta_pct = None
    if last_week_total > 0.01:
        wow_delta_pct = round(((this_week_total - last_week_total) / last_week_total) * 100.0, 1)

    return {
        "series": series,
        "this_week_total": this_week_total,
        "last_week_total": last_week_total,
        "wow_delta_pct": wow_delta_pct,
        "wow_delta_abs": round(this_week_total - last_week_total, 2),
        "max": round(max(totals), 2) if totals else 0.0,
        "avg": round(sum(totals) / len(totals), 2) if totals else 0.0,
        "days": days,
    }


# ---- Close-out CRUD ----

@router.get("/closeouts")
async def list_closeouts(limit: int = 30, user=Depends(get_current_user)):
    db = _db()
    rows = await db.daily_closeouts.find(
        {"clinic_id": user["clinic_id"]},
        {"_id": 0},
    ).sort("date", -1).to_list(max(1, min(limit, 365)))
    return rows


@router.get("/closeouts/latest")
async def latest_closeout(user=Depends(get_current_user)):
    db = _db()
    row = await db.daily_closeouts.find_one(
        {"clinic_id": user["clinic_id"]},
        {"_id": 0},
        sort=[("date", -1)],
    )
    return row


@router.get("/closeouts/{date}")
async def get_closeout_by_date(date: str, user=Depends(get_current_user)):
    db = _db()
    row = await db.daily_closeouts.find_one(
        {"clinic_id": user["clinic_id"], "date": date},
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="No close-out for this date")
    return row


@router.post("/closeouts/generate")
async def manual_closeout(payload: dict, user=Depends(get_current_user)):
    if user["role"] not in {"super_admin", "accounts"}:
        raise HTTPException(status_code=403, detail="Only super_admin / accounts can trigger close-out")
    db = _db()
    ymd = (payload or {}).get("date")
    return await closeout_module.generate_and_store_closeout(
        db, user["clinic_id"], ymd=ymd, generated_by=f"manual:{user['user_id']}"
    )


@router.put("/closeouts/{date}/read")
async def mark_closeout_read(date: str, user=Depends(get_current_user)):
    db = _db()
    await db.daily_closeouts.update_one(
        {"clinic_id": user["clinic_id"], "date": date},
        {"$set": {"read": True}},
    )
    return {"ok": True}