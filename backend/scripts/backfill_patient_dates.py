"""Backfill: rewrite legacy `patients.dob` / `patients.anniversary_date`
fields that were stored as raw `datetime` objects → ISO `"YYYY-MM-DD"`
strings.

Why: the Patient model declares both fields as strings; legacy/seed rows
written by an earlier code path saved them as Python `datetime`, which
caused production `ResponseValidationError` on list + detail endpoints
(see error_logs fingerprint `b5ce81b3ad38` family).

The model now has a `field_validator` that coerces at read time, so this
script is **optional** for correctness — but running it makes the DB
self-consistent and prevents drift in queries that filter on these
fields (e.g. anniversary-greetings cron).

Idempotent. Always dry-run first.

Usage (preview):
    cd /app/backend
    set -a; source .env; set +a
    python3 scripts/backfill_patient_dates.py             # dry-run
    python3 scripts/backfill_patient_dates.py --apply     # write

Usage (production):
    Founder Panel → System Health → "Run patient-date backfill"
    (admin endpoint wires this same logic; see routers/admin_backfill.py)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, date

from motor.motor_asyncio import AsyncIOMotorClient


def _coerce(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return None  # already a str (or None) — no change needed


async def main(apply: bool) -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME missing — did you source .env?", file=sys.stderr)
        return 2

    cli = AsyncIOMotorClient(mongo_url)
    db = cli[db_name]

    candidates = 0
    fixed = 0
    per_clinic: dict[str, int] = {}
    examples: list[dict] = []

    cursor = db.patients.find(
        {"$or": [
            {"dob": {"$type": "date"}},
            {"anniversary_date": {"$type": "date"}},
        ]},
        {"_id": 0, "patient_id": 1, "clinic_id": 1, "name": 1,
         "dob": 1, "anniversary_date": 1},
    )

    async for p in cursor:
        candidates += 1
        update: dict = {}
        new_dob = _coerce(p.get("dob"))
        new_ann = _coerce(p.get("anniversary_date"))
        if new_dob is not None:
            update["dob"] = new_dob
        if new_ann is not None:
            update["anniversary_date"] = new_ann
        if not update:
            continue
        if apply:
            await db.patients.update_one(
                {"patient_id": p["patient_id"], "clinic_id": p["clinic_id"]},
                {"$set": update},
            )
        fixed += 1
        per_clinic[p["clinic_id"]] = per_clinic.get(p["clinic_id"], 0) + 1
        if len(examples) < 10:
            examples.append({
                "patient_id": p["patient_id"],
                "clinic_id": p["clinic_id"],
                "name": p.get("name"),
                **update,
            })

    print(f"\n=== {'APPLIED' if apply else 'DRY RUN'} ===")
    print(f"Candidate rows: {candidates}")
    print(f"{'Fixed' if apply else 'Would fix'}: {fixed}")
    print("Per clinic:")
    for cid, n in sorted(per_clinic.items()):
        print(f"  {cid}: {n}")
    print("\nExamples (max 10):")
    for ex in examples:
        print(f"  {ex}")
    if not apply and fixed:
        print("\n→ Re-run with --apply to write the changes.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Actually write the changes (default: dry-run)")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(apply=args.apply)))
