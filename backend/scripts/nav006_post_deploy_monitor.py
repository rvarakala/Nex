"""NAV-006 Sprint-P1/P1B post-deploy monitoring probe.

READ-ONLY. Queries the production `error_logs` collection for any 5xx
tracebacks on the paths touched by this sprint. Never writes / mutates.

Suggested run cadence: T+15 min, T+1 h, T+6 h, T+24 h after deploy.

USAGE (from anywhere with production MONGO_URL in scope — e.g. Emergent
support running from prod pod, or any tool with read credentials):

    MONGO_URL='<prod-uri>' DB_NAME='<prod-db>' \
        python nav006_post_deploy_monitor.py

Optional: change the LOOKBACK by exporting SINCE_MINUTES=1440 (24 hours).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient

# Paths this sprint touched. Any 5xx traceback on these post-deploy is a
# candidate regression from NAV-006 P1/P1B.
WATCHED_PATHS = [
    "/api/diagnostics/queue",
    "/api/diagnostics/queue/start",
    "/api/diagnostics/queue/complete",
    "/api/sessions",
]

SINCE_MINUTES = int(os.environ.get("SINCE_MINUTES", "60"))


def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not (mongo_url and db_name):
        print("ERROR: MONGO_URL and DB_NAME must be set (prod)", file=sys.stderr)
        return 2

    since = datetime.now(timezone.utc) - timedelta(minutes=SINCE_MINUTES)
    print(f"Lookback: {SINCE_MINUTES} min · since {since.isoformat()}")
    print(f"Watched paths: {WATCHED_PATHS}")
    print("-" * 78)

    db = MongoClient(mongo_url)[db_name]

    grand_total = 0
    for path in WATCHED_PATHS:
        q = {"path": path, "at": {"$gte": since}}
        n = db.error_logs.count_documents(q)
        grand_total += n
        # top 3 exception types
        pipeline = [
            {"$match": q},
            {"$group": {"_id": "$exception_type", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": 3},
        ]
        top = list(db.error_logs.aggregate(pipeline))
        top_str = ", ".join(f"{r['_id']}={r['n']}" for r in top) if top else "—"
        marker = "  🚨" if n else "  ✓"
        print(f"{marker} {path:<40s}  {n:>4d} errors  ({top_str})")

    print("-" * 78)
    if grand_total == 0:
        print("✅ NO regressions detected in the last "
              f"{SINCE_MINUTES} min on any NAV-006 touched path.")
    else:
        print(f"⚠  {grand_total} traceback(s) observed. Sample the newest:")
        for doc in db.error_logs.find(
            {"path": {"$in": WATCHED_PATHS}, "at": {"$gte": since}},
            {"_id": 0, "at": 1, "path": 1, "exception_type": 1, "message": 1},
        ).sort("at", -1).limit(3):
            print(f"  {doc.get('at')} {doc.get('path')} "
                  f"{doc.get('exception_type')}: {(doc.get('message') or '')[:120]}")

    return 0 if grand_total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
