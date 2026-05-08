"""AUDINEXA — Mongo backup script.

Wraps `mongodump` with sane defaults and produces a single gzipped BSON
archive per run. Survives missing optional dependencies (boto3, schedulers).

Usage
-----
    # Manual one-off
    python -m scripts.backup_mongo

    # From a cron / APScheduler / supervisor invocation — same command,
    # behaviour identical.

Environment
-----------
* `MONGO_URL`              — required (read from backend/.env via load_dotenv)
* `DB_NAME`                — required
* `BACKUP_DIR`             — local target dir (default `/app/backups`)
* `BACKUP_RETENTION_DAYS`  — local file retention (default 14)
* `BACKUP_S3_BUCKET`       — optional offsite mirror
* `BACKUP_S3_ENDPOINT_URL` — optional (S3-compatible: B2 / R2 / Wasabi)
* `BACKUP_S3_PREFIX`       — optional key prefix (default `audinexa-backups/`)
* `BACKUP_S3_REGION`       — default `ap-south-1`
* `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — boto3 standard

Output
------
Prints (line-buffered) a JSON status doc — easy to consume from the admin
endpoint or a log scraper:

    {"ok": true, "filename": "...", "size_bytes": 12345, "duration_s": 4.2,
     "uploaded_to_s3": false, "retained_local_files": 5}

Why mongodump and not pymongo?
------------------------------
`mongodump --gzip --archive` produces a single restorable BSON stream with
full type fidelity (ObjectId, Decimal128, Date) — round-trips perfectly via
`mongorestore`. A pure-pymongo JSON dumper would lose Decimal128 precision
and force us to re-implement BSON encoding. `mongodump` is in the container.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional


def _log(payload: dict) -> None:
    """One-line JSON log so the wrapping admin endpoint can parse stdout."""
    print(json.dumps(payload, default=str), flush=True)


def _load_dotenv() -> None:
    """Best-effort .env load — keeps the script runnable from a bare cron."""
    try:
        from dotenv import load_dotenv  # noqa: WPS433
        backend_env = Path(__file__).resolve().parent.parent / ".env"
        if backend_env.is_file():
            load_dotenv(backend_env)
    except ImportError:
        pass


def _redact_uri(uri: str) -> str:
    """For logging — remove password from `mongodb://user:pass@host/db`."""
    if not uri or "@" not in uri:
        return uri
    head, tail = uri.split("@", 1)
    if "://" in head and ":" in head.split("://", 1)[1]:
        proto, creds = head.split("://", 1)
        user = creds.split(":", 1)[0]
        return f"{proto}://{user}:****@{tail}"
    return uri


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _run_mongodump(uri: str, db_name: str, target: Path) -> tuple[bool, str]:
    """Returns (success, stderr_tail)."""
    cmd = [
        "mongodump",
        f"--uri={uri}",
        f"--db={db_name}",
        "--gzip",
        f"--archive={target}",
        "--quiet",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 30)
    return proc.returncode == 0, (proc.stderr or proc.stdout or "")[-2000:]


def _rotate_local(backup_dir: Path, retention_days: int) -> int:
    """Drop archives older than the retention window. Returns # kept."""
    cutoff = time.time() - (retention_days * 86400)
    kept = 0
    for f in backup_dir.glob("audinexa-*.archive.gz"):
        if f.stat().st_mtime < cutoff:
            try:
                f.unlink()
            except OSError:
                pass
        else:
            kept += 1
    return kept


def _upload_to_s3(local: Path, *, bucket: str, key: str,
                  endpoint_url: Optional[str], region: str) -> dict:
    """Optional offsite mirror. Returns {'ok', 'bucket', 'key', 'error'}."""
    try:
        import boto3  # noqa: WPS433
    except ImportError:
        return {"ok": False, "error": "boto3 not installed"}
    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            region_name=region,
        )
        with local.open("rb") as fh:
            s3.upload_fileobj(fh, bucket, key)
        return {"ok": True, "bucket": bucket, "key": key,
                "endpoint_url": endpoint_url}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    started_at = time.time()
    _load_dotenv()

    mongo_uri = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_uri or not db_name:
        _log({"ok": False, "error": "MONGO_URL or DB_NAME missing in env"})
        return 2
    if shutil.which("mongodump") is None:
        _log({"ok": False, "error": "mongodump not installed in container"})
        return 3

    backup_dir = Path(os.environ.get("BACKUP_DIR", "/app/backups"))
    retention_days = int(os.environ.get("BACKUP_RETENTION_DAYS", "14"))
    _ensure_dir(backup_dir)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_name = f"audinexa-{db_name}-{ts}.archive.gz"
    archive_path = backup_dir / archive_name

    _log({"event": "backup.start", "uri": _redact_uri(mongo_uri),
          "db": db_name, "archive": str(archive_path)})

    ok, err_tail = _run_mongodump(mongo_uri, db_name, archive_path)
    if not ok or not archive_path.exists():
        _log({"ok": False, "event": "backup.failed",
              "stderr_tail": err_tail})
        # Cleanup partial file
        try:
            archive_path.unlink(missing_ok=True)
        except OSError:
            pass
        return 4

    size = archive_path.stat().st_size
    duration_s = round(time.time() - started_at, 2)

    # --- Optional offsite mirror ---
    s3_result: Optional[dict] = None
    s3_bucket = os.environ.get("BACKUP_S3_BUCKET")
    if s3_bucket:
        prefix = os.environ.get("BACKUP_S3_PREFIX", "audinexa-backups/")
        if prefix and not prefix.endswith("/"):
            prefix = prefix + "/"
        s3_result = _upload_to_s3(
            archive_path,
            bucket=s3_bucket,
            key=f"{prefix}{archive_name}",
            endpoint_url=os.environ.get("BACKUP_S3_ENDPOINT_URL"),
            region=os.environ.get("BACKUP_S3_REGION", "ap-south-1"),
        )
        if s3_result.get("ok"):
            _log({"event": "backup.s3_uploaded", **s3_result})
        else:
            _log({"event": "backup.s3_failed", **s3_result})

    kept = _rotate_local(backup_dir, retention_days)

    _log({
        "ok": True,
        "event": "backup.done",
        "filename": archive_name,
        "path": str(archive_path),
        "size_bytes": size,
        "size_mb": round(size / 1024 / 1024, 2),
        "duration_s": duration_s,
        "retained_local_files": kept,
        "uploaded_to_s3": bool(s3_result and s3_result.get("ok")),
        "s3": s3_result,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
