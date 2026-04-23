"""AUDINEXA Super-Admin Panel — Phase 14B + 14C.

Extends /api/admin/v2 prefix with 8 more modules:
  Phase 14B:
    7. Support Desk
    8. Usage Analytics (per-tenant + churn-risk scoring)
    9. System Health (live + incident log)
   10. Marketing CRM (campaigns + attribution)
  Phase 14C:
   11. Notifications Center (global broadcast)
   12. Full Audit Log viewer (filtered query)
   13. Settings (platform config)
   14. Granular RBAC (7 role permission matrix)

All endpoints require founder or super_admin by default. Sub-roles
(sales_manager, support_agent, finance_manager, product_ops, read_only)
are enforced inside each endpoint via the ROLE_PERMISSIONS matrix.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from auth import get_current_user
from database import get_db
from utils.serde import serialize_datetime, deserialize_datetime
from utils.rbac import ROLE_PERMISSIONS, has_permission, require_permission

from routers.admin_panel import _log_audit  # reuse audit helper


router = APIRouter(prefix="/api/admin/v2")


# ==================== RBAC (Phase 14C) ====================
# Permission matrix lives in utils/rbac.py (shared with admin_panel.py).


@router.get("/rbac/matrix")
async def get_rbac_matrix(user=Depends(get_current_user)):
    if user["role"] not in {"founder", "super_admin", "product_ops"}:
        raise HTTPException(403, detail="Not permitted")
    return {
        "roles": list(ROLE_PERMISSIONS.keys()),
        "matrix": ROLE_PERMISSIONS,
        "documented_actions": sorted({a for perms in ROLE_PERMISSIONS.values() for a in perms}),
    }


# ==================== 7. SUPPORT DESK (Phase 14B) ====================

TICKET_CATEGORIES = ["Billing", "Bug", "Feature Request", "Training", "Data Import", "Urgent Outage"]
TICKET_STATUSES = ["Open", "Pending", "Resolved", "Escalated", "Closed"]
TICKET_PRIORITIES = ["low", "medium", "high", "urgent"]
SLA_HOURS = {"low": 72, "medium": 24, "high": 8, "urgent": 2}


class TicketCreate(BaseModel):
    clinic_id: Optional[str] = None       # None for internal/ops-only tickets
    category: str
    priority: str = "medium"
    subject: str = Field(min_length=2)
    body: str = Field(min_length=1)
    contact_email: Optional[EmailStr] = None


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    owner_user_id: Optional[str] = None
    reply: Optional[str] = None           # appended to thread


@router.get("/tickets")
async def list_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    clinic_id: Optional[str] = None,
    limit: int = 500,
    user=Depends(require_permission("tickets:read")),
    db=Depends(get_db),
):
    q: dict = {}
    if status:
        q["status"] = status
    if priority:
        q["priority"] = priority
    if clinic_id:
        q["clinic_id"] = clinic_id
    rows = await db.support_tickets.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)

    now = datetime.now(timezone.utc)
    open_statuses = {"Open", "Pending", "Escalated"}
    resolution_times: list[float] = []
    response_times: list[float] = []
    priority_counts: dict[str, int] = {p: 0 for p in TICKET_PRIORITIES}
    sla_breaches = 0

    for t in rows:
        if t.get("status") in open_statuses:
            try:
                sla_due = t.get("sla_due_at")
                if sla_due and datetime.fromisoformat(sla_due.replace("Z", "+00:00")) < now:
                    sla_breaches += 1
            except Exception:
                pass
        if t.get("first_response_at") and t.get("created_at"):
            try:
                a = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                b = datetime.fromisoformat(t["first_response_at"].replace("Z", "+00:00"))
                response_times.append((b - a).total_seconds() / 3600.0)
            except Exception:
                pass
        if t.get("resolved_at") and t.get("created_at"):
            try:
                a = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                b = datetime.fromisoformat(t["resolved_at"].replace("Z", "+00:00"))
                resolution_times.append((b - a).total_seconds() / 3600.0)
            except Exception:
                pass
        priority_counts[t.get("priority", "medium")] = priority_counts.get(t.get("priority", "medium"), 0) + 1

    def avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    return {
        "count": len(rows),
        "rows": [deserialize_datetime(r) for r in rows],
        "stats": {
            "avg_response_hrs": avg(response_times),
            "avg_resolution_hrs": avg(resolution_times),
            "sla_breaches": sla_breaches,
            "open_by_priority": priority_counts,
            "categories": TICKET_CATEGORIES,
            "statuses": TICKET_STATUSES,
            "priorities": TICKET_PRIORITIES,
        },
    }


@router.post("/tickets")
async def create_ticket(
    payload: TicketCreate, request: Request,
    user=Depends(require_permission("tickets:write")),
    db=Depends(get_db),
):
    if payload.category not in TICKET_CATEGORIES:
        raise HTTPException(400, detail=f"category must be one of {TICKET_CATEGORIES}")
    if payload.priority not in TICKET_PRIORITIES:
        raise HTTPException(400, detail=f"priority must be one of {TICKET_PRIORITIES}")
    now = datetime.now(timezone.utc)
    sla = now + timedelta(hours=SLA_HOURS[payload.priority])
    ticket = {
        "ticket_id": f"TKT-{uuid.uuid4().hex[:8].upper()}",
        "clinic_id": payload.clinic_id,
        "category": payload.category,
        "priority": payload.priority,
        "status": "Open",
        "subject": payload.subject,
        "body": payload.body,
        "contact_email": payload.contact_email,
        "owner_user_id": None,
        "thread": [{"at": now.isoformat(), "author": user.get("email"), "text": payload.body, "kind": "open"}],
        "first_response_at": None,
        "resolved_at": None,
        "created_by": user["user_id"],
        "created_at": now.isoformat(),
        "sla_due_at": sla.isoformat(),
    }
    await db.support_tickets.insert_one(ticket.copy())
    await _log_audit(db, user, "ticket.create", ticket["ticket_id"], after={"category": payload.category, "priority": payload.priority}, request=request)
    ticket.pop("_id", None)
    return ticket


@router.patch("/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: str, payload: TicketUpdate, request: Request,
    user=Depends(require_permission("tickets:write")),
    db=Depends(get_db),
):
    existing = await db.support_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, detail="Ticket not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    updates: dict = {}
    push_items: list[dict] = []
    if payload.status:
        if payload.status not in TICKET_STATUSES:
            raise HTTPException(400, detail=f"status must be one of {TICKET_STATUSES}")
        updates["status"] = payload.status
        if payload.status == "Resolved" and not existing.get("resolved_at"):
            updates["resolved_at"] = now_iso
    if payload.priority:
        if payload.priority not in TICKET_PRIORITIES:
            raise HTTPException(400, detail=f"priority must be one of {TICKET_PRIORITIES}")
        updates["priority"] = payload.priority
    if payload.owner_user_id is not None:
        updates["owner_user_id"] = payload.owner_user_id
    if payload.reply:
        push_items.append({"at": now_iso, "author": user.get("email"), "text": payload.reply, "kind": "reply"})
        if not existing.get("first_response_at"):
            updates["first_response_at"] = now_iso
    if not updates and not push_items:
        raise HTTPException(400, detail="Nothing to update")
    mongo_update: dict = {}
    if updates:
        mongo_update["$set"] = updates
    if push_items:
        mongo_update["$push"] = {"thread": {"$each": push_items}}
    r = await db.support_tickets.find_one_and_update(
        {"ticket_id": ticket_id},
        mongo_update,
        projection={"_id": 0},
        return_document=True,
    )
    await _log_audit(db, user, "ticket.update", ticket_id, after=updates, request=request)
    return deserialize_datetime(r)


# ==================== 8. USAGE ANALYTICS (Phase 14B) ====================

@router.get("/usage-analytics")
async def usage_analytics(
    days: int = 30,
    user=Depends(require_permission("usage:read")),
    db=Depends(get_db),
):
    """Per-tenant DAU/MAU/retention proxy + churn-risk score."""
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(days=max(days, 7))).isoformat()
    month_start = (now - timedelta(days=30)).isoformat()
    day_start = (now - timedelta(days=1)).isoformat()

    clinics = await db.clinics.find({}, {"_id": 0, "clinic_id": 1, "name": 1, "subscription_tier": 1, "created_at": 1}).to_list(1000)

    rows = []
    for c in clinics:
        cid = c["clinic_id"]
        # DAU/MAU proxy via tokens.issued_at timestamps (tokens are issued on every clinic workflow)
        dau = await db.tokens.count_documents({"clinic_id": cid, "issued_at": {"$gte": day_start}})
        mau = await db.tokens.count_documents({"clinic_id": cid, "issued_at": {"$gte": month_start}})
        active_users_month = len(await db.tokens.distinct("issued_by_user_id", {"clinic_id": cid, "issued_at": {"$gte": month_start}}))
        patients_added = await db.patients.count_documents({"clinic_id": cid, "created_at": {"$gte": window_start}})
        reports_generated = await db.test_sessions.count_documents({"clinic_id": cid, "test_date": {"$gte": window_start}})
        invoices_created = await db.invoices.count_documents({"clinic_id": cid, "created_at": {"$gte": window_start}})
        # Days since last activity
        last_tok = await db.tokens.find_one({"clinic_id": cid}, {"_id": 0, "issued_at": 1}, sort=[("issued_at", -1)])
        inactive_days = None
        if last_tok and last_tok.get("issued_at"):
            try:
                inactive_days = (now - datetime.fromisoformat(last_tok["issued_at"].replace("Z", "+00:00"))).days
            except Exception:
                inactive_days = None

        # Churn-risk heuristic:
        #   low:   mau ≥ 20 AND inactive_days ≤ 3
        #   high:  inactive_days ≥ 14 OR mau == 0
        #   medium: otherwise
        risk = "medium"
        if mau == 0 or (inactive_days is not None and inactive_days >= 14):
            risk = "high"
        elif mau >= 20 and (inactive_days is None or inactive_days <= 3):
            risk = "low"

        # Feature adoption: how many distinct modules the tenant actually *touched*
        modules_touched = 0
        for coll, field in [("patients", "patient_id"), ("test_sessions", "session_id"),
                            ("ha_sales", "sale_no"), ("service_tickets", "ticket_no"),
                            ("ha_amc_contracts", "contract_no"), ("referral_partners", "partner_id")]:
            if await db[coll].count_documents({"clinic_id": cid}, limit=1):
                modules_touched += 1

        rows.append({
            "clinic_id": cid,
            "name": c.get("name"),
            "tier": c.get("subscription_tier", "BASIC"),
            "dau": dau,
            "mau": mau,
            "active_users_month": active_users_month,
            "patients_added": patients_added,
            "reports_generated": reports_generated,
            "invoices_created": invoices_created,
            "inactive_days": inactive_days,
            "feature_adoption": modules_touched,
            "churn_risk": risk,
        })

    # Aggregate totals
    totals = {
        "total_tenants": len(rows),
        "high_risk": sum(1 for r in rows if r["churn_risk"] == "high"),
        "medium_risk": sum(1 for r in rows if r["churn_risk"] == "medium"),
        "low_risk": sum(1 for r in rows if r["churn_risk"] == "low"),
        "platform_dau": sum(r["dau"] for r in rows),
        "platform_mau": sum(r["mau"] for r in rows),
    }
    rows.sort(key=lambda r: (-{"high": 2, "medium": 1, "low": 0}[r["churn_risk"]], -(r["inactive_days"] or 0)))
    return {"window_days": days, "totals": totals, "rows": rows}


# ==================== 9. SYSTEM HEALTH (Phase 14B) ====================

_APP_START_TS = time.time()


@router.get("/system/health")
async def system_health(
    user=Depends(require_permission("system:read")),
    db=Depends(get_db),
):
    uptime_s = int(time.time() - _APP_START_TS)
    uptime_h = round(uptime_s / 3600, 1)

    # DB ping
    db_ok = False
    db_latency_ms = None
    try:
        t0 = time.time()
        await db.command("ping")
        db_latency_ms = int((time.time() - t0) * 1000)
        db_ok = True
    except Exception:
        db_ok = False

    # Last completed backup (mock: use latest closeout doc as a proxy)
    last_backup = await db.closeouts.find_one({}, {"_id": 0, "closed_at": 1, "clinic_id": 1}, sort=[("closed_at", -1)])

    # Queue backlog (proxy: count of service_tickets in non-terminal states)
    queue_backlog = await db.service_tickets.count_documents({"status": {"$in": ["awaiting_triage", "in_service", "awaiting_parts"]}})

    # Email / SMS / WhatsApp health — read from health collection if set, else mocked as healthy
    gateway = await db.platform_gateway_health.find_one({"_id": "latest"}, {"_id": 0}) or {}

    # Recent incidents
    incidents = await db.platform_incidents.find({}, {"_id": 0}).sort("started_at", -1).limit(20).to_list(20)

    return {
        "api": {
            "status": "healthy",
            "uptime_seconds": uptime_s,
            "uptime_hours": uptime_h,
            "started_at": datetime.fromtimestamp(_APP_START_TS, tz=timezone.utc).isoformat(),
        },
        "database": {
            "status": "healthy" if db_ok else "down",
            "latency_ms": db_latency_ms,
        },
        "email_gateway": {
            "status": gateway.get("email_status", "mocked"),
            "last_delivery": gateway.get("email_last_delivery"),
            "success_rate_7d": gateway.get("email_success_rate_7d", 100),
        },
        "sms_gateway": {
            "status": gateway.get("sms_status", "mocked"),
            "success_rate_7d": gateway.get("sms_success_rate_7d", 100),
        },
        "whatsapp_gateway": {
            "status": gateway.get("whatsapp_status", "mocked"),
            "success_rate_7d": gateway.get("whatsapp_success_rate_7d", 100),
        },
        "queue_backlog": queue_backlog,
        "last_backup": last_backup,
        "incidents": [deserialize_datetime(i) for i in incidents],
    }


class IncidentCreate(BaseModel):
    title: str
    severity: Literal["info", "minor", "major", "critical"] = "minor"
    summary: str = ""


@router.post("/system/incidents")
async def log_incident(
    payload: IncidentCreate, request: Request,
    user=Depends(require_permission("system:read")),
    db=Depends(get_db),
):
    doc = {
        "incident_id": f"INC-{uuid.uuid4().hex[:8].upper()}",
        "title": payload.title,
        "severity": payload.severity,
        "summary": payload.summary,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "resolved_at": None,
        "logged_by": user["user_id"],
    }
    await db.platform_incidents.insert_one(doc.copy())
    await _log_audit(db, user, "incident.log", doc["incident_id"], after=doc, request=request)
    doc.pop("_id", None)
    return doc


@router.post("/system/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str, request: Request,
    user=Depends(require_permission("system:read")),
    db=Depends(get_db),
):
    r = await db.platform_incidents.find_one_and_update(
        {"incident_id": incident_id, "resolved_at": None},
        {"$set": {"resolved_at": datetime.now(timezone.utc).isoformat(), "resolved_by": user["user_id"]}},
        projection={"_id": 0},
        return_document=True,
    )
    if not r:
        raise HTTPException(404, detail="Open incident not found")
    await _log_audit(db, user, "incident.resolve", incident_id, request=request)
    return deserialize_datetime(r)


# ==================== 10. MARKETING CRM (Phase 14B) ====================

class CampaignCreate(BaseModel):
    name: str = Field(min_length=2)
    source: str                       # "google-ads", "instagram", "partner", "linkedin", etc.
    channel: Optional[str] = None     # "paid", "organic", "referral"
    budget: float = 0.0
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    notes: Optional[str] = None


@router.get("/marketing/campaigns")
async def list_campaigns(
    user=Depends(require_permission("marketing:read")),
    db=Depends(get_db),
):
    rows = await db.marketing_campaigns.find({}, {"_id": 0}).sort("started_at", -1).to_list(200)
    # Enrich each campaign with leads generated (match waitlist_signups.source = campaign.source)
    enriched = []
    for c in rows:
        leads_n = await db.waitlist_signups.count_documents({"source": {"$regex": f"^{c['source']}$", "$options": "i"}})
        converted_n = await db.waitlist_signups.count_documents({"source": {"$regex": f"^{c['source']}$", "$options": "i"}, "stage": "Converted"})
        cac = round(c["budget"] / converted_n, 2) if converted_n else None
        enriched.append({
            **deserialize_datetime(c),
            "leads_generated": leads_n,
            "converted": converted_n,
            "conversion_pct": round(100 * converted_n / max(leads_n, 1), 1),
            "cac": cac,
        })
    # Totals
    total_budget = sum(r["budget"] for r in rows)
    total_leads = sum(r["leads_generated"] for r in enriched)
    total_converted = sum(r["converted"] for r in enriched)

    # Partner referrals roll-up
    partner_converted = await db.waitlist_signups.count_documents({"source": {"$regex": "partner", "$options": "i"}, "stage": "Converted"})
    webinar_registrations = await db.waitlist_signups.count_documents({"source": {"$regex": "webinar", "$options": "i"}})

    return {
        "campaigns": enriched,
        "totals": {
            "total_budget": round(total_budget, 2),
            "total_leads": total_leads,
            "total_converted": total_converted,
            "overall_conversion_pct": round(100 * total_converted / max(total_leads, 1), 1),
            "blended_cac": round(total_budget / total_converted, 2) if total_converted else None,
            "partner_referrals_converted": partner_converted,
            "webinar_registrations": webinar_registrations,
        },
    }


@router.post("/marketing/campaigns")
async def create_campaign(
    payload: CampaignCreate, request: Request,
    user=Depends(require_permission("marketing:write")),
    db=Depends(get_db),
):
    doc = {
        "campaign_id": f"CAM-{uuid.uuid4().hex[:8].upper()}",
        **payload.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["user_id"],
    }
    await db.marketing_campaigns.insert_one(doc.copy())
    await _log_audit(db, user, "campaign.create", doc["campaign_id"], after=doc, request=request)
    doc.pop("_id", None)
    return doc


# ==================== 11. NOTIFICATIONS CENTER (Phase 14C) ====================

class NotificationSend(BaseModel):
    title: str = Field(min_length=2)
    body: str = Field(min_length=1)
    audience: Literal["all", "tier", "tenant"] = "all"
    audience_filter: Optional[str] = None   # tier name or clinic_id
    channels: List[Literal["in-app", "email", "sms", "whatsapp"]] = ["in-app"]
    priority: Literal["info", "important", "critical"] = "info"


@router.post("/notifications/send")
async def send_notification(
    payload: NotificationSend, request: Request,
    user=Depends(require_permission("notifications:write")),
    db=Depends(get_db),
):
    """Writes a broadcast doc. The `in-app` channel is the only one actually
    delivered today (poll via GET /notifications/feed). email/sms/whatsapp
    flags are recorded for downstream worker (MOCKED).
    """
    # Resolve target clinics
    q: dict = {}
    if payload.audience == "tier":
        q["subscription_tier"] = (payload.audience_filter or "").upper()
    elif payload.audience == "tenant":
        q["clinic_id"] = payload.audience_filter
    clinic_ids = [c["clinic_id"] async for c in db.clinics.find(q, {"_id": 0, "clinic_id": 1})]
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "notification_id": f"NOT-{uuid.uuid4().hex[:8].upper()}",
        "title": payload.title,
        "body": payload.body,
        "audience": payload.audience,
        "audience_filter": payload.audience_filter,
        "channels": payload.channels,
        "priority": payload.priority,
        "target_clinic_ids": clinic_ids,
        "target_count": len(clinic_ids),
        "delivered_in_app": "in-app" in payload.channels,
        "sent_by": user["user_id"],
        "sent_at": now_iso,
    }
    await db.platform_notifications.insert_one(doc.copy())
    await _log_audit(db, user, "notification.send", doc["notification_id"], after={"audience": payload.audience, "targets": len(clinic_ids)}, request=request)
    doc.pop("_id", None)
    return doc


@router.get("/notifications")
async def list_notifications(
    user=Depends(require_permission("notifications:read")),
    db=Depends(get_db),
):
    rows = await db.platform_notifications.find({}, {"_id": 0}).sort("sent_at", -1).limit(100).to_list(100)
    return [deserialize_datetime(r) for r in rows]


@router.get("/notifications/feed")
async def feed_for_current_clinic(user=Depends(get_current_user), db=Depends(get_db)):
    """In-app feed endpoint for any authenticated user."""
    rows = await db.platform_notifications.find({
        "$or": [
            {"target_clinic_ids": user["clinic_id"]},
            {"audience": "all"},
        ],
    }, {"_id": 0}).sort("sent_at", -1).limit(20).to_list(20)
    return [deserialize_datetime(r) for r in rows]


# ==================== 12. AUDIT LOG VIEWER (Phase 14C) ====================

@router.get("/audit")
async def audit_logs_filtered(
    actor: Optional[str] = None,
    action: Optional[str] = None,
    target: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = 500,
    user=Depends(require_permission("audit:read")),
    db=Depends(get_db),
):
    q: dict = {}
    if actor:
        q["actor_email"] = {"$regex": actor, "$options": "i"}
    if action:
        q["action"] = {"$regex": action, "$options": "i"}
    if target:
        q["target"] = {"$regex": target, "$options": "i"}
    if since:
        q["at"] = {"$gte": since}
    rows = await db.admin_audit_logs.find(q, {"_id": 0}).sort("at", -1).to_list(limit)
    # Stats
    action_counts: dict[str, int] = {}
    actor_counts: dict[str, int] = {}
    for r in rows:
        action_counts[r["action"]] = action_counts.get(r["action"], 0) + 1
        actor_counts[r.get("actor_email", "?")] = actor_counts.get(r.get("actor_email", "?"), 0) + 1
    return {
        "count": len(rows),
        "rows": [deserialize_datetime(r) for r in rows],
        "by_action": [{"action": k, "count": v} for k, v in sorted(action_counts.items(), key=lambda kv: -kv[1])[:20]],
        "by_actor": [{"actor": k, "count": v} for k, v in sorted(actor_counts.items(), key=lambda kv: -kv[1])[:20]],
    }


# ==================== 13. SETTINGS (Phase 14C) ====================

PLATFORM_SETTINGS_ID = "platform-settings-v1"

_DEFAULT_SETTINGS = {
    "brand_logo_url": None,
    "brand_name": "AUDINEXA",
    "support_email": "support@audinexa.com",
    "currency": "INR",
    "timezone": "Asia/Kolkata",
    "trial_duration_days": 30,
    "tax_rate_pct": 18.0,
    "tax_label": "GST",
    "email_templates": {
        "welcome": "Welcome to AUDINEXA!",
        "trial_ending": "Your trial ends in {days} days.",
        "payment_failed": "Your recent payment failed. Please update your payment method.",
    },
    "default_onboarding_checklist": [
        "Add first branch",
        "Invite 1 audiologist",
        "Configure service catalogue",
        "Register 5 patients",
        "Generate first diagnostic report",
    ],
}


class SettingsUpdate(BaseModel):
    brand_logo_url: Optional[str] = None
    brand_name: Optional[str] = None
    support_email: Optional[EmailStr] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    trial_duration_days: Optional[int] = Field(default=None, ge=0, le=365)
    tax_rate_pct: Optional[float] = None
    tax_label: Optional[str] = None
    email_templates: Optional[dict] = None
    default_onboarding_checklist: Optional[List[str]] = None


@router.get("/settings")
async def get_settings(
    user=Depends(require_permission("dashboard:read")),
    db=Depends(get_db),
):
    doc = await db.platform_settings.find_one({"_id": PLATFORM_SETTINGS_ID})
    if not doc:
        return _DEFAULT_SETTINGS
    doc.pop("_id", None)
    # Merge with defaults so newly added keys always present
    merged = {**_DEFAULT_SETTINGS, **doc}
    return merged


@router.put("/settings")
async def update_settings(
    payload: SettingsUpdate, request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    # founder + super_admin only (settings writes are sensitive)
    if user["role"] not in {"founder", "super_admin"}:
        raise HTTPException(403, detail="Only founder/super_admin can update settings")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = user["user_id"]
    await db.platform_settings.update_one(
        {"_id": PLATFORM_SETTINGS_ID},
        {"$set": updates},
        upsert=True,
    )
    await _log_audit(db, user, "settings.update", PLATFORM_SETTINGS_ID, after=updates, request=request)
    doc = await db.platform_settings.find_one({"_id": PLATFORM_SETTINGS_ID})
    doc.pop("_id", None)
    return {**_DEFAULT_SETTINGS, **doc}


# ==================== INTERNAL USERS (Phase 14C) ====================

class InternalUserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=8)
    role: str
    two_fa_enabled: bool = False


@router.get("/internal-users")
async def list_internal_users(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    if user["role"] not in {"founder", "super_admin"}:
        raise HTTPException(403, detail="Not permitted")
    platform_id = "audinexa-platform"
    rows = await db.users.find(
        {"clinic_id": platform_id},
        {"_id": 0, "password_hash": 0},
    ).to_list(200)
    return [deserialize_datetime(r) for r in rows]


@router.post("/internal-users")
async def invite_internal_user(
    payload: InternalUserCreate, request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    if user["role"] not in {"founder", "super_admin"}:
        raise HTTPException(403, detail="Not permitted")
    if payload.role not in ROLE_PERMISSIONS:
        raise HTTPException(400, detail=f"Unknown role. Valid: {list(ROLE_PERMISSIONS.keys())}")
    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(409, detail="Email already registered")
    from auth import hash_password as _hp  # avoid circular
    doc = {
        "user_id": f"USR-{uuid.uuid4().hex[:8].upper()}",
        "clinic_id": "audinexa-platform",
        "email": payload.email.lower(),
        "name": payload.name,
        "role": payload.role,
        "active": True,
        "two_fa_enabled": payload.two_fa_enabled,
        "password_hash": _hp(payload.password),
        "branch_ids": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["user_id"],
    }
    await db.users.insert_one(doc.copy())
    await _log_audit(db, user, "internal_user.invite", payload.email.lower(), after={"role": payload.role}, request=request)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


@router.patch("/internal-users/{user_id}")
async def update_internal_user(
    user_id: str,
    active: Optional[bool] = None,
    role: Optional[str] = None,
    request: Request = None,
    caller=Depends(get_current_user),
    db=Depends(get_db),
):
    if caller["role"] not in {"founder", "super_admin"}:
        raise HTTPException(403, detail="Not permitted")
    updates: dict = {}
    if active is not None:
        updates["active"] = active
    if role is not None:
        if role not in ROLE_PERMISSIONS:
            raise HTTPException(400, detail=f"Unknown role: {role}")
        updates["role"] = role
    if not updates:
        raise HTTPException(400, detail="Nothing to update")
    r = await db.users.find_one_and_update(
        {"user_id": user_id, "clinic_id": "audinexa-platform"},
        {"$set": updates},
        projection={"_id": 0, "password_hash": 0},
        return_document=True,
    )
    if not r:
        raise HTTPException(404, detail="Internal user not found")
    await _log_audit(db, caller, "internal_user.update", user_id, after=updates, request=request)
    return deserialize_datetime(r)
