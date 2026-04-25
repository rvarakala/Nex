# ACS Audiology Clinic — Test Credentials

## Default Clinic (Mumbai)
- **clinic_id**: `clinic-acs-demo`
- **name**: ACS Audiology Clinic
- **city**: Mumbai / Maharashtra
- **MRD prefix**: `ACS` (generates `ACS-YYYY-NNNNNN`)

## Demo Users (seeded automatically on backend startup)

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@acs.in` | `admin123` |
| Front Desk | `frontdesk@acs.in` | `frontdesk123` |
| Audiologist | `audiologist@acs.in` | `audio123` |
| Accounts | `accounts@acs.in` | `accounts123` |

All four users are scoped to `clinic-acs-demo` + branch `Mumbai HQ` (primary). The seed is idempotent — passwords are re-synced to the above values on every backend restart.

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
