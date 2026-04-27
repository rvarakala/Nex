"""HA Service Tickets — Post-Phase-7 UI catch-up.

A service ticket tracks a repair / cleaning / reprogramming / warranty-claim
job on a hearing-aid unit. Lifecycle:

    open → in_progress → resolved → closed
                    └→ cancelled (any time)

Serial state transitions on ticket lifecycle:
* CREATE (with serial_id): current_state → SERVICE_IN
* RESOLVE: SERVICE_IN → RETURNED (patient-owned → back to patient)
              or SERVICE_IN → IN_STOCK (clinic-owned → back to stock)
* CANCEL: SERVICE_IN → DAMAGED (clinic absorbs, unit declared bad)

Roles:
- create: front_desk / audiologist / technician / clinic_owner / super_admin
- update / resolve / cancel: technician / audiologist / clinic_owner / super_admin
- read: any authenticated clinic user
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from utils.concurrency import (
    assert_version, get_expected_version, version_update,
)
from database import get_db
from models_ha import (
    ServiceTicket, ServiceTicketCreate, ServiceTicketUpdate, ServiceTicketResolve,
)
from utils.ha_states import transition_serial
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api/ha")

CREATE_ROLES = ("front_desk", "audiologist", "technician", "clinic_owner", "super_admin")
MUTATE_ROLES = ("technician", "audiologist", "clinic_owner", "super_admin")

# Valid forward transitions for ticket status
FWD_TRANSITIONS: dict[str, set[str]] = {
    "open":        {"in_progress", "cancelled"},
    "in_progress": {"resolved", "cancelled"},
    "resolved":    {"closed"},
    "closed":      set(),
    "cancelled":   set(),
}


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


# ---- Legacy schema mapping ---------------------------------------------------
# A handful of seeded/imported tickets were written with a different field
# vocabulary (issue_summary, assigned_to_user_id, estimate_amount, completed_at)
# and lowercase status values that aren't part of the canonical TicketStatus
# Literal. Normalize at read time so the UI keeps working without a destructive
# migration.
_LEGACY_STATUS_MAP = {
    "received": "open",
    "estimated": "in_progress",
    "approved": "in_progress",
    "rejected": "cancelled",
    "completed": "resolved",
}


def _normalize_legacy(row: dict) -> dict:
    if "complaint" not in row or not row.get("complaint"):
        row["complaint"] = row.get("issue_summary") or row.get("complaint_text") or ""
    if "technician_user_id" not in row and row.get("assigned_to_user_id"):
        row["technician_user_id"] = row["assigned_to_user_id"]
    if "cost_to_patient" not in row and row.get("estimate_amount") is not None:
        row["cost_to_patient"] = float(row["estimate_amount"] or 0)
    if "resolved_at" not in row and row.get("completed_at"):
        row["resolved_at"] = row["completed_at"]
    s = row.get("status")
    if s in _LEGACY_STATUS_MAP:
        row["status"] = _LEGACY_STATUS_MAP[s]
    return row


async def _load(db, clinic_id: str, ticket_no: str) -> dict:
    row = await db.service_tickets.find_one(
        {"clinic_id": clinic_id, "ticket_no": ticket_no}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Service ticket not found")
    return row


# ==================== LIST / GET ====================

@router.get("/service-tickets", response_model=List[ServiceTicket])
async def list_tickets(
    status: Optional[str] = None,
    kind: Optional[str] = None,
    patient_id: Optional[str] = None,
    serial_id: Optional[str] = None,
    technician_user_id: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if status:
        q["status"] = status
    if kind:
        q["kind"] = kind
    if patient_id:
        q["patient_id"] = patient_id
    if serial_id:
        q["serial_id"] = serial_id
    if technician_user_id:
        q["technician_user_id"] = technician_user_id
    rows = await db.service_tickets.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(_normalize_legacy(r)) for r in rows]


@router.get("/service-tickets/{ticket_no}", response_model=ServiceTicket)
async def get_ticket(ticket_no: str, user=Depends(get_current_user), db=Depends(get_db)):
    row = await _load(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")
    return deserialize_datetime(_normalize_legacy(row))


@router.get("/service-tickets-kpis")
async def kpis(user=Depends(get_current_user), db=Depends(get_db)):
    base = _branch_scope(user)
    open_n = await db.service_tickets.count_documents({**base, "status": {"$in": ["open", "received"]}})
    in_prog = await db.service_tickets.count_documents({**base, "status": {"$in": ["in_progress", "estimated", "approved"]}})
    resolved = await db.service_tickets.count_documents({**base, "status": {"$in": ["resolved", "completed"]}})
    closed = await db.service_tickets.count_documents({**base, "status": "closed"})
    warranty = await db.service_tickets.count_documents({**base, "warranty_covered": True})
    return {"open": open_n, "in_progress": in_prog, "resolved": resolved,
            "closed": closed, "warranty_covered": warranty}


# ==================== CREATE ====================

@router.post("/service-tickets", response_model=ServiceTicket, status_code=201)
async def create_ticket(
    payload: ServiceTicketCreate,
    user=Depends(require_roles(*CREATE_ROLES)),
    db=Depends(get_db),
):
    if not user_can_see_branch(user, payload.branch_id):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if not payload.complaint or len(payload.complaint.strip()) < 5:
        raise HTTPException(status_code=400, detail="Complaint must be at least 5 characters")

    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": payload.patient_id},
        {"_id": 0, "name": 1, "mobile": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    tech_name = None
    if payload.technician_user_id:
        tech = await db.users.find_one(
            {"user_id": payload.technician_user_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "name": 1, "role": 1},
        )
        if not tech:
            raise HTTPException(status_code=404, detail="Technician user not found")
        tech_name = tech.get("name")

    serial_doc = None
    if payload.serial_id:
        serial_doc = await db.serial_items.find_one(
            {"serial_id": payload.serial_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
        )
        if not serial_doc:
            raise HTTPException(status_code=404, detail="Serial not found")
        if serial_doc["state"] not in {"SOLD", "IN_STOCK", "RETURNED"}:
            raise HTTPException(
                status_code=409,
                detail=f"Serial is {serial_doc['state']} — only SOLD / IN_STOCK / RETURNED can enter service",
            )

    ticket_no = await next_number(db, "job", user["clinic_id"])
    now_iso = datetime.now(timezone.utc).isoformat()

    ticket = ServiceTicket(
        ticket_no=ticket_no,
        clinic_id=user["clinic_id"],
        branch_id=payload.branch_id,
        patient_id=payload.patient_id,
        patient_name=patient.get("name"),
        patient_mobile=patient.get("mobile"),
        serial_id=payload.serial_id,
        serial_no=serial_doc.get("serial_no") if serial_doc else None,
        kind=payload.kind,
        complaint=payload.complaint.strip(),
        status="open",
        technician_user_id=payload.technician_user_id,
        technician_name=tech_name,
        warranty_covered=payload.warranty_covered,
        created_by_user_id=user["user_id"],
        updated_at=now_iso,
    )
    await db.service_tickets.insert_one(serialize_datetime(ticket.model_dump()))

    # If a serial is attached, move it → SERVICE_IN.
    if serial_doc:
        await transition_serial(
            db, payload.serial_id, "SERVICE_IN",
            actor_user_id=user["user_id"],
            ref_doc={"kind": "service_ticket", "id": ticket_no},
            note=f"Service ticket {ticket_no}: {payload.complaint[:80]}",
        )

    return deserialize_datetime(ticket.model_dump())


# ==================== UPDATE ====================

@router.put("/service-tickets/{ticket_no}", response_model=ServiceTicket)
async def update_ticket(
    ticket_no: str, payload: ServiceTicketUpdate, request: Request,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    row = await _load(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")
    if row["status"] in {"closed", "cancelled"}:
        raise HTTPException(status_code=409, detail=f"Ticket is {row['status']}, cannot edit")

    # Optimistic concurrency: client may pin the version it loaded
    expected = get_expected_version(request, payload.model_dump())
    assert_version(row, expected)

    upd: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}

    if payload.status is not None:
        allowed = FWD_TRANSITIONS.get(row["status"], set())
        if payload.status != row["status"] and payload.status not in allowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot move {row['status']} → {payload.status}. Allowed: {sorted(allowed)}",
            )
        upd["status"] = payload.status

    if payload.technician_user_id is not None:
        tech = await db.users.find_one(
            {"user_id": payload.technician_user_id, "clinic_id": user["clinic_id"]},
            {"_id": 0, "name": 1},
        )
        if not tech:
            raise HTTPException(status_code=404, detail="Technician user not found")
        upd["technician_user_id"] = payload.technician_user_id
        upd["technician_name"] = tech.get("name")

    for field in ("diagnosis", "resolution_notes", "cost_to_patient",
                  "warranty_covered", "loaner_serial_id"):
        v = getattr(payload, field)
        if v is not None:
            upd[field] = v

    await db.service_tickets.update_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        version_update(upd),
    )
    # Reload to surface fresh version in response
    fresh = await db.service_tickets.find_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no}, {"_id": 0},
    )
    return deserialize_datetime(fresh)


# ==================== RESOLVE ====================

@router.post("/service-tickets/{ticket_no}/resolve", response_model=ServiceTicket)
async def resolve_ticket(
    ticket_no: str, payload: ServiceTicketResolve,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    """Mark the ticket as resolved + move serial SERVICE_IN → RETURNED (patient-owned)
    or → IN_STOCK (clinic-owned)."""
    row = await _load(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")
    if row["status"] in {"resolved", "closed", "cancelled"}:
        raise HTTPException(status_code=409, detail=f"Cannot resolve a {row['status']} ticket")
    if row["status"] == "open":
        raise HTTPException(
            status_code=409,
            detail="Move ticket to 'in_progress' before resolving",
        )

    now_iso = datetime.now(timezone.utc).isoformat()

    # Move serial back if attached
    if row.get("serial_id"):
        cur = await db.serial_items.find_one({"serial_id": row["serial_id"]}, {"_id": 0, "state": 1})
        if cur and cur["state"] == "SERVICE_IN":
            # SOLD-origin tickets → RETURNED (back to patient).
            # IN_STOCK-origin tickets → IN_STOCK (back to stock).
            # Decide by checking if a patient owns it (current_patient_id present).
            owner_pid = None
            try:
                full = await db.serial_items.find_one({"serial_id": row["serial_id"]}, {"_id": 0})
                owner_pid = full.get("current_patient_id") if full else None
            except Exception:
                owner_pid = None
            next_state = "RETURNED" if owner_pid else "IN_STOCK"
            await transition_serial(
                db, row["serial_id"], next_state,
                actor_user_id=user["user_id"],
                ref_doc={"kind": "service_ticket", "id": ticket_no},
                note=f"Ticket {ticket_no} resolved",
            )

    upd = {
        "status": "resolved",
        "resolution_notes": payload.resolution_notes,
        "cost_to_patient": float(payload.cost_to_patient or 0),
        "warranty_covered": bool(payload.warranty_covered),
        "resolved_at": now_iso,
        "updated_at": now_iso,
    }
    await db.service_tickets.update_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


# ==================== CLOSE ====================

@router.post("/service-tickets/{ticket_no}/close", response_model=ServiceTicket)
async def close_ticket(
    ticket_no: str,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    row = await _load(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")
    if row["status"] != "resolved":
        raise HTTPException(status_code=409, detail=f"Cannot close a {row['status']} ticket — must be resolved first")

    now_iso = datetime.now(timezone.utc).isoformat()
    upd = {"status": "closed", "closed_at": now_iso, "updated_at": now_iso}
    await db.service_tickets.update_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


# ==================== CANCEL ====================

@router.post("/service-tickets/{ticket_no}/cancel", response_model=ServiceTicket)
async def cancel_ticket(
    ticket_no: str,
    user=Depends(require_roles(*MUTATE_ROLES)),
    db=Depends(get_db),
):
    """Cancel the ticket + move serial SERVICE_IN → DAMAGED (unfixable)."""
    row = await _load(db, user["clinic_id"], ticket_no)
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Ticket not in your branch")
    if row["status"] in {"closed", "cancelled"}:
        raise HTTPException(status_code=409, detail=f"Ticket is already {row['status']}")

    now_iso = datetime.now(timezone.utc).isoformat()

    if row.get("serial_id"):
        cur = await db.serial_items.find_one({"serial_id": row["serial_id"]}, {"_id": 0, "state": 1})
        if cur and cur["state"] == "SERVICE_IN":
            await transition_serial(
                db, row["serial_id"], "DAMAGED",
                actor_user_id=user["user_id"],
                ref_doc={"kind": "service_ticket", "id": ticket_no},
                note=f"Ticket {ticket_no} cancelled — unit damaged",
            )

    upd = {"status": "cancelled", "closed_at": now_iso, "updated_at": now_iso}
    await db.service_tickets.update_one(
        {"clinic_id": user["clinic_id"], "ticket_no": ticket_no},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})
