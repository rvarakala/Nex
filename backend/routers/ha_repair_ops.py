"""AUDINEXA repair-specific analytics + Job Card PDF + WhatsApp link builder.

Phase 12.C deliverables:
  * GET  /api/ha/repair/analytics         — TAT, repeat-failure ranking, in-repair count
  * GET  /api/ha/service-tickets/{no}/job-card.pdf — printable intake card
  * GET  /api/ha/service-tickets/{no}/whatsapp?status=
        — returns a ready-to-click wa.me deep-link + rendered message
"""
from __future__ import annotations

import io
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from auth import get_current_user, require_roles, CLINIC_WIDE_ROLES
from database import get_db
from utils.service_job_states import normalise_status, TERMINAL_STATES
from utils.audinexa_templates import render_template, build_whatsapp_url
from utils.tiers import require_tier


router = APIRouter(prefix="/api/ha")

ANALYTICS_ROLES = ("super_admin", "clinic_owner", "accounts", "audiologist", "front_desk")


def _scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


# ==================== REPAIR ANALYTICS ====================

IN_REPAIR_STATUSES = {
    "RECEIVED", "INSPECTED", "AWAITING_DISPATCH", "DISPATCHED", "IN_TRANSIT",
    "DELIVERED_TO_COMPANY", "ESTIMATE_PENDING", "CLIENT_APPROVED",
    "REPAIR_IN_PROGRESS", "RETURN_SHIPPED", "READY_FOR_PICKUP",
    # Legacy mappings
    "open", "in_progress", "resolved",
}


@router.get("/repair/analytics",
            dependencies=[Depends(require_tier("repair", "analytics"))])
async def repair_analytics(
    days: int = Query(90, ge=7, le=365),
    user=Depends(require_roles(*ANALYTICS_ROLES)),
    db=Depends(get_db),
):
    base = _scope(user)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # ---- in-repair count (live) ----
    in_repair = await db.service_tickets.count_documents({
        **base, "status": {"$in": list(IN_REPAIR_STATUSES)},
    })

    # ---- courier in transit (live) ----
    couriers_in_transit = await db.ha_courier_shipments.count_documents({
        **base, "status": {"$in": ["BOOKED", "PICKED_UP", "IN_TRANSIT", "EXCEPTION"]},
    })

    # ---- awaiting customer approval (live) ----
    awaiting_approval = await db.ha_customer_approvals.count_documents({
        "clinic_id": user["clinic_id"], "decision": "PENDING",
    })

    # ---- closed in window + TAT ----
    closed_q = {**base, "status": {"$in": ["CLOSED", "closed"]},
                "closed_at": {"$gte": cutoff}}
    closed_rows = await db.service_tickets.find(
        closed_q, {"_id": 0, "created_at": 1, "closed_at": 1, "kind": 1,
                   "warranty_covered": 1, "cost_to_patient": 1},
    ).to_list(1000)
    tat_days = []
    paid_total = 0.0
    warranty_count = 0
    for c in closed_rows:
        try:
            a = c["created_at"]
            b = c.get("closed_at") or a
            if isinstance(a, str):
                a = datetime.fromisoformat(a.replace("Z", "+00:00"))
            if isinstance(b, str):
                b = datetime.fromisoformat(b.replace("Z", "+00:00"))
            if a.tzinfo is None: a = a.replace(tzinfo=timezone.utc)
            if b.tzinfo is None: b = b.replace(tzinfo=timezone.utc)
            tat_days.append(max((b - a).days, 0))
        except Exception:
            pass
        paid_total += float(c.get("cost_to_patient") or 0)
        if c.get("warranty_covered"):
            warranty_count += 1
    avg_tat = round(sum(tat_days) / len(tat_days), 1) if tat_days else None

    # ---- repeat-failure ranking (same patient + same serial, ≥2 tickets) ----
    repeat_pipeline = [
        {"$match": {**base, "serial_id": {"$ne": None}}},
        {"$group": {
            "_id": {"patient_id": "$patient_id", "serial_id": "$serial_id"},
            "count": {"$sum": 1},
            "patient_name": {"$first": "$patient_name"},
            "serial_no": {"$first": "$serial_no"},
            "last_at": {"$max": "$created_at"},
        }},
        {"$match": {"count": {"$gte": 2}}},
        {"$sort": {"count": -1, "last_at": -1}},
        {"$limit": 20},
    ]
    repeats = []
    async for r in db.service_tickets.aggregate(repeat_pipeline):
        repeats.append({
            "patient_id": r["_id"]["patient_id"],
            "patient_name": r.get("patient_name"),
            "serial_id": r["_id"]["serial_id"],
            "serial_no": r.get("serial_no"),
            "ticket_count": r["count"],
            "last_at": r["last_at"].isoformat() if hasattr(r.get("last_at"), "isoformat") else r.get("last_at"),
        })

    # ---- brand breakdown ----
    brand_pipeline = [
        {"$match": closed_q},
        {"$lookup": {"from": "serial_items", "localField": "serial_id",
                     "foreignField": "serial_id", "as": "si"}},
        {"$unwind": {"path": "$si", "preserveNullAndEmptyArrays": True}},
        {"$lookup": {"from": "ha_products", "localField": "si.product_id",
                     "foreignField": "product_id", "as": "p"}},
        {"$unwind": {"path": "$p", "preserveNullAndEmptyArrays": True}},
        {"$group": {"_id": {"$ifNull": ["$p.brand", "Unknown"]}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]
    by_brand = []
    async for r in db.service_tickets.aggregate(brand_pipeline):
        by_brand.append({"brand": r["_id"], "count": r["n"]})

    return {
        "window_days": days,
        "live": {
            "in_repair": in_repair,
            "couriers_in_transit": couriers_in_transit,
            "awaiting_approval": awaiting_approval,
        },
        "closed": {
            "count": len(closed_rows),
            "avg_tat_days": avg_tat,
            "paid_revenue": round(paid_total, 2),
            "warranty_tickets": warranty_count,
            "warranty_pct": round(100 * warranty_count / max(len(closed_rows), 1), 1),
        },
        "repeat_failures": repeats,
        "by_brand": by_brand,
    }


# ==================== JOB CARD PDF ====================

@router.get("/service-tickets/{ticket_no}/job-card.pdf",
            dependencies=[Depends(require_tier("repair"))])
async def job_card_pdf(
    ticket_no: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    t = await db.service_tickets.find_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Service ticket not found")

    clinic = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0},
    ) or {}
    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": t["patient_id"]},
        {"_id": 0, "mrd": 1, "mobile": 1, "name": 1},
    ) or {}

    # ----- Build PDF -----
    from reportlab.lib.pagesizes import A5
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A5,
                             leftMargin=10*mm, rightMargin=10*mm,
                             topMargin=10*mm, bottomMargin=10*mm,
                             title=f"Job Card {ticket_no}")
    styles = getSampleStyleSheet()
    story = []

    # Header
    h_table = Table([[
        Paragraph(f"<b>{clinic.get('name', 'ACS Audiology Clinic')}</b><br/>"
                  f"<font size=8>{clinic.get('city', '')} · "
                  f"{clinic.get('phone', '')}</font>", styles["Normal"]),
        Paragraph(f"<para align='right'><b>JOB CARD</b><br/>"
                  f"<font size=9>{ticket_no}</font><br/>"
                  f"<font size=7 color='#64748b'>"
                  f"{datetime.now().strftime('%d %b %Y, %H:%M')}</font></para>",
                  styles["Normal"]),
    ]], colWidths=[80*mm, 55*mm])
    h_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(h_table)
    story.append(Spacer(1, 5*mm))

    # Patient + Device box
    pd_rows = [
        ["Patient", patient.get("name") or t.get("patient_name") or "—"],
        ["MRD / Mobile", f"{patient.get('mrd') or '—'} · {patient.get('mobile') or t.get('patient_mobile') or '—'}"],
        ["Device", f"{t.get('serial_no') or '—'}"],
        ["Complaint type", t.get("kind", "repair").replace("_", " ").title()],
        ["Status", normalise_status(t.get("status", "RECEIVED"))],
        ["Warranty", "Yes · covered" if t.get("warranty_covered") else "Out of warranty / paid"],
    ]
    pd = Table(pd_rows, colWidths=[35*mm, 100*mm])
    pd.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#475569")),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(pd)
    story.append(Spacer(1, 4*mm))

    # Complaint description
    story.append(Paragraph("<b>Complaint Description</b>", styles["Normal"]))
    story.append(Paragraph(
        t.get("complaint") or "—",
        styles["Normal"],
    ))
    story.append(Spacer(1, 4*mm))

    if t.get("diagnosis"):
        story.append(Paragraph("<b>Diagnosis / Notes</b>", styles["Normal"]))
        story.append(Paragraph(t["diagnosis"], styles["Normal"]))
        story.append(Spacer(1, 4*mm))

    # Accessories checklist
    story.append(Paragraph("<b>Accessories Received at Intake</b>", styles["Normal"]))
    acc = Table([
        ["☐ Battery", "☐ Charger", "☐ Dome / tip", "☐ Receiver"],
        ["☐ Case / pouch", "☐ Cleaning tool", "☐ Wax filter", "☐ Mould"],
    ], colWidths=[34*mm, 34*mm, 34*mm, 34*mm])
    acc.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(acc)
    story.append(Spacer(1, 6*mm))

    # Sign area
    sign = Table([
        [Paragraph("<font size=8 color='#64748b'>Front Desk / Audiologist</font><br/><br/>_________________",
                   styles["Normal"]),
         Paragraph("<font size=8 color='#64748b'>Patient / Attendant Signature</font><br/><br/>_________________",
                   styles["Normal"])],
    ], colWidths=[65*mm, 65*mm])
    story.append(sign)
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        "<font size=7 color='#64748b'>Track your repair anytime at "
        f"<b>{clinic.get('name', 'the clinic')}</b> · "
        "by sharing this Job Card number with our front desk.</font>",
        styles["Normal"],
    ))

    doc.build(story)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="job-card-{ticket_no}.pdf"',
        },
    )


# ==================== WHATSAPP LINK BUILDER ====================

@router.get("/service-tickets/{ticket_no}/whatsapp",
            dependencies=[Depends(require_tier("repair"))])
async def whatsapp_deeplink(
    ticket_no: str,
    status: Optional[str] = Query(None, description="Force a specific status template; default = current"),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    t = await db.service_tickets.find_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Service ticket not found")

    cur = normalise_status(t.get("status") or "RECEIVED")
    target = status or cur
    clinic = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0, "name": 1},
    ) or {}

    # Pull latest estimate + outbound shipment for rich context
    est = await db.ha_service_estimates.find_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"_id": 0}, sort=[("created_at", -1)],
    ) or {}
    ship = await db.ha_courier_shipments.find_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"_id": 0}, sort=[("created_at", -1)],
    ) or {}

    ctx = {
        "patient_name": t.get("patient_name") or "there",
        "ticket_no": ticket_no,
        "clinic_name": clinic.get("name") or "AUDINEXA",
        "awb_number": ship.get("awb_number") or "—",
        "courier_partner": ship.get("courier_partner") or "courier",
        "eta_date": ship.get("eta_date") or "soon",
        "amount": f"{est.get('amount', 0):,.0f}",
        "warranty_line": "under warranty — no charge" if est.get("warranty_covered") else "payable",
        "eta_days": est.get("eta_days") or "—",
    }
    message = render_template(target, ctx)
    if not message:
        return {"ok": True, "message": None, "url": None,
                "note": f"No notification template for status {target}"}
    url = build_whatsapp_url(t.get("patient_mobile"), message)
    return {"ok": True, "status": target, "message": message, "url": url,
            "is_terminal": cur in TERMINAL_STATES}
