# ACS Audiology Clinic — Test Credentials

## ⚠️ Production Mode (`DISABLE_DEMO_SEED=1`)
When this env var is set on the backend (recommended in production):
- The 4 ACS demo users (`admin@acs.in`, etc.), the second Delhi test clinic, the 4 admin-panel demo tenants, and the sample leads are **NOT** seeded.
- Only the **founder** account is seeded into the platform clinic so the platform owner can sign in.
- Override the founder password by setting `FOUNDER_PASSWORD=<strong-pass>` (also `FOUNDER_EMAIL=<email>` if needed).
- Test credentials below apply to **dev / staging / preview** environments only (where `DISABLE_DEMO_SEED` is unset).

## ⚠️ DEPRECATED — Default Clinic (Mumbai) `clinic-acs-demo`
- **Status (2026-05-06)**: NOT seeded in this environment (`DISABLE_DEMO_SEED=1`). The clinic + 4 users (`admin@acs.in`, `frontdesk@acs.in`, `audiologist@acs.in`, `accounts@acs.in`) are **gone** from preview/prod DB.
- **For local pytest runs** that still reference `admin@acs.in`: spin up a local MongoDB without `DISABLE_DEMO_SEED` so `seeds/demo.py` re-creates the clinic.
- **Migration plan (P2 backlog)**: rewrite the 30+ pytest files to use `founder@audinexa.com` or the sandbox tenant.

| Legacy Role | Email | Password |
|---|---|---|
| Super Admin | `admin@acs.in` | `admin123` |
| Front Desk | `frontdesk@acs.in` | `frontdesk123` |
| Audiologist | `audiologist@acs.in` | `audio123` |
| Accounts | `accounts@acs.in` | `accounts123` |

### Expanded role enum (Phase 1 HA Foundation + Phase 13-14)
Valid roles: `super_admin`, `clinic_owner`, `front_desk`, `audiologist`, `accounts`, `inventory_manager`, `technician`, `referral_partner`, `founder`. `super_admin` and `founder` bypass every `require_roles` + `require_tier` check.

## AUDINEXA Super Admin Panel — Internal Team (Phase 14A/B/C)
- **Founder**: `founder@audinexa.com` / `founder123` — full access + delete-tenant
- **Super Admin**: `admin@acs.in` / `admin123` — all admin except delete-tenant
- **Sales Manager**: `sales@audinexa.com` / `sales123` — leads/marketing/revenue:read
- **Support Agent**: `support@audinexa.com` / `support123` — tickets/impersonate/system:read
- **Finance Manager**: `finance@audinexa.com` / `finance123` — revenue/invoices/subscriptions
- **Product Ops**: `ops@audinexa.com` / `ops123` — features/usage/notifications
- **Read Only Analyst**: `analyst@audinexa.com` / `analyst123` — all read, no write

### Seeded demo tenants (for Admin Panel screenshots)
| Clinic | Tier | Owner email | Password |
|---|---|---|---|
| KIMS Hearing Center (`tenant-kims-hearing`) | PREMIUM | `support@kimshearing.in` | `demo123` |
| Apollo Audiology (`tenant-apollo-audiology`) | PREMIUM | `audiology@apollohospitals.in` | `demo123` |
| SoundCare Hyderabad (`tenant-soundcare-hyd`) | STANDARD | `hello@soundcare.in` | `demo123` |
| ENT Plus Clinic (`tenant-ent-plus`) | BASIC (on trial) | `admin@entplus.in` | `demo123` |


## Second Test Clinic (Delhi — for cross-tenant isolation tests)
- **clinic_id**: `clinic-delhi-test`
- **name**: Delhi Test Branch
- **city**: New Delhi / Delhi
- **MRD prefix**: `DEL`

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@delhi.test` | `delhiadmin123` |
| Front Desk | `frontdesk@delhi.test` | `delhifrontdesk123` |

Use these to verify 403 responses when a Delhi user tries to access Mumbai resources (patients, sessions, invoices, report PDFs, share-links).

## Auth Endpoints
- `POST /api/auth/login` → returns `{access_token, user, clinic}`
- `GET /api/auth/me` → requires `Authorization: Bearer <token>` → returns current user
- Frontend stores token in `localStorage` key `acs.token`; axios interceptor attaches it on every request.

## 🎬 DEMO PREMIUM TENANT — "The Sound Clinic — Bangaluru"
**Use these for client screenshot sessions.** Tenant `tenant-sound-clinic-blr` is fully populated (25 patients, 58 appointments across patient/vendor/sales-rep/internal/tech-staff types, 11 HA sales, fittings, trials, AMC contracts, repair tickets, invoices, referral partners).

Re-seed at any time:
```bash
cd /app/backend && set -a && source .env && set +a && python3 scripts/seed_demo_premium.py
```

| Role | Email | Password | Name |
|---|---|---|---|
| **Clinic Owner** | `owner@thesoundclinic.in` | `demo123` | Dr. Rajesh Iyer |
| Audiologist | `aditi@thesoundclinic.in` | `demo123` | Dr. Aditi Krishnan |
| Audiologist | `vikram@thesoundclinic.in` | `demo123` | Dr. Vikram Reddy |
| Front Desk | `meera@thesoundclinic.in` | `demo123` | Meera Bhat |
| Technician | `suresh@thesoundclinic.in` | `demo123` | Suresh Kumar |
| Accounts | `priya@thesoundclinic.in` | `demo123` | Priya Nair |

Log in as **owner@thesoundclinic.in** for the broadest screenshot tour (all modules unlocked, PREMIUM tier).

## Example curl

```bash
TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"frontdesk@acs.in","password":"frontdesk123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s "$API/patients" -H "Authorization: Bearer $TOKEN"
```

## Twilio SMS (LIVE — configured in /app/backend/.env)
- Provider: Twilio, `SMS_PROVIDER=twilio`
- Account SID: `ACa7e2d2c737c9220877328f2e33dfb01f`
- From Number: `+15709425660` (US trial number)
- Trial account → can ONLY deliver to numbers on Twilio's "Verified Caller IDs" list.
- Admin test UI: `/admin/settings` → "Send test SMS" card
- API: `POST /api/admin/v2/test-sms` (founder/super_admin only)
- To run the live-delivery pytest, set `TWILIO_VERIFIED_TEST_NUMBER=+91…` before running `pytest tests/test_sms.py`.

## ZeptoMail Email (LIVE — configured in /app/backend/.env)
- Provider: ZeptoMail SMTP, `EMAIL_PROVIDER=zepto`
- Server: `smtp.zeptomail.com:587` (STARTTLS)
- Username: `emailapikey` (literal)
- From: `noreply@audinexa.com` (name: `AUDINEXA`)
- Admin test UI: `/admin/settings` → "Send test email" card
- API: `POST /api/admin/v2/test-email` (founder/super_admin only)
- Live-delivery pytest: `ZEPTO_TEST_RECIPIENT=you@example.com pytest tests/test_email.py -k live`
- Welcome email is auto-sent when founder creates a tenant via "Set password now" mode.



## Sandbox Test Clinic (NEW — 2026-05-06)
- **Login URL**: PREVIEW preview env `REACT_APP_BACKEND_URL` / PROD `https://audinexa.com/login`
- **Email**: `sandbox.demo@audinexademo.com`
- **Password**: `Sandbox@123`
- **Role**: `clinic_owner`
- **Tier**: `STANDARD` (30-day trial)
- **clinic_id**: `clinic-sandbox-test-clinic-9aaab6`
- **City / State**: Bengaluru, Karnataka
- **Phone**: `+919900110011`
- **Created via**: `POST /api/admin/v2/tenants` (founder, set-password-now mode)
- **Status**: Trial, ready for end-to-end testing of import + accounts + scheduling + billing flows.

## Smoke Test Suite (added 2026-05-08)
Fast (<5s) sanity check that confirms the platform boots and the canonical schemas haven't drifted. Useful before deploys / after large refactors.

```bash
# Either of these:
cd /app/backend && bash scripts/smoke.sh
cd /app/frontend && yarn test:smoke
cd /app/backend && pytest -m smoke -x -q
```

Covers: `/api/health`, admin login, founder login, `/api/auth/me` shape, `/api/patients` listing, forgot-password endpoint mount.

### Override identity at runtime
The legacy admin (`admin@acs.in`) is still seeded by `conftest.py` for back-compat. To run the suite as a different identity:

```bash
TEST_ADMIN_EMAIL=founder@audinexa.com TEST_ADMIN_PASSWORD=founder123 pytest
```

All 39 legacy test files were migrated on 2026-05-08 to read these env vars (via shared `tests/_helpers.py`) instead of hardcoding the literal email/password. The shared helpers also expose `API`, `H(token)`, `login(email, password)`, `admin_token()`, and `founder_token()` for new tests.
