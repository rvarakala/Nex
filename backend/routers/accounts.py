"""Accounts / Revenue dashboard for the tenant app.

Aggregates payments — both invoice-linked and CSV-imported — by a configurable
date range. Powers the new "Accounts" item in the main left nav.

Endpoints:
  GET /api/accounts/revenue?range=daily|weekly|monthly|quarterly|half_yearly|custom
                          [&from=YYYY-MM-DD&to=YYYY-MM-DD]
    Returns a structured dashboard payload:
      { range, from, to,
        total: float,
        payment_count: int,
        unique_patients: int,
        invoice_count: int,
        timeseries: [{date, amount, count}],   # daily buckets across the window
        by_method: {cash:..., upi:..., ...},
        by_referring_doctor: [{name, doctor_id?, amount, count}],
        by_test: [{test, amount, count}] }

  GET /api/accounts/recent-payments?limit=50
    Latest N payment rows across the clinic — quick "live activity" panel.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user, require_roles
from database import get_db


router = APIRouter(prefix="/api/accounts", tags=["accounts"])


RangeKey = Literal["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly", "custom"]


def _resolve_range(range_key: str, from_str: Optional[str], to_str: Optional[str]) -> tuple[date, date]:
    today = datetime.utcnow().date()
    if range_key == "custom":
        if not from_str or not to_str:
            raise HTTPException(400, "custom range needs ?from= and ?to= (YYYY-MM-DD)")
        try:
            f = datetime.strptime(from_str, "%Y-%m-%d").date()
            t = datetime.strptime(to_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "from / to must be YYYY-MM-DD")
        if f > t:
            f, t = t, f
        return f, t
    if range_key == "daily":
        return today, today
    if range_key == "weekly":
        return today - timedelta(days=6), today
    if range_key == "monthly":
        return today - timedelta(days=29), today
    if range_key == "quarterly":
        return today - timedelta(days=89), today
    if range_key == "half_yearly":
        return today - timedelta(days=179), today
    if range_key == "yearly":
        return today - timedelta(days=364), today
    # Fallback — treat unknown values as monthly to keep the UI alive.
    return today - timedelta(days=29), today


def _iso_window(d_from: date, d_to: date) -> tuple[str, str]:
    """Inclusive ISO-string window. Payments use lexicographic prefix matching
    (paid_at stored as ISO string), so use 'YYYY-MM-DDT00:00:00' / '...T23:59:59'."""
    return f"{d_from.isoformat()}T00:00:00", f"{d_to.isoformat()}T23:59:59.999"


@router.get("/revenue")
async def revenue(
    range: RangeKey = Query("monthly"),  # noqa: A002 — name matches public API contract
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    d_from, d_to = _resolve_range(range, from_, to)
    iso_from, iso_to = _iso_window(d_from, d_to)

    q = {
        "clinic_id": user["clinic_id"],
        "paid_at": {"$gte": iso_from, "$lte": iso_to},
    }

    rows = await db.payments.find(q, {"_id": 0}).to_list(20000)

    # In-Python aggregations (collections are <1M rows / range, fast enough).
    total = 0.0
    by_method: dict[str, float] = {}
    by_doctor: dict[str, dict] = {}
    by_test: dict[str, dict] = {}
    by_day: dict[str, dict] = {}
    invoice_ids: set[str] = set()
    patient_ids: set[str] = set()

    for r in rows:
        amt = float(r.get("amount") or 0)
        total += amt
        by_method[r.get("method", "other")] = round(by_method.get(r.get("method", "other"), 0.0) + amt, 2)
        if r.get("invoice_id"):
            invoice_ids.add(r["invoice_id"])
        if r.get("patient_id"):
            patient_ids.add(r["patient_id"])
        # By date — derive YYYY-MM-DD from paid_at (or visit_date as fallback)
        day_key = (r.get("paid_at") or r.get("visit_date") or "")[:10] or "unknown"
        bucket = by_day.setdefault(day_key, {"date": day_key, "amount": 0.0, "count": 0})
        bucket["amount"] = round(bucket["amount"] + amt, 2)
        bucket["count"] += 1
        # By referring doctor
        dr_name = (r.get("referring_doctor_name") or "").strip() or "Walk-in / no referral"
        dr_key = dr_name.lower()
        d = by_doctor.setdefault(dr_key, {"name": dr_name, "doctor_id": r.get("referring_doctor_id"),
                                          "amount": 0.0, "count": 0})
        d["amount"] = round(d["amount"] + amt, 2)
        d["count"] += 1
        # By test
        for t in (r.get("tests") or []):
            t_key = str(t).upper()
            tt = by_test.setdefault(t_key, {"test": t_key, "amount": 0.0, "count": 0})
            # When a payment covers N tests, attribute amount/N to each test.
            denom = max(1, len(r.get("tests") or []))
            tt["amount"] = round(tt["amount"] + amt / denom, 2)
            tt["count"] += 1

    # Fill missing days in the window so the timeseries chart isn't gappy.
    timeseries = []
    cursor_d = d_from
    while cursor_d <= d_to:
        k = cursor_d.isoformat()
        timeseries.append(by_day.get(k) or {"date": k, "amount": 0.0, "count": 0})
        cursor_d += timedelta(days=1)

    return {
        "range": range,
        "from": d_from.isoformat(),
        "to": d_to.isoformat(),
        "total": round(total, 2),
        "payment_count": len(rows),
        "invoice_count": len(invoice_ids),
        "unique_patients": len(patient_ids),
        "timeseries": timeseries,
        "by_method": by_method,
        "by_referring_doctor": sorted(by_doctor.values(), key=lambda x: x["amount"], reverse=True),
        "by_test": sorted(by_test.values(), key=lambda x: x["amount"], reverse=True),
    }


@router.get("/recent-payments")
async def recent_payments(
    limit: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    rows = await db.payments.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0},
    ).sort("paid_at", -1).limit(limit).to_list(limit)
    return rows
