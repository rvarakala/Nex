"""Founder Panel — backup admin endpoints.

* `GET  /api/admin/v2/backups`            — list local + S3 archives + last run
* `POST /api/admin/v2/backups/run-now`    — trigger a backup synchronously
* `GET  /api/admin/v2/backups/config`     — show current schedule + paths

Also wires up an in-process APScheduler so a daily backup happens at 03:00 IST
without a separate cron daemon. Skip the scheduler with `BACKUP_DISABLED=1`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import require_roles
from database import get_db


_log = logging.getLogger("audinexa.backups")

router = APIRouter(prefix="/api/admin/v2/backups", tags=["admin-backups"])

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/backups"))


def _run_backup_subprocess() -> dict:
    """Invoke `python -m scripts.backup_mongo` and return the parsed final
    JSON status line. Runs in a worker thread (subprocess is sync)."""
    backend_dir = Path(__file__).resolve().parent.parent  # /app/backend
    proc = subprocess.run(
        [sys.executable, "-m", "scripts.backup_mongo"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
        timeout=60 * 30,
    )
    last_status: dict = {}
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            doc = json.loads(line)
        except json.JSONDecodeError:
            continue
        if doc.get("event") == "backup.done" or doc.get("ok") is False:
            last_status = doc
    if not last_status:
        last_status = {
            "ok": False,
            "error": f"backup script did not emit a final status (rc={proc.returncode})",
            "stderr_tail": (proc.stderr or "")[-1500:],
        }
    last_status.setdefault("ok", False)
    return last_status


@router.get("/config")
async def get_backup_config(_=Depends(require_roles("founder"))):
    """Returns the live config so the founder can confirm env vars + paths."""
    return {
        "backup_dir": str(BACKUP_DIR),
        "retention_days": int(os.environ.get("BACKUP_RETENTION_DAYS", "14")),
        "s3_bucket": os.environ.get("BACKUP_S3_BUCKET") or None,
        "s3_endpoint_url": os.environ.get("BACKUP_S3_ENDPOINT_URL") or None,
        "s3_prefix": os.environ.get("BACKUP_S3_PREFIX", "audinexa-backups/"),
        "s3_region": os.environ.get("BACKUP_S3_REGION", "ap-south-1"),
        "scheduler_enabled": os.environ.get("BACKUP_DISABLED", "0") != "1",
        "schedule_time_ist": os.environ.get("BACKUP_DAILY_TIME_IST", "03:00"),
    }


@router.get("")
async def list_backups(
    user=Depends(require_roles("founder", "super_admin")),
    db=Depends(get_db),
):
    """Lists local archives (always) + last run history (from
    `backup_history` collection) + S3 keys when configured."""
    files: list[dict] = []
    if BACKUP_DIR.is_dir():
        for f in sorted(BACKUP_DIR.glob("audinexa-*.archive.gz"),
                        key=lambda p: p.stat().st_mtime, reverse=True):
            st = f.stat()
            files.append({
                "filename": f.name,
                "path": str(f),
                "size_bytes": st.st_size,
                "size_mb": round(st.st_size / 1024 / 1024, 2),
                "modified_at": datetime.fromtimestamp(
                    st.st_mtime, tz=timezone.utc).isoformat(),
            })
    history = await (
        db.backup_history.find({}, {"_id": 0})
        .sort("at", -1).limit(50).to_list(50)
    )
    s3_objects: list[dict] = []
    bucket = os.environ.get("BACKUP_S3_BUCKET")
    if bucket:
        try:
            import boto3  # noqa: WPS433
            s3 = boto3.client(
                "s3",
                endpoint_url=os.environ.get("BACKUP_S3_ENDPOINT_URL") or None,
                region_name=os.environ.get("BACKUP_S3_REGION", "ap-south-1"),
            )
            prefix = os.environ.get("BACKUP_S3_PREFIX", "audinexa-backups/")
            resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=50)
            for obj in resp.get("Contents", [])[:50]:
                s3_objects.append({
                    "key": obj["Key"],
                    "size_bytes": obj["Size"],
                    "size_mb": round(obj["Size"] / 1024 / 1024, 2),
                    "last_modified": obj["LastModified"].isoformat(),
                })
        except Exception as exc:  # noqa: BLE001
            s3_objects = [{"_error": f"{type(exc).__name__}: {exc}"}]

    return {
        "local_files": files,
        "s3_objects": s3_objects,
        "history": history,
        "config": await get_backup_config(),
    }


@router.post("/run-now")
async def run_backup_now(
    user=Depends(require_roles("founder")),
    db=Depends(get_db),
):
    """Triggers one backup synchronously. Returns the parsed status doc and
    persists it to `backup_history`."""
    started = datetime.now(timezone.utc)
    status = await asyncio.to_thread(_run_backup_subprocess)
    record = {
        "at": started,
        "triggered_by": "manual",
        "actor_user_id": user.get("user_id"),
        "actor_email": user.get("email"),
        "ok": bool(status.get("ok")),
        "filename": status.get("filename"),
        "size_mb": status.get("size_mb"),
        "duration_s": status.get("duration_s"),
        "uploaded_to_s3": bool(status.get("uploaded_to_s3")),
        "error": status.get("error") or status.get("stderr_tail"),
    }
    try:
        await db.backup_history.insert_one(record)
    except Exception as exc:  # noqa: BLE001
        _log.warning("backup_history insert failed: %s", exc)
    if not status.get("ok"):
        raise HTTPException(status_code=500, detail=status)
    return status


# ---------------------------------------------------------------------------
# In-process scheduler (called from server.py lifespan)
# ---------------------------------------------------------------------------
_scheduler = None  # set lazily by setup_backup_scheduler()


def setup_backup_scheduler(db) -> None:
    """Idempotent. Wires a daily APScheduler job at the configured IST
    time. Skips entirely when BACKUP_DISABLED=1.

    Why in-process: keeps the deploy footprint single-binary. For a 500-
    clinic SaaS this is more than enough. If you ever outgrow it, swap
    to an external cron / sidecar — the script is identical, the scheduler
    is just sugar.
    """
    global _scheduler
    if os.environ.get("BACKUP_DISABLED") == "1":
        _log.info("backup scheduler disabled via BACKUP_DISABLED=1")
        return
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError as exc:
        _log.warning("apscheduler not installed; daily backup disabled: %s", exc)
        return

    time_ist = os.environ.get("BACKUP_DAILY_TIME_IST", "03:00")
    try:
        hh, mm = (int(x) for x in time_ist.split(":"))
    except (ValueError, TypeError):
        hh, mm = 3, 0

    sched = AsyncIOScheduler(timezone="Asia/Kolkata")

    async def _scheduled_run() -> None:
        try:
            status = await asyncio.to_thread(_run_backup_subprocess)
            await db.backup_history.insert_one({
                "at": datetime.now(timezone.utc),
                "triggered_by": "scheduled",
                "actor_user_id": None,
                "actor_email": "scheduler",
                "ok": bool(status.get("ok")),
                "filename": status.get("filename"),
                "size_mb": status.get("size_mb"),
                "duration_s": status.get("duration_s"),
                "uploaded_to_s3": bool(status.get("uploaded_to_s3")),
                "error": status.get("error") or status.get("stderr_tail"),
            })
            if status.get("ok"):
                _log.info("scheduled backup OK: %s (%.2fMB)",
                          status.get("filename"), status.get("size_mb", 0))
            else:
                _log.warning("scheduled backup FAILED: %s",
                             status.get("error") or "unknown")
        except Exception as exc:  # noqa: BLE001
            _log.error("scheduled backup raised: %s", exc)

    sched.add_job(
        _scheduled_run,
        trigger=CronTrigger(hour=hh, minute=mm, timezone="Asia/Kolkata"),
        id="audinexa.daily_backup",
        replace_existing=True,
        misfire_grace_time=60 * 60 * 6,  # tolerate 6h late if container restarted
    )
    sched.start()
    _scheduler = sched
    _log.info("backup scheduler started — daily %02d:%02d IST", hh, mm)


def shutdown_backup_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            pass
        _scheduler = None
