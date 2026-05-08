"""AUDINEXA — Mongo restore script. Counterpart to `backup_mongo.py`.

⚠️  RESTORE IS DESTRUCTIVE — refuses to run without an explicit confirmation
    flag because `mongorestore --drop` blows away all existing collections
    in `DB_NAME` before re-importing.

Usage
-----
    # Dry-run — validates the archive and prints what *would* happen:
    python -m scripts.restore_mongo --archive /app/backups/audinexa-...gz --dry-run

    # Real restore (destructive — backs up current state first as a safety net):
    python -m scripts.restore_mongo --archive /app/backups/audinexa-...gz \
        --confirm I-UNDERSTAND-THIS-WIPES-DATA

    # Restore from S3 (requires BACKUP_S3_* env + boto3 creds):
    python -m scripts.restore_mongo --s3-key audinexa-backups/audinexa-...gz \
        --confirm I-UNDERSTAND-THIS-WIPES-DATA

Safety net
----------
Before executing the destructive restore, the script ALWAYS triggers one
fresh backup of the current state to `<BACKUP_DIR>/pre-restore-<timestamp>`
so an Oh-Shit moment is recoverable. Skip with `--no-safety-backup`.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

# Reuse helpers from the backup module to keep behaviour consistent.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.backup_mongo import (  # type: ignore[import]
    _load_dotenv,
    _redact_uri,
    _run_mongodump,
)


def _log(payload: dict) -> None:
    print(json.dumps(payload, default=str), flush=True)


def _download_from_s3(key: str, target: Path) -> dict:
    try:
        import boto3  # noqa: WPS433
    except ImportError:
        return {"ok": False, "error": "boto3 not installed"}
    bucket = os.environ.get("BACKUP_S3_BUCKET")
    if not bucket:
        return {"ok": False, "error": "BACKUP_S3_BUCKET missing"}
    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=os.environ.get("BACKUP_S3_ENDPOINT_URL") or None,
            region_name=os.environ.get("BACKUP_S3_REGION", "ap-south-1"),
        )
        s3.download_file(bucket, key, str(target))
        return {"ok": True, "bytes": target.stat().st_size}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _safety_backup(uri: str, db_name: str, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = backup_dir / f"pre-restore-{db_name}-{ts}.archive.gz"
    ok, err = _run_mongodump(uri, db_name, target)
    if not ok:
        raise RuntimeError(f"safety backup failed before restore: {err}")
    return target


def _do_restore(uri: str, db_name: str, archive: Path) -> tuple[bool, str]:
    cmd = [
        "mongorestore",
        f"--uri={uri}",
        f"--nsInclude={db_name}.*",
        "--gzip",
        f"--archive={archive}",
        "--drop",
        "--quiet",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 30)
    return proc.returncode == 0, (proc.stderr or proc.stdout or "")[-2000:]


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore AUDINEXA Mongo from archive")
    parser.add_argument("--archive", help="Local path to a .archive.gz file")
    parser.add_argument("--s3-key", help="S3 key (under BACKUP_S3_BUCKET) to fetch first")
    parser.add_argument(
        "--confirm",
        help="Required for destructive restore. Must be exactly "
             "'I-UNDERSTAND-THIS-WIPES-DATA'",
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Validate archive + print plan without restoring")
    parser.add_argument("--no-safety-backup", action="store_true",
                        help="Skip the pre-restore backup of current state (NOT recommended)")
    args = parser.parse_args()

    _load_dotenv()
    uri = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not uri or not db_name:
        _log({"ok": False, "error": "MONGO_URL or DB_NAME missing"})
        return 2
    if shutil.which("mongorestore") is None:
        _log({"ok": False, "error": "mongorestore not installed in container"})
        return 3

    if not args.dry_run and args.confirm != "I-UNDERSTAND-THIS-WIPES-DATA":
        _log({"ok": False,
              "error": "Refusing destructive restore without "
                       "--confirm I-UNDERSTAND-THIS-WIPES-DATA "
                       "(or use --dry-run)"})
        return 4

    if not args.archive and not args.s3_key:
        _log({"ok": False, "error": "Specify --archive PATH or --s3-key KEY"})
        return 5

    # Resolve the archive — download from S3 if requested.
    tmp_holder: tempfile.TemporaryDirectory | None = None
    if args.s3_key:
        tmp_holder = tempfile.TemporaryDirectory(prefix="audinexa-restore-")
        local = Path(tmp_holder.name) / Path(args.s3_key).name
        dl = _download_from_s3(args.s3_key, local)
        if not dl.get("ok"):
            _log({"ok": False, "event": "s3.download_failed", **dl})
            return 6
        archive = local
    else:
        archive = Path(args.archive)
    if not archive.is_file():
        _log({"ok": False, "error": f"archive not found: {archive}"})
        return 7

    plan = {
        "uri": _redact_uri(uri),
        "db_name": db_name,
        "archive": str(archive),
        "archive_size_mb": round(archive.stat().st_size / 1024 / 1024, 2),
        "dry_run": args.dry_run,
        "safety_backup": not args.no_safety_backup,
    }
    _log({"event": "restore.plan", **plan})

    if args.dry_run:
        _log({"ok": True, "event": "restore.dry_run_complete",
              "note": "No changes made. Re-run without --dry-run to execute."})
        return 0

    started = time.time()
    safety_path: Path | None = None
    if not args.no_safety_backup:
        try:
            safety_path = _safety_backup(uri, db_name,
                                         Path(os.environ.get("BACKUP_DIR", "/app/backups")))
            _log({"event": "restore.safety_backup_done", "path": str(safety_path)})
        except Exception as exc:  # noqa: BLE001
            _log({"ok": False, "event": "restore.safety_backup_failed",
                  "error": str(exc)})
            return 8

    ok, err_tail = _do_restore(uri, db_name, archive)
    duration_s = round(time.time() - started, 2)
    if not ok:
        _log({"ok": False, "event": "restore.failed",
              "stderr_tail": err_tail, "duration_s": duration_s,
              "safety_backup": str(safety_path) if safety_path else None})
        return 9

    _log({
        "ok": True,
        "event": "restore.done",
        "duration_s": duration_s,
        "archive": str(archive),
        "safety_backup": str(safety_path) if safety_path else None,
        "next_step": "Restart backend (sudo supervisorctl restart backend) "
                     "so all caches/indexes pick up the restored data",
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
