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

## Role Routing Defaults
- `audiologist` → lands on `/test`
- everyone else → lands on `/frontdesk`

## Example curl

```bash
TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"frontdesk@acs.in","password":"frontdesk123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s "$API/patients" -H "Authorization: Bearer $TOKEN"
```
