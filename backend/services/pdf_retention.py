"""Hybrid PDF Storage — retention sweeper + storage stats.

Background:
    The platform stores client-rendered audiogram report PDFs in GridFS bucket
    `session_reports` so that "what was printed = what is saved = what the
    patient receives". For long-running tenants this collection becomes the
    biggest storage hog (each blob ~200KB-2MB, 1k+ reports => GBs).

The hybrid model keeps blobs **only for a configurable retention window**
(legal/audit) and then purges them. Subsequent fetches naturally fall through
to the on-demand generator (`pdf_generator.generate_report_pdf`) which
re-renders from the source `test_sessions` + `patients` data.

Configuration:
    * `PDF_RETENTION_DAYS` env var (default 30 days). 0 disables sweeper.

Public API:
    * `purge_expired_session_reports(db)` — async. Returns
      `{"scanned": N, "purged": N, "freed_bytes": N, "retention_days": N}`.
    * `gridfs_storage_stats(db)` — async. Returns per-bucket totals for
      the system health dashboard.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorGridFSBucket

log = logging.getLogger("audinexa.pdf_retention")


def _retention_days() -> int:
    raw = os.environ.get("PDF_RETENTION_DAYS", "30").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 30
    return max(0, n)


# Buckets we currently care about. `clinic_logos`, `user_signatures`,
# `user_avatars`, and `transfer_signatures` are images (small, low churn,
# referenced often) — explicitly NOT swept.
_PDF_BUCKETS = ("session_reports",)


async def purge_expired_session_reports(db, *, retention_days: Optional[int] = None) -> dict:
    """Sweep `session_reports` GridFS for blobs older than retention.
    Idempotent — safe to call repeatedly. Setting `retention_days=0` disables.
    """
    days = _retention_days() if retention_days is None else max(0, int(retention_days))
    if days == 0:
        return {"scanned": 0, "purged": 0, "freed_bytes": 0, "retention_days": 0,
                "skipped": "retention disabled (PDF_RETENTION_DAYS=0)"}

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="session_reports")

    scanned = 0
    purged = 0
    freed = 0
    purged_session_ids: list[str] = []

    cursor = db["session_reports.files"].find(
        {"uploadDate": {"$lt": cutoff}},
        {"_id": 1, "length": 1, "metadata.session_id": 1},
    )
    async for f in cursor:
        scanned += 1
        try:
            await bucket.delete(f["_id"])
            purged += 1
            freed += int(f.get("length") or 0)
            sid = (f.get("metadata") or {}).get("session_id")
            if sid:
                purged_session_ids.append(sid)
        except Exception as exc:  # noqa: BLE001 — log + skip a single bad blob
            log.warning(f"pdf_retention: failed to purge {f.get('_id')}: {exc}")

    # Clear `report_pdf_fs_id` pointer on any sessions whose blobs we purged so
    # the on-demand generator kicks in next time the report is opened.
    if purged_session_ids:
        await db.test_sessions.update_many(
            {"session_id": {"$in": purged_session_ids}},
            {"$set": {"report_pdf_fs_id": None,
                      "report_pdf_purged_at": datetime.now(timezone.utc).isoformat()}},
        )

    if purged:
        log.info(f"pdf_retention: purged {purged}/{scanned} session_reports "
                 f"({freed/1024:.1f} KB) older than {days}d cutoff={cutoff.isoformat()}")
    return {
        "scanned": scanned,
        "purged": purged,
        "freed_bytes": freed,
        "retention_days": days,
        "cutoff_iso": cutoff.isoformat(),
    }


async def gridfs_storage_stats(db) -> dict:
    """Per-bucket size + count totals for the System Health dashboard.

    Includes both PDF buckets we sweep AND non-swept image buckets so admins
    can see the full storage picture.
    """
    out: dict[str, dict] = {}
    all_buckets = (*_PDF_BUCKETS, "clinic_logos", "user_signatures",
                   "user_avatars", "transfer_signatures")
    for b in all_buckets:
        coll = f"{b}.files"
        count = await db[coll].estimated_document_count()
        if count == 0:
            out[b] = {"count": 0, "total_bytes": 0,
                      "swept": b in _PDF_BUCKETS}
            continue
        # Single $group aggregation is O(N) but each `.files` doc is tiny.
        agg = await db[coll].aggregate([
            {"$group": {"_id": None, "total": {"$sum": "$length"}}}
        ]).to_list(1)
        total = int(agg[0]["total"]) if agg else 0
        out[b] = {"count": count, "total_bytes": total,
                  "swept": b in _PDF_BUCKETS}
    return {
        "buckets": out,
        "retention_days": _retention_days(),
        "at": datetime.now(timezone.utc).isoformat(),
    }
