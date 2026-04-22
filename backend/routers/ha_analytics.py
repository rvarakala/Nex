"""HA Analytics — Phase 7 (final phase per user's 7-phase plan).

Five owner-dashboard views, all using MongoDB aggregation pipelines for
performance. No per-doc loops — everything runs server-side in Mongo with
IST-timezone bucketing (same pattern as /closeouts/trend).

Endpoints (read-only; clinic_owner + super_admin + accounts):
  * GET /ha/analytics/revenue      — monthly revenue + brand-wise breakdown
  * GET /ha/analytics/audiologists — per-audiologist sales / revenue / margin
  * GET /ha/analytics/inventory    — aging + dead stock + fast-moving accessories
  * GET /ha/analytics/funnel       — consultation → trial → sale conversion
  * GET /ha/analytics/retention    — missed follow-ups, repeat consumables, upgrade pipeline
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends

from auth import require_roles, CLINIC_WIDE_ROLES, get_current_user
from database import get_db


router = APIRouter(prefix="/api/ha/analytics")

READ_ROLES = ("clinic_owner", "super_admin", "accounts")


def _clinic_match(user: dict) -> dict:
    """Analytics are clinic-wide (not branch-scoped) — owner and accounts need full view."""
    return {"clinic_id": user["clinic_id"]}


# ==================== REVENUE ====================

@router.get("/revenue")
async def revenue(
    months: int = 12,
    user=Depends(require_roles(*READ_ROLES)),
    db=Depends(get_db),
):
    """Monthly sales revenue (in INR) for the last N months (default 12), plus
    a brand-wise breakdown for the full window.

    Excludes cancelled sales. Uses `$group` by (year-month) with IST bucketing
    via `$dateFromString` → `$dateToString(tz='Asia/Kolkata')`.
    """
    if months < 1 or months > 36:
        months = 12
    cutoff = (datetime.now(timezone.utc) - timedelta(days=months * 31)).isoformat()
    match_stage = {
        "clinic_id": user["clinic_id"],
        "status": {"$nin": ["cancelled", "draft"]},
        "created_at": {"$gte": cutoff},
    }

    # Monthly series
    monthly = []
    async for row in db.ha_sales.aggregate([
        {"$match": match_stage},
        {"$project": {
            "total": 1, "subtotal": 1, "gst_amount": 1, "discount_amount": 1,
            "ts": {"$dateFromString": {"dateString": "$created_at"}},
        }},
        {"$project": {
            "total": 1, "subtotal": 1, "gst_amount": 1, "discount_amount": 1,
            "bucket": {"$dateToString": {"date": "$ts", "format": "%Y-%m", "timezone": "Asia/Kolkata"}},
        }},
        {"$group": {
            "_id": "$bucket",
            "revenue": {"$sum": "$total"},
            "subtotal": {"$sum": "$subtotal"},
            "gst": {"$sum": "$gst_amount"},
            "discount": {"$sum": "$discount_amount"},
            "sales_count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]):
        monthly.append({
            "month": row["_id"],
            "revenue": round(float(row.get("revenue") or 0), 2),
            "subtotal": round(float(row.get("subtotal") or 0), 2),
            "gst": round(float(row.get("gst") or 0), 2),
            "discount": round(float(row.get("discount") or 0), 2),
            "sales_count": row["sales_count"],
        })

    # Brand-wise (last 12 months)
    brand_cutoff = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    brand_rows = []
    async for row in db.ha_sales.aggregate([
        {"$match": {**match_stage, "created_at": {"$gte": brand_cutoff}}},
        {"$unwind": "$lines"},
        {"$lookup": {
            "from": "ha_products", "localField": "lines.product_id",
            "foreignField": "product_id", "as": "p",
        }},
        {"$unwind": {"path": "$p", "preserveNullAndEmptyArrays": True}},
        {"$group": {
            "_id": {"$ifNull": ["$p.brand", "(unknown)"]},
            "revenue": {"$sum": {"$multiply": ["$lines.qty", "$lines.unit_price"]}},
            "units": {"$sum": "$lines.qty"},
        }},
        {"$sort": {"revenue": -1}},
        {"$limit": 15},
    ]):
        brand_rows.append({
            "brand": row["_id"],
            "revenue": round(float(row.get("revenue") or 0), 2),
            "units": int(row.get("units") or 0),
        })

    total_revenue = sum(m["revenue"] for m in monthly)
    total_sales = sum(m["sales_count"] for m in monthly)
    return {
        "window_months": months,
        "total_revenue": round(total_revenue, 2),
        "total_sales_count": total_sales,
        "avg_ticket": round(total_revenue / total_sales, 2) if total_sales else 0.0,
        "monthly": monthly,
        "brand_split": brand_rows,
    }


# ==================== AUDIOLOGIST PERFORMANCE ====================

@router.get("/audiologists")
async def audiologists(
    days: int = 90,
    user=Depends(require_roles(*READ_ROLES)),
    db=Depends(get_db),
):
    """Per-audiologist sales count + revenue + below-floor rate for a window."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(days, 7))).isoformat()

    # Map user_ids → names once
    user_rows = {
        u["user_id"]: u for u in await db.users.find(
            {"clinic_id": user["clinic_id"]},
            {"_id": 0, "user_id": 1, "name": 1, "role": 1, "email": 1},
        ).to_list(200)
    }

    rows = []
    async for row in db.ha_sales.aggregate([
        {"$match": {
            "clinic_id": user["clinic_id"],
            "status": {"$nin": ["cancelled", "draft"]},
            "created_at": {"$gte": cutoff},
        }},
        {"$group": {
            "_id": "$created_by_user_id",
            "sales_count": {"$sum": 1},
            "revenue": {"$sum": "$total"},
            "below_floor_count": {
                "$sum": {"$cond": [{"$gt": [{"$size": {"$ifNull": ["$below_floor_lines", []]}}, 0]}, 1, 0]},
            },
            "paid_count": {"$sum": {"$cond": [{"$eq": ["$status", "paid"]}, 1, 0]}},
        }},
        {"$sort": {"revenue": -1}},
    ]):
        u = user_rows.get(row["_id"], {})
        if u and u.get("role") == "accounts":
            # Accounts creating invoices is not audiologist performance; exclude.
            continue
        rows.append({
            "user_id": row["_id"],
            "name": u.get("name") or row["_id"],
            "role": u.get("role") or "(unknown)",
            "sales_count": row["sales_count"],
            "revenue": round(float(row.get("revenue") or 0), 2),
            "below_floor_count": row.get("below_floor_count", 0),
            "paid_count": row.get("paid_count", 0),
            "below_floor_pct": round(100 * (row.get("below_floor_count", 0) / max(row["sales_count"], 1)), 1),
            "paid_conversion_pct": round(100 * (row.get("paid_count", 0) / max(row["sales_count"], 1)), 1),
        })

    # WhatsApp follow-up engagement (who's actually reaching out to patients)
    wa_rows = {}
    async for row in db.ha_followups.aggregate([
        {"$match": {"clinic_id": user["clinic_id"]}},
        {"$unwind": "$sent_channels"},
        {"$match": {"sent_channels.sent_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": "$sent_channels.actor_user_id",
            "sends": {"$sum": 1},
        }},
    ]):
        wa_rows[row["_id"]] = row["sends"]

    for r in rows:
        r["wa_sends"] = wa_rows.get(r["user_id"], 0)

    return {"window_days": days, "rows": rows}


# ==================== INVENTORY HEALTH ====================

@router.get("/inventory")
async def inventory_health(
    aging_days: int = 90,
    dead_days: int = 180,
    user=Depends(require_roles(*READ_ROLES)),
    db=Depends(get_db),
):
    """IN_STOCK serials aged > `aging_days` (aging) and > `dead_days` (dead),
    plus accessories burning fastest in the last 30 days."""
    aging_cutoff = (datetime.now(timezone.utc) - timedelta(days=aging_days)).isoformat()
    dead_cutoff = (datetime.now(timezone.utc) - timedelta(days=dead_days)).isoformat()

    # Aging & dead counts by product
    aging = []
    async for row in db.serial_items.aggregate([
        {"$match": {"clinic_id": user["clinic_id"], "state": "IN_STOCK"}},
        {"$lookup": {
            "from": "serial_events",
            "let": {"sid": "$serial_id"},
            "pipeline": [
                {"$match": {"$expr": {"$eq": ["$serial_id", "$$sid"]}, "to": "IN_STOCK"}},
                {"$sort": {"at": 1}},
                {"$limit": 1},
            ],
            "as": "ev",
        }},
        {"$addFields": {"in_stock_since": {"$ifNull": [{"$arrayElemAt": ["$ev.at", 0]}, "$updated_at"]}}},
        {"$lookup": {
            "from": "ha_products", "localField": "product_id",
            "foreignField": "product_id", "as": "p",
        }},
        {"$unwind": {"path": "$p", "preserveNullAndEmptyArrays": True}},
        {"$group": {
            "_id": {
                "product_id": "$product_id",
                "brand": {"$ifNull": ["$p.brand", "(unknown)"]},
                "model": {"$ifNull": ["$p.model", "(unknown)"]},
            },
            "count": {"$sum": 1},
            "aging": {"$sum": {"$cond": [{"$lt": ["$in_stock_since", aging_cutoff]}, 1, 0]}},
            "dead": {"$sum": {"$cond": [{"$lt": ["$in_stock_since", dead_cutoff]}, 1, 0]}},
            "cost_blocked": {"$sum": {"$ifNull": ["$p.cost", 0]}},
        }},
        {"$match": {"aging": {"$gt": 0}}},
        {"$sort": {"dead": -1, "aging": -1}},
        {"$limit": 50},
    ]):
        aging.append({
            "product_id": row["_id"]["product_id"],
            "brand": row["_id"]["brand"], "model": row["_id"]["model"],
            "in_stock": row["count"],
            "aging": row["aging"], "dead": row["dead"],
            "cost_blocked": round(float(row.get("cost_blocked") or 0), 2),
        })

    totals = {
        "in_stock_total": await db.serial_items.count_documents(
            {"clinic_id": user["clinic_id"], "state": "IN_STOCK"},
        ),
        "aging_units": sum(r["aging"] for r in aging),
        "dead_units": sum(r["dead"] for r in aging),
        "cost_blocked": round(sum(r["cost_blocked"] for r in aging), 2),
    }

    # Fast-moving accessories: 30-day burn (positive deliveries vs incoming stock)
    burn_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    burn = []
    async for row in db.accessory_events.aggregate([
        {"$match": {"clinic_id": user["clinic_id"], "at": {"$gte": burn_cutoff}, "delta": {"$lt": 0}}},
        {"$group": {"_id": "$product_id", "units_out": {"$sum": {"$abs": "$delta"}}}},
        {"$sort": {"units_out": -1}},
        {"$limit": 10},
    ]):
        burn.append({"product_id": row["_id"], "units_out_30d": int(row["units_out"])})

    return {
        "totals": totals,
        "aging_by_product": aging,
        "fast_moving_accessories": burn,
        "aging_days": aging_days, "dead_days": dead_days,
    }


# ==================== FUNNEL ====================

@router.get("/funnel")
async def funnel(
    days: int = 90,
    user=Depends(require_roles(*READ_ROLES)),
    db=Depends(get_db),
):
    """Counts across the clinical commerce funnel for the window:
    consultations (tokens / appointments) → quotations → trials → sales → paid.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    consultations = await db.tokens.count_documents({
        "clinic_id": user["clinic_id"], "issued_at": {"$gte": cutoff},
    })
    quotations = await db.quotations.count_documents({
        "clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff},
    })
    trials_issued = await db.ha_trials.count_documents({
        "clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff},
    })
    trial_converted = await db.ha_trials.count_documents({
        "clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff}, "status": "converted",
    })
    trial_returned = await db.ha_trials.count_documents({
        "clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff}, "status": "returned",
    })
    trial_lost = await db.ha_trials.count_documents({
        "clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff}, "status": "lost",
    })
    sales_total = await db.ha_sales.count_documents({
        "clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff}, "status": {"$nin": ["cancelled"]},
    })
    sales_paid = await db.ha_sales.count_documents({
        "clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff}, "status": "paid",
    })

    # Average trial-to-convert days (for converted trials with a linked sale)
    avg_trial_days = None
    async for row in db.ha_trials.aggregate([
        {"$match": {
            "clinic_id": user["clinic_id"],
            "status": "converted", "created_at": {"$gte": cutoff},
            "closed_at": {"$ne": None},
        }},
        {"$project": {
            "s": {"$dateFromString": {"dateString": "$created_at"}},
            "e": {"$dateFromString": {"dateString": "$closed_at"}},
        }},
        {"$project": {"days": {"$divide": [{"$subtract": ["$e", "$s"]}, 86400000]}}},
        {"$group": {"_id": None, "avg_days": {"$avg": "$days"}}},
    ]):
        avg_trial_days = round(float(row.get("avg_days") or 0), 1)

    # Conversion rates
    def pct(n, d): return round(100 * n / max(d, 1), 1)

    return {
        "window_days": days,
        "stages": {
            "consultations": consultations,
            "quotations": quotations,
            "trials_issued": trials_issued,
            "trials_converted": trial_converted,
            "trials_returned": trial_returned,
            "trials_lost": trial_lost,
            "sales_total": sales_total,
            "sales_paid": sales_paid,
        },
        "rates": {
            "quote_per_consult_pct": pct(quotations, consultations),
            "trial_per_quote_pct": pct(trials_issued, quotations),
            "convert_per_trial_pct": pct(trial_converted, trials_issued),
            "lost_per_trial_pct": pct(trial_lost, trials_issued),
            "paid_per_sale_pct": pct(sales_paid, sales_total),
        },
        "avg_trial_to_convert_days": avg_trial_days,
    }


# ==================== RETENTION ====================

@router.get("/retention")
async def retention(
    user=Depends(require_roles(*READ_ROLES)),
    db=Depends(get_db),
):
    """Missed follow-ups, consumable repeat-purchase loyalty, and upgrade pipeline size."""
    today = date.today().isoformat()

    missed = await db.ha_followups.count_documents({
        "clinic_id": user["clinic_id"], "status": "pending", "due_date": {"$lt": today},
    })
    dismissed_pct_denom = await db.ha_followups.count_documents({
        "clinic_id": user["clinic_id"],
    })
    dismissed = await db.ha_followups.count_documents({
        "clinic_id": user["clinic_id"], "status": "dismissed",
    })

    # Consumable repeat loyalty — % of patients with >= 2 deliveries tracked.
    repeat_rows = []
    async for row in db.ha_subscriptions.aggregate([
        {"$match": {"clinic_id": user["clinic_id"], "last_delivered_at": {"$ne": None}}},
        {"$group": {"_id": "$patient_id", "deliveries": {"$sum": 1}}},
        {"$match": {"deliveries": {"$gte": 2}}},
        {"$count": "n"},
    ]):
        repeat_rows.append(row["n"])
    loyal_patients = repeat_rows[0] if repeat_rows else 0

    active_subs = await db.ha_subscriptions.count_documents({
        "clinic_id": user["clinic_id"], "status": "active",
    })

    # Upgrade pipeline
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=3 * 365)).isoformat()
    upgrade_size = await db.ha_sales.count_documents({
        "clinic_id": user["clinic_id"],
        "status": {"$in": ["paid", "invoiced"]},
        "created_at": {"$lt": cutoff_iso},
    })

    return {
        "missed_followups": missed,
        "dismissed_followups": dismissed,
        "dismissed_pct": round(100 * dismissed / max(dismissed_pct_denom, 1), 1),
        "active_subscriptions": active_subs,
        "loyal_repeat_patients": loyal_patients,
        "upgrade_pipeline_size": upgrade_size,
    }
