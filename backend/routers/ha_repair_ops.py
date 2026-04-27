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

    # Pull related rows for full Service Report
    shipments = await db.ha_courier_shipments.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    estimates = await db.ha_service_estimates.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    approvals = await db.ha_customer_approvals.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)

    # ----- Build PDF -----
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    )

    cur_status = normalise_status(t.get("status", "RECEIVED"))
    is_terminal = cur_status in TERMINAL_STATES or cur_status in ("DELIVERED_TO_CLIENT", "CLOSED")
    doc_label = "SERVICE REPORT" if is_terminal else "JOB CARD"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                             leftMargin=12*mm, rightMargin=12*mm,
                             topMargin=12*mm, bottomMargin=12*mm,
                             title=f"{doc_label} {ticket_no}")
    styles = getSampleStyleSheet()
    story = []

    def fmt_dt(v):
        if not v:
            return "—"
        try:
            s = v if isinstance(v, str) else v.isoformat()
            return datetime.fromisoformat(s.replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M")
        except Exception:
            return str(v)[:16]

    # ----- HEADER -----
    h_table = Table([[
        Paragraph(f"<b>{clinic.get('name', 'AUDINEXA Clinic')}</b><br/>"
                  f"<font size=8 color='#64748b'>{clinic.get('city', '')} · "
                  f"{clinic.get('phone', '')}</font>", styles["Normal"]),
        Paragraph(f"<para align='right'><b><font size=11>{doc_label}</font></b><br/>"
                  f"<font size=10 color='#1e293b'>{ticket_no}</font><br/>"
                  f"<font size=7 color='#64748b'>"
                  f"Printed {datetime.now().strftime('%d %b %Y, %H:%M')}</font></para>",
                  styles["Normal"]),
    ]], colWidths=[110*mm, 76*mm])
    h_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(h_table)
    story.append(Spacer(1, 4*mm))

    # ----- PATIENT + DEVICE -----
    pd_rows = [
        ["Patient", patient.get("name") or t.get("patient_name") or "—"],
        ["MRD / Mobile", f"{patient.get('mrd') or '—'} · {patient.get('mobile') or t.get('patient_mobile') or '—'}"],
        ["Device", f"{t.get('serial_no') or '—'}"],
        ["Complaint type", t.get("kind", "repair").replace("_", " ").title()],
        ["Current status", cur_status.replace("_", " ").title()],
        ["Warranty", "Yes · covered" if t.get("warranty_covered") else "Out of warranty / paid"],
        ["Created at", fmt_dt(t.get("created_at"))],
    ]
    pd = Table(pd_rows, colWidths=[42*mm, 144*mm])
    pd.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#475569")),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(pd)
    story.append(Spacer(1, 4*mm))

    # ----- COMPLAINT -----
    story.append(Paragraph("<b>Complaint Description</b>", styles["Normal"]))
    story.append(Paragraph(t.get("complaint") or "—", styles["Normal"]))
    story.append(Spacer(1, 3*mm))

    # ----- INSPECTION NOTES -----
    if t.get("inspection_notes") or t.get("diagnosis"):
        story.append(Paragraph("<b>Inspection / Diagnosis</b>", styles["Normal"]))
        story.append(Paragraph(
            t.get("inspection_notes") or t.get("diagnosis") or "—",
            styles["Normal"],
        ))
        story.append(Spacer(1, 3*mm))

    # ----- PIPELINE TIMELINE -----
    timeline = [
        ("Received",             t.get("created_at")),
        ("Inspected",            None),
        ("Awaiting Dispatch",    None),
        ("Dispatched",           t.get("dispatched_at")),
        ("Delivered to Centre",  t.get("delivered_to_company_at")),
        ("Estimate Pending",     t.get("estimate_received_at")),
        ("Client Decided",       t.get("client_decided_at")),
        ("Return Shipped",       t.get("return_shipped_at")),
        ("Ready for Pickup",     t.get("ready_at")),
        ("Delivered to Client",  t.get("delivered_to_client_at")),
        ("Closed",               t.get("closed_at")),
    ]
    tl_rows = [["Stage", "Stamped at"]] + [
        [stage, fmt_dt(ts)] for stage, ts in timeline if ts
    ]
    if len(tl_rows) > 1:
        story.append(Paragraph("<b>Pipeline Timeline</b>", styles["Normal"]))
        tl = Table(tl_rows, colWidths=[60*mm, 126*mm])
        tl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(tl)
        story.append(Spacer(1, 3*mm))

    # ----- COURIER SHIPMENTS -----
    if shipments:
        story.append(Paragraph("<b>Courier Shipments</b>", styles["Normal"]))
        s_rows = [["ID", "Direction", "Partner", "AWB", "Dispatch", "Status"]]
        for s in shipments:
            s_rows.append([
                s.get("shipment_id", "—"),
                s.get("direction", "—"),
                s.get("courier_partner", "—"),
                s.get("awb_number") or "—",
                str(s.get("dispatch_date") or "—"),
                s.get("status", "—"),
            ])
        st = Table(s_rows, colWidths=[28*mm, 22*mm, 28*mm, 35*mm, 28*mm, 45*mm])
        st.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(st)
        story.append(Spacer(1, 3*mm))

    # ----- ESTIMATES + APPROVALS -----
    if estimates or approvals:
        story.append(Paragraph("<b>Vendor Estimates &amp; Customer Approval</b>", styles["Normal"]))
        e_rows = [["Estimate", "Vendor", "Vendor Est.", "Conveyed", "Discount", "Final"]]
        # Index approvals by estimate_id for join
        appr_by_est = {a.get("estimate_id"): a for a in approvals}
        for e in estimates:
            warranty = bool(e.get("warranty_covered"))
            conveyed = e.get("conveyed_amount")
            disc = e.get("discount") or 0
            if warranty:
                final_amt = "Warranty"
            elif conveyed is not None:
                final_amt = f"₹{int(max(0, float(conveyed) - float(disc))):,}"
            else:
                final_amt = f"₹{int(e.get('amount') or 0):,}"
            e_rows.append([
                e.get("estimate_id", "—"),
                (e.get("vendor_name") or "—")[:22],
                f"₹{int(e.get('amount') or 0):,}",
                "—" if conveyed is None else f"₹{int(conveyed):,}",
                f"₹{int(disc):,}" if disc else "—",
                final_amt,
            ])
        et = Table(e_rows, colWidths=[28*mm, 38*mm, 26*mm, 26*mm, 24*mm, 32*mm])
        et.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ]))
        story.append(et)

        # Conveyed-by + decision details
        for e in estimates:
            if e.get("conveyed_by_name") or e.get("conveyed_at"):
                conv_dt = e.get("conveyed_at", "")
                conv_str = ""
                if conv_dt:
                    try:
                        conv_str = " on " + datetime.fromisoformat(
                            conv_dt.replace("Z", "+00:00")
                        ).strftime("%d %b %Y, %H:%M")
                    except Exception:
                        pass
                story.append(Paragraph(
                    f"<font size=8 color='#475569'><b>{e.get('estimate_id')}</b> — "
                    f"price conveyed by <b>{e.get('conveyed_by_name', '—')}</b>{conv_str}</font>",
                    styles["Normal"],
                ))
            a = appr_by_est.get(e.get("estimate_id"), {})
            if a and a.get("decision") in ("APPROVED", "REJECTED"):
                dec_dt = a.get("decided_at", "")
                dec_str = ""
                if dec_dt:
                    try:
                        dec_str = " on " + datetime.fromisoformat(
                            dec_dt.replace("Z", "+00:00")
                        ).strftime("%d %b %Y, %H:%M")
                    except Exception:
                        pass
                contact_html = (f" · contact <b>{a.get('contact_number')}</b>"
                                if a.get("contact_number") else "")
                notes_html = (f"<br/><i>Notes:</i> {a.get('notes')}"
                              if a.get("notes") else "")
                story.append(Paragraph(
                    f"<font size=8 color='#475569'><b>{a.get('decision')}</b> by "
                    f"<b>{a.get('decided_by_name', '—')}</b>{dec_str}{contact_html}{notes_html}</font>",
                    styles["Normal"],
                ))
        story.append(Spacer(1, 3*mm))

    # ----- RESOLUTION & COST -----
    if t.get("resolution_notes") or t.get("cost_to_patient"):
        story.append(Paragraph("<b>Resolution &amp; Cost</b>", styles["Normal"]))
        if t.get("resolution_notes"):
            story.append(Paragraph(t["resolution_notes"], styles["Normal"]))
        if t.get("cost_to_patient"):
            story.append(Paragraph(
                f"<b>Cost to patient: ₹{int(t.get('cost_to_patient') or 0):,}</b>",
                styles["Normal"],
            ))
        story.append(Spacer(1, 3*mm))

    # ----- ACCESSORIES (only on intake / Job Card) -----
    if not is_terminal:
        story.append(Paragraph("<b>Accessories Received at Intake</b>", styles["Normal"]))
        acc = Table([
            ["☐ Battery", "☐ Charger", "☐ Dome / tip", "☐ Receiver"],
            ["☐ Case / pouch", "☐ Cleaning tool", "☐ Wax filter", "☐ Mould"],
        ], colWidths=[46*mm, 46*mm, 46*mm, 46*mm])
        acc.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(acc)
        story.append(Spacer(1, 5*mm))

    # ----- SIGNATURE -----
    sign = Table([
        [Paragraph("<font size=8 color='#64748b'>Audiologist / Front Desk</font><br/><br/>_____________________",
                   styles["Normal"]),
         Paragraph("<font size=8 color='#64748b'>Patient / Attendant Signature</font><br/><br/>_____________________",
                   styles["Normal"])],
    ], colWidths=[93*mm, 93*mm])
    story.append(Spacer(1, 6*mm))
    story.append(sign)
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph(
        "<font size=7 color='#64748b'>"
        f"Track this {doc_label.lower()} anytime at <b>{clinic.get('name', 'the clinic')}</b> "
        f"by quoting the job number above."
        "</font>",
        styles["Normal"],
    ))

    doc.build(story)
    buf.seek(0)
    fname = f"service-report-{ticket_no}.pdf" if is_terminal else f"job-card-{ticket_no}.pdf"
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
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
