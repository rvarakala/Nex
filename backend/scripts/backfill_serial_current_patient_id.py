"""One-shot backfill — stamp `current_patient_id` on `serial_items` rows
that are SOLD / AT_SERVICE / RETURNED but were never linked to a patient.

Reason: until 2026-05-09 the Quotation → Sale → mark-paid flow forgot to
stamp the buyer's patient_id on the serial, which broke the Service Ticket
"Unit being serviced" dropdown ("No HA units found for this patient").

The fix has shipped — this script just retro-fixes existing rows.

Run inside the backend container, against production (one-time):

    cd /app/backend && set -a && source .env && set +a \
        && python3 scripts/backfill_serial_current_patient_id.py --apply

Without `--apply` it's a dry-run that just prints what would change.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient


TARGET_STATES = {"SOLD", "AT_SERVICE", "DISPATCHED_TO_VENDOR", "RETURNED"}


async def run(apply: bool) -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("MONGO_URL / DB_NAME must be set", file=sys.stderr)
        return 2

    cli = AsyncIOMotorClient(mongo_url)
    db = cli[db_name]

    fixed_per_clinic: dict[str, int] = {}
    skipped_no_match = 0
    total_candidates = 0

    cursor = db.serial_items.find(
        {
            "state": {"$in": list(TARGET_STATES)},
            "$or": [
                {"current_patient_id": None},
                {"current_patient_id": {"$exists": False}},
            ],
        },
        {"_id": 0, "serial_id": 1, "clinic_id": 1, "serial_no": 1},
    )

    async for si in cursor:
        total_candidates += 1
        sid = si["serial_id"]
        # Find a ha_sales line that references this serial, ideally paid/invoiced.
        sale = await db.ha_sales.find_one(
            {
                "clinic_id": si["clinic_id"],
                "lines.serial_id": sid,
                "status": {"$in": ["paid", "invoiced", "reserved"]},
            },
            {"_id": 0, "patient_id": 1, "sale_no": 1, "status": 1},
        )
        if not sale or not sale.get("patient_id"):
            # Try quick_sales (older path)
            qs = await db.quick_sales.find_one(
                {"clinic_id": si["clinic_id"], "serial_id": sid},
                {"_id": 0, "patient_id": 1},
            )
            sale = qs if qs and qs.get("patient_id") else None

        if not sale or not sale.get("patient_id"):
            skipped_no_match += 1
            continue

        if apply:
            await db.serial_items.update_one(
                {"serial_id": sid},
                {"$set": {"current_patient_id": sale["patient_id"]}},
            )
        fixed_per_clinic[si["clinic_id"]] = fixed_per_clinic.get(si["clinic_id"], 0) + 1
        print(
            f"  {'[APPLY] ' if apply else '[DRY] '}"
            f"{si['serial_no']} ({sid}) → patient {sale['patient_id']}"
        )

    print()
    print(f"Candidates scanned: {total_candidates}")
    print(f"Backfilled: {sum(fixed_per_clinic.values())} (across {len(fixed_per_clinic)} clinics)")
    print(f"Skipped (no matching sale): {skipped_no_match}")
    for cid, n in sorted(fixed_per_clinic.items()):
        print(f"   {cid}: {n}")
    if not apply:
        print()
        print("** DRY RUN — re-run with --apply to actually write **")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true", help="Actually update Mongo")
    args = p.parse_args()
    rc = asyncio.run(run(args.apply))
    sys.exit(rc)


if __name__ == "__main__":
    main()
