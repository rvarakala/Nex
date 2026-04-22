from fastapi import FastAPI, APIRouter, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from datetime import datetime

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
        await db.report_deliveries.create_index("delivery_id", unique=True)
        await db.report_deliveries.create_index([("clinic_id", 1), ("session_id", 1)])
        _log.info("MongoDB indexes ensured")

        # ---- seed defaults (clinic, users, services) — idempotent ----
        await _seed_defaults()

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

    # Start daily close-out scheduler (21:00 IST)
    scheduler = None
    try:
        scheduler = closeout_module.start_scheduler(db)
    except Exception as e:
        _log.warning(f"Close-out scheduler skipped: {e}")

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

# Expose db to dependency (used by auth.get_current_user)
app.state.db = db

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ==================== M01: AUTH ROUTES ====================

@api_router.post("/auth/login")
async def login(req: LoginRequest):
    email = req.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("active", True) or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["user_id"], user["email"], user["role"], user["clinic_id"])
    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0})
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
from routers import appointments as appointments_router  # noqa: E402
from routers import tokens as tokens_router           # noqa: E402
from routers import sessions as sessions_router       # noqa: E402
from routers import ref_docs as ref_docs_router       # noqa: E402
from routers import branches as branches_router       # noqa: E402
from routers import vendors as vendors_router         # noqa: E402
from routers import ha_products as ha_products_router       # noqa: E402
from routers import ha_inventory as ha_inventory_router     # noqa: E402
from routers import ha_procurement as ha_procurement_router # noqa: E402

app.include_router(closeouts_router.router)
app.include_router(reports_router.router)
app.include_router(patients_router.router)
app.include_router(appointments_router.router)
app.include_router(tokens_router.router)
app.include_router(sessions_router.router)
app.include_router(ref_docs_router.router)
app.include_router(branches_router.router)
app.include_router(vendors_router.router)
app.include_router(ha_products_router.router)
app.include_router(ha_inventory_router.router)
app.include_router(ha_procurement_router.router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
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
    """
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
            "created_at": datetime.utcnow(),
        }))
        logger.info(f"Seeded default clinic: {clinic_id}")

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

    # Seed default service catalogue for the default clinic (idempotent)
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


async def _seed_second_clinic():
    """Idempotently seed a second clinic + 2 users for cross-tenant testing.

    This is a test fixture (not a product feature). It lets test code log in as
    a Delhi-clinic user and confirm they receive 403 on Mumbai-clinic resources.
    Safe in demo because passwords match the documented convention.
    """
    c2_id = "clinic-delhi-test"
    if await db.clinics.find_one({"clinic_id": c2_id}):
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