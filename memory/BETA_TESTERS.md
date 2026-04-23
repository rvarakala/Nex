# AUDINEXA — Beta Tester Credentials (PRODUCTION)

> Generated: 2026-04-23 02:05 UTC
> Login URL: **https://www.audinexa.com/login**
> Trial duration: **30 days** (STANDARD tier)
> Seeded via: `POST /api/admin/v2/seed/beta-testers` (founder-only)

⚠️  **KEEP THIS FILE PRIVATE.** These are the live prod passwords for your 10 beta testers.
Passwords cannot be recovered from the system — copy them now. Instruct each tester to change their password after first login (`Profile → Change Password`).

| # | Clinic | City | Contact | Email (login) | Temp Password |
|---|---|---|---|---|---|
| 1 | Beta Clinic 01 | Mumbai | Tester 1 | `tester01@audinexa.com` | `gsHSMJQfyQNf` |
| 2 | Beta Clinic 02 | Bengaluru | Tester 2 | `tester02@audinexa.com` | `PCNauG6q3aEV` |
| 3 | Beta Clinic 03 | Hyderabad | Tester 3 | `tester03@audinexa.com` | `23BN5iUhJvwT` |
| 4 | Beta Clinic 04 | Chennai | Tester 4 | `tester04@audinexa.com` | `38cM78RE7XEh` |
| 5 | Beta Clinic 05 | New Delhi | Tester 5 | `tester05@audinexa.com` | `efgTFURpmbnx` |
| 6 | Beta Clinic 06 | Pune | Tester 6 | `tester06@audinexa.com` | `axsaVe4d8k7A` |
| 7 | Beta Clinic 07 | Kolkata | Tester 7 | `tester07@audinexa.com` | `dvUYuJC6AnvG` |
| 8 | Beta Clinic 08 | Ahmedabad | Tester 8 | `tester08@audinexa.com` | `EwQtuxEmAKu3` |
| 9 | Beta Clinic 09 | Jaipur | Tester 9 | `tester09@audinexa.com` | `TxqFNZWTq227` |
| 10 | Beta Clinic 10 | Kochi | Tester 10 | `tester10@audinexa.com` | `CebF9GE9MFGT` |

---

## Verified Live on Production ✅

End-to-end login verified for `tester01@audinexa.com` on https://www.audinexa.com at generation time.

## How each tester logs in

1. Go to **https://www.audinexa.com/login**
2. Enter their email + temp password from the table above
3. They land on the **Clinic Owner Dashboard** with full access to:
   - Patients, Appointments, Diagnostics, Hearing Aid Sales, Service & Repair, AMC, Analytics
   - Their own branch (auto-seeded in their city)
   - 30-day STANDARD trial (Referral Partners, Patient Portal, Trade-Ins all unlocked)

## Where to monitor them (as founder)

Log in as `founder@audinexa.com` / `founder123`, then visit:
- **Tenants**: https://www.audinexa.com/admin/tenants
- **Usage Analytics**: https://www.audinexa.com/admin/usage
- **Support Desk**: https://www.audinexa.com/admin/support
- **Audit Log**: https://www.audinexa.com/admin/audit (shows beta seeding event)

## Re-generate / Rotate Passwords

```bash
# Get founder token
TOKEN=$(curl -s -X POST https://www.audinexa.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"founder@audinexa.com","password":"founder123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# Reset + regenerate (rotates ALL 10 passwords — USE WITH CAUTION)
curl -X POST https://www.audinexa.com/api/admin/v2/seed/beta-testers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reset": true}'
```

## Change clinic names / tester contact details

Edit the `BETA_TESTERS` list in `/app/backend/beta_seed.py`, then:
1. Commit + Save to Github
2. Click Deploy
3. Call the endpoint with `reset: true` to rotate