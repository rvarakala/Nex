# ACS Audiology Clinic — Test Credentials

> **📧 Email verification (2026-07-26)**: All 151 existing users have been
> **grandfathered as `email_verified=true`** — they log in normally.
> Every NEW signup after 2026-07-26 must complete a 6-digit OTP via
> `/verify-email` before login (hard-block via 403 `EMAIL_NOT_VERIFIED`).
> Zepto delivers the code. Pull the code for automated tests from
> `db.users.email_verification_code`.



> **🔑 Founder password rotated (2026-07-30)**: The founder account is
> now `founder@audinexa.com` / `AudinexaFounder@2026`. The old default
> `founder123` no longer works. This was set as part of the fix for the
> non-idempotent-seed bug — see PRD.md for context. `password_changed_at`
> is now stamped on the user row so future backend restarts will NOT
> reset it. Pytest picks the new password up automatically via
> `tests/_helpers.py::FOUNDER_PASSWORD`.


> **🔒 Device limit (2026-07-29)**: Per-user concurrent-session cap enforced
> based on clinic tier (BASIC=2, STANDARD=4, PREMIUM=8, founder/super_admin=∞).
> Currently in **warn-only mode** — env `DEVICE_LIMIT_ENFORCE=false`. Flip to
> `true` to enable hard blocking. For pytest, the AUDIO role (`pytest.audio@`)
> on the BASIC-tier `clinic-pytest-suite` is the go-to non-exempt account to
> hit the cap (super_admin/founder skip the check entirely).
>
> Extra manual test account (for the ad-hoc device-limit UI checks):
> - `dltest@example.com` / `TestPass@123` — clinic_id `clinic-dl-test-clinic-851466` on BASIC tier, email verified.


## ⚠️ Production Mode (`DISABLE_DEMO_SEED=1`)
When this env var is set on the backend (recommended in production):
- The 4 ACS demo users (`admin@acs.in`, etc.), the second Delhi test clinic, the 4 admin-panel demo tenants, and the sample leads are **NOT** seeded.
- Only the **founder** account is seeded into the platform clinic so the platform owner can sign in.
- Override the founder password by setting `FOUNDER_PASSWORD=<strong-pass>` (also `FOUNDER_EMAIL=<email>` if needed).
- Test credentials below apply to **dev / staging / preview** environments only (where `DISABLE_DEMO_SEED` is unset).

## ⚠️ DEPRECATED — Default Clinic (Mumbai) `clinic-acs-demo`
- **Status (2026-05-08)**: ❌ **DROPPED**. The demo tenant + its 4 users (`admin@acs.in`, etc.) have been **deleted** from preview/prod DB and the pytest bootstrap.
- **Replacement**: pytest now bootstraps a dedicated `clinic-pytest-suite` tenant. See "Pytest Suite Tenant" section below.

## 🧪 Pytest Suite Tenant (NEW — 2026-05-08)
- **clinic_id**: `clinic-pytest-suite`
- **Bootstrap**: `tests/conftest.py` (idempotent on every pytest invocation)
- **Branch**: `BR-PYTEST-001` (named "Mumbai HQ" for legacy compat)
- **Tier**: PREMIUM (so every tier-gated module is reachable in the suite)
- **Bootstrap patient**: `PT-PYTEST-BOOTSTRAP-001` (MRD `PYT-2026-TEST01`)

Role accounts (all share password `Pytest@123` unless overridden):

| Role | Email |
|---|---|
| Super Admin | `pytest.admin@audinexa.test` |
| Front Desk | `pytest.frontdesk@audinexa.test` |
| Audiologist | `pytest.audio@audinexa.test` |
| Accounts | `pytest.accounts@audinexa.test` |

These are read from `tests/_helpers.py` constants (`ADMIN_EMAIL` / `ADMIN_PASSWORD` / `FRONTDESK_EMAIL` / etc.) and can be overridden at the shell:

```bash
TEST_ADMIN_EMAIL=founder@audinexa.com \
TEST_ADMIN_PASSWORD=founder123 \
pytest
```

### Expanded role enum (Phase 1 HA Foundation + Phase 13-14)
Valid roles: `super_admin`, `clinic_owner`, `front_desk`, `audiologist`, `accounts`, `inventory_manager`, `technician`, `referral_partner`, `founder`. `super_admin` and `founder` bypass every `require_roles` + `require_tier` check.

## AUDINEXA Super Admin Panel — Internal Team (Phase 14A/B/C)
> Architecture note: the admin-panel backend is split across two router
> files for historical reasons — `admin_panel.py` (21 routes, Phase 14A
> dashboard/tenants/leads/revenue) + `admin_panel_b.py` (32 routes,
> Phase 14B+C support/usage/system-health/marketing/notifications/audit/
> settings/RBAC). They share zero routes — both are mounted under
> `/api/admin/v2`. Future rename candidate: `admin_panel.py` →
> `admin_panel_core.py` and `admin_panel_b.py` → `admin_panel_ops.py`.
> Not blocking; safe to defer.

- **Founder**: `founder@audinexa.com` / `founder123` — full access + delete-tenant
  - Override via env `FOUNDER_PASSWORD=<strong>` for production
- **Super Admin**: `admin@acs.in` / `admin123` — all admin except delete-tenant (legacy, deprecated)

### 🔐 Rotated 2026-06-03 — strong passwords now required
Internal Audinexa-team accounts had their default passwords rotated from
`<role>123` to strong randoms. Each value can be overridden in production
via env var `AUDINEXA_<ROLE>_PW`.

| Role | Email | New Password | Env Override |
|---|---|---|---|
| Sales Manager | `sales@audinexa.com` | `Sales-Mgr-9K2vX7wR` | `AUDINEXA_SALES_PW` |
| Support Agent | `support@audinexa.com` | `Support-A3jH8nP4yZ` | `AUDINEXA_SUPPORT_PW` |
| Finance Manager | `finance@audinexa.com` | `Finance-V5tB9cM1qL` | `AUDINEXA_FINANCE_PW` |
| Product Ops | `ops@audinexa.com` | `ProdOps-G4xN6sD2uK` | `AUDINEXA_OPS_PW` |
| Read Only Analyst | `analyst@audinexa.com` | `Analyst-W8rT5fJ3eY` | `AUDINEXA_ANALYST_PW` |

The previous `<role>123` passwords **no longer work**. To rotate again:
1. Set `AUDINEXA_<ROLE>_PW=<new-strong>` in `/app/backend/.env`
2. Either run the seed (`DISABLE_DEMO_SEED=0 supervisorctl restart backend`)
   OR run the one-off rotation block in `admin_seed._resolve_internal_pw`.

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



## 🔥 Production Burner Clinic (added 2026-08-18)
- **Login URL**: `https://audinexa.com/login`
- **Email**: `triveni.pisb@gmail.com`
- **Password**: `Jasmita@1506`
- **Role**: `clinic_owner`
- **Tier**: `STANDARD` (Basic feature · 29 days trial)
- **clinic_name**: "AUDINEXA QA Clinic" (Pune)
- **Purpose**: PRODUCTION smoke tests only — dedicated burner account provided by user for post-deploy verification. Use synthetic/test data only. Do NOT commit real patient data into this tenant.

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
