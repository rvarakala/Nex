"""AUDINEXA Care — client-facing support tickets.

Pairs with `/api/admin/tickets` (founder/super-admin side). Clinics use these
endpoints to file, view, and reply on their OWN support tickets — strictly
scoped to `clinic_id` from the JWT.

  • POST   /api/care/tickets           — create a new ticket
  • GET    /api/care/tickets           — list MY tickets (paginated)
  • GET    /api/care/tickets/{tid}     — single ticket detail
  • POST   /api/care/tickets/{tid}/reply — append a clinic reply

Schema is shared with the admin Support Desk:
    support_tickets {
      ticket_id, clinic_id, category, priority, status, subject, body,
      diagnostic, contact_email, owner_user_id, thread[],
      first_response_at, resolved_at,
      created_by, created_at, sla_due_at,
    }

Founders see clinic replies via `/api/admin/tickets`; clinics see founder
replies via `/api/care/tickets/{tid}` — a single thread, two views.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, EmailStr
import uuid

from auth import get_current_user
from database import get_db
from utils.serde import deserialize_datetime
from routers.admin_panel_b import (
    TICKET_CATEGORIES, TICKET_PRIORITIES, SLA_HOURS,
)

router = APIRouter(prefix="/api/care", tags=["care"])


class CareTicketCreate(BaseModel):
    category: str
    priority: str = "medium"
    subject: str = Field(min_length=2, max_length=160)
    body: str = Field(min_length=1, max_length=5000)
    contact_email: Optional[EmailStr] = None
    diagnostic: Optional[str] = Field(default=None, max_length=10000)


class CareReply(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


def _strip(t: dict) -> dict:
    """Strip Mongo internals before returning to clinic users."""
    t = {k: v for k, v in t.items() if k != "_id"}
    return deserialize_datetime(t)


@router.post("/tickets")
async def create_my_ticket(
    payload: CareTicketCreate, request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """File a new ticket. clinic_id and created_by are auto-populated from JWT."""
    if payload.category not in TICKET_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of {TICKET_CATEGORIES}",
        )
    if payload.priority not in TICKET_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"priority must be one of {TICKET_PRIORITIES}",
        )
    if not user.get("clinic_id"):
        raise HTTPException(status_code=400, detail="No clinic context on this account")

    now = datetime.now(timezone.utc)
    sla_due = now + timedelta(hours=SLA_HOURS[payload.priority])

    body = payload.body
    if payload.diagnostic:
        # Bake the diagnostic into the body for now (single source of truth in
        # the thread). Founders see it as part of the original ticket text.
        body = f"{body}\n\n--- Attached error diagnostic ---\n{payload.diagnostic}"

    ticket = {
        "ticket_id": f"TKT-{uuid.uuid4().hex[:8].upper()}",
        "clinic_id": user["clinic_id"],
        "category": payload.category,
        "priority": payload.priority,
        "status": "Open",
        "subject": payload.subject,
        "body": body,
        "diagnostic": payload.diagnostic,
        "contact_email": payload.contact_email or user.get("email"),
        "owner_user_id": None,
        "thread": [{
            "at": now.isoformat(),
            "author": user.get("name") or user.get("email"),
            "author_role": "clinic",
            "text": body,
            "kind": "open",
        }],
        "first_response_at": None,
        "resolved_at": None,
        "created_by": user["user_id"],
        "created_by_email": user.get("email"),
        "created_at": now.isoformat(),
        "sla_due_at": sla_due.isoformat(),
    }
    await db.support_tickets.insert_one(ticket.copy())
    return _strip(ticket)


@router.get("/tickets")
async def list_my_tickets(
    status: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    if not user.get("clinic_id"):
        raise HTTPException(status_code=400, detail="No clinic context on this account")
    q: dict = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    rows = await db.support_tickets.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)

    # Surface a friendly unread/open count for the sidebar badge
    open_count = sum(1 for r in rows if r.get("status") in {"Open", "Pending", "Escalated"})
    return {
        "count": len(rows),
        "open_count": open_count,
        "rows": [deserialize_datetime(r) for r in rows],
        "categories": TICKET_CATEGORIES,
        "priorities": TICKET_PRIORITIES,
    }


@router.get("/tickets/{ticket_id}")
async def get_my_ticket(
    ticket_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    row = await db.support_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if row.get("clinic_id") != user.get("clinic_id"):
        raise HTTPException(status_code=403, detail="This ticket belongs to another clinic")
    return deserialize_datetime(row)


@router.post("/tickets/{ticket_id}/reply")
async def reply_to_my_ticket(
    ticket_id: str, payload: CareReply,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    row = await db.support_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if row.get("clinic_id") != user.get("clinic_id"):
        raise HTTPException(status_code=403, detail="This ticket belongs to another clinic")
    if row.get("status") in {"Resolved", "Closed"}:
        raise HTTPException(
            status_code=409,
            detail=f"Ticket is {row['status']}. Open a new ticket if you need further help.",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "at": now_iso,
        "author": user.get("name") or user.get("email"),
        "author_role": "clinic",
        "text": payload.text,
        "kind": "reply",
    }
    updates: dict = {}
    # If founder hadn't replied yet, the SLA first-response stays open. If
    # founder has replied (status went Pending) and clinic is now responding,
    # flip status back to Open so it surfaces in the founder queue again.
    if row.get("status") == "Pending":
        updates["status"] = "Open"

    mongo_update: dict = {"$push": {"thread": msg}}
    if updates:
        mongo_update["$set"] = updates

    fresh = await db.support_tickets.find_one_and_update(
        {"ticket_id": ticket_id, "clinic_id": user["clinic_id"]},
        mongo_update,
        projection={"_id": 0},
        return_document=True,
    )
    return deserialize_datetime(fresh)
