"""AUDINEXA Beta Tester Seeder — one-shot CLI.

Creates 10 fully-provisioned clinic workspaces for beta testers.
Each clinic gets:
  * A clinic record (on STANDARD tier, 30-day trial)
  * A clinic_owner user (login) with a strong auto-generated password
  * A primary branch (HQ)
  * Sane defaults (MRD prefix, country, state)

Output:
  Writes a markdown credentials table to /app/memory/BETA_TESTERS.md

Idempotent:
  If a tenant already exists, it is skipped (password is NOT regenerated).

Usage:
  cd /app/backend && python beta_seed.py
  # Optional: pass --reset to wipe + regenerate (dangerous)
  cd /app/backend && python beta_seed.py --reset

To customize tester clinics:
  Edit the BETA_TESTERS list below with real clinic names/emails BEFORE running.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import string
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from uuid import uuid4

# Add backend to path so we can import when run as script
sys.path.insert(0, str(Path(__file__).parent))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from auth import hash_password
from utils.serde import serialize_datetime


# === Customize these 10 clinics before running ===
# Each entry becomes an independent tenant with its own owner login.
BETA_TESTERS = [
    {"clinic_id": "beta-01",  "name": "Beta Clinic 01",  "city": "Mumbai",     "state": "Maharashtra",   "contact_name": "Tester 1",  "email": "tester01@audinexa.com",  "phone": "+91-9000000001"},
    {"clinic_id": "beta-02",  "name": "Beta Clinic 02",  "city": "Bengaluru",  "state": "Karnataka",     "contact_name": "Tester 2",  "email": "tester02@audinexa.com",  "phone": "+91-9000000002"},
    {"clinic_id": "beta-03",  "name": "Beta Clinic 03",  "city": "Hyderabad",  "state": "Telangana",     "contact_name": "Tester 3",  "email": "tester03@audinexa.com",  "phone": "+91-9000000003"},
    {"clinic_id": "beta-04",  "name": "Beta Clinic 04",  "city": "Chennai",    "state": "Tamil Nadu",    "contact_name": "Tester 4",  "email": "tester04@audinexa.com",  "phone": "+91-9000000004"},
    {"clinic_id": "beta-05",  "name": "Beta Clinic 05",  "city": "New Delhi",  "state": "Delhi",         "contact_name": "Tester 5",  "email": "tester05@audinexa.com",  "phone": "+91-9000000005"},
    {"clinic_id": "beta-06",  "name": "Beta Clinic 06",  "city": "Pune",       "state": "Maharashtra",   "contact_name": "Tester 6",  "email": "tester06@audinexa.com",  "phone": "+91-9000000006"},
    {"clinic_id": "beta-07",  "name": "Beta Clinic 07",  "city": "Kolkata",    "state": "West Bengal",   "contact_name": "Tester 7",  "email": "tester07@audinexa.com",  "phone": "+91-9000000007"},
    {"clinic_id": "beta-08",  "name": "Beta Clinic 08",  "city": "Ahmedabad",  "state": "Gujarat",       "contact_name": "Tester 8",  "email": "tester08@audinexa.com",  "phone": "+91-9000000008"},
    {"clinic_id": "beta-09",  "name": "Beta Clinic 09",  "city": "Jaipur",     "state": "Rajasthan",     "contact_name": "Tester 9",  "email": "tester09@audinexa.com",  "phone": "+91-9000000009"},
    {"clinic_id": "beta-10",  "name": "Beta Clinic 10",  "city": "Kochi",      "state": "Kerala",        "contact_name": "Tester 10", "email": "tester10@audinexa.com",  "phone": "+91-9000000010"},
]

TRIAL_DAYS = 30
OUTPUT_FILE = Path("/app/memory/BETA_TESTERS.md")


def _gen_password(length: int = 12) -> str:
    """Human-friendly strong password: letters+digits (no ambiguous chars)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _mrd_prefix(clinic_id: str) -> str:
    # beta-01 -> BET01
    parts = clinic_id.upper().split("-")
    if len(parts) >= 2:
        return (parts[0][:3] + parts[1])[:6]
    return clinic_id[:5].upper()


async def seed_beta_testers(reset: bool = False) -> list[dict]:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    now = datetime.now(timezone.utc)
    credentials: list[dict] = []

    if reset:
        ids = [t["clinic_id"] for t in BETA_TESTERS]
        emails = [t["email"] for t in BETA_TESTERS]
        await db.clinics.delete_many({"clinic_id": {"$in": ids}})
        await db.users.delete_many({"email": {"$in": emails}})
        await db.branches.delete_many({"clinic_id": {"$in": ids}})
        print(f"[reset] removed {len(ids)} beta tenants + owners + branches")

    for t in BETA_TESTERS:
        cid = t["clinic_id"]
        existing_clinic = await db.clinics.find_one({"clinic_id": cid})
        existing_user = await db.users.find_one({"email": t["email"]})

        if existing_clinic and existing_user:
            credentials.append({
                **t,
                "password": "<already seeded — password not re-issued>",
                "status": "skipped",
            })
            continue

        # Clinic
        if not existing_clinic:
            await db.clinics.insert_one(serialize_datetime({
                "clinic_id": cid,
                "name": t["name"],
                "city": t["city"],
                "state": t["state"],
                "country": "India",
                "phone": t["phone"],
                "email": t["email"],
                "mrd_prefix": _mrd_prefix(cid),
                "subscription_tier": "STANDARD",
                "trial_ends_at": now + timedelta(days=TRIAL_DAYS),
                "signup_source": "beta-program",
                "status": "active",
                "created_at": now,
            }))

        # Primary branch
        branch = await db.branches.find_one({"clinic_id": cid, "is_primary": True})
        if not branch:
            branch_id = f"BR-{str(uuid4())[:8].upper()}"
            await db.branches.insert_one(serialize_datetime({
                "branch_id": branch_id, "clinic_id": cid,
                "name": f"{t['city']} HQ",
                "city": t["city"], "state": t["state"],
                "is_primary": True, "active": True, "created_at": now,
            }))
        else:
            branch_id = branch["branch_id"]

        # Owner user
        password = _gen_password()
        await db.users.insert_one(serialize_datetime({
            "user_id": f"USR-{str(uuid4())[:8].upper()}",
            "clinic_id": cid,
            "email": t["email"],
            "name": t["contact_name"],
            "role": "clinic_owner",
            "active": True,
            "password_hash": hash_password(password),
            "branch_ids": [branch_id],
            "created_at": now,
        }))

        credentials.append({**t, "password": password, "status": "created"})

    _write_credentials_md(credentials)
    client.close()
    return credentials


def _write_credentials_md(rows: list[dict]):
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    base_url = "https://www.audinexa.com"

    lines = [
        "# AUDINEXA — Beta Tester Credentials",
        "",
        f"> Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"> Login URL: **{base_url}/login**",
        f"> Trial duration: **{TRIAL_DAYS} days** (STANDARD tier)",
        "",
        "⚠️  **KEEP THIS FILE PRIVATE.** These are the initial passwords for your 10 beta testers.",
        "Instruct each tester to change their password after first login (Profile → Change Password).",
        "",
        "| # | Clinic | City | Contact | Email (login) | Temp Password | Status |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(rows, 1):
        lines.append(
            f"| {i} | {r['name']} | {r['city']} | {r['contact_name']} | "
            f"`{r['email']}` | `{r['password']}` | {r['status']} |"
        )

    lines += [
        "",
        "---",
        "",
        "## How each tester logs in",
        "",
        f"1. Go to **{base_url}/login**",
        "2. Enter their email + temp password from the table above",
        "3. They land on the **Clinic Owner Dashboard** with full access to:",
        "   - Patients, Appointments, Diagnostics, Hearing Aid Sales, Service & Repair, Analytics",
        "   - Their own branch (already seeded)",
        "   - 30-day STANDARD trial (AMC, Referral Partners, Patient Portal all unlocked)",
        "",
        "## Where to track them (as founder)",
        "",
        f"- Super Admin Panel → Tenants: **{base_url}/admin/tenants**",
        f"- Super Admin Panel → Usage Analytics: **{base_url}/admin/usage**",
        f"- Super Admin Panel → Support Desk: **{base_url}/admin/support**",
        "",
        "## Re-generate / wipe",
        "",
        "```bash",
        "cd /app/backend && python beta_seed.py           # create (idempotent)",
        "cd /app/backend && python beta_seed.py --reset   # wipe + recreate (dangerous)",
        "```",
    ]
    OUTPUT_FILE.write_text("\n".join(lines))
    print(f"[write] {OUTPUT_FILE}  ({len(rows)} testers)")


async def _main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Delete existing beta tenants before re-seeding")
    args = parser.parse_args()

    rows = await seed_beta_testers(reset=args.reset)
    created = sum(1 for r in rows if r["status"] == "created")
    skipped = sum(1 for r in rows if r["status"] == "skipped")
    print(f"\n✅ Done. Created: {created} | Skipped (already exists): {skipped}")
    print(f"📄 Credentials written to: {OUTPUT_FILE}")


if __name__ == "__main__":
    asyncio.run(_main())
