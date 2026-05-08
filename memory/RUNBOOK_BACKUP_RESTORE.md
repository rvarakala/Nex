# AUDINEXA — Backup & Restore Runbook

> **For the panicked you at 2am.** Read top-down. Don't skip steps. Don't be clever.

## 0. Quick reference — call before the panic

| Question | Answer |
|---|---|
| Where do backups live? | `/app/backups/` inside the backend container |
| Naming pattern | `audinexa-<DB_NAME>-YYYYMMDDTHHMMSSZ.archive.gz` |
| Schedule | Daily at **03:00 IST** (in-process APScheduler) |
| Retention | 14 days local. Old files auto-delete. |
| Offsite mirror? | Only if `BACKUP_S3_BUCKET` env var is set. Today: **NOT configured** — fix this before launch. |
| Format | `mongodump --gzip --archive` (single restorable BSON stream) |
| Founder UI | `GET /api/admin/v2/backups`, `POST /api/admin/v2/backups/run-now` |

---

## 1. Verify backups are happening (do this every Monday)

Two minute health check.

### 1.1 From the founder API
```bash
curl -s -X POST https://audinexa.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"founder@audinexa.com","password":"YOUR_FOUNDER_PASSWORD"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])" \
  | xargs -I{} curl -s "https://audinexa.com/api/admin/v2/backups" -H "Authorization: Bearer {}" \
  | python3 -m json.tool
```
You should see `local_files` ≥ 1 with a `modified_at` from today, and `history[0].triggered_by="scheduled"` from this morning.

### 1.2 Red flags
- Newest backup is older than 36 hours → scheduler is broken. Check backend logs for `audinexa.backups`.
- `history[0].ok=false` → see the `error` field. Probably ran out of disk or Mongo URL changed.
- Same backup `size_mb` 14 days in a row → suspicious. Either nothing's changing, or the dump is silently empty.

---

## 2. Trigger an emergency manual backup

Before doing anything risky (large migration, schema change, customer import, restoring an old backup) — **always take a fresh backup first.**

```bash
# Founder UI (preferred)
curl -X POST https://audinexa.com/api/admin/v2/backups/run-now \
  -H "Authorization: Bearer <FOUNDER_TOKEN>"
```

OR straight from the container:
```bash
cd /app/backend && python -m scripts.backup_mongo
```

Both finish in seconds for current data size, ~2-5 minutes once you have 500 clinics.

---

## 3. Restore — destructive operation, you only do this when something's already on fire

**RULE OF THUMB:** Before running restore, take a fresh manual backup of the current (broken) state. Step 2 above does this automatically as the "safety backup", but doing it explicitly costs nothing and gives you peace of mind.

### 3.1 Dry-run FIRST. Always.
```bash
cd /app/backend && python -m scripts.restore_mongo \
  --archive /app/backups/audinexa-<DB>-<TIMESTAMP>.archive.gz \
  --dry-run
```
This validates the archive without touching the live DB. If you see anything other than `ok: true`, **stop and check the archive file**.

### 3.2 The actual restore
```bash
cd /app/backend && python -m scripts.restore_mongo \
  --archive /app/backups/audinexa-<DB>-<TIMESTAMP>.archive.gz \
  --confirm I-UNDERSTAND-THIS-WIPES-DATA
```
The `--confirm` string is intentionally ugly. If you can't be bothered to type it, you shouldn't be running restore.

The script:
1. Takes a fresh **safety backup** of current state → `/app/backups/pre-restore-<TS>.archive.gz` (skip with `--no-safety-backup` — DON'T)
2. Runs `mongorestore --drop` (wipes existing collections in `DB_NAME`, then re-imports)
3. Logs duration + final status

### 3.3 After restore — REQUIRED
```bash
sudo supervisorctl restart backend
```
Backend caches, in-memory rate limiters, and APScheduler jobs need to pick up the restored data.

### 3.4 Verify
```bash
# Founder login → /api/admin/v2/dashboard should show plausible KPIs
# Or sanity check from the container:
cd /app/backend && python -c "
import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('.env')
async def go():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ['DB_NAME']]
    print('patients:', await db.patients.count_documents({}))
    print('clinics: ', await db.clinics.count_documents({}))
    print('users:   ', await db.users.count_documents({}))
asyncio.run(go())
"
```

---

## 4. Restore from S3 (only when local is gone)

Requires `BACKUP_S3_BUCKET` + `AWS_*` env vars set.

```bash
cd /app/backend && python -m scripts.restore_mongo \
  --s3-key audinexa-backups/audinexa-<DB>-<TIMESTAMP>.archive.gz \
  --confirm I-UNDERSTAND-THIS-WIPES-DATA
```

---

## 5. Failure scenarios + responses

| What happened | First action | Then |
|---|---|---|
| Customer says "all my data is gone!" | **Verify with them** — don't restore on a hunch. Often it's a filter / search bug or wrong tenant. | If real data loss confirmed → take fresh backup of current state, then restore from this morning's snapshot. |
| Container disk full, scheduler is failing | `df -h /app/backups` → if >80%, manually delete older `audinexa-*.archive.gz` files keeping last 3 | Lower `BACKUP_RETENTION_DAYS` or add an S3 mirror |
| Scheduler stopped firing (no backup for 36h) | `sudo supervisorctl restart backend` | Check `audinexa.backups` log lines on next boot — should say "backup scheduler started" |
| `mongodump` fails with "auth failed" | Check `MONGO_URL` in `/app/backend/.env` | Recreate from your DB password manager |
| Restore succeeds but app shows stale data | `sudo supervisorctl restart backend` | Hard-refresh browser; localStorage may have stale tokens |
| Restore fails halfway through | Don't panic — your DB is now in a partial state | Restore from the **safety backup** that was created 30 seconds before: `/app/backups/pre-restore-*.archive.gz` |

---

## 6. To-do before going live with 500 clinics

- [ ] **Configure offsite mirror** — set `BACKUP_S3_BUCKET` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` in production env. (Local backups die when the container dies. They are **not** disaster recovery.)
- [ ] **Test restore quarterly** — schedule a calendar reminder to run the dry-run + actual restore-to-staging at least once every 3 months. Untested backups are tombstones.
- [ ] **Document your S3 credentials in the company password vault** — locked behind 2FA, rotation policy.
- [ ] **Set up a Mongo Atlas dedicated tier** (M10+) which gives you point-in-time recovery for free — and treat this script as the secondary safety net.

---

## 7. Configuration reference

All env vars (set in `/app/backend/.env`):

| Var | Default | Purpose |
|---|---|---|
| `MONGO_URL` | _required_ | Source of truth, where dumps come from |
| `DB_NAME` | _required_ | Which database to back up |
| `BACKUP_DIR` | `/app/backups` | Local target dir |
| `BACKUP_RETENTION_DAYS` | `14` | Delete local files older than this |
| `BACKUP_DAILY_TIME_IST` | `03:00` | When the daily scheduler fires (Asia/Kolkata) |
| `BACKUP_DISABLED` | `0` | Set to `1` to disable the in-process scheduler |
| `BACKUP_S3_BUCKET` | _empty_ | If set, mirror each backup offsite |
| `BACKUP_S3_ENDPOINT_URL` | _empty_ | For S3-compatible (B2, R2, Wasabi) |
| `BACKUP_S3_PREFIX` | `audinexa-backups/` | Key prefix |
| `BACKUP_S3_REGION` | `ap-south-1` | AWS region |
| `AWS_ACCESS_KEY_ID` | _empty_ | boto3 standard |
| `AWS_SECRET_ACCESS_KEY` | _empty_ | boto3 standard |

---

## 8. Last verified

| When | Result |
|---|---|
| 2026-05-08 | End-to-end drill: backup → wipe sentinel → restore → verify counts match. Pass. Restore took 3.94s for ~200KB archive. Safety-backup auto-created. |

(Update this row every time you re-test.)
