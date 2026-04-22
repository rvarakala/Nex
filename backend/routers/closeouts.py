"""Close-out report endpoints."""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from utils.ist import IST, ist_today_ymd, ist_day_start_utc, ist_next_day_start_utc
import closeout as closeout_module


router = APIRouter(prefix="/api")


# ---- Sparkline / trend ----

@router.get("/closeouts/trend/collections")
async def collections_trend(days: int = 30, user=Depends(get_current_user), db=Depends(get_db)):
    """Last `days` days of collections (₹) bucketed by IST date for the current clinic.
    Response includes week-on-week delta + min/max/avg for the sparkline render."""
    return await _compute_trend(db, user["clinic_id"], days, kind="collections")


@router.get("/closeouts/trend/walkins")
async def walkins_trend(days: int = 30, user=Depends(get_current_user), db=Depends(get_db)):
    """Last `days` days of walk-in token counts bucketed by IST date."""
    return await _compute_trend(db, user["clinic_id"], days, kind="walkins")


@router.get("/closeouts/trend/no_show_rate")
async def no_show_rate_trend(days: int = 30, user=Depends(get_current_user), db=Depends(get_db)):
    """Last `days` days of no-show-rate (%) bucketed by IST date.
    Rate per day = no_show_count / scheduled_count × 100 (0 if no appointments).
    """
    return await _compute_trend(db, user["clinic_id"], days, kind="no_show_rate")


async def _compute_trend(db, clinic_id: str, days: int, kind: str) -> dict:
    days = max(1, min(days, 90))
    today = ist_today_ymd()
    start_ymd = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    start_utc = ist_day_start_utc(start_ymd)
    end_utc = ist_next_day_start_utc(today)

    # Pre-seed buckets (zeros) so dates with no data still appear.
    dates = [
        (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        for i in range(days)
    ]
    values: dict[str, float] = {d: 0.0 for d in dates}

    if kind == "collections":
        # MongoDB aggregation: parse ISO-string `paid_at` → IST-bucketed date → sum amount.
        # Avoids streaming every payment doc into Python and bucketing in-process.
        pipeline = [
            {"$match": {
                "clinic_id": clinic_id,
                "paid_at": {"$gte": start_utc.isoformat(), "$lt": end_utc.isoformat()},
            }},
            {"$group": {
                "_id": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "timezone": "Asia/Kolkata",
                        "date": {"$dateFromString": {"dateString": "$paid_at", "onError": None, "onNull": None}},
                    }
                },
                "total": {"$sum": {"$toDouble": {"$ifNull": ["$amount", 0]}}},
            }},
        ]
        async for row in db.payments.aggregate(pipeline):
            d = row.get("_id")
            if d in values:
                values[d] = round(float(row.get("total", 0.0)), 2)

    elif kind == "walkins":
        pipeline = [
            {"$match": {
                "clinic_id": clinic_id,
                "issued_at": {"$gte": start_utc.isoformat(), "$lt": end_utc.isoformat()},
            }},
            {"$group": {
                "_id": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "timezone": "Asia/Kolkata",
                        "date": {"$dateFromString": {"dateString": "$issued_at", "onError": None, "onNull": None}},
                    }
                },
                "count": {"$sum": 1},
            }},
        ]
        async for row in db.tokens.aggregate(pipeline):
            d = row.get("_id")
            if d in values:
                values[d] = int(row.get("count", 0))

    elif kind == "no_show_rate":
        # Appointments are stored as IST-local ISO strings (no TZ suffix) — compare by string prefix.
        scheduled: dict[str, int] = {d: 0 for d in dates}
        no_shows: dict[str, int] = {d: 0 for d in dates}
        async for a in db.appointments.find(
            {"clinic_id": clinic_id, "start_at": {"$gte": f"{start_ymd}T00:00:00", "$lte": f"{today}T23:59:59"}},
            {"_id": 0, "start_at": 1, "status": 1},
        ):
            ymd = str(a.get("start_at", ""))[:10]
            if ymd in scheduled:
                scheduled[ymd] += 1
                if a.get("status") == "no_show":
                    no_shows[ymd] += 1
        for d in dates:
            values[d] = round((no_shows[d] / scheduled[d] * 100.0), 1) if scheduled[d] else 0.0

    series = [{"date": d, "value": values[d]} for d in dates]
    # Back-compat alias: `total` key used by the existing sparkline component.
    for s in series:
        s["total"] = s["value"]
    totals = [s["value"] for s in series]

    this_week_total = round(sum(totals[-7:]), 2) if len(totals) >= 1 else 0.0
    last_week_total = round(sum(totals[-14:-7]), 2) if len(totals) >= 14 else 0.0
    wow_delta_pct = None
    if kind == "no_show_rate":
        # For rates, WoW compares 7-day averages rather than sums.
        this_avg = round(sum(totals[-7:]) / max(1, min(7, len(totals))), 2)
        last_avg = round(sum(totals[-14:-7]) / max(1, 7) if len(totals) >= 14 else 0, 2)
        this_week_total = this_avg
        last_week_total = last_avg
        if last_avg > 0.01:
            wow_delta_pct = round(((this_avg - last_avg) / last_avg) * 100.0, 1)
    else:
        if last_week_total > 0.01:
            wow_delta_pct = round(((this_week_total - last_week_total) / last_week_total) * 100.0, 1)

    return {
        "kind": kind,
        "series": series,
        "this_week_total": this_week_total,
        "last_week_total": last_week_total,
        "wow_delta_pct": wow_delta_pct,
        "wow_delta_abs": round(this_week_total - last_week_total, 2),
        "max": round(max(totals), 2) if totals else 0.0,
        "avg": round(sum(totals) / len(totals), 2) if totals else 0.0,
        "days": days,
    }


def _bucket_from_utc(iso_str) -> str | None:  # noqa: F841
    """Parse a UTC-ish ISO string and return the IST YYYY-MM-DD it belongs to.
    Retained for ad-hoc diagnostics; the aggregation pipeline now handles bucketing server-side."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).strftime("%Y-%m-%d")
    except Exception:
        return None


# ---- Close-out CRUD ----

@router.get("/closeouts")
async def list_closeouts(limit: int = 30, user=Depends(get_current_user), db=Depends(get_db)):
    rows = await db.daily_closeouts.find(
        {"clinic_id": user["clinic_id"]},
        {"_id": 0},
    ).sort("date", -1).to_list(max(1, min(limit, 365)))
    return rows


@router.get("/closeouts/latest")
async def latest_closeout(user=Depends(get_current_user), db=Depends(get_db)):
    row = await db.daily_closeouts.find_one(
        {"clinic_id": user["clinic_id"]},
        {"_id": 0},
        sort=[("date", -1)],
    )
    return row


@router.get("/closeouts/{date}")
async def get_closeout_by_date(date: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await db.daily_closeouts.find_one(
        {"clinic_id": user["clinic_id"], "date": date},
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="No close-out for this date")
    return row


@router.post("/closeouts/generate")
async def manual_closeout(payload: dict, user=Depends(get_current_user), db=Depends(get_db)):
    if user["role"] not in {"super_admin", "accounts"}:
        raise HTTPException(status_code=403, detail="Only super_admin / accounts can trigger close-out")
    ymd = (payload or {}).get("date")
    return await closeout_module.generate_and_store_closeout(
        db, user["clinic_id"], ymd=ymd, generated_by=f"manual:{user['user_id']}"
    )


@router.put("/closeouts/{date}/read")
async def mark_closeout_read(date: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.daily_closeouts.update_one(
        {"clinic_id": user["clinic_id"], "date": date},
        {"$set": {"read": True}},
    )
    return {"ok": True}
