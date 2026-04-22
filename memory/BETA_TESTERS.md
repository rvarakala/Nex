# AUDINEXA — Beta Tester Credentials

> Generated: 2026-04-22 19:22 UTC
> Login URL: **https://www.audinexa.com/login**
> Trial duration: **30 days** (STANDARD tier)

⚠️  **KEEP THIS FILE PRIVATE.** These are the initial passwords for your 10 beta testers.
Instruct each tester to change their password after first login (Profile → Change Password).

| # | Clinic | City | Contact | Email (login) | Temp Password | Status |
|---|---|---|---|---|---|---|
| 1 | Beta Clinic 01 | Mumbai | Tester 1 | `tester01@audinexa.com` | `QzwQEm7wZMd8` | created |
| 2 | Beta Clinic 02 | Bengaluru | Tester 2 | `tester02@audinexa.com` | `QyYK7rq7R8tS` | created |
| 3 | Beta Clinic 03 | Hyderabad | Tester 3 | `tester03@audinexa.com` | `LLib2PckLUuf` | created |
| 4 | Beta Clinic 04 | Chennai | Tester 4 | `tester04@audinexa.com` | `TnheALsu3Mwq` | created |
| 5 | Beta Clinic 05 | New Delhi | Tester 5 | `tester05@audinexa.com` | `QTDgaRdh3dam` | created |
| 6 | Beta Clinic 06 | Pune | Tester 6 | `tester06@audinexa.com` | `rNZTN8XCMyx5` | created |
| 7 | Beta Clinic 07 | Kolkata | Tester 7 | `tester07@audinexa.com` | `f36sLdDAK9Uw` | created |
| 8 | Beta Clinic 08 | Ahmedabad | Tester 8 | `tester08@audinexa.com` | `kjjeueqsDQqW` | created |
| 9 | Beta Clinic 09 | Jaipur | Tester 9 | `tester09@audinexa.com` | `ZkgNJaYjjMJu` | created |
| 10 | Beta Clinic 10 | Kochi | Tester 10 | `tester10@audinexa.com` | `8wJxDFXwWqnV` | created |

---

## How each tester logs in

1. Go to **https://www.audinexa.com/login**
2. Enter their email + temp password from the table above
3. They land on the **Clinic Owner Dashboard** with full access to:
   - Patients, Appointments, Diagnostics, Hearing Aid Sales, Service & Repair, Analytics
   - Their own branch (already seeded)
   - 30-day STANDARD trial (AMC, Referral Partners, Patient Portal all unlocked)

## Where to track them (as founder)

- Super Admin Panel → Tenants: **https://www.audinexa.com/admin/tenants**
- Super Admin Panel → Usage Analytics: **https://www.audinexa.com/admin/usage**
- Super Admin Panel → Support Desk: **https://www.audinexa.com/admin/support**

## Re-generate / wipe

```bash
cd /app/backend && python beta_seed.py           # create (idempotent)
cd /app/backend && python beta_seed.py --reset   # wipe + recreate (dangerous)
```