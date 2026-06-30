"""Referral Corner — owner-grade revenue + payout dashboard.

A focused, owner-and-delegate UI that tells the clinic exactly which
referring doctors are sending business and how much the practice owes
them in commission for the chosen window.

Endpoints:
  GET    /api/referrals/access                — caller's effective access
  GET    /api/referrals/dashboard             — per-doctor revenue + payout
  PATCH  /api/referrals/doctors/{id}/cut-config  — set % / ₹ cut config
  GET    /api/referrals/payout-report.csv     — owner-side CSV export

Revenue rules (locked by product call, 2026-06-30):
  • DIAGNOSTICS revenue per doctor = sum of invoice-line totals for
    paid invoices where the patient was referred by that doctor AND the
    line's `product_type` is NOT "Hearing Aid".
  • HA SALES revenue per doctor = sum of invoice-line totals for paid
    invoices where the patient was referred by that doctor AND the line's
    `product_type == "Hearing Aid"`. We additionally require the
    underlying HA sale (when linked) to be in a `delivered`/`paid` state
    — trials, returned, and cancelled deals are excluded.
  • Payout per category = either `value%` of category revenue
    (mode='percent') or `value × patient_count` (mode='flat'). Defaults
    to 0 when no mode is configured.

Access control:
  • Always allowed: super_admin, clinic_owner.
  • Optional grant: any user with `can_access_referrals = True`. Owners
    flip this via the staff settings page.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db


router = APIRouter(prefix="/api/referrals")


# ───────────────────────────────────────────────────────────────────────
# Access dependency
# ───────────────────────────────────────────────────────────────────────
async def _require_referral_access(user=Depends(get_current_user)):
    role = user.get("role")
    if role in ("super_admin", "clinic_owner"):
        return user
    if user.get("can_access_referrals"):
        return user
    raise HTTPException(
        status_code=403,
        detail="Referral Corner access is owner-only by default. "
               "Ask the clinic owner to enable it for your account in Settings → Staff.",
    )


def _is_owner(user) -> bool:
    return user.get("role") in ("super_admin", "clinic_owner")


# ───────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────
def _parse_window(start: Optional[str], end: Optional[str]) -> tuple[datetime, datetime]:
    """Default = month-to-date in IST. Clamps end to "now" to prevent
    accidental future-dated queries from returning zero rows silently."""
    now = datetime.now(timezone.utc)
    if not end:
        end_dt = now
    else:
        end_dt = datetime.fromisoformat(end).replace(tzinfo=timezone.utc)
        if end_dt > now:
            end_dt = now
    if not start:
        # Default: first day of the current calendar month, UTC
        start_dt = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    else:
        start_dt = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
    if start_dt > end_dt:
        raise HTTPException(status_code=400, detail="start must be <= end")
    return start_dt, end_dt


def _compute_payout(revenue: float, patient_count: int,
                     mode: Optional[str], value: float) -> float:
    """Translate a configured cut into rupees owed.

    Two modes:
      • percent → `value%` of `revenue` (e.g. 10% of ₹50 000 = ₹5 000)
      • flat    → `value × patient_count` (e.g. ₹500 per referred patient)
    """
    if not mode or not value:
        return 0.0
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    if mode == "percent":
        return round(revenue * v / 100.0, 2)
    if mode == "flat":
        return round(v * max(0, int(patient_count)), 2)
    return 0.0


async def _dashboard_rows(db, clinic_id: str, start_dt: datetime, end_dt: datetime):
    """Build the per-doctor revenue rollup. Pure function over Mongo —
    no auth concerns here; the caller has already gated access."""
    start_iso = start_dt.isoformat()
    end_iso = end_dt.isoformat()

    # 1. Pull all referring doctors for this clinic. We seed the rollup
    #    with a row for every doctor (even those with zero referrals in
    #    the window) so the owner sees the complete pad while configuring
    #    cuts. The empty-revenue rows are sorted to the bottom in the API.
    doctors: dict[str, dict] = {}
    async for d in db.referring_doctors.find(
        {"clinic_id": clinic_id},
        {"_id": 0},
    ):
        doctors[d["doctor_id"]] = {
            "doctor_id": d["doctor_id"],
            "name": d.get("name") or d["doctor_id"],
            "specialty": d.get("specialty"),
            "clinic": d.get("clinic"),
            "phone": d.get("phone"),
            "diag_cut_mode": d.get("diag_cut_mode"),
            "diag_cut_value": float(d.get("diag_cut_value") or 0.0),
            "ha_cut_mode": d.get("ha_cut_mode"),
            "ha_cut_value": float(d.get("ha_cut_value") or 0.0),
            "patient_count": 0,
            "patient_ids": set(),
            "diagnostics_revenue": 0.0,
            "ha_sales_revenue": 0.0,
        }

    # 2. Find every patient in the clinic that points to one of these
    #    doctors. We use referring_doctor_id (the canonical FK) — the
    #    free-text `referring_physician` field is ignored on purpose
    #    because it can't be reliably matched to a doctor record.
    patient_to_doctor: dict[str, str] = {}
    async for p in db.patients.find(
        {"clinic_id": clinic_id, "referring_doctor_id": {"$in": list(doctors.keys()) or [None]}},
        {"_id": 0, "patient_id": 1, "referring_doctor_id": 1},
    ):
        did = p.get("referring_doctor_id")
        pid = p.get("patient_id")
        if did and pid and did in doctors:
            patient_to_doctor[pid] = did

    if not patient_to_doctor:
        return list(doctors.values())

    # 3. Pull PAID invoices in window for those patients. Split each
    #    invoice's revenue by line `product_type` so a single mixed
    #    invoice (PTA + HA fitting) correctly contributes to both totals.
    async for inv in db.invoices.find(
        {
            "clinic_id": clinic_id,
            "patient_id": {"$in": list(patient_to_doctor.keys())},
            "status": "paid",
            "invoice_date": {"$gte": start_iso, "$lte": end_iso},
        },
        {"_id": 0, "patient_id": 1, "lines": 1, "ticket_no": 1, "session_id": 1, "grand_total": 1},
    ):
        did = patient_to_doctor.get(inv.get("patient_id"))
        if not did or did not in doctors:
            continue

        diag_rev = 0.0
        ha_rev = 0.0
        for ln in (inv.get("lines") or []):
            if not isinstance(ln, dict):
                continue
            amt = float(ln.get("line_total") or 0.0)
            if ln.get("product_type") == "Hearing Aid":
                ha_rev += amt
            else:
                diag_rev += amt

        # Edge case: invoice has no line breakdown (very old or imported
        # data) — fall back to grand_total and bucket by parent linkage.
        if not (diag_rev or ha_rev):
            gt = float(inv.get("grand_total") or 0.0)
            if inv.get("ticket_no"):       # HA service ticket → HA
                ha_rev += gt
            else:
                diag_rev += gt

        doctors[did]["diagnostics_revenue"] += diag_rev
        doctors[did]["ha_sales_revenue"] += ha_rev
        doctors[did]["patient_ids"].add(inv.get("patient_id"))

    # 4. Tighten HA revenue against the linked HA-sale lifecycle. The user's
    #    rule: only "delivered AND paid" sales count. Trials/returns/
    #    cancelled deals are excluded. We look up linked sales via the
    #    patient_id (best-available join), exclude any sale not in the
    #    allowed set, and *subtract* that sale's invoice contribution.
    #    NOTE: this is a tightening, not a re-source — the invoice's `paid`
    #    status remains the primary truth.
    ha_sale_blacklist_patients: set[str] = set()
    async for sale in db.ha_sales.find(
        {
            "clinic_id": clinic_id,
            "patient_id": {"$in": list(patient_to_doctor.keys())},
            "status": {"$in": ["trial", "cancelled", "returned"]},
        },
        {"_id": 0, "patient_id": 1, "status": 1},
    ):
        # Conservative: if ANY linked sale is not closed, we treat this
        # patient's HA revenue as "not yet earned" for the doctor's payout.
        # The owner can override by re-mapping the invoice if needed.
        ha_sale_blacklist_patients.add(sale["patient_id"])

    # Re-walk the rollup: if a doctor has HA revenue contributed by a
    # blacklisted patient, drop that contribution back out. This is rare
    # in practice (most paid invoices are for closed deals) but matters
    # for clinics that bill at trial start.
    if ha_sale_blacklist_patients:
        async for inv in db.invoices.find(
            {
                "clinic_id": clinic_id,
                "patient_id": {"$in": list(ha_sale_blacklist_patients)},
                "status": "paid",
                "invoice_date": {"$gte": start_iso, "$lte": end_iso},
            },
            {"_id": 0, "patient_id": 1, "lines": 1},
        ):
            did = patient_to_doctor.get(inv.get("patient_id"))
            if not did or did not in doctors:
                continue
            for ln in (inv.get("lines") or []):
                if isinstance(ln, dict) and ln.get("product_type") == "Hearing Aid":
                    doctors[did]["ha_sales_revenue"] = max(
                        0.0,
                        doctors[did]["ha_sales_revenue"] - float(ln.get("line_total") or 0.0),
                    )

    # 5. Finalise: patient counts + payout computation.
    rows = []
    for d in doctors.values():
        d["patient_count"] = len(d.pop("patient_ids", set()))
        d["diagnostics_payout"] = _compute_payout(
            d["diagnostics_revenue"], d["patient_count"],
            d["diag_cut_mode"], d["diag_cut_value"],
        )
        d["ha_payout"] = _compute_payout(
            d["ha_sales_revenue"], d["patient_count"],
            d["ha_cut_mode"], d["ha_cut_value"],
        )
        d["total_payout"] = round(d["diagnostics_payout"] + d["ha_payout"], 2)
        d["diagnostics_revenue"] = round(d["diagnostics_revenue"], 2)
        d["ha_sales_revenue"] = round(d["ha_sales_revenue"], 2)
        d["total_revenue"] = round(d["diagnostics_revenue"] + d["ha_sales_revenue"], 2)
        rows.append(d)

    # Sort: doctors with revenue first (desc), then alphabetical for the rest.
    rows.sort(key=lambda r: (-(r["total_revenue"]), r["name"].lower()))
    return rows


# ───────────────────────────────────────────────────────────────────────
# Endpoints
# ───────────────────────────────────────────────────────────────────────
@router.get("/access")
async def my_access(user=Depends(get_current_user)):
    """The frontend nav uses this to show / hide the menu item."""
    return {
        "has_access": _is_owner(user) or bool(user.get("can_access_referrals")),
        "role": user.get("role"),
        "is_owner": _is_owner(user),
    }


@router.get("/dashboard")
async def referral_dashboard(
    start: Optional[str] = Query(None, description="ISO date YYYY-MM-DD inclusive"),
    end: Optional[str] = Query(None, description="ISO date YYYY-MM-DD inclusive"),
    user=Depends(_require_referral_access),
    db=Depends(get_db),
):
    start_dt, end_dt = _parse_window(start, end)
    rows = await _dashboard_rows(db, user["clinic_id"], start_dt, end_dt)
    totals = {
        "patient_count": sum(r["patient_count"] for r in rows),
        "diagnostics_revenue": round(sum(r["diagnostics_revenue"] for r in rows), 2),
        "ha_sales_revenue": round(sum(r["ha_sales_revenue"] for r in rows), 2),
        "diagnostics_payout": round(sum(r["diagnostics_payout"] for r in rows), 2),
        "ha_payout": round(sum(r["ha_payout"] for r in rows), 2),
        "total_payout": round(sum(r["total_payout"] for r in rows), 2),
    }
    return {
        "window": {
            "start": start_dt.date().isoformat(),
            "end": end_dt.date().isoformat(),
        },
        "totals": totals,
        "rows": rows,
        "configured_by_owner_only": True,
    }


class CutConfigPayload(BaseModel):
    """Set BOTH diagnostics and HA payouts for a single doctor in one call.
    Setting `mode=None` for either category effectively disables payouts
    for that revenue stream."""
    diag_cut_mode: Optional[str] = Field(None, pattern="^(percent|flat)$")
    diag_cut_value: float = 0.0
    ha_cut_mode: Optional[str] = Field(None, pattern="^(percent|flat)$")
    ha_cut_value: float = 0.0


@router.patch("/doctors/{doctor_id}/cut-config")
async def set_cut_config(
    doctor_id: str,
    payload: CutConfigPayload,
    user=Depends(_require_referral_access),
    db=Depends(get_db),
):
    """Owner-only edit. Delegated staff get a 403 here so they can VIEW
    the dashboard but not change payout terms (those affect cheque-sized
    money and stay with the owner)."""
    if not _is_owner(user):
        raise HTTPException(
            status_code=403,
            detail="Only the clinic owner can change referral payouts.",
        )

    # Negative payouts make no sense and would create awkward "you owe
    # the clinic" rows. Clamp at 0.
    diag_v = max(0.0, float(payload.diag_cut_value or 0.0))
    ha_v = max(0.0, float(payload.ha_cut_value or 0.0))

    # When mode='percent' we additionally cap value at 100. Past 100% the
    # clinic is literally paying the doctor more than it earned, which is
    # almost always a typo.
    if payload.diag_cut_mode == "percent" and diag_v > 100:
        raise HTTPException(status_code=400, detail="Diagnostics percentage cannot exceed 100%")
    if payload.ha_cut_mode == "percent" and ha_v > 100:
        raise HTTPException(status_code=400, detail="HA-sales percentage cannot exceed 100%")

    res = await db.referring_doctors.update_one(
        {"doctor_id": doctor_id, "clinic_id": user["clinic_id"]},
        {"$set": {
            "diag_cut_mode": payload.diag_cut_mode,
            "diag_cut_value": diag_v,
            "ha_cut_mode": payload.ha_cut_mode,
            "ha_cut_value": ha_v,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Referring doctor not found")
    return {"ok": True, "doctor_id": doctor_id}


@router.get("/payout-report.csv")
async def payout_report_csv(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    report_type: str = Query("both", pattern="^(diagnostics|ha|both)$",
                              description="Which stream to include in the report"),
    user=Depends(_require_referral_access),
    db=Depends(get_db),
):
    """End-of-month-style payout CSV. The 3 report types map to three
    accounting workflows:
      • `diagnostics` — one cheque per doctor for diagnostic referrals
      • `ha`          — one cheque per doctor for HA-sale referrals
      • `both`        — consolidated single-row-per-doctor summary
    """
    start_dt, end_dt = _parse_window(start, end)
    rows = await _dashboard_rows(db, user["clinic_id"], start_dt, end_dt)
    # Drop zero-payout rows from the CSV — they're noise on the print-out.
    if report_type == "diagnostics":
        rows = [r for r in rows if r["diagnostics_payout"] > 0]
    elif report_type == "ha":
        rows = [r for r in rows if r["ha_payout"] > 0]
    else:
        rows = [r for r in rows if r["total_payout"] > 0]

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        f"AUDINEXA — Referral Payout Report ({report_type.upper()})",
        f"Window: {start_dt.date().isoformat()} → {end_dt.date().isoformat()}",
    ])
    w.writerow([])

    if report_type == "diagnostics":
        w.writerow(["Doctor", "Specialty", "Referred Patients",
                    "Diagnostics Revenue (₹)", "Cut Mode", "Cut Value",
                    "Diagnostics Payout (₹)"])
        for r in rows:
            w.writerow([r["name"], r.get("specialty") or "",
                        r["patient_count"], r["diagnostics_revenue"],
                        r.get("diag_cut_mode") or "—", r.get("diag_cut_value") or 0,
                        r["diagnostics_payout"]])
    elif report_type == "ha":
        w.writerow(["Doctor", "Specialty", "Referred Patients",
                    "HA Sales Revenue (₹)", "Cut Mode", "Cut Value",
                    "HA Payout (₹)"])
        for r in rows:
            w.writerow([r["name"], r.get("specialty") or "",
                        r["patient_count"], r["ha_sales_revenue"],
                        r.get("ha_cut_mode") or "—", r.get("ha_cut_value") or 0,
                        r["ha_payout"]])
    else:
        w.writerow(["Doctor", "Specialty", "Referred Patients",
                    "Diagnostics Revenue (₹)", "Diagnostics Payout (₹)",
                    "HA Sales Revenue (₹)", "HA Payout (₹)", "Total Payout (₹)"])
        for r in rows:
            w.writerow([r["name"], r.get("specialty") or "",
                        r["patient_count"], r["diagnostics_revenue"],
                        r["diagnostics_payout"], r["ha_sales_revenue"],
                        r["ha_payout"], r["total_payout"]])

    buf.seek(0)
    filename = f"audinexa_referral_payout_{report_type}_{start_dt.date()}_{end_dt.date()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
