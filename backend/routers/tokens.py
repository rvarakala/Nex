"""Tokens, public queue TV, and Front Desk Dashboard KPIs."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from auth import get_current_user
from database import get_db
from models import OPDToken
from utils.ist import ist_day_start_utc, ist_today_ymd
from utils.rate_limit import enforce_rate_limit
from utils.serde import serialize_datetime, deserialize_datetime


router = APIRouter(prefix="/api")


async def _next_token_no(db, clinic_id: str) -> int:
    """Daily-resetting token counter per clinic (IST day)."""
    today = ist_today_ymd()
    counter = await db.counters.find_one_and_update(
        {"_id": f"token:{clinic_id}:{today}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return counter["seq"] if counter else 1


@router.post("/tokens")
async def issue_token(payload: dict, user=Depends(get_current_user), db=Depends(get_db)):
    """Issue an OPD token for a patient. Body: {patient_id, service?, priority?}."""
    pid = payload.get("patient_id")
    if not pid:
        raise HTTPException(status_code=400, detail="patient_id required")
    p = await db.patients.find_one({"patient_id": pid, "clinic_id": user["clinic_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    token_no = await _next_token_no(db, user["clinic_id"])
    obj = OPDToken(
        clinic_id=user["clinic_id"],
        token_no=token_no,
        patient_id=pid,
        patient_name=p.get("name", ""),
        patient_mobile=p.get("mobile") or p.get("phone"),
        mrd=p.get("mrd"),
        issued_by_user_id=user["user_id"],
        service=payload.get("service"),
        priority=payload.get("priority", "normal"),
        notes=payload.get("notes"),
    )
    await db.tokens.insert_one(serialize_datetime(obj.model_dump()))
    return obj.model_dump()


@router.get("/tokens")
async def list_tokens(
    status: Optional[str] = None,
    today_only: bool = True,
    limit: int = 200,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q: dict = {"clinic_id": user["clinic_id"]}
    if status:
        q["status"] = status
    if today_only:
        start = ist_day_start_utc()
        q["issued_at"] = {"$gte": start.isoformat()}
    tokens = await db.tokens.find(q, {"_id": 0}).sort("issued_at", -1).to_list(limit)
    return [deserialize_datetime(t) for t in tokens]


@router.put("/tokens/{token_id}/status")
async def update_token_status(token_id: str, payload: dict,
                              user=Depends(get_current_user), db=Depends(get_db)):
    new_status = payload.get("status")
    if new_status not in {"waiting", "in_consultation", "in_testing", "billing", "completed", "cancelled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    update: dict = {"status": new_status}
    if new_status in {"in_consultation", "in_testing"}:
        update["called_at"] = datetime.utcnow().isoformat()
    if new_status in {"completed", "cancelled"}:
        update["completed_at"] = datetime.utcnow().isoformat()
    res = await db.tokens.update_one(
        {"token_id": token_id, "clinic_id": user["clinic_id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Token not found")
    t = await db.tokens.find_one({"token_id": token_id}, {"_id": 0})
    return deserialize_datetime(t)


# ==================== PUBLIC QUEUE TV DISPLAY ====================

@router.get("/queue/public/{clinic_id}")
async def public_queue(clinic_id: str, request: Request, db=Depends(get_db)):
    """UNAUTHENTICATED endpoint for waiting-room TV. Privacy-redacted names.
    Rate-limited per IP (120 req / 60s — covers a TV polling every 5s with 6x headroom)."""
    enforce_rate_limit(request, "queue_public", max_requests=120, window_seconds=60)

    clinic = await db.clinics.find_one({"clinic_id": clinic_id}, {"_id": 0, "name": 1, "city": 1})
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    today_start = ist_day_start_utc()
    tokens = await db.tokens.find(
        {
            "clinic_id": clinic_id,
            "issued_at": {"$gte": today_start.isoformat()},
            "status": {"$in": ["waiting", "in_consultation", "in_testing"]},
        },
        {"_id": 0, "token_no": 1, "patient_name": 1, "service": 1, "status": 1, "called_at": 1, "issued_at": 1},
    ).sort("issued_at", 1).to_list(50)

    def _redact(name: str) -> str:
        if not name:
            return ""
        parts = name.strip().split()
        if len(parts) == 1:
            return parts[0]
        return f"{parts[0]} {parts[-1][0]}."

    for t in tokens:
        t["patient_name"] = _redact(t.get("patient_name", ""))

    now_serving = [t for t in tokens if t.get("status") in {"in_consultation", "in_testing"}]
    next_up = [t for t in tokens if t.get("status") == "waiting"][:10]

    return {
        "clinic": clinic,
        "now_serving": now_serving,
        "next_up": next_up,
        "total_waiting": sum(1 for t in tokens if t.get("status") == "waiting"),
        "fetched_at": datetime.utcnow().isoformat(),
    }


# ==================== FRONT DESK DASHBOARD ====================

@router.get("/dashboard/frontdesk")
async def frontdesk_dashboard(user=Depends(get_current_user), db=Depends(get_db)):
    """KPI cards + live queue for the Front Desk Dashboard."""
    clinic_id = user["clinic_id"]
    today_start = ist_day_start_utc()

    walkins_today = await db.patients.count_documents({
        "clinic_id": clinic_id, "created_at": {"$gte": today_start.isoformat()},
    })
    all_tokens_today = await db.tokens.find(
        {"clinic_id": clinic_id, "issued_at": {"$gte": today_start.isoformat()}},
        {"_id": 0},
    ).to_list(500)

    # Bulk-resolve patients referenced by today's tokens in ONE query
    # (was an N+1 `find_one` per token → 100+ round-trips per dashboard refresh).
    returning_today = 0
    token_pids = list({t.get("patient_id") for t in all_tokens_today if t.get("patient_id")})
    if token_pids:
        patient_created: dict[str, str] = {}
        async for p in db.patients.find(
            {"patient_id": {"$in": token_pids}, "clinic_id": clinic_id},
            {"_id": 0, "patient_id": 1, "created_at": 1},
        ):
            patient_created[p["patient_id"]] = p.get("created_at") or ""
        today_iso = today_start.isoformat()
        for t in all_tokens_today:
            created = patient_created.get(t.get("patient_id"), "")
            if isinstance(created, str) and created and created < today_iso:
                returning_today += 1

    waiting_now = sum(1 for t in all_tokens_today if t.get("status") == "waiting")
    in_progress = sum(1 for t in all_tokens_today if t.get("status") in {"in_consultation", "in_testing"})

    day_key = ist_today_ymd()
    appointments_today = await db.appointments.count_documents({
        "clinic_id": clinic_id,
        "start_at": {"$gte": f"{day_key}T00:00:00", "$lte": f"{day_key}T23:59:59"},
        "status": {"$nin": ["cancelled"]},
    })
    waitlist_active = await db.waitlist.count_documents({"clinic_id": clinic_id, "status": "active"})

    collections_today = 0.0
    try:
        pay_rows = await db.payments.find(
            {"clinic_id": clinic_id, "paid_at": {"$gte": today_start.isoformat()}},
            {"_id": 0, "amount": 1},
        ).to_list(1000)
        collections_today = round(sum(float(r.get("amount", 0)) for r in pay_rows), 2)
    except Exception:
        pass

    try:
        pending_reports = await db.test_sessions.count_documents({
            "clinic_id": clinic_id,
            "report_status": {"$ne": "finalized"},
        })
    except Exception:
        pending_reports = 0

    queue = [t for t in all_tokens_today if t.get("status") in {"waiting", "in_consultation", "in_testing"}]
    queue.sort(key=lambda x: x.get("issued_at", ""))

    return {
        "kpis": {
            "walkins_today": walkins_today,
            "returning_today": returning_today,
            "appointments_today": appointments_today,
            "waitlist_active": waitlist_active,
            "waiting_now": waiting_now,
            "in_progress": in_progress,
            "collections_today": collections_today,
            "pending_reports": pending_reports,
        },
        "queue": [deserialize_datetime(t) for t in queue[:50]],
    }
