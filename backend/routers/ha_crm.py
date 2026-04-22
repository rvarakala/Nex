"""HA CRM — Phase 6: FollowUps + Subscriptions + Upgrade candidates.

Core primitives:
  * `ha_followups` — append-only task queue driven by the daily scheduler.
  * `ha_subscriptions` — per-patient consumable re-order cadence.
  * Upgrade candidates — derived (no collection); HA sales > 3y old OR 3+ service tickets.

Daily scheduler entry point: `run_daily_followup_scan(db)` — called from the
APScheduler job wired up in server.py lifespan at 09:30 IST.

Roles:
  - read: all authenticated clinic users
  - dismiss / mark-sent / done: front_desk + audiologist + clinic_owner + super_admin
  - create subscription / update subscription: front_desk + audiologist + clinic_owner + super_admin
  - generate (force-run the scan): clinic_owner + super_admin
"""
from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import (
    FollowUp, FollowUpKind, FollowUpStatus, SentChannel,
    Subscription, SubscriptionCreate, SubscriptionUpdate, SubscriptionDeliver,
)
from utils.followup_rules import (
    fitting_due_dates, trial_due_dates,
    templ_fitting, templ_trial, templ_consumable, templ_upgrade,
)
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api/ha")


WRITE_ROLES = ("front_desk", "audiologist", "clinic_owner", "super_admin")
GENERATE_ROLES = ("clinic_owner", "super_admin")


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


def _today_ymd() -> str:
    return date.today().isoformat()


# ==================== SUBSCRIPTIONS ====================

@router.get("/subscriptions", response_model=List[Subscription])
async def list_subscriptions(
    patient_id: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if patient_id:
        q["patient_id"] = patient_id
    if status:
        q["status"] = status
    rows = await db.ha_subscriptions.find(q, {"_id": 0}).sort("next_due_date", 1).to_list(200)
    return [deserialize_datetime(r) for r in rows]


@router.post("/subscriptions", response_model=Subscription, status_code=201)
async def create_subscription(
    payload: SubscriptionCreate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    if not user_can_see_branch(user, payload.branch_id):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if payload.cadence_days <= 0:
        raise HTTPException(status_code=400, detail="cadence_days must be > 0")

    patient = await db.patients.find_one(
        {"clinic_id": user["clinic_id"], "patient_id": payload.patient_id},
        {"_id": 0, "name": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    next_due = payload.next_due_date or (date.today() + timedelta(days=payload.cadence_days)).isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()

    sub = Subscription(
        clinic_id=user["clinic_id"],
        branch_id=payload.branch_id,
        patient_id=payload.patient_id,
        patient_name=patient.get("name"),
        kind=payload.kind,
        item_label=payload.item_label,
        cadence_days=payload.cadence_days,
        next_due_date=next_due,
        notes=payload.notes,
        created_by_user_id=user["user_id"],
        updated_at=now_iso,
    )
    await db.ha_subscriptions.insert_one(serialize_datetime(sub.model_dump()))
    return deserialize_datetime(sub.model_dump())


@router.put("/subscriptions/{subscription_id}", response_model=Subscription)
async def update_subscription(
    subscription_id: str, payload: SubscriptionUpdate,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await db.ha_subscriptions.find_one(
        {"clinic_id": user["clinic_id"], "subscription_id": subscription_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")

    upd: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for k in ("status", "cadence_days", "next_due_date", "notes"):
        v = getattr(payload, k)
        if v is not None:
            upd[k] = v
    if upd.get("cadence_days") is not None and upd["cadence_days"] <= 0:
        raise HTTPException(status_code=400, detail="cadence_days must be > 0")

    await db.ha_subscriptions.update_one(
        {"clinic_id": user["clinic_id"], "subscription_id": subscription_id},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


@router.post("/subscriptions/{subscription_id}/deliver", response_model=Subscription)
async def deliver_subscription(
    subscription_id: str, payload: SubscriptionDeliver,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await db.ha_subscriptions.find_one(
        {"clinic_id": user["clinic_id"], "subscription_id": subscription_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if row["status"] != "active":
        raise HTTPException(status_code=409, detail=f"Cannot deliver a {row['status']} subscription")

    delivered = payload.delivered_on or _today_ymd()
    try:
        next_due = (date.fromisoformat(delivered) + timedelta(days=int(row["cadence_days"]))).isoformat()
    except Exception:
        raise HTTPException(status_code=400, detail="delivered_on must be YYYY-MM-DD")

    now_iso = datetime.now(timezone.utc).isoformat()
    upd = {
        "last_delivered_at": delivered,
        "next_due_date": next_due,
        "updated_at": now_iso,
    }
    if payload.note:
        upd["notes"] = ((row.get("notes") or "") + f"\n[del {delivered}] {payload.note}").strip()
    await db.ha_subscriptions.update_one(
        {"clinic_id": user["clinic_id"], "subscription_id": subscription_id},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


# ==================== FOLLOWUPS ====================

@router.get("/followups", response_model=List[FollowUp])
async def list_followups(
    status: Optional[str] = None,
    kind: Optional[str] = None,
    patient_id: Optional[str] = None,
    due_by: Optional[str] = None,
    bucket: Optional[str] = Query(None, description="One of: overdue | today | upcoming | done"),
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
    if due_by:
        q["due_date"] = {"$lte": due_by}

    today = _today_ymd()
    if bucket == "overdue":
        q["status"] = "pending"
        q["due_date"] = {"$lt": today}
    elif bucket == "today":
        q["status"] = "pending"
        q["due_date"] = today
    elif bucket == "upcoming":
        q["status"] = "pending"
        q["due_date"] = {"$gt": today}
    elif bucket == "done":
        q["status"] = {"$in": ["done", "dismissed"]}

    sort = [("due_date", 1)] if bucket != "done" else [("closed_at", -1)]
    rows = await db.ha_followups.find(q, {"_id": 0}).sort(sort).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.get("/followups-kpis")
async def followups_kpis(user=Depends(get_current_user), db=Depends(get_db)):
    base = _branch_scope(user)
    today = _today_ymd()

    overdue = await db.ha_followups.count_documents({
        **base, "status": "pending", "due_date": {"$lt": today},
    })
    due_today = await db.ha_followups.count_documents({
        **base, "status": "pending", "due_date": today,
    })
    upcoming = await db.ha_followups.count_documents({
        **base, "status": "pending", "due_date": {"$gt": today},
    })
    sent_today = await db.ha_followups.count_documents({
        **base, "sent_channels.sent_at": {"$regex": f"^{today}"},
    })
    done_today = await db.ha_followups.count_documents({
        **base, "status": "done", "closed_at": {"$regex": f"^{today}"},
    })

    return {
        "overdue": overdue,
        "due_today": due_today,
        "upcoming": upcoming,
        "sent_today": sent_today,
        "done_today": done_today,
    }


@router.post("/followups/{followup_id}/mark-sent", response_model=FollowUp)
async def mark_sent(
    followup_id: str, payload: dict,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    """Log that the user hit 'Send on WhatsApp'. Flips status pending → sent, appends audit row."""
    row = await db.ha_followups.find_one(
        {"clinic_id": user["clinic_id"], "followup_id": followup_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="FollowUp not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if row["status"] in {"done", "dismissed"}:
        raise HTTPException(status_code=409, detail=f"Cannot mark-sent a {row['status']} follow-up")

    now_iso = datetime.now(timezone.utc).isoformat()
    channel = (payload or {}).get("channel") or "whatsapp"
    sent = SentChannel(channel=channel, sent_at=now_iso, actor_user_id=user["user_id"])

    await db.ha_followups.update_one(
        {"clinic_id": user["clinic_id"], "followup_id": followup_id},
        {
            "$push": {"sent_channels": serialize_datetime(sent.model_dump())},
            "$set": {"status": "sent"},
        },
    )
    row["sent_channels"] = (row.get("sent_channels") or []) + [sent.model_dump()]
    row["status"] = "sent"
    return deserialize_datetime(row)


@router.post("/followups/{followup_id}/done", response_model=FollowUp)
async def mark_done(
    followup_id: str, payload: Optional[dict] = None,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await db.ha_followups.find_one(
        {"clinic_id": user["clinic_id"], "followup_id": followup_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="FollowUp not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if row["status"] in {"done", "dismissed"}:
        raise HTTPException(status_code=409, detail=f"Follow-up already {row['status']}")

    now_iso = datetime.now(timezone.utc).isoformat()
    upd = {"status": "done", "closed_at": now_iso}
    note = (payload or {}).get("notes")
    if note:
        upd["notes"] = ((row.get("notes") or "") + f"\n[done {now_iso[:10]}] {note}").strip()

    await db.ha_followups.update_one(
        {"clinic_id": user["clinic_id"], "followup_id": followup_id},
        {"$set": upd},
    )
    return deserialize_datetime({**row, **upd})


@router.post("/followups/{followup_id}/dismiss", response_model=FollowUp)
async def dismiss(
    followup_id: str,
    user=Depends(require_roles(*WRITE_ROLES)),
    db=Depends(get_db),
):
    row = await db.ha_followups.find_one(
        {"clinic_id": user["clinic_id"], "followup_id": followup_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="FollowUp not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if row["status"] in {"done", "dismissed"}:
        raise HTTPException(status_code=409, detail=f"Follow-up already {row['status']}")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.ha_followups.update_one(
        {"clinic_id": user["clinic_id"], "followup_id": followup_id},
        {"$set": {"status": "dismissed", "closed_at": now_iso}},
    )
    row["status"] = "dismissed"; row["closed_at"] = now_iso
    return deserialize_datetime(row)


@router.post("/followups/generate")
async def manual_generate(
    user=Depends(require_roles(*GENERATE_ROLES)),
    db=Depends(get_db),
):
    """Force-run the daily scan for this user's clinic. Useful for testing + manual refresh."""
    created = await run_scan_for_clinic(db, user["clinic_id"])
    return {"clinic_id": user["clinic_id"], "created": created}


# ==================== UPGRADE CANDIDATES ====================

@router.get("/upgrade-candidates")
async def upgrade_candidates(
    years_min: int = 3,
    repair_min: int = 3,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Flag HA sales that are (a) older than `years_min` years, OR (b) have
    had `repair_min`+ service tickets. Returns a denormalised list ready to
    render in the owner dashboard."""
    base = _branch_scope(user)
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=years_min * 365)).isoformat()

    aged = await db.ha_sales.find(
        {**base, "status": {"$in": ["paid", "invoiced"]}, "created_at": {"$lt": cutoff_iso}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(200)

    # Candidates by repeated repair — scan service_tickets (may be empty pre-Phase 6 svc).
    candidates = []
    for s in aged:
        age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))).days
        candidates.append({
            "patient_id": s["patient_id"],
            "patient_name": s.get("patient_name"),
            "sale_no": s["sale_no"],
            "age_years": round(age_days / 365, 1),
            "trigger": "age",
            "total": s.get("total"),
        })

    # Add repair-based triggers (only if service_tickets collection has rows)
    try:
        async for st in db.service_tickets.aggregate([
            {"$match": base},
            {"$group": {"_id": {"pid": "$patient_id", "sid": "$serial_id"}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gte": repair_min}}},
        ]):
            candidates.append({
                "patient_id": st["_id"]["pid"],
                "serial_id": st["_id"]["sid"],
                "repair_count": st["n"],
                "trigger": "repeated_repair",
            })
    except Exception:
        pass

    return {"count": len(candidates), "candidates": candidates}


# ==================== DAILY SCAN (scheduler entry point) ====================

async def _followup_exists(db, clinic_id: str, patient_id: str, kind: str, ref_id: Optional[str]) -> bool:
    return await db.ha_followups.find_one(
        {"clinic_id": clinic_id, "patient_id": patient_id, "kind": kind, "ref_id": ref_id},
        {"_id": 1},
    ) is not None


async def _mk_followup(db, *, clinic_id, branch_id, patient, kind, due_date, title, message,
                       ref_kind=None, ref_id=None) -> bool:
    """Insert a followup if one doesn't already exist for (clinic, patient, kind, ref_id)."""
    if await _followup_exists(db, clinic_id, patient["patient_id"], kind, ref_id):
        return False
    doc = FollowUp(
        clinic_id=clinic_id,
        branch_id=branch_id,
        patient_id=patient["patient_id"],
        patient_name=patient.get("name"),
        patient_mobile=patient.get("mobile"),
        kind=kind,
        due_date=due_date,
        status="pending",
        ref_kind=ref_kind,
        ref_id=ref_id,
        title=title,
        message_template=message,
    )
    await db.ha_followups.insert_one(serialize_datetime(doc.model_dump()))
    return True


async def run_scan_for_clinic(db, clinic_id: str) -> int:
    """For a single clinic, idempotently generate any missing follow-up rows.
    Returns the number of new rows inserted."""
    clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0})
    if not clinic:
        return 0
    clinic_name = clinic.get("name") or "the clinic"
    clinic_phone = clinic.get("phone") or ""

    created = 0

    # Patient lookup helper — avoid N+1 by bulk-caching
    patient_cache: dict = {}

    async def _patient(pid: str) -> Optional[dict]:
        if pid in patient_cache:
            return patient_cache[pid]
        p = await db.patients.find_one(
            {"clinic_id": clinic_id, "patient_id": pid},
            {"_id": 0, "patient_id": 1, "name": 1, "mobile": 1},
        )
        patient_cache[pid] = p
        return p

    # ---------- 1. FITTINGS (1w / 1mo / 3mo / annual / NPS @30d) ----------
    async for f in db.ha_fittings.find({"clinic_id": clinic_id}, {"_id": 0}):
        if not f.get("first_fit_at"):
            continue
        try:
            d = date.fromisoformat(f["first_fit_at"][:10])
        except Exception:
            continue
        p = await _patient(f["patient_id"])
        if not p:
            continue
        for (kind, due_date, title) in fitting_due_dates(d):
            msg = templ_fitting(kind, p.get("name") or "", clinic_name, clinic_phone)
            if await _mk_followup(
                db, clinic_id=clinic_id, branch_id=f["branch_id"],
                patient=p, kind=kind, due_date=due_date, title=title,
                message=msg, ref_kind="fitting", ref_id=f["fitting_id"],
            ):
                created += 1

    # ---------- 2. TRIALS (day 3 / day 7 / overdue) ----------
    today = _today_ymd()
    async for t in db.ha_trials.find({"clinic_id": clinic_id}, {"_id": 0}):
        p = await _patient(t["patient_id"])
        if not p:
            continue
        # Day 3 / Day 7 — only for active/extended trials
        if t["status"] in {"active", "extended"} and t.get("start_date"):
            try:
                s = date.fromisoformat(t["start_date"])
                for (kind, due_date, title) in trial_due_dates(s):
                    msg = templ_trial(kind, p.get("name") or "", clinic_name, clinic_phone, t.get("return_date", ""))
                    if await _mk_followup(
                        db, clinic_id=clinic_id, branch_id=t["branch_id"],
                        patient=p, kind=kind, due_date=due_date, title=title,
                        message=msg, ref_kind="trial", ref_id=t["trial_no"],
                    ):
                        created += 1
            except Exception:
                pass
        # Overdue — trial not returned and today > return_date
        if t["status"] in {"active", "extended"} and t.get("return_date") and t["return_date"] < today:
            msg = templ_trial("trial_overdue", p.get("name") or "", clinic_name, clinic_phone, t["return_date"])
            if await _mk_followup(
                db, clinic_id=clinic_id, branch_id=t["branch_id"],
                patient=p, kind="trial_overdue", due_date=today,
                title=f"Trial {t['trial_no']} overdue since {t['return_date']}",
                message=msg, ref_kind="trial", ref_id=t["trial_no"],
            ):
                created += 1

    # ---------- 3. CONSUMABLE SUBSCRIPTIONS ----------
    async for sub in db.ha_subscriptions.find(
        {"clinic_id": clinic_id, "status": "active"}, {"_id": 0},
    ):
        if not sub.get("next_due_date") or sub["next_due_date"] > today:
            continue
        p = await _patient(sub["patient_id"])
        if not p:
            continue
        # Only one open consumable followup per subscription at a time.
        existing = await db.ha_followups.find_one({
            "clinic_id": clinic_id, "patient_id": sub["patient_id"],
            "kind": "consumable", "ref_id": sub["subscription_id"],
            "status": {"$in": ["pending", "sent"]},
        }, {"_id": 1})
        if existing:
            continue
        msg = templ_consumable(sub["item_label"], p.get("name") or "", clinic_name, clinic_phone)
        doc = FollowUp(
            clinic_id=clinic_id, branch_id=sub["branch_id"],
            patient_id=p["patient_id"], patient_name=p.get("name"), patient_mobile=p.get("mobile"),
            kind="consumable", due_date=sub["next_due_date"],
            title=f"Consumable due: {sub['item_label']}",
            message_template=msg, ref_kind="subscription", ref_id=sub["subscription_id"],
        )
        await db.ha_followups.insert_one(serialize_datetime(doc.model_dump()))
        created += 1

    # ---------- 4. UPGRADE CANDIDATES (>=3y old paid/invoiced sales) ----------
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=3 * 365)).isoformat()
    async for s in db.ha_sales.find(
        {"clinic_id": clinic_id, "status": {"$in": ["paid", "invoiced"]},
         "created_at": {"$lt": cutoff_iso}},
        {"_id": 0},
    ):
        p = await _patient(s["patient_id"])
        if not p:
            continue
        try:
            age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))).days
            years = round(age_days / 365, 1)
        except Exception:
            years = 3
        msg = templ_upgrade(p.get("name") or "", int(years), clinic_name, clinic_phone)
        if await _mk_followup(
            db, clinic_id=clinic_id, branch_id=s["branch_id"],
            patient=p, kind="upgrade", due_date=today,
            title=f"Upgrade candidate — {years}-year-old aid",
            message=msg, ref_kind="sale", ref_id=s["sale_no"],
        ):
            created += 1

    return created


async def run_daily_followup_scan(db) -> None:
    """APScheduler entry point — runs at 09:30 IST daily."""
    import logging
    log = logging.getLogger(__name__)
    try:
        async for c in db.clinics.find({}, {"_id": 0, "clinic_id": 1}):
            try:
                n = await run_scan_for_clinic(db, c["clinic_id"])
                if n:
                    log.info(f"FollowUp scan: {n} new rows for {c['clinic_id']}")
            except Exception as e:
                log.error(f"FollowUp scan failed for {c.get('clinic_id')}: {e}")
    except Exception as e:
        log.error(f"FollowUp scan loop error: {e}")
