"""Clinical & Referral Analytics — Phase 13.B.

Two dashboards, PREMIUM-gated:

  UC-A01  Diagnosis analytics  GET /api/analytics/diagnosis
      — distribution of hearing-loss severity, ear-side, age buckets,
        gender; monthly trend of new diagnoses.

  UC-A02  Referral source attribution  GET /api/analytics/referrals
      — patient-count + revenue by referral_source + referring_doctor_id;
        conversion funnel (patient → billed-invoice) per source.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from auth import require_roles, get_current_user
from database import get_db
from utils.tiers import require_tier


router = APIRouter(
    prefix="/api/analytics",
    dependencies=[Depends(require_tier("analytics"))],
)

READ_ROLES = ("clinic_owner", "super_admin", "accounts", "audiologist")


# ------------ helpers ------------

def _age_bucket(age: Optional[int]) -> str:
    if age is None:
        return "Unknown"
    try:
        a = int(age)
    except (TypeError, ValueError):
        return "Unknown"
    if a < 5:   return "0-4 (Infant)"
    if a < 13:  return "5-12 (Child)"
    if a < 19:  return "13-18 (Teen)"
    if a < 35:  return "19-34 (Young)"
    if a < 55:  return "35-54 (Adult)"
    if a < 70:  return "55-69 (Senior)"
    return "70+ (Geriatric)"


def _classify_degree(pta: Optional[float]) -> str:
    """WHO-style HL classification based on PTA (dB HL)."""
    if pta is None:
        return "Unknown"
    try:
        v = float(pta)
    except (TypeError, ValueError):
        return "Unknown"
    if v < 26:  return "Normal"
    if v < 41:  return "Mild"
    if v < 56:  return "Moderate"
    if v < 71:  return "Moderately-Severe"
    if v < 91:  return "Severe"
    return "Profound"


# ==================== UC-A01 DIAGNOSIS ANALYTICS ====================

@router.get("/diagnosis")
async def diagnosis_analytics(
    days: int = 180,
    user=Depends(require_roles(*READ_ROLES)),
    db=Depends(get_db),
):
    """Frequency & cohort breakdowns of the *worst-ear* PTA across all
    test_sessions in the window.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(days, 7))).isoformat()

    degrees: dict[str, int] = {}
    by_side: dict[str, int] = {}
    total_sessions = 0
    worst_right: list[float] = []
    worst_left: list[float] = []

    # Index each patient's most-recent dx only (avoid double-counting repeat tests)
    seen_patients: set[str] = set()

    # Aggregate: take most recent session per patient in window
    pipeline = [
        {"$match": {
            "clinic_id": user["clinic_id"],
            "test_date": {"$gte": cutoff},
        }},
        {"$sort": {"test_date": -1}},
        {"$group": {
            "_id": "$patient_id",
            "session": {"$first": "$$ROOT"},
        }},
    ]
    diagnosed_patient_ids: list[str] = []
    async for row in db.test_sessions.aggregate(pipeline):
        s = row.get("session") or {}
        pid = s.get("patient_id")
        if not pid or pid in seen_patients:
            continue
        seen_patients.add(pid)
        diagnosed_patient_ids.append(pid)
        total_sessions += 1

        # Pull PTA values from stored session (shape varies; tolerate absence)
        pta_r = s.get("right_ear_pta") or (s.get("pure_tone") or {}).get("right_pta")
        pta_l = s.get("left_ear_pta") or (s.get("pure_tone") or {}).get("left_pta")
        try:
            if pta_r is not None: worst_right.append(float(pta_r))
        except (TypeError, ValueError):
            pass
        try:
            if pta_l is not None: worst_left.append(float(pta_l))
        except (TypeError, ValueError):
            pass

        # Worst-ear degree (max PTA)
        candidates = [v for v in (pta_r, pta_l) if v is not None]
        try:
            worst = max(float(v) for v in candidates) if candidates else None
        except (TypeError, ValueError):
            worst = None
        deg = _classify_degree(worst)
        degrees[deg] = degrees.get(deg, 0) + 1

        # Affected side
        if pta_r is not None and pta_l is not None:
            side = "Bilateral"
        elif pta_r is not None:
            side = "Right"
        elif pta_l is not None:
            side = "Left"
        else:
            side = "Unknown"
        by_side[side] = by_side.get(side, 0) + 1

    # Age + gender distributions by diagnosis (requires patient lookup)
    age_dist: dict[str, int] = {}
    gender_dist: dict[str, int] = {}
    if diagnosed_patient_ids:
        async for p in db.patients.find(
            {"patient_id": {"$in": diagnosed_patient_ids}, "clinic_id": user["clinic_id"]},
            {"_id": 0, "age": 1, "gender": 1},
        ):
            ab = _age_bucket(p.get("age"))
            age_dist[ab] = age_dist.get(ab, 0) + 1
            g = p.get("gender") or "Unknown"
            gender_dist[g] = gender_dist.get(g, 0) + 1

    # Monthly trend of new diagnoses
    monthly = []
    async for row in db.test_sessions.aggregate([
        {"$match": {"clinic_id": user["clinic_id"], "test_date": {"$gte": cutoff}}},
        {"$project": {
            "patient_id": 1,
            "ts": {"$dateFromString": {"dateString": "$test_date", "onError": None}},
        }},
        {"$match": {"ts": {"$ne": None}}},
        {"$project": {
            "patient_id": 1,
            "bucket": {"$dateToString": {"date": "$ts", "format": "%Y-%m", "timezone": "Asia/Kolkata"}},
        }},
        {"$group": {
            "_id": "$bucket",
            "sessions": {"$sum": 1},
            "unique_patients": {"$addToSet": "$patient_id"},
        }},
        {"$project": {
            "month": "$_id", "_id": 0,
            "sessions": 1,
            "patients": {"$size": "$unique_patients"},
        }},
        {"$sort": {"month": 1}},
    ]):
        monthly.append(row)

    def _avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    return {
        "window_days": days,
        "unique_diagnosed_patients": len(seen_patients),
        "degrees": [{"label": k, "count": v} for k, v in sorted(degrees.items(), key=lambda kv: -kv[1])],
        "by_side": [{"label": k, "count": v} for k, v in by_side.items()],
        "age_distribution": [{"bucket": k, "count": v} for k, v in sorted(age_dist.items())],
        "gender_distribution": [{"label": k, "count": v} for k, v in gender_dist.items()],
        "avg_pta_right": _avg(worst_right),
        "avg_pta_left": _avg(worst_left),
        "monthly_trend": monthly,
    }


# ==================== UC-A02 REFERRAL SOURCE ATTRIBUTION ====================

@router.get("/referrals")
async def referral_attribution(
    days: int = 180,
    user=Depends(require_roles(*READ_ROLES)),
    db=Depends(get_db),
):
    """Patient-count + revenue + conversion by referral_source & referring_doctor_id."""
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=max(days, 7))).isoformat()

    # --- Load all patients registered in window ---
    patients = await db.patients.find(
        {"clinic_id": user["clinic_id"], "created_at": {"$gte": cutoff_iso}},
        {"_id": 0, "patient_id": 1, "referral_source": 1, "referring_doctor_id": 1, "name": 1},
    ).to_list(20000)
    patient_ids = [p["patient_id"] for p in patients]
    src_of = {p["patient_id"]: (p.get("referral_source") or "Walk-in") for p in patients}
    doc_of = {p["patient_id"]: p.get("referring_doctor_id") for p in patients}

    # --- Aggregate paid invoice revenue per patient ---
    revenue_of: dict[str, float] = {}
    invoice_count: dict[str, int] = {}
    if patient_ids:
        async for row in db.invoices.aggregate([
            {"$match": {
                "clinic_id": user["clinic_id"],
                "patient_id": {"$in": patient_ids},
                "status": {"$in": ["paid", "partial", "issued"]},
            }},
            {"$group": {
                "_id": "$patient_id",
                "revenue": {"$sum": {"$ifNull": ["$grand_total", "$total"]}},
                "invoices": {"$sum": 1},
            }},
        ]):
            revenue_of[row["_id"]] = float(row.get("revenue") or 0)
            invoice_count[row["_id"]] = int(row.get("invoices") or 0)

    # --- HA sales revenue per patient ---
    ha_rev: dict[str, float] = {}
    if patient_ids:
        async for row in db.ha_sales.aggregate([
            {"$match": {
                "clinic_id": user["clinic_id"],
                "patient_id": {"$in": patient_ids},
                "status": {"$nin": ["cancelled", "draft"]},
            }},
            {"$group": {"_id": "$patient_id", "rev": {"$sum": "$total"}}},
        ]):
            ha_rev[row["_id"]] = float(row.get("rev") or 0)

    # --- Resolve doctor names in one call ---
    doctor_ids = list({v for v in doc_of.values() if v})
    doctor_names: dict[str, str] = {}
    if doctor_ids:
        async for d in db.referring_doctors.find(
            {"doctor_id": {"$in": doctor_ids}, "clinic_id": user["clinic_id"]},
            {"_id": 0, "doctor_id": 1, "name": 1, "specialization": 1, "hospital": 1},
        ):
            doctor_names[d["doctor_id"]] = d.get("name") or d["doctor_id"]

    # ---- Group by source ----
    by_source: dict[str, dict] = {}
    for pid in patient_ids:
        src = src_of.get(pid) or "Walk-in"
        slot = by_source.setdefault(src, {
            "source": src, "patients": 0,
            "patients_with_invoice": 0, "invoice_count": 0,
            "invoice_revenue": 0.0, "ha_sale_revenue": 0.0,
        })
        slot["patients"] += 1
        if pid in revenue_of:
            slot["patients_with_invoice"] += 1
            slot["invoice_count"] += invoice_count.get(pid, 0)
            slot["invoice_revenue"] += revenue_of[pid]
        slot["ha_sale_revenue"] += ha_rev.get(pid, 0.0)

    sources = []
    for s in by_source.values():
        s["total_revenue"] = round(s["invoice_revenue"] + s["ha_sale_revenue"], 2)
        s["invoice_revenue"] = round(s["invoice_revenue"], 2)
        s["ha_sale_revenue"] = round(s["ha_sale_revenue"], 2)
        s["conversion_pct"] = round(100 * s["patients_with_invoice"] / max(s["patients"], 1), 1)
        s["avg_revenue_per_patient"] = round(s["total_revenue"] / max(s["patients"], 1), 2)
        sources.append(s)
    sources.sort(key=lambda r: -r["total_revenue"])

    # ---- Group by referring doctor ----
    by_doctor: dict[str, dict] = {}
    for pid in patient_ids:
        did = doc_of.get(pid)
        if not did:
            continue
        slot = by_doctor.setdefault(did, {
            "doctor_id": did,
            "doctor_name": doctor_names.get(did, did),
            "patients": 0, "invoice_revenue": 0.0, "ha_sale_revenue": 0.0,
            "patients_with_invoice": 0,
        })
        slot["patients"] += 1
        if pid in revenue_of:
            slot["patients_with_invoice"] += 1
            slot["invoice_revenue"] += revenue_of[pid]
        slot["ha_sale_revenue"] += ha_rev.get(pid, 0.0)

    doctors = []
    for d in by_doctor.values():
        d["total_revenue"] = round(d["invoice_revenue"] + d["ha_sale_revenue"], 2)
        d["invoice_revenue"] = round(d["invoice_revenue"], 2)
        d["ha_sale_revenue"] = round(d["ha_sale_revenue"], 2)
        d["conversion_pct"] = round(100 * d["patients_with_invoice"] / max(d["patients"], 1), 1)
        doctors.append(d)
    doctors.sort(key=lambda r: -r["total_revenue"])

    total_patients = len(patients)
    total_rev = round(sum(s["total_revenue"] for s in sources), 2)

    return {
        "window_days": days,
        "total_patients": total_patients,
        "total_revenue_attributed": total_rev,
        "avg_revenue_per_patient": round(total_rev / max(total_patients, 1), 2),
        "by_source": sources,
        "by_referring_doctor": doctors[:25],
        "doctor_count": len(doctors),
    }
