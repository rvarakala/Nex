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
import os
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from auth import hash_password, verify_password
from utils.serde import serialize_datetime

logger = logging.getLogger(__name__)


PLATFORM_CLINIC_ID = "audinexa-platform"

_DEMO_TENANTS = [
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


_SAMPLE_LEADS = [
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


async def seed_admin_panel_demo(db):
    """Idempotent. Safe on every boot."""
    now = datetime.now(timezone.utc)

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
        logger.info(f"Seeded demo tenant: {cid}")

    # ---- 4. Sample leads (use waitlist_signups so existing leads UI continues working) ----
    for lead in _SAMPLE_LEADS:
        if await db.waitlist_signups.find_one({"email": lead["email"]}):
            continue
        await db.waitlist_signups.insert_one(serialize_datetime({
            **lead,
            "created_at": now - timedelta(days=2 + (hash(lead["email"]) % 40)),
        }))
