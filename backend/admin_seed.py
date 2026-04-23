"""Seeds AUDINEXA-platform demo data for the Super Admin Panel.

Creates idempotently:
  * Founder user `founder@audinexa.com` / `founder123` scoped to a virtual
    platform clinic `audinexa-platform`.
  * 4 demo tenants: KIMS Hearing Center, Apollo Audiology, SoundCare Hyderabad,
    ENT Plus Clinic — with a varied plan mix (2 PREMIUM, 1 STANDARD, 1 trial).
  * A handful of sample waitlist leads in different pipeline stages.

Called from server.py lifespan after the primary clinic + Delhi test clinic
are seeded.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorDatabase

from auth import hash_password, verify_password
from utils.serde import serialize_datetime

logger: logging.Logger = logging.getLogger(__name__)


PLATFORM_CLINIC_ID: str = "audinexa-platform"

_DEMO_TENANTS: list[dict[str, Any]] = [
    {"clinic_id": "tenant-kims-hearing", "name": "KIMS Hearing Center", "city": "Hyderabad", "state": "Telangana",
     "phone": "+91-40-4000-1001", "email": "support@kimshearing.in", "mrd_prefix": "KIM",
     "subscription_tier": "PREMIUM", "signup_source": "seed-demo"},
    {"clinic_id": "tenant-apollo-audiology", "name": "Apollo Audiology", "city": "Chennai", "state": "Tamil Nadu",
     "phone": "+91-44-2829-3333", "email": "audiology@apollohospitals.in", "mrd_prefix": "APO",
     "subscription_tier": "PREMIUM", "signup_source": "seed-demo"},
    {"clinic_id": "tenant-soundcare-hyd", "name": "SoundCare Hyderabad", "city": "Hyderabad", "state": "Telangana",
     "phone": "+91-40-2000-5577", "email": "hello@soundcare.in", "mrd_prefix": "SCH",
     "subscription_tier": "STANDARD", "signup_source": "seed-demo"},
    {"clinic_id": "tenant-ent-plus", "name": "ENT Plus Clinic", "city": "Bengaluru", "state": "Karnataka",
     "phone": "+91-80-4500-7788", "email": "admin@entplus.in", "mrd_prefix": "ENT",
     "subscription_tier": "BASIC", "trial": True, "signup_source": "seed-demo"},
]


_SAMPLE_LEADS: list[dict[str, Any]] = [
    {"email": "rahul@prodigymedical.in", "clinic_name": "Prodigy Medical", "city": "Mumbai",
     "contact_name": "Dr. Rahul Sharma", "mobile": "+919812345001", "stage": "Demo Scheduled",
     "source": "Instagram", "notes": "Requested demo for multi-branch setup."},
    {"email": "nisha@harmonyhearing.in", "clinic_name": "Harmony Hearing", "city": "Pune",
     "contact_name": "Nisha Kale", "mobile": "+919812345002", "stage": "Trial Started",
     "source": "Google Ads", "notes": "Trial started 5 days ago."},
    {"email": "vikram@soundwell.in", "clinic_name": "SoundWell Clinic", "city": "Delhi",
     "contact_name": "Dr. Vikram Singh", "mobile": "+919812345003", "stage": "Converted",
     "source": "Partner Referral", "notes": "Upgraded to Premium."},
    {"email": "meera@hearfirst.in", "clinic_name": "HearFirst", "city": "Kochi",
     "contact_name": "Meera Nair", "mobile": "+919812345004", "stage": "Lost",
     "source": "LinkedIn", "notes": "Chose competitor on price."},
]

_SAMPLE_CAMPAIGNS: list[dict[str, Any]] = [
    {"campaign_id": "CAM-SEED-GADS", "name": "Q1 Google Ads — Founder Launch",
     "source": "Google Ads", "channel": "paid", "budget": 75000.0,
     "started_at": "2026-01-01", "ended_at": "2026-03-31", "notes": "Awareness campaign."},
    {"campaign_id": "CAM-SEED-IG", "name": "Instagram Creative Push",
     "source": "Instagram", "channel": "paid", "budget": 35000.0,
     "started_at": "2026-02-01", "notes": "Targeting audiologists in metros."},
    {"campaign_id": "CAM-SEED-PART", "name": "Partner Referral Program",
     "source": "Partner Referral", "channel": "referral", "budget": 0.0,
     "started_at": "2026-01-15", "notes": "ENT doctor partner activation."},
]

_SAMPLE_TICKETS: list[dict[str, Any]] = [
    {"subject": "Cannot generate GRN", "body": "GRN number skipping sequence.",
     "category": "Bug", "priority": "high", "contact_email": "support@kimshearing.in",
     "clinic_id": "tenant-kims-hearing", "status": "Open"},
    {"subject": "Need WhatsApp template approval help", "body": "MSG91 template rejected.",
     "category": "Training", "priority": "medium", "contact_email": "hello@soundcare.in",
     "clinic_id": "tenant-soundcare-hyd", "status": "Pending"},
    {"subject": "GST invoice formatting", "body": "State code missing.",
     "category": "Billing", "priority": "low", "contact_email": "admin@entplus.in",
     "clinic_id": "tenant-ent-plus", "status": "Resolved"},
]

_INTERNAL_USERS: list[tuple[str, str, str, str]] = [
    ("sales@audinexa.com", "sales_manager", "Asha Sales", "sales123"),
    ("support@audinexa.com", "support_agent", "Rohit Support", "support123"),
    ("finance@audinexa.com", "finance_manager", "Priya Finance", "finance123"),
    ("ops@audinexa.com", "product_ops", "Kiran Ops", "ops123"),
    ("analyst@audinexa.com", "read_only", "Neha Analyst", "analyst123"),
]


async def seed_admin_panel_demo(db: AsyncIOMotorDatabase) -> None:
    """Idempotent. Safe on every boot."""
    now: datetime = datetime.now(timezone.utc)

    # ---- 1. Platform clinic (for founder user) ----
    if not await db.clinics.find_one({"clinic_id": PLATFORM_CLINIC_ID}):
        await db.clinics.insert_one(serialize_datetime({
            "clinic_id": PLATFORM_CLINIC_ID,
            "name": "AUDINEXA (Platform)",
            "city": "Global",
            "state": "-",
            "email": "ops@audinexa.com",
            "mrd_prefix": "AUD",
            "subscription_tier": "PREMIUM",
            "signup_source": "platform-reserved",
            "created_at": now,
        }))
        logger.info(f"Seeded platform tenant: {PLATFORM_CLINIC_ID}")

    # ---- 2. Founder user ----
    founder_email = "founder@audinexa.com"
    founder_pw = "founder123"
    found = await db.users.find_one({"email": founder_email})
    if not found:
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(uuid4())[:8].upper()}",
            "clinic_id": PLATFORM_CLINIC_ID,
            "email": founder_email,
            "name": "Audinexa Founder",
            "role": "founder",
            "active": True,
            "password_hash": hash_password(founder_pw),
            "branch_ids": [],
            "created_at": now,
        }))
        logger.info(f"Seeded founder user: {founder_email}")
    else:
        # Keep password in sync
        if not verify_password(founder_pw, found.get("password_hash", "")):
            await db.users.update_one(
                {"email": founder_email},
                {"$set": {"password_hash": hash_password(founder_pw), "role": "founder", "clinic_id": PLATFORM_CLINIC_ID}},
            )

    # ---- 3. Demo tenants ----
    for t in _DEMO_TENANTS:
        cid = t["clinic_id"]
        if await db.clinics.find_one({"clinic_id": cid}):
            continue
        doc = {
            "clinic_id": cid,
            "name": t["name"],
            "city": t["city"],
            "state": t["state"],
            "country": "India",
            "phone": t.get("phone"),
            "email": t.get("email"),
            "mrd_prefix": t.get("mrd_prefix", cid[:3].upper()),
            "subscription_tier": t["subscription_tier"],
            "signup_source": t.get("signup_source", "seed-demo"),
            "status": "active",
            "created_at": now - timedelta(days=30 + (hash(cid) % 120)),  # stagger signup dates
        }
        if t.get("trial"):
            doc["trial_ends_at"] = now + timedelta(days=5 + (hash(cid) % 10))

        await db.clinics.insert_one(serialize_datetime(doc))

        # Seed an owner user for each tenant
        owner_email = t.get("email") or f"owner@{cid}.in"
        if not await db.users.find_one({"email": owner_email}):
            await db.users.insert_one(serialize_datetime({
                "user_id": f"USR-{str(uuid4())[:8].upper()}",
                "clinic_id": cid,
                "email": owner_email,
                "name": f"{t['name']} Owner",
                "role": "clinic_owner",
                "active": True,
                "password_hash": hash_password("demo123"),
                "branch_ids": [],
                "created_at": now,
            }))

        # Primary branch
        branch_id = f"BR-{str(uuid4())[:8].upper()}"
        await db.branches.insert_one(serialize_datetime({
            "branch_id": branch_id, "clinic_id": cid, "name": t["city"] + " HQ",
            "city": t["city"], "state": t["state"], "is_primary": True, "active": True,
            "created_at": now,
        }))
        await db.users.update_many(
            {"clinic_id": cid, "branch_ids": {"$size": 0}},
            {"$set": {"branch_ids": [branch_id]}},
        )

        # Seed default service catalogue — so billing dropdown isn't empty on day 1
        try:
            import billing as billing_module
            await billing_module.seed_default_services(db, cid)
        except Exception as e:
            logger.warning(f"Service catalogue seeding skipped for {cid}: {e}")

        logger.info(f"Seeded demo tenant: {cid}")

    # ---- 4. Sample leads (use waitlist_signups so existing leads UI continues working) ----
    for lead in _SAMPLE_LEADS:
        if await db.waitlist_signups.find_one({"email": lead["email"]}):
            continue
        await db.waitlist_signups.insert_one(serialize_datetime({
            **lead,
            "created_at": now - timedelta(days=2 + (hash(lead["email"]) % 40)),
        }))

    # ---- 5. Internal Audinexa team users (Phase 14C granular RBAC) ----
    for email, role, name, pw in _INTERNAL_USERS:
        found = await db.users.find_one({"email": email})
        if found:
            # keep pw in sync
            if not verify_password(pw, found.get("password_hash", "")):
                await db.users.update_one(
                    {"email": email},
                    {"$set": {"password_hash": hash_password(pw), "role": role,
                              "clinic_id": PLATFORM_CLINIC_ID, "active": True}},
                )
            continue
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(uuid4())[:8].upper()}",
            "clinic_id": PLATFORM_CLINIC_ID,
            "email": email,
            "name": name,
            "role": role,
            "active": True,
            "two_fa_enabled": False,
            "password_hash": hash_password(pw),
            "branch_ids": [],
            "created_at": now,
        }))
        logger.info(f"Seeded internal user: {email} ({role})")

    # ---- 6. Sample marketing campaigns ----
    for c in _SAMPLE_CAMPAIGNS:
        if await db.marketing_campaigns.find_one({"campaign_id": c["campaign_id"]}):
            continue
        await db.marketing_campaigns.insert_one(serialize_datetime({
            **c,
            "created_at": now,
            "created_by": "SEED",
        }))

    # ---- 7. Sample support tickets ----
    for t in _SAMPLE_TICKETS:
        # idempotency: skip if any ticket exists for this clinic+subject
        if await db.support_tickets.find_one({"clinic_id": t["clinic_id"], "subject": t["subject"]}):
            continue
        ts = now - timedelta(days=1 + (hash(t["subject"]) % 5))
        sla_hrs = {"low": 72, "medium": 24, "high": 8, "urgent": 2}[t["priority"]]
        doc = {
            "ticket_id": f"TKT-SEED-{str(uuid4())[:4].upper()}",
            "clinic_id": t["clinic_id"],
            "category": t["category"],
            "priority": t["priority"],
            "status": t["status"],
            "subject": t["subject"],
            "body": t["body"],
            "contact_email": t["contact_email"],
            "owner_user_id": None,
            "thread": [{"at": ts.isoformat(), "author": t["contact_email"], "text": t["body"], "kind": "open"}],
            "first_response_at": None,
            "resolved_at": now.isoformat() if t["status"] == "Resolved" else None,
            "created_by": "SEED",
            "created_at": ts.isoformat(),
            "sla_due_at": (ts + timedelta(hours=sla_hrs)).isoformat(),
        }
        await db.support_tickets.insert_one(doc)
