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

_INTERNAL_USERS_DEFAULT_PWS: dict[str, str] = {
    # P0 security hardening (2026-06-03): rotated from `<role>123` to
    # strong randoms. Each user's password can be overridden via env var
    # `AUDINEXA_<ROLE>_PW` (e.g. AUDINEXA_SALES_PW). The strong defaults
    # below are the source of truth and propagate to the DB via the
    # idempotent password-sync block in `seed_admin_panel_demo`.
    #
    # These ARE intentionally checked in — they are the seed/demo creds
    # for the platform tenant, NOT production keys. The platform tenant
    # is for internal Audinexa team only; clinics use separate auth.
    # Production owners should override every value below via env.
    "sales@audinexa.com":   "Sales-Mgr-9K2vX7wR",
    "support@audinexa.com": "Support-A3jH8nP4yZ",
    "finance@audinexa.com": "Finance-V5tB9cM1qL",
    "ops@audinexa.com":     "ProdOps-G4xN6sD2uK",
    "analyst@audinexa.com": "Analyst-W8rT5fJ3eY",
}

_INTERNAL_USER_ROLES: list[tuple[str, str, str]] = [
    # (email, role, display_name) — passwords looked up from the dict above
    # (or env var override).
    ("sales@audinexa.com",   "sales_manager",   "Asha Sales"),
    ("support@audinexa.com", "support_agent",   "Rohit Support"),
    ("finance@audinexa.com", "finance_manager", "Priya Finance"),
    ("ops@audinexa.com",     "product_ops",     "Kiran Ops"),
    ("analyst@audinexa.com", "read_only",       "Neha Analyst"),
]


def _resolve_internal_pw(email: str) -> str:
    """Resolve seed password for an internal user. Env var wins (operators
    should set `AUDINEXA_<ROLE>_PW=<strong>` in prod), strong default
    otherwise. Falls back to a per-call random if anything goes wrong, so
    we never accidentally seed a blank password."""
    import os
    import secrets
    role_key = email.split("@", 1)[0].upper()
    env_var = f"AUDINEXA_{role_key}_PW"
    env_val = os.environ.get(env_var)
    if env_val and len(env_val) >= 12:
        return env_val
    default = _INTERNAL_USERS_DEFAULT_PWS.get(email)
    if default:
        return default
    # Defensive — never seed blank. If a new internal user is added without
    # a default, generate a random one (caller can read it from the DB or
    # logs, then rotate). 18 url-safe chars ≈ 134 bits of entropy.
    return secrets.token_urlsafe(18)


async def seed_founder_only(db: AsyncIOMotorDatabase) -> None:
    """Production-safe seed: only creates the platform clinic + founder user.

    Runs even when `DISABLE_DEMO_SEED=1` is set so the platform owner can
    sign in. Honours `FOUNDER_PASSWORD` env var (recommended in production).
    Idempotent: keeps the password in sync on every boot if it changed in env.
    """
    import os

    now: datetime = datetime.now(timezone.utc)

    # ---- 1. Platform clinic ----
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
    founder_email = os.environ.get("FOUNDER_EMAIL", "founder@audinexa.com")
    founder_pw = os.environ.get("FOUNDER_PASSWORD", "founder123")
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
            "email_verified": True,
            "email_verified_at": now.isoformat(),
            "email_verified_via": "founder_seed",
            "created_at": now,
        }))
        logger.info(f"Seeded founder user: {founder_email}")
    elif found.get("role") != "founder":
        # ⚠️ COLLISION GUARD (2026-07-26 incident): a real clinic-owner
        # signed up with the founder's email on production; the previous
        # seed logic silently overwrote their role + clinic + password on
        # the next deploy. Refuse to hijack — log loudly so ops can
        # decide (either rename the founder email or the offending user).
        logger.error(
            "🚨 FOUNDER-EMAIL COLLISION — user %r has role=%r, NOT founder. "
            "Refusing to overwrite their record. Rename FOUNDER_EMAIL or "
            "reach out to the affected user to migrate their account.",
            founder_email, found.get("role"),
        )
    else:
        # Keep password in sync if env changed — but only when the existing
        # row is genuinely the founder (guarded above).
        if not verify_password(founder_pw, found.get("password_hash", "")):
            await db.users.update_one(
                {"email": founder_email, "role": "founder"},
                {"$set": {"password_hash": hash_password(founder_pw), "role": "founder",
                          "clinic_id": PLATFORM_CLINIC_ID}},
            )
            logger.info(f"Founder password synced from env: {founder_email}")

    # Self-heal: founder is internal — must never be trapped behind the
    # email-verification gate. Runs on every boot; no-op if already verified.
    # This is what unblocks a founder whose account was seeded BEFORE the
    # email-verification hard-block was added (2026-07-26).
    # Scoped to role=founder to avoid touching a colliding user row.
    await db.users.update_one(
        {"email": founder_email, "role": "founder", "email_verified": {"$ne": True}},
        {"$set": {"email_verified": True,
                  "email_verified_at": now.isoformat(),
                  "email_verified_via": "founder_seed"}},
    )


async def seed_admin_panel_demo(db: AsyncIOMotorDatabase) -> None:
    """Idempotent. Safe on every boot.

    PRODUCTION SAFETY: when `DISABLE_DEMO_SEED=1`, this becomes a no-op
    (founder is seeded separately via `seed_founder_only`).
    """
    import os
    if os.environ.get("DISABLE_DEMO_SEED") == "1":
        logger.info("DISABLE_DEMO_SEED=1 — admin panel demo tenants/leads skipped")
        return

    now: datetime = datetime.now(timezone.utc)

    # ---- 1. Platform clinic + founder (also covered by seed_founder_only) ----
    await seed_founder_only(db)

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

        # Seed an owner user for each tenant. The default is intentionally
        # kept as `demo123` because it's the documented test credential for
        # every demo tenant (see `/app/memory/test_credentials.md`). Rotate
        # via env `AUDINEXA_DEMO_OWNER_PW` before any external-facing demo.
        # Note: existing demo owners aren't auto-synced — only newly created
        # demo tenants pick up the env override. To rotate existing users
        # at scale, run the seed with the new env var AND a one-off
        # update_many in mongo.
        import os
        owner_email = t.get("email") or f"owner@{cid}.in"
        demo_owner_pw = os.environ.get("AUDINEXA_DEMO_OWNER_PW", "demo123")
        if not await db.users.find_one({"email": owner_email}):
            await db.users.insert_one(serialize_datetime({
                "user_id": f"USR-{str(uuid4())[:8].upper()}",
                "clinic_id": cid,
                "email": owner_email,
                "name": f"{t['name']} Owner",
                "role": "clinic_owner",
                "active": True,
                "password_hash": hash_password(demo_owner_pw),
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
    # Passwords come from env var `AUDINEXA_<ROLE>_PW` if set, otherwise
    # strong checked-in defaults (see `_INTERNAL_USERS_DEFAULT_PWS`).
    for email, role, name in _INTERNAL_USER_ROLES:
        pw = _resolve_internal_pw(email)
        found = await db.users.find_one({"email": email})
        if found:
            # keep pw in sync — re-runs after env rotation propagate without
            # operator intervention.
            if not verify_password(pw, found.get("password_hash", "")):
                await db.users.update_one(
                    {"email": email},
                    {"$set": {"password_hash": hash_password(pw), "role": role,
                              "clinic_id": PLATFORM_CLINIC_ID, "active": True}},
                )
                logger.info(f"Internal user password rotated: {email}")
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
            "email_verified": True,
            "email_verified_at": now.isoformat(),
            "email_verified_via": "internal_seed",
            "created_at": now,
        }))
        logger.info(f"Seeded internal user: {email} ({role})")

    # Self-heal internal team accounts (same logic as the founder — internal
    # accounts must never be trapped behind the email-verification gate).
    internal_emails = [e for e, _, _ in _INTERNAL_USER_ROLES]
    await db.users.update_many(
        {"email": {"$in": internal_emails}, "email_verified": {"$ne": True}},
        {"$set": {"email_verified": True,
                  "email_verified_at": now.isoformat(),
                  "email_verified_via": "internal_seed"}},
    )

    # Self-heal seeded demo tenant owners too — they're internal test accounts
    # and shouldn't be gated (grandfathered by design).
    demo_owner_emails = [t.get("email") for t in _DEMO_TENANTS if t.get("email")]
    if demo_owner_emails:
        await db.users.update_many(
            {"email": {"$in": demo_owner_emails}, "email_verified": {"$ne": True}},
            {"$set": {"email_verified": True,
                      "email_verified_at": now.isoformat(),
                      "email_verified_via": "demo_seed"}},
        )

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
