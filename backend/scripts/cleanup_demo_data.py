"""Production data cleanup — purge demo / test pollution.

USER PLAN (from chat 2026-04-28):
  1.a  Delete junk: clinic-test-clinic-*, clinic-smoke-clinic-*, harmony
  2.b  Delete demo tenants: tenant-kims-hearing, tenant-apollo-audiology,
       tenant-soundcare-hyd. KEEP tenant-sound-clinic-blr.
  3.b  KEEP beta-01 … beta-10.
  4.c  Delete clinic-acs-demo entirely (admin@acs.in goes with it).
  5.a  Set DISABLE_DEMO_SEED=1 in .env afterwards.

System clinics that must SURVIVE:
  • audinexa-platform   (founder + internal team)
  • clinic-delhi-test   (cross-tenant isolation tests)
  • tenant-sound-clinic-blr (premium screenshot demo — user kept)
  • beta-01 … beta-10   (beta tenants — user kept)

Run:
  Dry run  →  python3 scripts/cleanup_demo_data.py
  Apply    →  python3 scripts/cleanup_demo_data.py --apply
"""
from __future__ import annotations

import asyncio
import os
import sys
import re
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

# Load /app/backend/.env so MONGO_URL / DB_NAME are available regardless of cwd.
ENV = Path(__file__).resolve().parent.parent / ".env"
if ENV.is_file():
    for raw in ENV.read_text().splitlines():
        if "=" in raw and not raw.strip().startswith("#"):
            k, _, v = raw.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

APPLY = "--apply" in sys.argv

# ── Decisions ─────────────────────────────────────────────────────────
KEEP_EXACT = {
    "audinexa-platform",
    "clinic-delhi-test",
    "tenant-sound-clinic-blr",
}
KEEP_PREFIX = ("beta-",)             # beta-01 … beta-10

# Hard-coded "demo" tenants the user asked to drop:
EXTRA_DELETE = {
    "tenant-kims-hearing",
    "tenant-apollo-audiology",
    "tenant-soundcare-hyd",
    "clinic-acs-demo",
    "clinic-harmony-hearing-clinic-271f44",
}

# Patterns that always count as junk regardless of name:
JUNK_PATTERNS = [
    re.compile(r"^clinic-test-clinic-"),
    re.compile(r"^clinic-smoke-clinic-"),
]

# Collections holding tenant-scoped data via direct `clinic_id` field.
# (Programmatically expanded at runtime — this list is just for clarity.)


def _is_junk_id(cid: str) -> bool:
    return any(p.match(cid) for p in JUNK_PATTERNS)


def _should_delete(cid: str) -> bool:
    if cid in KEEP_EXACT:
        return False
    if any(cid.startswith(p) for p in KEEP_PREFIX):
        return False
    if cid in EXTRA_DELETE:
        return True
    return _is_junk_id(cid)


async def main() -> None:
    mongo = os.environ.get("MONGO_URL")
    dbname = os.environ.get("DB_NAME")
    if not mongo or not dbname:
        sys.exit("MONGO_URL / DB_NAME missing — aborting.")

    db = AsyncIOMotorClient(mongo)[dbname]

    # 1. Resolve target clinic ids ----------------------------------------
    targets: list[str] = []
    async for c in db.clinics.find({}, {"_id": 0, "clinic_id": 1, "name": 1}):
        cid = c.get("clinic_id") or ""
        if _should_delete(cid):
            targets.append(cid)
    targets.sort()

    if not targets:
        print("Nothing to delete.")
        return

    print(f"\n=== {'APPLY' if APPLY else 'DRY-RUN'}: cleanup_demo_data ===")
    print(f"Targets ({len(targets)}):")
    for cid in targets:
        print(f"  - {cid}")

    # 2. Discover all collections with `clinic_id` -----------------------
    all_cols = await db.list_collection_names()
    direct_scoped: list[str] = []
    for c in all_cols:
        if await db[c].find_one({"clinic_id": {"$in": targets}}, {"_id": 1}):
            direct_scoped.append(c)
    direct_scoped.sort()

    # 3. Resolve patient/serial/sku ids belonging to those clinics
    #    so we can cascade into collections that don't carry clinic_id
    #    but reference it indirectly.
    patient_ids = [
        p["patient_id"] async for p in
        db.patients.find({"clinic_id": {"$in": targets}}, {"_id": 0, "patient_id": 1})
    ]
    serial_ids = [
        s["serial_id"] async for s in
        db.serial_items.find({"clinic_id": {"$in": targets}}, {"_id": 0, "serial_id": 1})
        if "serial_id" in s
    ]
    sku_ids = [
        a["sku_id"] async for a in
        db.accessory_stock.find({"clinic_id": {"$in": targets}}, {"_id": 0, "sku_id": 1})
        if "sku_id" in a
    ]

    # 4. Tally everything we plan to nuke --------------------------------
    plan: list[tuple[str, dict, int]] = []

    for col in direct_scoped:
        flt = {"clinic_id": {"$in": targets}}
        n = await db[col].count_documents(flt)
        if n:
            plan.append((col, flt, n))

    if patient_ids:
        n = await db.patient_notes.count_documents({"patient_id": {"$in": patient_ids}})
        if n:
            plan.append(("patient_notes (cascade)", {"patient_id": {"$in": patient_ids}}, n))

    if serial_ids:
        n = await db.serial_events.count_documents({"serial_id": {"$in": serial_ids}})
        if n:
            plan.append(("serial_events (cascade)", {"serial_id": {"$in": serial_ids}}, n))

    if sku_ids:
        n = await db.accessory_events.count_documents({"sku_id": {"$in": sku_ids}})
        if n:
            plan.append(("accessory_events (cascade)", {"sku_id": {"$in": sku_ids}}, n))

    # stock_transfers — both sides
    stock_flt = {"$or": [
        {"from_clinic_id": {"$in": targets}},
        {"to_clinic_id":   {"$in": targets}},
    ]}
    n = await db.stock_transfers.count_documents(stock_flt)
    if n:
        plan.append(("stock_transfers", stock_flt, n))

    # counters use _id like "<clinic_id>:<counter_name>"
    counter_or = [{"_id": {"$regex": f"^{re.escape(t)}:"}} for t in targets]
    counter_flt = {"$or": counter_or} if counter_or else None
    if counter_flt:
        n = await db.counters.count_documents(counter_flt)
        if n:
            plan.append(("counters", counter_flt, n))

    # plan_overrides _id is the clinic_id
    po_flt = {"_id": {"$in": targets}}
    n = await db.plan_overrides.count_documents(po_flt)
    if n:
        plan.append(("plan_overrides", po_flt, n))

    # GridFS metadata.clinic_id (session_reports + signatures)
    for bucket in ("session_reports", "transfer_signatures", "user_signatures"):
        flt = {"metadata.clinic_id": {"$in": targets}}
        files_col = f"{bucket}.files"
        if files_col in all_cols:
            n = await db[files_col].count_documents(flt)
            if n:
                plan.append((files_col, flt, n))

    # Finally clinics doc itself
    plan.append(("clinics", {"clinic_id": {"$in": targets}}, len(targets)))

    # 5. Print plan ------------------------------------------------------
    grand = sum(n for _, _, n in plan)
    print(f"\nWill delete {grand:,} documents across {len(plan)} collections:")
    for col, _, n in plan:
        print(f"  {col:42s} → {n:>7,}")

    if not APPLY:
        print("\nDRY-RUN — re-run with --apply to execute.")
        return

    # 6. EXECUTE ---------------------------------------------------------
    print("\n--- DELETING ---")
    for col, flt, _ in plan:
        # GridFS delete: must remove .chunks too
        if col.endswith(".files"):
            bucket = col[: -len(".files")]
            files_cur = db[col].find(flt, {"_id": 1})
            ids = [doc["_id"] async for doc in files_cur]
            if ids:
                cr = await db[f"{bucket}.chunks"].delete_many({"files_id": {"$in": ids}})
                print(f"  {bucket}.chunks → {cr.deleted_count}")
            r = await db[col].delete_many({"_id": {"$in": ids}})
        else:
            real_col = col.split(" ")[0]            # strip "(cascade)" suffix
            r = await db[real_col].delete_many(flt)
        print(f"  {col:42s} → {r.deleted_count}")

    print("\n✅ Cleanup complete.")


if __name__ == "__main__":
    asyncio.run(main())
