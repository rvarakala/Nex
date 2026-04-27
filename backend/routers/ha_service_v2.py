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

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import get_current_user, require_roles, user_can_see_branch, CLINIC_WIDE_ROLES
from database import get_db
from models_ha import (
    CourierShipment, CourierShipmentCreate, CourierStatusPayload,
    ServiceEstimate, ServiceEstimateCreate,
    CustomerApproval, CustomerApprovalPayload,
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


@router.post("/service-tickets/{ticket_no}/transition")
async def transition_service_job(
    ticket_no: str, payload: TransitionPayload,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    t = await _ticket(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, t["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")

    cur = normalise_status(t["status"])
    assert_job_transition(cur, payload.to_status)

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
        {"$set": upd,
         "$push": {"audit_trail": {
             "from": cur, "to": payload.to_status,
             "at": now_iso, "by_user_id": user["user_id"],
             "note": payload.note,
         }}},
    )
    return {"ok": True, "ticket_no": ticket_no,
            "from": cur, "to": payload.to_status, "at": now_iso}


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
    est = ServiceEstimate(
        estimate_id=eid,
        clinic_id=user["clinic_id"],
        ticket_no=payload.ticket_no,
        vendor_id=payload.vendor_id or t.get("vendor_id"),
        vendor_name=payload.vendor_name,
        received_on=received_on,
        warranty_covered=payload.warranty_covered,
        amount=float(payload.amount or 0),
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
    now_iso = datetime.now(timezone.utc).isoformat()
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
    await db.ha_customer_approvals.update_one(
        {"clinic_id": user["clinic_id"], "approval_id": approval_id},
        {"$set": {"decision": payload.decision, "notes": payload.notes,
                  "decided_by_user_id": user["user_id"],
                  "decided_by_name": user.get("name"),
                  "decided_at": now_iso}},
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
    row.update({
        "decision": payload.decision, "notes": payload.notes,
        "decided_by_user_id": user["user_id"],
        "decided_by_name": user.get("name"),
        "decided_at": now_iso,
    })
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
