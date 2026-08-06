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


@router.get("/accessory-sales")
async def accessory_sales(
    range: RangeKey = Query("monthly"),  # noqa: A002
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Aggregated view of accessory-line revenue for the Revenue dashboard.

    Only counts lines whose parent invoice is fully `paid` — i.e. money
    actually landed. Aggregates from `invoices.lines[]` where
    `product_type == 'Accessory'` and the invoice's `created_at` falls
    inside the resolved window.

    Response:
        {
          "range", "from", "to",
          "unit_count":       total accessory units sold,
          "revenue":          gross revenue (line_total, incl. discount excl. GST),
          "invoice_count":    # of distinct paid invoices touched,
          "top_skus":         top-5 SKUs by revenue,
                              [{brand, model, kind, variant, unit_count, revenue}]
        }
    """
    d_from, d_to = _resolve_range(range, from_, to)
    iso_from, iso_to = _iso_window(d_from, d_to)

    # Pull paid invoices in window with at least one accessory line.
    # We keep the aggregation Python-side; volume is <10k paid invoices
    # per range for even our biggest tenants (roughly ~30 sales/day).
    q = {
        "clinic_id": user["clinic_id"],
        "status": "paid",
        "created_at": {"$gte": iso_from, "$lte": iso_to},
        "lines.product_type": "Accessory",
    }
    invoices = await db.invoices.find(
        q, {"_id": 0, "invoice_id": 1, "lines": 1},
    ).to_list(20000)

    # Resolve product_id → kind for any lines that have `accessory_product_id`
    prod_ids: set[str] = set()
    for inv in invoices:
        for ln in inv.get("lines") or []:
            if ln.get("product_type") == "Accessory" and ln.get("accessory_product_id"):
                prod_ids.add(ln["accessory_product_id"])
    kind_by_pid: dict[str, str] = {}
    if prod_ids:
        async for p in db.ha_products.find(
            {"clinic_id": user["clinic_id"], "product_id": {"$in": list(prod_ids)}},
            {"_id": 0, "product_id": 1, "accessory_kind": 1, "brand": 1, "model": 1},
        ):
            kind_by_pid[p["product_id"]] = p.get("accessory_kind") or "other"

    unit_count = 0
    revenue = 0.0
    invoice_ids: set[str] = set()
    # Group SKUs by (brand, model, variant) so "Phonak Silicone Dome — M"
    # doesn't merge with the L variant.
    by_sku: dict[tuple, dict] = {}
    for inv in invoices:
        touched = False
        for ln in inv.get("lines") or []:
            if ln.get("product_type") != "Accessory":
                continue
            qty = float(ln.get("quantity") or 0)
            line_total = float(ln.get("line_total") or 0)  # discount incl., GST excl.
            unit_count += int(qty)
            revenue += line_total
            touched = True
            brand = (ln.get("make") or "—").strip()
            model = (ln.get("model") or "—").strip()
            variant = ln.get("accessory_variant") or None
            kind = kind_by_pid.get(ln.get("accessory_product_id") or "", "other")
            key = (brand.lower(), model.lower(), variant or "")
            slot = by_sku.setdefault(key, {
                "brand": brand, "model": model, "variant": variant,
                "kind": kind, "unit_count": 0, "revenue": 0.0,
            })
            slot["unit_count"] += int(qty)
            slot["revenue"] = round(slot["revenue"] + line_total, 2)
        if touched:
            invoice_ids.add(inv.get("invoice_id"))

    top_skus = sorted(by_sku.values(), key=lambda x: x["revenue"], reverse=True)[:5]

    return {
        "range": range,
        "from": d_from.isoformat(),
        "to": d_to.isoformat(),
        "unit_count": unit_count,
        "revenue": round(revenue, 2),
        "invoice_count": len(invoice_ids),
        "top_skus": top_skus,
    }
