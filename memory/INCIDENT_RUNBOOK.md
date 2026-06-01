# AUDINEXA — Incident Response Runbook

> **Purpose:** The "what do I do at 2am" playbook for AUDINEXA — written so an
> on-call founder/super-admin (or Emergent Support) can stabilise the platform
> end-to-end without re-reading every PRD section. Keep this short, ordered,
> and updated after every real incident.

| Field | Value |
|---|---|
| **Primary on-call inbox** | `lead@audinexa.com` |
| **Production URL** | https://audinexa.com |
| **Public status page** | https://audinexa.com/status |
| **Backend logs** | `tail -n 400 /var/log/supervisor/backend.*.log` |
| **DB** | Preview & prod MongoDB via `MONGO_URL` in `/app/backend/.env` |
| **Email error alerts** | `ERROR_ALERT_EMAIL_TO=lead@audinexa.com` (configured) |

---

## 0. Triage — what's actually on fire? (≤ 60 sec)

1. **Open `/status`** (https://audinexa.com/status) — the public status page tells
   you which component is red (Mongo, ZeptoMail, Twilio, MSG91, Razorpay, Backups).
2. **Check `/api/health`** → expect `200 {"ok": true, ...}`.
3. **Skim recent errors:** Founder Panel → **Ops → Errors** (last 1h, group by
   fingerprint). Top fingerprint usually points to the root cause.
4. **Decide severity:**
   - **SEV-1** — clinics can't log in, can't save, data corruption/loss → page everyone.
   - **SEV-2** — one integration down (Email/SMS/WhatsApp), clinics still usable.
   - **SEV-3** — degraded UX, perf, single-tenant bug.

---

## 1. Backend is down / 5xx everywhere

**Symptoms:** `/api/health` is 502/504, login page hangs, status page can't load.

```bash
# Inside the backend container
sudo supervisorctl status backend
tail -n 200 /var/log/supervisor/backend.err.log
```

**Common causes & fixes:**
- **Import error / syntax bomb after deploy** → backend boot loops. Logs will
  show the traceback. Roll back via Emergent **Rollback** to the previous green
  build.
- **Out of memory / disk full** → `df -h` and `free -m`. Old archives in
  `/app/backups/` are the usual culprit — `BACKUP_RETENTION_DAYS=14` keeps it
  bounded, but a stuck run can leave a giant temp file.
- **Mongo unreachable** → see §3.

**Restart command:** `sudo supervisorctl restart backend` (only after the
root cause is clear).

---

## 2. Frontend white-screening / blank page

1. Open browser console → React error boundary or chunk-load failure?
2. If it's a **chunk-load failure** (CDN/build mismatch) → ask the user to hard
   refresh (Ctrl+Shift+R). If everyone is hitting it, redeploy frontend.
3. If it's a **render crash** caught by `<AppErrorBoundary>`, the user sees the
   "Something went wrong" screen + the crash is auto-logged. Open Founder Panel
   → **Ops → Errors** → filter `kind=frontend` → click the top row → read the
   component stack → fix the offending component.

---

## 3. MongoDB outage / failover

**Symptoms:** `/status` shows **Database: Outage**, every endpoint 500s with
"server selection timeout".

1. **Confirm:** `python3 -c "from pymongo import MongoClient; import os; MongoClient(os.environ['MONGO_URL']).admin.command('ping')"`
2. **Failover:** If using a managed cluster (Atlas / DocumentDB), the cluster
   should auto-failover within ~30s. If it doesn't, escalate to the DB
   provider's incident channel.
3. **Restore from backup if data was corrupted:**
   ```bash
   cd /app/backend
   set -a && source .env && set +a
   python3 scripts/restore_mongo.py --archive /app/backups/<latest>.archive.gz \
     --confirm I-UNDERSTAND-THIS-WIPES-DATA
   ```
   The restore script **always** takes a fresh safety backup first. Restore on
   the preview environment took ~4s for the full DB — production will be
   similar.
4. After Mongo is back, `sudo supervisorctl restart backend` so the connection
   pool starts clean.

---

## 4. Email outage (ZeptoMail down)

**Symptoms:** `/status` shows **Email: Operational** (credentials present is all
we can probe without sending), but appointment confirmations / OTPs / password
resets aren't landing.

1. **Test from Founder UI:** `/admin/settings` → "Send test email". Look for a
   non-200 or an SMTP error in `/var/log/supervisor/backend.err.log` (grep for
   `zepto`).
2. **Check ZeptoMail dashboard** (zoho.com/zeptomail) — auth issues / quota /
   account suspended are the 90% reasons.
3. **No-fix fallback:** Password reset and OTP can be issued manually by a
   founder via Founder Panel → User Detail → "Send password reset link"
   (returns the link directly so it can be hand-delivered via WhatsApp/SMS).
4. **Async impact:** Emails now run via `BackgroundTasks`, so a ZeptoMail outage
   does **not** stall the request thread. New failures are logged + alerter
   fires at 5/hr threshold.

---

## 5. SMS outage (Twilio down or trial-account block)

**Symptoms:** Appointment SMS not received, status page Twilio = unknown/degraded.

1. **Verify creds:** `/admin/settings` → "Send test SMS" to a verified number.
2. **Trial account caveat:** Twilio trial only sends to **verified caller IDs**.
   New patient mobile numbers will silently 422. Either verify the number on
   Twilio console, or migrate to a paid Twilio account.
3. **No-fix fallback:** Notifications can be sent manually via WhatsApp Web
   from the clinic phone. SMS is best-effort; nothing in the app blocks on an
   SMS send.

---

## 6. WhatsApp outage (MSG91)

Currently MOCKED — Phase 2 awaiting the Hosted Sender Number from owner. Until
then this component shows **Unknown** on `/status` (intentional) and any
WhatsApp call returns a stub. No incident handling needed beyond "tell the user
it's not live yet".

---

## 7. Payment outage (Razorpay)

**Symptoms:** `/status` shows **Payments: Outage**, "Add Payment" flow fails.

1. Check status.razorpay.com.
2. **Workaround:** Mark invoice paid manually with `payment_mode=cash/cheque/
   bank_transfer` and the actual reference number. Online flow auto-resumes
   when Razorpay is back.
3. If keys are rotated → update `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` in
   `/app/backend/.env` and `sudo supervisorctl restart backend`.

---

## 8. Daily backup didn't run

**Symptoms:** `/status` shows **Daily backups: Degraded** (>30h since last
success) or **Outage** (>72h).

1. **Verify the scheduler is alive:** `GET /api/admin/v2/backups/config` →
   confirm `BACKUP_DISABLED=0` and the cron time hasn't been changed.
2. **Run on demand:** `POST /api/admin/v2/backups/run-now` (founder-only).
   Should complete in <1s on preview.
3. **Disk pressure?** `df -h /app/backups` — if >90%, drop the oldest archive
   or lower `BACKUP_RETENTION_DAYS`.
4. **Long-term fix:** Set `BACKUP_S3_BUCKET` so archives mirror off-pod and
   local disk isn't the single point of failure. The local disk dies with the
   container — **this is still TODO for production**.

---

## 9. Admin account lockout (brute force / leaked password)

**Brute force lockout on a real user:**
1. Founder Panel → Users → search → "Reset login throttling" (clears the
   `login_attempts` counter for that email/IP).

**Suspected credential leak:**
1. Founder Panel → User Detail → "Force password reset" (invalidates current
   sessions + sends reset link).
2. Founder Panel → Sessions audit → revoke any sessions you don't recognise
   (Gmail-style: by device + IP + last_seen).
3. **2FA enforcement:** super_admin + founder accounts auto-block after the
   7-day grace window without 2FA — pre-empts this entire class of attack.

**Lost 2FA device:**
1. User uses one of the **10 recovery codes** issued during 2FA enrolment
   (single-use, bcrypt-hashed).
2. If recovery codes are also lost → founder runs `python3 -c "from auth
   import disable_mfa_for_user; disable_mfa_for_user('user@example.com')"`
   after verifying identity out-of-band (phone call / govt ID).

---

## 10. Rate-limit flood (tenant or IP)

**Symptoms:** A particular clinic sees `429 Too Many Requests`, or `/status`
shows API degraded.

1. The limiter keys by `clinic:<clinic_id>` from the JWT (so one runaway clinic
   doesn't drag others down). Default ceiling: **600/minute per clinic**.
2. Identify the offending clinic from `/var/log/supervisor/backend.err.log` →
   grep `429`.
3. If it's a misbehaving UI loop (typical), tell the owner to refresh / contact
   support to clear browser state.
4. If it's a legit high-throughput tenant, bump their limit via slowapi config
   or expose a per-tenant override.

---

## 11. Mass crash spike (error alerter fires)

When the **error spike alerter** emails `lead@audinexa.com` "5+ same-fingerprint
errors in 60min":

1. Click the deep link in the email → lands on Founder Panel → Ops → Errors
   filtered to that fingerprint.
2. Look at the **traceback** (top frame is the actual bug, usually in
   `routers/...`).
3. If it's a release-introduced regression → **Rollback** via Emergent platform.
4. If it's a single-clinic data issue → fix the data via a script in
   `/app/backend/scripts/` and commit it as a one-off migration.
5. Always write a regression `test_*.py` so the bug can't silently come back.

---

## 12. Production database script execution

The preview pod can run scripts directly (`python3 scripts/<x>.py`). **Production
is sandboxed** — you cannot SSH in.

**Options for prod scripts:**
- **A.** Open an Emergent Support ticket: "Please run
  `scripts/backfill_serial_current_patient_id.py --apply` on production." They
  exec it inside the prod container.
- **B.** Add a founder-only admin endpoint that wraps the script (preferred for
  scripts that may need to be re-run — e.g. legacy data backfills).

**Current outstanding script:** `backfill_serial_current_patient_id.py` — fixes
legacy serial_items missing `current_patient_id` so the Service & Repair
"unit picker" works for old sales. Ran on preview (32 rows). **Still TODO on prod.**

---

## 13. After-action

Within 24h of any SEV-1/SEV-2 incident:

1. Add an entry to `/app/memory/PRD.md` under a new "## 🚨 INCIDENT — *title*"
   section: symptoms, root cause, fix, files, prevention.
2. Add a regression test under `/app/backend/tests/` that would have caught it.
3. Add any new env var / runbook step here.

---

**Last updated:** 2026-02 — fork session, alongside the 4-item 500-user launch
readiness batch (per-tenant rate limit + new-device email alert + public
status page + this runbook).
