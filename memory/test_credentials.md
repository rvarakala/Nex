# ACS Audiology Clinic — Test Credentials

## Default Clinic
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

All four users are scoped to `clinic-acs-demo`. The seed is idempotent — passwords are re-synced to the above values on every backend restart.

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
