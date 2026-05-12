"""AUDINEXA Service Operations — Phase 12.A + 12.B.

Adds to the existing `ha_service.py` (which keeps the legacy create/resolve/
close endpoints for backward compat). This router provides the new AUDINEXA
13-state transition endpoint plus Couriers, Estimates, Customer Approvals.

Endpoints:
    POST   /api/ha/service-tickets/{ticket_no}/transition
                — generic state-machine transition
                  {to_status, note, vendor_id, shipment_id, ...}

    POST   /api/ha/couriers                     — book a shipment
    GET    /api/ha/couriers                     — list (filterable)
    GET    /api/ha/couriers/{shipment_id}       — detail
    POST   /api/ha/couriers/{shipment_id}/status — transition status
                — also auto-advances the linked service-job on DELIVERED

    POST   /api/ha/service-estimates            — record vendor estimate
                — creates pending CustomerApproval + advances job → ESTIMATE_PENDING
    GET    /api/ha/service-estimates?ticket_no= — list

    POST   /api/ha/customer-approvals/{approval_id}/decide
                — front-desk records APPROVED / REJECTED
                — auto-advances job → CLIENT_APPROVED or CLIENT_REJECTED

    GET    /api/ha/service-jobs/{ticket_no}/pipeline
                — full stitched view: job + shipments + estimates + approvals
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth import get_current_user, require_roles, user_can_see_branch, CLINIC_WIDE_ROLES
from database import get_db
from models_ha import (
    CourierShipment, CourierShipmentCreate, CourierStatusPayload,
    ServiceEstimate, ServiceEstimateCreate,
    CustomerApproval, CustomerApprovalPayload,
)
from utils.concurrency import (
    assert_version, get_expected_version, version_update,
)
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime
from utils.service_job_states import (
    assert_job_transition, normalise_status, TERMINAL_STATES,
)


router = APIRouter(prefix="/api/ha")

WRITE_ROLES = ("front_desk", "audiologist", "technician", "clinic_owner", "super_admin")


def _scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


async def _ticket(db, clinic_id: str, ticket_no: str) -> dict:
    t = await db.service_tickets.find_one(
        {"clinic_id": clinic_id, "ticket_no": ticket_no}, {"_id": 0},
    )
    if not t:
        raise HTTPException(status_code=404, detail="Service ticket not found")
    return t


# ==================== STATE TRANSITIONS ====================

class TransitionPayload(BaseModel):
    to_status: str
    note: Optional[str] = None
    vendor_id: Optional[str] = None           # for AWAITING_DISPATCH
    shipment_id: Optional[str] = None         # for DISPATCHED/IN_TRANSIT/RETURN_SHIPPED
    expected_version: Optional[int] = None    # opt-in optimistic-lock for offline replay


@router.post("/service-tickets/{ticket_no}/transition")
async def transition_service_job(
    ticket_no: str, payload: TransitionPayload, request: Request,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    t = await _ticket(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, t["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")

    # Optimistic concurrency: client may pin the version it loaded.
    expected = get_expected_version(request, payload.model_dump())
    assert_version(t, expected)

    cur = normalise_status(t["status"])
    assert_job_transition(cur, payload.to_status)

    # ── Guard: must have an Outbound shipment with AWB before moving to
    # DISPATCHED. Front desk often hits the "→ Dispatched" next-step button
    # without first booking a courier — block that, otherwise the customer
    # has no tracking record. Skip when the transition already carries a
    # fresh shipment_id (i.e. the courier booking flow auto-advances).
    if cur == "AWAITING_DISPATCH" and payload.to_status == "DISPATCHED" and not payload.shipment_id:
        outbound = await db.ha_courier_shipments.find_one(
            {
                "clinic_id": user["clinic_id"],
                "ticket_no": ticket_no,
                "direction": "OUTBOUND",
                "awb_number": {"$nin": [None, ""]},
            },
            {"_id": 0, "shipment_id": 1},
        )
        if not outbound:
            raise HTTPException(
                status_code=422,
                detail="Book an outbound courier (with AWB / tracking number) before marking this job Dispatched.",
            )

    now_iso = datetime.now(timezone.utc).isoformat()
    upd: dict = {"status": payload.to_status, "updated_at": now_iso}

    # Fine-grained timestamp stamps for TAT analytics
    stamp_key = {
        "DISPATCHED":           "dispatched_at",
        "DELIVERED_TO_COMPANY": "delivered_to_company_at",
        "ESTIMATE_PENDING":     "estimate_received_at",
        "CLIENT_APPROVED":      "client_decided_at",
        "CLIENT_REJECTED":      "client_decided_at",
        "RETURN_SHIPPED":       "return_shipped_at",
        "READY_FOR_PICKUP":     "ready_at",
        "DELIVERED_TO_CLIENT":  "delivered_to_client_at",
        "CLOSED":               "closed_at",
    }.get(payload.to_status)
    if stamp_key:
        upd[stamp_key] = now_iso

    if payload.vendor_id:
        upd["vendor_id"] = payload.vendor_id
    if payload.shipment_id:
        # DISPATCHED/IN_TRANSIT = outbound; RETURN_SHIPPED = inbound
        if payload.to_status in ("DISPATCHED", "IN_TRANSIT", "DELIVERED_TO_COMPANY"):
            upd["outbound_shipment_id"] = payload.shipment_id
        elif payload.to_status in ("RETURN_SHIPPED", "READY_FOR_PICKUP"):
            upd["inbound_shipment_id"] = payload.shipment_id

    # Persist inspection / resolution notes alongside the audit trail so the
    # Service Report PDF can render them as first-class fields.
    if payload.note:
        if payload.to_status == "INSPECTED":
            upd["inspection_notes"] = payload.note
        elif payload.to_status == "DELIVERED_TO_CLIENT":
            upd["handover_notes"] = payload.note
        elif payload.to_status in ("READY_FOR_PICKUP", "CLOSED"):
            # Append-or-set for resolution summary
            upd.setdefault("resolution_notes", payload.note)

    await db.service_tickets.update_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"$set": {**upd, "version_updated_at": now_iso},
         "$inc": {"version": 1},
         "$push": {"audit_trail": {
             "from": cur, "to": payload.to_status,
             "at": now_iso, "by_user_id": user["user_id"],
             "note": payload.note,
         }}},
    )
    # Read back the new version so the client can pin its next call.
    fresh = await db.service_tickets.find_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"_id": 0, "version": 1},
    )
    return {"ok": True, "ticket_no": ticket_no,
            "from": cur, "to": payload.to_status, "at": now_iso,
            "version": (fresh or {}).get("version", 1)}


# ==================== COURIER SHIPMENTS ====================

@router.post("/couriers", response_model=CourierShipment, status_code=201)
async def create_shipment(
    payload: CourierShipmentCreate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    t = await _ticket(db, user["clinic_id"], payload.ticket_no)
    if not user_can_see_branch(user, t["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")

    # Uniqueness: same AWB cannot be booked twice on the same direction
    dup = await db.ha_courier_shipments.find_one({
        "clinic_id": user["clinic_id"], "awb_number": payload.awb_number,
        "direction": payload.direction,
    }, {"_id": 0, "shipment_id": 1})
    if dup:
        raise HTTPException(
            status_code=409,
            detail=f"AWB {payload.awb_number} already booked ({dup['shipment_id']})",
        )

    shid = await next_number(db, "courier", user["clinic_id"])
    doc = CourierShipment(
        shipment_id=shid,
        clinic_id=user["clinic_id"],
        branch_id=t["branch_id"],
        ticket_no=payload.ticket_no,
        direction=payload.direction,
        courier_partner=payload.courier_partner,
        awb_number=payload.awb_number,
        dispatch_date=payload.dispatch_date,
        eta_date=payload.eta_date,
        from_address=payload.from_address,
        to_address=payload.to_address,
        recipient_name=payload.recipient_name,
        notes=payload.notes,
        status="BOOKED",
        created_by_user_id=user["user_id"],
    )
    await db.ha_courier_shipments.insert_one(serialize_datetime(doc.model_dump()))
    # Attach onto ticket right away for quick drill-down
    link_key = "outbound_shipment_id" if payload.direction == "OUTBOUND" else "inbound_shipment_id"
    upd: dict = {link_key: shid}

    # ---- Auto-advance the linked job's pipeline state ----
    # Booking a shipment is the natural trigger for the next state.
    cur_job = normalise_status(t["status"])
    auto_to: Optional[str] = None
    if payload.direction == "OUTBOUND" and cur_job == "AWAITING_DISPATCH":
        auto_to = "DISPATCHED"
    elif payload.direction == "INBOUND" and cur_job in (
        "REPAIR_IN_PROGRESS", "CLIENT_REJECTED",
    ):
        auto_to = "RETURN_SHIPPED"

    if auto_to:
        now_iso = datetime.now(timezone.utc).isoformat()
        upd["status"] = auto_to
        upd["updated_at"] = now_iso
        if auto_to == "DISPATCHED":
            upd["dispatched_at"] = now_iso
        elif auto_to == "RETURN_SHIPPED":
            upd["return_shipped_at"] = now_iso
        await db.service_tickets.update_one(
            {"clinic_id": user["clinic_id"], "ticket_no": payload.ticket_no},
            {"$set": upd,
             "$push": {"audit_trail": {
                 "from": cur_job, "to": auto_to,
                 "at": now_iso, "by_user_id": user["user_id"],
                 "note": f"Auto-advanced on shipment {shid} booking",
             }}},
        )
    else:
        await db.service_tickets.update_one(
            {"clinic_id": user["clinic_id"], "ticket_no": payload.ticket_no},
            {"$set": upd},
        )
    return deserialize_datetime(doc.model_dump())


@router.get("/couriers", response_model=List[CourierShipment])
async def list_shipments(
    ticket_no: Optional[str] = None,
    direction: Optional[str] = Query(None, description="OUTBOUND|INBOUND"),
    status: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user), db=Depends(get_db),
):
    q = _scope(user)
    if ticket_no:
        q["ticket_no"] = ticket_no
    if direction:
        q["direction"] = direction
    if status:
        q["status"] = status
    rows = await db.ha_courier_shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/couriers/{shipment_id}", response_model=CourierShipment)
async def get_shipment(shipment_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await db.ha_courier_shipments.find_one(
        {"clinic_id": user["clinic_id"], "shipment_id": shipment_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Shipment not in your branch")
    return deserialize_datetime(row)


# Valid shipment-status transitions
_SHIP_TRANSITIONS = {
    "BOOKED":     {"PICKED_UP", "CANCELLED", "EXCEPTION"},
    "PICKED_UP":  {"IN_TRANSIT", "DELIVERED", "EXCEPTION", "CANCELLED"},
    "IN_TRANSIT": {"DELIVERED", "EXCEPTION", "CANCELLED"},
    "EXCEPTION":  {"IN_TRANSIT", "DELIVERED", "CANCELLED"},
    "DELIVERED":  set(),
    "CANCELLED":  set(),
}


@router.post("/couriers/{shipment_id}/status", response_model=CourierShipment)
async def update_shipment_status(
    shipment_id: str, payload: CourierStatusPayload,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await db.ha_courier_shipments.find_one(
        {"clinic_id": user["clinic_id"], "shipment_id": shipment_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Shipment not in your branch")
    cur = row["status"]
    if payload.to_status not in _SHIP_TRANSITIONS.get(cur, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Illegal shipment transition {cur} → {payload.to_status}. "
                   f"Legal: {sorted(_SHIP_TRANSITIONS.get(cur, []))}",
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    upd = {"status": payload.to_status, "updated_at": now_iso}
    if payload.exception_note:
        upd["exception_note"] = payload.exception_note
    if payload.to_status == "DELIVERED":
        upd["delivered_at"] = now_iso

    await db.ha_courier_shipments.update_one(
        {"clinic_id": user["clinic_id"], "shipment_id": shipment_id},
        {"$set": upd},
    )

    # Auto-advance the linked service-job when outbound DELIVERED
    if payload.to_status == "DELIVERED" and row["direction"] == "OUTBOUND":
        try:
            t = await _ticket(db, user["clinic_id"], row["ticket_no"])
            cur_job = normalise_status(t["status"])
            # Only auto-advance if currently DISPATCHED / IN_TRANSIT
            if cur_job in ("DISPATCHED", "IN_TRANSIT"):
                await db.service_tickets.update_one(
                    {"clinic_id": user["clinic_id"], "ticket_no": row["ticket_no"]},
                    {"$set": {"status": "DELIVERED_TO_COMPANY",
                              "delivered_to_company_at": now_iso,
                              "updated_at": now_iso}},
                )
        except HTTPException:
            pass
    row["status"] = payload.to_status
    row["updated_at"] = now_iso
    if payload.to_status == "DELIVERED":
        row["delivered_at"] = now_iso
    if payload.exception_note:
        row["exception_note"] = payload.exception_note
    return deserialize_datetime(row)


# ==================== ESTIMATES + CUSTOMER APPROVAL ====================

@router.post("/service-estimates", response_model=ServiceEstimate, status_code=201)
async def record_estimate(
    payload: ServiceEstimateCreate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    t = await _ticket(db, user["clinic_id"], payload.ticket_no)
    if not user_can_see_branch(user, t["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")

    # Only valid when ticket is at the company
    cur = normalise_status(t["status"])
    if cur != "DELIVERED_TO_COMPANY" and cur != "ESTIMATE_PENDING":
        raise HTTPException(
            status_code=409,
            detail=f"Estimates can only be recorded after device reaches the company "
                   f"(current status: {cur})",
        )

    eid = await next_number(db, "estimate", user["clinic_id"])
    received_on = payload.received_on or datetime.now(timezone.utc).date().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    has_conveyed = (
        payload.conveyed_amount is not None
        or payload.discount is not None
    )
    est = ServiceEstimate(
        estimate_id=eid,
        clinic_id=user["clinic_id"],
        ticket_no=payload.ticket_no,
        vendor_id=payload.vendor_id or t.get("vendor_id"),
        vendor_name=payload.vendor_name,
        received_on=received_on,
        warranty_covered=payload.warranty_covered,
        amount=float(payload.amount or 0),
        conveyed_amount=(float(payload.conveyed_amount)
                         if payload.conveyed_amount is not None else None),
        discount=(float(payload.discount)
                  if payload.discount is not None else None),
        # Stamp who conveyed the price the moment the estimate is created
        conveyed_by_user_id=user["user_id"] if has_conveyed else None,
        conveyed_by_name=user.get("name") if has_conveyed else None,
        conveyed_at=now_iso if has_conveyed else None,
        repair_notes=payload.repair_notes,
        eta_days=payload.eta_days,
        created_by_user_id=user["user_id"],
    )
    await db.ha_service_estimates.insert_one(serialize_datetime(est.model_dump()))

    # Auto-create a PENDING CustomerApproval
    aid = await next_number(db, "approval", user["clinic_id"])
    approval = CustomerApproval(
        approval_id=aid,
        clinic_id=user["clinic_id"],
        ticket_no=payload.ticket_no,
        estimate_id=eid,
        decision="PENDING",
    )
    await db.ha_customer_approvals.insert_one(serialize_datetime(approval.model_dump()))

    # Advance job → ESTIMATE_PENDING (legal from DELIVERED_TO_COMPANY;
    # from ESTIMATE_PENDING itself it's a no-op).
    if cur == "DELIVERED_TO_COMPANY":
        await db.service_tickets.update_one(
            {"clinic_id": user["clinic_id"], "ticket_no": payload.ticket_no},
            {"$set": {"status": "ESTIMATE_PENDING",
                      "estimate_received_at": now_iso,
                      "estimate_id": eid, "approval_id": aid,
                      "updated_at": now_iso}},
        )
    else:
        # still link latest estimate/approval for easy drill-down
        await db.service_tickets.update_one(
            {"clinic_id": user["clinic_id"], "ticket_no": payload.ticket_no},
            {"$set": {"estimate_id": eid, "approval_id": aid,
                      "updated_at": now_iso}},
        )
    return deserialize_datetime(est.model_dump())


@router.get("/service-estimates", response_model=List[ServiceEstimate])
async def list_estimates(
    ticket_no: Optional[str] = None, limit: int = 200,
    user=Depends(get_current_user), db=Depends(get_db),
):
    q = {"clinic_id": user["clinic_id"]}
    if ticket_no:
        q["ticket_no"] = ticket_no
    rows = await db.ha_service_estimates.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.post("/customer-approvals/{approval_id}/decide", response_model=CustomerApproval)
async def decide_approval(
    approval_id: str, payload: CustomerApprovalPayload,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    if payload.decision not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="decision must be APPROVED or REJECTED")
    row = await db.ha_customer_approvals.find_one(
        {"clinic_id": user["clinic_id"], "approval_id": approval_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Approval not found")
    if row["decision"] != "PENDING":
        raise HTTPException(status_code=409,
                            detail=f"Approval already {row['decision']}")
    now_iso = datetime.now(timezone.utc).isoformat()
    decision_set = {
        "decision": payload.decision,
        "notes": payload.notes,
        "contact_number": payload.contact_number,
        "decided_by_user_id": user["user_id"],
        "decided_by_name": user.get("name"),
        "decided_at": now_iso,
    }
    await db.ha_customer_approvals.update_one(
        {"clinic_id": user["clinic_id"], "approval_id": approval_id},
        {"$set": decision_set},
    )
    # Advance linked service-job
    t = await _ticket(db, user["clinic_id"], row["ticket_no"])
    cur = normalise_status(t["status"])
    new_job_status = "CLIENT_APPROVED" if payload.decision == "APPROVED" else "CLIENT_REJECTED"
    if cur == "ESTIMATE_PENDING":
        await db.service_tickets.update_one(
            {"clinic_id": user["clinic_id"], "ticket_no": row["ticket_no"]},
            {"$set": {"status": new_job_status,
                      "client_decided_at": now_iso,
                      "updated_at": now_iso}},
        )
    row.update(decision_set)
    return deserialize_datetime(row)


# ==================== STITCHED PIPELINE VIEW ====================

@router.get("/service-jobs/{ticket_no}/pipeline")
async def pipeline_view(
    ticket_no: str, user=Depends(get_current_user), db=Depends(get_db),
):
    t = await _ticket(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, t["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")
    shipments = await db.ha_courier_shipments.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    estimates = await db.ha_service_estimates.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    approvals = await db.ha_customer_approvals.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    return {
        "ticket": deserialize_datetime(t),
        "normalised_status": normalise_status(t["status"]),
        "is_terminal": normalise_status(t["status"]) in TERMINAL_STATES,
        "shipments": [deserialize_datetime(r) for r in shipments],
        "estimates": [deserialize_datetime(r) for r in estimates],
        "approvals": [deserialize_datetime(r) for r in approvals],
    }


# ============================================================================
# AUTO-INVOICE — generate a GST invoice for the service job at handover.
# ============================================================================
SERVICE_GST_RATE = 18.0     # India: hearing-aid service & repair classified
                            # under HSN/SAC 9985 → 18% IGST
SERVICE_HSN_SAC = "9985"    # Standard SAC for "Other support services"


@router.post("/service-tickets/{ticket_no}/invoice")
async def generate_service_invoice(
    ticket_no: str,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    """Auto-generate a GST invoice for the completed service job.

    Behaviour:
      • Idempotent: if the ticket already has `invoice_id`, returns the
        existing invoice (callers don't need to know about state).
      • Allowed only at terminal-customer states: READY_FOR_PICKUP /
        DELIVERED_TO_CLIENT / CLOSED.
      • Creates ONE invoice line:
          description = "Hearing-aid Service & Repair · {ticket_no}"
          unit_price  = approved estimate's (conveyed_amount − discount), or
                        fallback to ticket.cost_to_patient
          gst_rate    = 18% (SAC 9985)
      • Warranty-covered jobs → unit_price=0 → tax-exempt invoice (₹0 grand
        total) which still serves as a paper trail for the patient.
      • Stamps the new invoice_id + invoice_no on the ticket so the drawer
        can render "View Invoice" instead of "Generate Invoice" on reopen.
    """
    from billing import _next_invoice_no, _compute_line, _apply_tax_split
    from models import (
        Invoice, InvoiceLineCreate, InvoiceLine,
    )

    t = await _ticket(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, t["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")

    cur = normalise_status(t["status"])
    if cur not in {"READY_FOR_PICKUP", "DELIVERED_TO_CLIENT", "CLOSED"}:
        raise HTTPException(
            status_code=409,
            detail=(
                "Invoice can be generated only after the job reaches "
                "Ready-for-pickup / Delivered / Closed (current: "
                f"{cur}). Approve the estimate and complete the repair first."
            ),
        )

    # Idempotent: return existing invoice
    if t.get("invoice_id"):
        existing = await db.invoices.find_one(
            {"invoice_id": t["invoice_id"], "clinic_id": user["clinic_id"]},
            {"_id": 0},
        )
        if existing:
            return deserialize_datetime(existing)
        # Stale linkage — fall through and regenerate

    # Resolve final amount: approved estimate first, then ticket cost
    estimates = await db.ha_service_estimates.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"_id": 0},
    ).sort("created_at", -1).to_list(10)
    approvals = {a["estimate_id"]: a for a in await db.ha_customer_approvals.find(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no, "decision": "APPROVED"},
        {"_id": 0},
    ).to_list(10)}

    final_amount = 0.0
    warranty_covered = bool(t.get("warranty_covered"))
    chosen_est = None
    for e in estimates:
        if e.get("estimate_id") in approvals:
            chosen_est = e
            break
    if chosen_est:
        warranty_covered = bool(chosen_est.get("warranty_covered"))
        if warranty_covered:
            final_amount = 0.0
        else:
            conveyed = chosen_est.get("conveyed_amount")
            base = float(conveyed) if conveyed is not None else float(chosen_est.get("amount") or 0)
            final_amount = max(0.0, base - float(chosen_est.get("discount") or 0))
    else:
        final_amount = float(t.get("cost_to_patient") or 0)

    # Patient + clinic for header/state-split
    patient = await db.patients.find_one(
        {"patient_id": t["patient_id"], "clinic_id": user["clinic_id"]}, {"_id": 0},
    ) or {}
    clinic = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0},
    ) or {}

    # Build the single line
    line_in = InvoiceLineCreate(
        description=f"Hearing-aid Service & Repair · {ticket_no}",
        quantity=1.0,
        unit_price=final_amount,
        is_taxable=(not warranty_covered),
        gst_rate=(SERVICE_GST_RATE if not warranty_covered else 0.0),
        hsn_sac=SERVICE_HSN_SAC,
    )
    # Service-aware shape — _compute_line wants a dict with `gst_inclusive`,
    # we want exclusive (line_total = base + GST)
    pseudo_service = {
        "name": line_in.description,
        "price": final_amount,
        "is_taxable": line_in.is_taxable,
        "gst_rate": line_in.gst_rate,
        "hsn_sac": line_in.hsn_sac,
        "gst_inclusive": False,
    }
    resolved_line: InvoiceLine = _compute_line(line_in, pseudo_service)

    # Intra vs inter-state split
    clinic_state = (clinic.get("state") or "").strip().lower()
    pat_state = (patient.get("state") or "").strip().lower()
    inter_state = bool(clinic_state and pat_state and clinic_state != pat_state)
    _apply_tax_split([resolved_line], inter_state)

    invoice_no = await _next_invoice_no(db, user["clinic_id"])
    inv = Invoice(
        clinic_id=user["clinic_id"],
        invoice_no=invoice_no,
        patient_id=patient.get("patient_id", t["patient_id"]),
        patient_name=patient.get("name", t.get("patient_name", "")),
        patient_mobile=patient.get("mobile") or patient.get("phone") or t.get("patient_mobile"),
        mrd=patient.get("mrd"),
        ticket_no=ticket_no,
        lines=[resolved_line],
        notes=(
            f"Auto-generated from Service Job {ticket_no}."
            + (" Warranty-covered." if warranty_covered else "")
        ),
        created_by_user_id=user["user_id"],
    )
    # Roll-up totals (mirror billing.create_invoice)
    inv.subtotal = round(sum(ln.taxable_value for ln in inv.lines), 2)
    inv.discount_total = round(sum(ln.discount_amount for ln in inv.lines), 2)
    inv.cgst_total = round(sum(ln.cgst_amount for ln in inv.lines), 2)
    inv.sgst_total = round(sum(ln.sgst_amount for ln in inv.lines), 2)
    inv.igst_total = round(sum(ln.igst_amount for ln in inv.lines), 2)
    inv.tax_total = round(inv.cgst_total + inv.sgst_total + inv.igst_total, 2)
    inv.grand_total = round(inv.subtotal + inv.tax_total, 2)
    inv.rounded_total = round(inv.grand_total)
    inv.round_off = round(inv.rounded_total - inv.grand_total, 2)
    inv.due_total = inv.rounded_total
    inv.paid_total = 0.0
    if inv.rounded_total <= 0:
        inv.status = "paid"
        inv.due_total = 0.0

    from billing import _serialize
    await db.invoices.insert_one(_serialize(inv.model_dump()))
    # Stamp on ticket so future calls are idempotent
    await db.service_tickets.update_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"$set": {
            "invoice_id": inv.invoice_id,
            "invoice_no": inv.invoice_no,
            "cost_to_patient": final_amount,
            "version_updated_at": datetime.now(timezone.utc).isoformat(),
        }, "$inc": {"version": 1}},
    )
    return deserialize_datetime(inv.model_dump())
