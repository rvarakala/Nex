from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from datetime import datetime, timezone
import uuid

# IST helpers — shared module (single source of truth)
from utils.ist import IST, ist_day_start_utc, ist_today_ymd, ist_next_day_start_utc  # noqa: F401

# Models used by remaining in-file routes (auth / clinic)
from models import LoginRequest
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_roles, VALID_ROLES,
)
import billing as billing_module
import closeout as closeout_module
from utils.serde import serialize_datetime  # noqa: F401 — used by _seed_defaults


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection (single source; shared with routers via Depends(get_db))
from database import client, db, get_db  # noqa: E402

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """FastAPI lifespan: replaces deprecated on_event('startup'/'shutdown') handlers.
    Startup: creates MongoDB indexes, seeds default clinic/users/services, cleans stale UTC-keyed token counters.
    Shutdown: closes MongoDB client connection.
    """
    _log = logging.getLogger(__name__)
    try:
        # ---- indexes ----
        await db.patients.create_index("patient_id", unique=True)
        await db.patients.create_index("mobile")
        await db.patients.create_index("updated_at")
        await db.referring_doctors.create_index("doctor_id", unique=True)
        await db.referring_doctors.create_index("name")
        await db.patient_notes.create_index("patient_id")
        await db.patient_notes.create_index("created_at")
        await db.test_sessions.create_index("session_id", unique=True)
        await db.test_sessions.create_index([("patient_id", 1), ("test_date", -1)])
        # M01 indexes
        await db.users.create_index("email", unique=True)
        await db.users.create_index([("clinic_id", 1), ("role", 1)])
        await db.clinics.create_index("clinic_id", unique=True)
        await db.tokens.create_index([("clinic_id", 1), ("issued_at", -1)])
        await db.tokens.create_index("token_id", unique=True)
        await db.patients.create_index([("clinic_id", 1), ("updated_at", -1)])
        await db.patients.create_index("mrd")
        # M01.B appointment indexes
        await db.appointments.create_index("appointment_id", unique=True)
        await db.appointments.create_index([("clinic_id", 1), ("start_at", 1)])
        await db.appointments.create_index([("clinic_id", 1), ("audiologist_id", 1), ("start_at", 1)])
        await db.appointments.create_index([("clinic_id", 1), ("staff_id", 1), ("start_at", 1)])
        await db.appointments.create_index([("clinic_id", 1), ("counterparty_type", 1), ("start_at", 1)])
        await db.waitlist.create_index("entry_id", unique=True)
        await db.waitlist.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.reminder_logs.create_index([("clinic_id", 1), ("sent_at", -1)])
        await db.cancellation_logs.create_index([("clinic_id", 1), ("cancelled_at", -1)])
        # M01.C billing indexes
        await db.services.create_index("service_id", unique=True)
        await db.services.create_index([("clinic_id", 1), ("active", 1), ("name", 1)])
        await db.invoices.create_index("invoice_id", unique=True)
        await db.invoices.create_index([("clinic_id", 1), ("invoice_date", -1)])
        await db.invoices.create_index([("clinic_id", 1), ("patient_id", 1)])
        await db.invoices.create_index("invoice_no")
        await db.payments.create_index("payment_id", unique=True)
        await db.payments.create_index([("clinic_id", 1), ("paid_at", -1)])
        await db.payments.create_index("invoice_id")
        # HA module Phase 1/2 — inventory integrity
        await db.branches.create_index("branch_id", unique=True)
        await db.branches.create_index([("clinic_id", 1), ("is_primary", -1)])
        await db.vendors.create_index("vendor_id", unique=True)
        await db.vendors.create_index([("clinic_id", 1), ("name", 1)])
        await db.ha_products.create_index("product_id", unique=True)
        await db.ha_products.create_index([("clinic_id", 1), ("brand", 1), ("model", 1)])
        await db.serial_items.create_index("serial_id", unique=True)
        # Hard uniqueness — same physical sticker cannot be received twice in a clinic.
        await db.serial_items.create_index(
            [("clinic_id", 1), ("serial_no", 1)], unique=True, name="uniq_clinic_serial_no",
        )
        await db.serial_items.create_index([("clinic_id", 1), ("branch_id", 1), ("state", 1)])
        await db.serial_events.create_index([("serial_id", 1), ("at", -1)])
        await db.purchase_orders.create_index("po_no", unique=True)
        await db.purchase_orders.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        # Numbering identifiers are clinic-scoped — same `GRN-YYYY-NNNN` may legitimately
        # exist in two different tenants. Use a compound (clinic_id, grn_no) unique key
        # and drop the legacy global index if present (safe: only blocks cross-tenant dupes).
        try:
            await db.grns.drop_index("grn_no_1")
        except Exception:
            pass
        await db.grns.create_index([("clinic_id", 1), ("grn_no", 1)], unique=True, name="uniq_clinic_grn_no")
        await db.grns.create_index([("po_no", 1), ("received_at", -1)])
        await db.accessory_stock.create_index("sku_id", unique=True)
        await db.accessory_stock.create_index([("clinic_id", 1), ("branch_id", 1), ("product_id", 1), ("variant", 1)], name="uniq_accessory_variant", unique=True)
        # HA module Phase 3 — transactions
        await db.quotations.create_index("quote_no", unique=True)
        await db.quotations.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.quotations.create_index("patient_id")
        await db.ha_sales.create_index("sale_no", unique=True)
        await db.ha_sales.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.ha_sales.create_index("patient_id")
        # HA module Phase 4 — clinical fittings
        await db.ha_fittings.create_index("fitting_id", unique=True)
        await db.ha_fittings.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.ha_fittings.create_index([("clinic_id", 1), ("patient_id", 1), ("created_at", -1)])
        await db.ha_fittings.create_index("sale_no")
        # HA module Phase 4.5 — trials
        await db.ha_trials.create_index("trial_no", unique=True)
        await db.ha_trials.create_index([("clinic_id", 1), ("status", 1), ("return_date", 1)])
        await db.ha_trials.create_index([("clinic_id", 1), ("patient_id", 1), ("created_at", -1)])
        # HA module Phase 6 — CRM
        await db.ha_followups.create_index("followup_id", unique=True)
        await db.ha_followups.create_index([("clinic_id", 1), ("status", 1), ("due_date", 1)])
        await db.ha_followups.create_index([("clinic_id", 1), ("patient_id", 1), ("kind", 1), ("ref_id", 1)])
        await db.ha_subscriptions.create_index("subscription_id", unique=True)
        await db.ha_subscriptions.create_index([("clinic_id", 1), ("status", 1), ("next_due_date", 1)])
        await db.ha_subscriptions.create_index([("clinic_id", 1), ("patient_id", 1)])
        # Service tickets (post-P7 UI catch-up) — ticket_no clinic-scoped
        try:
            await db.service_tickets.drop_index("ticket_no_1")
        except Exception:
            pass
        await db.service_tickets.create_index([("clinic_id", 1), ("ticket_no", 1)], unique=True, name="uniq_clinic_ticket_no")
        await db.service_tickets.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.service_tickets.create_index([("clinic_id", 1), ("patient_id", 1)])
        await db.service_tickets.create_index("serial_id")
        # Loaners
        await db.ha_loaners.create_index("loaner_id", unique=True)
        await db.ha_loaners.create_index([("clinic_id", 1), ("status", 1), ("expected_return_date", 1)])
        await db.ha_loaners.create_index([("clinic_id", 1), ("patient_id", 1)])
        # Trade-ins (Phase 10.5 — Upgrade Engine)
        await db.ha_trade_ins.create_index("trade_in_id", unique=True)
        await db.ha_trade_ins.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.ha_trade_ins.create_index([("clinic_id", 1), ("patient_id", 1)])
        await db.ha_trade_ins.create_index("old_serial_id")
        # Waitlist (Phase 12.0 — public signup)
        await db.waitlist_signups.create_index("email", unique=True)
        await db.waitlist_signups.create_index([("created_at", -1)])
        # Login events — capped audit (Phase 14D Activity Tracking)
        from utils.activity import ensure_login_events_collection, ensure_page_views_collection
        await ensure_login_events_collection(db)
        await ensure_page_views_collection(db)
        try:
            await db.login_events.create_index([("clinic_id", 1), ("at", -1)])
            await db.login_events.create_index([("at", -1)])
            await db.users.create_index([("last_seen_at", -1)])
            await db.page_views.create_index([("user_id", 1), ("at", -1)])
            await db.geoip_cache.create_index("ip", unique=True)
        except Exception as e:
            logger.debug(f"login_events index skip: {e}")
        # AUDINEXA Couriers / Estimates / Approvals (Phase 12.B)
        await db.ha_courier_shipments.create_index("shipment_id", unique=True)
        await db.ha_courier_shipments.create_index([("clinic_id", 1), ("ticket_no", 1)])
        await db.ha_courier_shipments.create_index([("clinic_id", 1), ("status", 1), ("direction", 1)])
        await db.ha_courier_shipments.create_index([("clinic_id", 1), ("awb_number", 1), ("direction", 1)], unique=True)
        await db.ha_service_estimates.create_index("estimate_id", unique=True)
        await db.ha_service_estimates.create_index([("clinic_id", 1), ("ticket_no", 1)])
        await db.ha_customer_approvals.create_index("approval_id", unique=True)
        await db.ha_customer_approvals.create_index([("clinic_id", 1), ("ticket_no", 1)])
        await db.ha_customer_approvals.create_index([("clinic_id", 1), ("decision", 1)])
        await db.report_deliveries.create_index("delivery_id", unique=True)
        await db.report_deliveries.create_index([("clinic_id", 1), ("session_id", 1)])
        # AMC (Phase 13.A)
        await db.ha_amc_plans.create_index("plan_id", unique=True)
        await db.ha_amc_plans.create_index([("clinic_id", 1), ("active", 1)])
        await db.ha_amc_contracts.create_index("contract_no", unique=True)
        await db.ha_amc_contracts.create_index([("clinic_id", 1), ("status", 1), ("amc_expiry_date", 1)])
        await db.ha_amc_contracts.create_index([("clinic_id", 1), ("patient_id", 1)])
        await db.ha_amc_contracts.create_index([("clinic_id", 1), ("serial_id", 1), ("status", 1)])

        # M-Transfers (inter-clinic stock transfer + delivery challan)
        await db.stock_transfers.create_index("transfer_id", unique=True)
        await db.stock_transfers.create_index([("from_clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.stock_transfers.create_index([("to_clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.stock_transfers.create_index([("challan_no", 1)])
        # Referral Partners (M12, Phase 13.C)
        await db.referral_partners.create_index("partner_id", unique=True)
        await db.referral_partners.create_index([("clinic_id", 1), ("referral_code", 1)], unique=True)
        await db.referral_partners.create_index([("clinic_id", 1), ("status", 1)])
        await db.partner_payouts.create_index("payout_id", unique=True)
        await db.partner_payouts.create_index([("clinic_id", 1), ("partner_id", 1), ("created_at", -1)])
        await db.patients.create_index([("clinic_id", 1), ("referral_partner_id", 1)])
        # Patient Portal (M13, Phase 13.D)
        await db.patient_otps.create_index([("clinic_id", 1), ("patient_id", 1)], unique=True)
        await db.patient_appointment_requests.create_index("request_id", unique=True)
        await db.patient_appointment_requests.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        await db.patient_feedback.create_index("feedback_id", unique=True)
        await db.patient_feedback.create_index([("clinic_id", 1), ("created_at", -1)])
        # Admin panel (Phase 14A)
        await db.tenant_invoices.create_index("invoice_id", unique=True)
        await db.tenant_invoices.create_index([("clinic_id", 1), ("issued_at", -1)])
        await db.tenant_invoices.create_index([("status", 1), ("issued_at", -1)])
        await db.tenant_feature_flags.create_index("clinic_id", unique=True)
        await db.plan_overrides.create_index("tier", unique=True)
        await db.admin_audit_logs.create_index([("at", -1)])
        await db.admin_audit_logs.create_index([("actor_user_id", 1), ("at", -1)])
        await db.admin_audit_logs.create_index("log_id", unique=True)
        # BYOK Phase 1 — Clinic Vault PoC
        await db.clinic_vaults.create_index("clinic_id", unique=True)
        await db.vault_test_records.create_index([("clinic_id", 1), ("created_at", -1)])
        await db.vault_test_records.create_index("record_id", unique=True)
        # Email-token invitations (P1 onboarding)
        await db.invitations.create_index("token", unique=True)
        await db.invitations.create_index("invite_id", unique=True)
        await db.invitations.create_index([("clinic_id", 1), ("status", 1), ("created_at", -1)])
        _log.info("MongoDB indexes ensured")

        # ---- seed defaults (clinic, users, services) — idempotent ----
        await _seed_defaults()

        # ---- one-time backfill: extend existing appointments with the new
        # counterparty + staff resource fields (Phase: Calendar v2). Idempotent
        # — only touches rows missing the new fields. ------------------------
        try:
            res = await db.appointments.update_many(
                {"staff_id": {"$exists": False}},
                [{
                    "$set": {
                        "staff_id": "$audiologist_id",
                        "staff_name": "$audiologist_name",
                        "counterparty_type": "patient",
                        "counterparty_id": "$patient_id",
                        "counterparty_name": "$patient_name",
                        "counterparty_phone": "$patient_mobile",
                        "category": "consultation",
                    },
                }],
            )
            if res.modified_count:
                _log.info(f"Appointments backfill: {res.modified_count} rows enriched with staff/counterparty fields")
        except Exception as e:
            _log.warning(f"Appointments backfill skipped: {e}")

        # ---- one-time cleanup of stale UTC-keyed token counters ----
        # After the IST migration, old `token:{clinic}:{YYYY-MM-DD}` counter docs keyed on UTC date
        # (e.g., yesterday's UTC date when we crossed IST midnight) are functionally obsolete.
        # Drop anything that isn't today's IST-YMD. Counters auto-regenerate on next issuance.
        try:
            today_ymd = ist_today_ymd()
            cleanup = await db.counters.delete_many({
                "$and": [
                    {"_id": {"$regex": r"^token:.+:\d{4}-\d{2}-\d{2}$"}},
                    {"_id": {"$not": {"$regex": f":{today_ymd}$"}}},
                ]
            })
            if cleanup.deleted_count:
                _log.info(f"Counter cleanup: removed {cleanup.deleted_count} stale token counter docs")
        except Exception as e:
            _log.warning(f"Counter cleanup skipped: {e}")

    except Exception as e:
        _log.error(f"Startup initialisation error: {e}")

    # Start daily close-out scheduler (21:00 IST) + follow-up scan (09:30 IST)
    scheduler = None
    try:
        scheduler = closeout_module.start_scheduler(db)
        # Attach the CRM follow-up scan as a second job on the same scheduler.
        try:
            from apscheduler.triggers.cron import CronTrigger
            from routers.ha_crm import run_daily_followup_scan
            scheduler.add_job(
                run_daily_followup_scan,
                trigger=CronTrigger(hour=9, minute=30, timezone=IST),
                args=[db],
                id="daily_followup_scan_0930_ist",
                replace_existing=True,
                misfire_grace_time=3600,
            )
            logging.getLogger(__name__).info("APScheduler job added: daily_followup_scan_0930_ist (09:30 IST)")
            # Trial-expiry scanner — 02:00 IST daily (Phase 12.0)
            try:
                from trial_expiry import run_trial_expiry_scan
                scheduler.add_job(
                    run_trial_expiry_scan,
                    trigger=CronTrigger(hour=2, minute=0, timezone=IST),
                    args=[db],
                    id="trial_expiry_0200_ist",
                    replace_existing=True,
                    misfire_grace_time=3600,
                )
                logging.getLogger(__name__).info("APScheduler job added: trial_expiry_0200_ist (02:00 IST)")
            except Exception as e:
                logging.getLogger(__name__).warning(f"Trial-expiry scheduler skipped: {e}")
            # AMC expiry sweep — 02:30 IST daily (Phase 13.A)
            try:
                from routers.ha_amc import run_amc_expiry_sweep
                scheduler.add_job(
                    run_amc_expiry_sweep,
                    trigger=CronTrigger(hour=2, minute=30, timezone=IST),
                    args=[db],
                    id="amc_expiry_sweep_0230_ist",
                    replace_existing=True,
                    misfire_grace_time=3600,
                )
                logging.getLogger(__name__).info("APScheduler job added: amc_expiry_sweep_0230_ist (02:30 IST)")
            except Exception as e:
                logging.getLogger(__name__).warning(f"AMC sweep scheduler skipped: {e}")
            # Birthday + anniversary greeting scan — 09:00 IST daily
            try:
                from routers.greetings import run_daily_greeting_scan
                scheduler.add_job(
                    run_daily_greeting_scan,
                    trigger=CronTrigger(hour=9, minute=0, timezone=IST),
                    args=[db],
                    id="daily_greeting_scan_0900_ist",
                    replace_existing=True,
                    misfire_grace_time=3600,
                )
                logging.getLogger(__name__).info("APScheduler job added: daily_greeting_scan_0900_ist (09:00 IST)")
            except Exception as e:
                logging.getLogger(__name__).warning(f"Greeting scan scheduler skipped: {e}")
        except Exception as e:
            logging.getLogger(__name__).warning(f"FollowUp scheduler job skipped: {e}")
    except Exception as e:
        _log.warning(f"Close-out scheduler skipped: {e}")

    # One-time (idempotent) migration of legacy report_status values to the new
    # 3-state model (draft | report_ready | completed). Safe on every boot.
    try:
        from routers.report_handover import migrate_legacy_report_statuses
        res = await migrate_legacy_report_statuses(db)
        if res.get("merged_into_completed"):
            _log.info(f"report_status migration: {res}")
    except Exception as e:
        _log.warning(f"report_status migration skipped: {e}")

    yield

    # ---- shutdown ----
    if scheduler:
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass
    client.close()
    _log.info("MongoDB client closed")


app = FastAPI(lifespan=lifespan)

# ==================== Rate limiting (brute-force protection) ====================
# Singleton Limiter lives in rate_limit.py so routers can import it without
# circular dependency. Strict per-endpoint limits live next to each route via
# @limiter.limit decorators. Default app-wide ceiling = 300/minute per IP.
from slowapi import _rate_limit_exceeded_handler  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402
from rate_limit import limiter  # noqa: E402

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Expose db to dependency (used by auth.get_current_user)
app.state.db = db

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ==================== M01: AUTH ROUTES ====================

@api_router.post("/auth/login")
@limiter.limit("10/minute")
async def login(req: LoginRequest, request: Request):
    email = req.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("active", True) or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(
        user["user_id"], user["email"], user["role"], user["clinic_id"],
        token_version=int(user.get("token_version", 0) or 0),
    )
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    # Fire-and-forget login audit (never blocks or fails the login)
    from utils.activity import record_login
    await record_login(db, user, clinic, request)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "name": user.get("name", ""),
            "role": user["role"],
            "clinic_id": user["clinic_id"],
            "branch_ids": user.get("branch_ids", []) or [],
        },
        "clinic": clinic,
    }


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    return {"user": user, "clinic": clinic}


# ==================== MULTI-CLINIC SWITCHER ====================

@api_router.get("/auth/my-clinics")
async def my_clinics(user=Depends(get_current_user)):
    """Every clinic this user can sign into — primary + granted additionals.

    Used by the top-nav clinic-switcher dropdown. Includes the *active*
    clinic_id so the UI can highlight it.
    """
    ids = list({user["primary_clinic_id"], *user.get("additional_clinic_ids", [])})
    clinics = await db.clinics.find(
        {"clinic_id": {"$in": ids}},
        {"_id": 0, "clinic_id": 1, "name": 1, "city": 1, "state": 1,
         "logo_fs_id": 1, "subscription_tier": 1, "active": 1},
    ).to_list(len(ids))
    return {
        "active_clinic_id": user["clinic_id"],
        "primary_clinic_id": user["primary_clinic_id"],
        "clinics": clinics,
    }


class SwitchClinicIn(BaseModel):
    clinic_id: str


@api_router.post("/auth/switch-clinic")
async def switch_clinic(
    payload: SwitchClinicIn, request: Request,
    user=Depends(get_current_user),
):
    """Re-issues a JWT bound to a different clinic the user has been granted.

    The token_version is preserved — we do not bump it, so parallel sessions
    (if any) stay valid. Switching is purely a re-scope of the active tenant;
    the user's identity and role are unchanged.

    Every switch is persisted to `clinic_switch_audit` with IP + user-agent
    so super-admins have a compliance-grade trail of who moved between
    which tenants.
    """
    target = payload.clinic_id
    allowed = {user["primary_clinic_id"], *user.get("additional_clinic_ids", [])}
    if target not in allowed:
        raise HTTPException(status_code=403, detail="You don't have access to that clinic")

    clinic = await db.clinics.find_one(
        {"clinic_id": target}, {"_id": 0, "clinic_id": 1, "name": 1},
    )
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    # Capture the *from* clinic name while we still hold the old context.
    from_clinic = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]},
        {"_id": 0, "clinic_id": 1, "name": 1},
    ) or {"clinic_id": user["clinic_id"], "name": "(unknown)"}

    # Token version lookup (to preserve current force-logout state).
    udoc = await db.users.find_one(
        {"user_id": user["user_id"]}, {"_id": 0, "token_version": 1},
    )
    token = create_access_token(
        user_id=user["user_id"],
        email=user["email"],
        role=user["role"],
        clinic_id=target,
        token_version=int((udoc or {}).get("token_version") or 0),
    )

    # --- Audit trail (fire-and-forget, not critical path) ---------------
    # Skip the audit insert when the user "switches" to the clinic they
    # are already on — that's a no-op the UI shouldn't trigger but might.
    if target != user["clinic_id"]:
        try:
            client_ip = (request.headers.get("x-forwarded-for") or request.client.host or "").split(",")[0].strip() if request else ""
            ua = (request.headers.get("user-agent") or "")[:300] if request else ""
            await db.clinic_switch_audit.insert_one({
                "audit_id": f"CSA-{uuid.uuid4().hex[:10].upper()}",
                "user_id": user["user_id"],
                "user_email": user["email"],
                "user_role": user["role"],
                "from_clinic_id": from_clinic["clinic_id"],
                "from_clinic_name": from_clinic.get("name"),
                "to_clinic_id": target,
                "to_clinic_name": clinic["name"],
                "ip": client_ip,
                "user_agent": ua,
                "at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            # Never let audit failure block a legitimate switch.
            pass

    return {"access_token": token, "token_type": "bearer",
            "active_clinic_id": target, "active_clinic_name": clinic["name"]}


class LinkClinicIn(BaseModel):
    user_id: str
    clinic_id: str


@api_router.post("/auth/link-clinic")
async def link_clinic_to_user(
    payload: LinkClinicIn,
    user=Depends(get_current_user),
):
    """Grant a user access to an additional clinic.

    Gate: only `super_admin` or `founder` can do this (multi-clinic is a
    provisioning action — typically done by AUDINEXA support staff when a
    chain owner onboards a new branch-clinic). Idempotent.
    """
    if user.get("role") not in ("super_admin", "founder"):
        raise HTTPException(status_code=403, detail="Super admin only")

    target_user = await db.users.find_one(
        {"user_id": payload.user_id}, {"_id": 0, "password_hash": 0},
    )
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    clinic = await db.clinics.find_one(
        {"clinic_id": payload.clinic_id}, {"_id": 0, "clinic_id": 1, "name": 1},
    )
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    # If this is the user's primary clinic already, nothing to do.
    if target_user.get("clinic_id") == payload.clinic_id:
        return {"ok": True, "already_primary": True}

    await db.users.update_one(
        {"user_id": payload.user_id},
        {"$addToSet": {"additional_clinic_ids": payload.clinic_id}},
    )
    return {"ok": True, "user_id": payload.user_id,
            "clinic_id": payload.clinic_id, "clinic_name": clinic["name"]}


@api_router.post("/auth/unlink-clinic")
async def unlink_clinic_from_user(
    payload: LinkClinicIn,
    user=Depends(get_current_user),
):
    """Revoke a user's access to an additional clinic. Super-admin only."""
    if user.get("role") not in ("super_admin", "founder"):
        raise HTTPException(status_code=403, detail="Super admin only")
    await db.users.update_one(
        {"user_id": payload.user_id},
        {"$pull": {"additional_clinic_ids": payload.clinic_id},
         "$inc": {"token_version": 1}},  # kick them out of any session holding that clinic
    )
    return {"ok": True}


class PageViewIn(BaseModel):
    path: str = Field(..., min_length=1, max_length=300)


@api_router.post("/activity/pageview")
async def record_page_view_endpoint(
    payload: PageViewIn,
    request: Request,
    user=Depends(get_current_user),
):
    """Authenticated frontend pings this on every route change. Throttled
    server-side to avoid write-storms."""
    from utils.activity import record_page_view
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
    await record_page_view(db, user, payload.path, ip=ip)
    return {"ok": True}


# ==================== M01: CLINIC ROUTES ====================

@api_router.get("/clinic")
async def get_my_clinic(user=Depends(get_current_user)):
    c = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Clinic not found")
    return c


# ==================== HELPER FUNCTIONS ====================
# serialize_datetime / deserialize_datetime now live in utils/serde.py — shared
# with the extracted routers. Imported above for _seed_defaults to use.


# ==================== BASIC ROUTES ====================

@api_router.get("/")
async def root():
    return {"message": "ACS Audiology Management System API"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ==================== EXTRACTED → routers/ ==================== (== PATIENT ROUTES)
# ==================== EXTRACTED → routers/ ==================== (== M01.B: APPOINTMEN)
# ==================== EXTRACTED → routers/ ==================== (== TOKEN / QUEUE)
# ==================== EXTRACTED → routers/ref_docs.py ====================
# ==================== EXTRACTED → routers/ref_docs.py ==================== (PATIENT NOTES)
# ==================== EXTRACTED → routers/sessions.py ==================== (TEST SESSIONS + PTA)


# Include the router in the main app
app.include_router(api_router)
app.include_router(billing_module.billing_router)

from routers import closeouts as closeouts_router    # noqa: E402
from routers import reports as reports_router         # noqa: E402
from routers import patients as patients_router       # noqa: E402
from routers import vault as vault_router              # noqa: E402
from routers import invitations as invitations_router  # noqa: E402
from routers import care_support as care_support_router  # noqa: E402
from routers import appointments as appointments_router  # noqa: E402
from routers import tokens as tokens_router           # noqa: E402
from routers import sessions as sessions_router       # noqa: E402
from routers import diagnostics_queue as diagnostics_queue_router  # noqa: E402
from routers import ref_docs as ref_docs_router       # noqa: E402
from routers import branches as branches_router       # noqa: E402
from routers import vendors as vendors_router         # noqa: E402
from routers import ha_products as ha_products_router       # noqa: E402
from routers import ha_inventory as ha_inventory_router     # noqa: E402
from routers import ha_procurement as ha_procurement_router # noqa: E402
from routers import ha_quotations as ha_quotations_router   # noqa: E402
from routers import ha_sales as ha_sales_router             # noqa: E402
from routers import ha_fittings as ha_fittings_router       # noqa: E402
from routers import ha_trials as ha_trials_router             # noqa: E402
from routers import ha_crm as ha_crm_router                   # noqa: E402
from routers import ha_analytics as ha_analytics_router       # noqa: E402
from routers import ha_service as ha_service_router           # noqa: E402
from routers import ha_loaners as ha_loaners_router           # noqa: E402
from routers import ha_tradeins as ha_tradeins_router         # noqa: E402
from routers import subscription as subscription_router       # noqa: E402
from routers import ha_service_v2 as ha_service_v2_router     # noqa: E402
from routers import ha_repair_ops as ha_repair_ops_router     # noqa: E402
from routers import ha_amc as ha_amc_router                   # noqa: E402
from routers import analytics as analytics_router             # noqa: E402
from routers import referral_partners as referral_partners_router  # noqa: E402
from routers import patient_portal as patient_portal_router   # noqa: E402
from routers import admin_panel as admin_panel_router         # noqa: E402
from routers import admin_panel_b as admin_panel_b_router     # noqa: E402
from routers import export_data as export_data_router         # noqa: E402
from routers import report_handover as report_handover_router # noqa: E402
from routers import settings as settings_router                # noqa: E402
from routers import stock_transfers as stock_transfers_router  # noqa: E402
from routers import connect as connect_router                  # noqa: E402
from routers import clinic_status as clinic_status_router      # noqa: E402
from routers import greetings as greetings_router               # noqa: E402
from routers import razorpay_payments as razorpay_router        # noqa: E402

app.include_router(closeouts_router.router)
app.include_router(reports_router.router)
app.include_router(patients_router.router)
app.include_router(vault_router.router)
app.include_router(care_support_router.router)
# Invitations router mounts at /api (paths inside the router include /settings/*
# for owner endpoints and /public/* for invitee endpoints)
app.include_router(invitations_router.router, prefix="/api")
app.include_router(appointments_router.router)
app.include_router(tokens_router.router)
app.include_router(sessions_router.router)
app.include_router(diagnostics_queue_router.router)
app.include_router(ref_docs_router.router)
app.include_router(branches_router.router)
app.include_router(vendors_router.router)
app.include_router(ha_products_router.router)
app.include_router(ha_inventory_router.router)
app.include_router(ha_procurement_router.router)
app.include_router(ha_quotations_router.router)
app.include_router(ha_sales_router.router)
app.include_router(ha_fittings_router.router)
app.include_router(ha_trials_router.router)
app.include_router(ha_crm_router.router)
app.include_router(ha_analytics_router.router)
app.include_router(ha_service_router.router)
app.include_router(ha_loaners_router.router)
app.include_router(ha_tradeins_router.router)
app.include_router(subscription_router.router)
app.include_router(ha_service_v2_router.router)
app.include_router(ha_repair_ops_router.router)
app.include_router(ha_amc_router.router)
app.include_router(analytics_router.router)
app.include_router(referral_partners_router.router)
app.include_router(patient_portal_router.router)
app.include_router(admin_panel_router.router)
app.include_router(admin_panel_b_router.router)
app.include_router(export_data_router.router)
app.include_router(report_handover_router.router)
app.include_router(settings_router.router)
app.include_router(stock_transfers_router.router)
app.include_router(connect_router.router)
app.include_router(clinic_status_router.router)
app.include_router(greetings_router.router)
app.include_router(razorpay_router.router)

# ---- CORS lockdown ----
# Production MUST set CORS_ORIGINS to a comma-separated list of allowed origins
# (e.g. "https://app.audinexa.com,https://www.audinexa.com"). A literal "*" is
# permitted only for dev/preview where it pairs with allow_credentials=False.
_cors_raw = os.environ.get('CORS_ORIGINS', '*').strip()
if _cors_raw == '*' or _cors_raw == '':
    logging.getLogger(__name__).warning(
        "CORS_ORIGINS is '*' — acceptable for dev/preview only. Set explicit origins in production."
    )
    _allow_origins = ['*']
    _allow_credentials = False  # browsers reject `*` + credentials anyway
else:
    _allow_origins = [o.strip() for o in _cors_raw.split(',') if o.strip()]
    _allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def _seed_defaults():
    """Idempotently creates the default clinic + 4 demo users (super_admin, front_desk, audiologist, accounts).

    Also: backfill existing patients/referring_doctors that lack `clinic_id` so legacy records remain accessible.

    PRODUCTION SAFETY: when env var `DISABLE_DEMO_SEED=1` is set, the demo
    clinic + demo users + second test clinic + admin panel demo tenants are
    all skipped. The founder account (founder@audinexa.com) is still seeded
    via `admin_seed.seed_founder_only()` so the platform owner can sign in.
    Set `FOUNDER_PASSWORD` to override the default password in production.
    """
    disable_demo = os.environ.get("DISABLE_DEMO_SEED") == "1"

    if disable_demo:
        # Production path — only seed the founder, nothing else.
        logger.info("DISABLE_DEMO_SEED=1 — skipping demo data seed")
        try:
            from admin_seed import seed_founder_only
            await seed_founder_only(db)
        except Exception as e:
            logger.warning(f"Founder seed skipped: {e}")
        return

    clinic_id = os.environ.get("DEFAULT_CLINIC_ID", "clinic-acs-demo")
    clinic_name = os.environ.get("DEFAULT_CLINIC_NAME", "ACS Audiology Clinic")

    existing = await db.clinics.find_one({"clinic_id": clinic_id})
    if not existing:
        await db.clinics.insert_one(serialize_datetime({
            "clinic_id": clinic_id,
            "name": clinic_name,
            "city": "Mumbai",
            "state": "Maharashtra",
            "phone": "+91-22-00000000",
            "email": "clinic@acsdemo.in",
            "mrd_prefix": "ACS",
            # Phase 12.0 — demo clinic seeded on PREMIUM so every feature is visible
            # for showcase. New real clinics start on BASIC + 30-day Premium trial.
            "subscription_tier": "PREMIUM",
            "created_at": datetime.utcnow(),
        }))
        logger.info(f"Seeded default clinic: {clinic_id}")
    else:
        # Ensure subscription_tier is set on existing demo clinic (idempotent)
        if not existing.get("subscription_tier"):
            await db.clinics.update_one(
                {"clinic_id": clinic_id},
                {"$set": {"subscription_tier": "PREMIUM"}},
            )

    demo_users = [
        {"email": "admin@acs.in",      "password": "admin123",     "name": "Super Admin",   "role": "super_admin"},
        {"email": "frontdesk@acs.in",  "password": "frontdesk123", "name": "Front Desk",    "role": "front_desk"},
        {"email": "audiologist@acs.in","password": "audio123",     "name": "Dr. Audiologist","role": "audiologist"},
        {"email": "accounts@acs.in",   "password": "accounts123",  "name": "Accounts Team", "role": "accounts"},
    ]
    for u in demo_users:
        found = await db.users.find_one({"email": u["email"]})
        if found:
            # Keep password in sync with seed defaults (safe in demo)
            if not verify_password(u["password"], found.get("password_hash", "")):
                await db.users.update_one(
                    {"email": u["email"]},
                    {"$set": {"password_hash": hash_password(u["password"]), "clinic_id": clinic_id}},
                )
            continue
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(os.urandom(4).hex()).upper()}",
            "clinic_id": clinic_id,
            "email": u["email"],
            "name": u["name"],
            "role": u["role"],
            "active": True,
            "password_hash": hash_password(u["password"]),
            "created_at": datetime.utcnow(),
        }))
        logger.info(f"Seeded user: {u['email']} ({u['role']})")

    # Backfill legacy records missing clinic_id
    for coll in ("patients", "referring_doctors", "test_sessions"):
        try:
            await db[coll].update_many({"clinic_id": {"$exists": False}}, {"$set": {"clinic_id": clinic_id}})
            await db[coll].update_many({"clinic_id": None}, {"$set": {"clinic_id": clinic_id}})
        except Exception as e:
            logger.warning(f"Backfill skipped for {coll}: {e}")

    # Seed default service catalogue for the default clinic.
    # Disabled by default — clinics should curate their own catalogue from the
    # Settings → Service Catalogue UI. Set SEED_DEFAULT_SERVICES=1 to opt back in
    # (useful only for greenfield demo / dev environments).
    if os.environ.get("SEED_DEFAULT_SERVICES") == "1":
        try:
            inserted = await billing_module.seed_default_services(db, clinic_id)
            if inserted:
                logger.info(f"Seeded {inserted} default services for {clinic_id}")
        except Exception as e:
            logger.warning(f"Service seeding skipped: {e}")

    # Seed the primary Mumbai HQ branch + backfill existing users to it.
    await _seed_primary_branch(clinic_id, "Mumbai HQ", "Mumbai", "Maharashtra")

    # ---- Second test clinic (for cross-tenant isolation tests) ----
    # Delhi branch with its own 2 users. Enables end-to-end 403 assertions on
    # patient / report / share-link cross-clinic access.
    await _seed_second_clinic()

    # ---- AUDINEXA Super Admin Panel demo data (founder + 4 demo tenants + leads) ----
    try:
        from admin_seed import seed_admin_panel_demo
        await seed_admin_panel_demo(db)
    except Exception as e:
        logger.warning(f"Admin panel seed skipped: {e}")


async def _seed_second_clinic():
    """Idempotently seed a second clinic + 2 users for cross-tenant testing.

    This is a test fixture (not a product feature). It lets test code log in as
    a Delhi-clinic user and confirm they receive 403 on Mumbai-clinic resources.
    Safe in demo because passwords match the documented convention.
    """
    c2_id = "clinic-delhi-test"
    existing = await db.clinics.find_one({"clinic_id": c2_id})
    if existing:
        # Back-fill subscription_tier if missing on an existing doc (migration safety).
        if not existing.get("subscription_tier"):
            await db.clinics.update_one(
                {"clinic_id": c2_id},
                {"$set": {"subscription_tier": "BASIC"}},
            )
        # Still ensure passwords stay in sync for the Delhi users.
        for u in _DELHI_USERS:
            found = await db.users.find_one({"email": u["email"]})
            if found and not verify_password(u["password"], found.get("password_hash", "")):
                await db.users.update_one(
                    {"email": u["email"]},
                    {"$set": {"password_hash": hash_password(u["password"]), "clinic_id": c2_id}},
                )
        # Ensure Delhi also has a primary branch + all users are scoped to it.
        await _seed_primary_branch(c2_id, "Delhi", "New Delhi", "Delhi")
        return

    await db.clinics.insert_one(serialize_datetime({
        "clinic_id": c2_id,
        "name": "Delhi Test Branch",
        "city": "New Delhi",
        "state": "Delhi",
        "phone": "+91-11-00000000",
        "email": "clinic@delhi.test",
        "mrd_prefix": "DEL",
        # Delhi seeded on BASIC so cross-tenant tier-gate tests are meaningful
        # (non-super-admin Delhi users hitting /repair, /analytics, etc. → 402).
        "subscription_tier": "BASIC",
        "created_at": datetime.utcnow(),
    }))
    logger.info(f"Seeded second test clinic: {c2_id}")

    for u in _DELHI_USERS:
        if await db.users.find_one({"email": u["email"]}):
            continue
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(os.urandom(4).hex()).upper()}",
            "clinic_id": c2_id,
            "email": u["email"],
            "name": u["name"],
            "role": u["role"],
            "active": True,
            "password_hash": hash_password(u["password"]),
            "created_at": datetime.utcnow(),
        }))
        logger.info(f"Seeded user: {u['email']} ({u['role']}) [clinic {c2_id}]")

    try:
        inserted = await billing_module.seed_default_services(db, c2_id)
        if inserted:
            logger.info(f"Seeded {inserted} default services for {c2_id}")
    except Exception as e:
        logger.warning(f"Delhi service seeding skipped: {e}")

    # Seed Delhi primary branch + backfill Delhi users.
    await _seed_primary_branch(c2_id, "Delhi", "New Delhi", "Delhi")


async def _seed_primary_branch(clinic_id: str, name: str, city: str, state: str):
    """Ensure the given clinic has at least one primary branch, and backfill
    every user that currently has no `branch_ids` so they're scoped to it.

    Idempotent: safe to call on every boot.
    """
    existing = await db.branches.find_one({"clinic_id": clinic_id, "is_primary": True})
    if existing:
        primary_branch_id = existing["branch_id"]
    else:
        from uuid import uuid4
        primary_branch_id = f"BR-{str(uuid4())[:8].upper()}"
        await db.branches.insert_one(serialize_datetime({
            "branch_id": primary_branch_id,
            "clinic_id": clinic_id,
            "name": name,
            "city": city,
            "state": state,
            "is_primary": True,
            "active": True,
            "created_at": datetime.utcnow(),
        }))
        logger.info(f"Seeded primary branch {primary_branch_id} ({name}) for {clinic_id}")

    # Backfill branch_ids for every user in this clinic who has none.
    res = await db.users.update_many(
        {"clinic_id": clinic_id,
         "$or": [{"branch_ids": {"$exists": False}}, {"branch_ids": {"$size": 0}}]},
        {"$set": {"branch_ids": [primary_branch_id]}},
    )
    if res.modified_count:
        logger.info(f"Backfilled branch_ids for {res.modified_count} users in {clinic_id}")


_DELHI_USERS = [
    {"email": "admin@delhi.test",      "password": "delhiadmin123",     "name": "Delhi Admin",     "role": "super_admin"},
    {"email": "frontdesk@delhi.test",  "password": "delhifrontdesk123", "name": "Delhi Front Desk","role": "front_desk"},
]