# 🚀 AUDINEXA — Production Deployment Checklist

This checklist covers the **environment variables** and **manual steps** required when deploying to production via Emergent's deployment screen.

---

## 1. Required env vars (Backend)

Set these on the Emergent deployment screen → Environment Variables:

| Variable | Value | Why |
|---|---|---|
| `MONGO_URL` | (auto-populated by Emergent) | Production MongoDB connection |
| `DB_NAME` | `audinexa_prod` (or your choice) | Database name |
| `JWT_SECRET` | (auto-populated, 64-char hex) | DO NOT reuse the preview secret |
| `CORS_ORIGINS` | `https://app.audinexa.com,https://www.audinexa.com` | Lock down browser origins. Replace with your real production domain(s). **Never `*` in prod.** |
| `DISABLE_DEMO_SEED` | `1` | **Critical.** Skips ACS demo clinic + 4 demo users + 4 admin-panel demo tenants. Without this, `admin@acs.in / admin123` would exist in production. |
| `FOUNDER_EMAIL` | `founder@yourdomain.com` | Override the default founder email. |
| `FOUNDER_PASSWORD` | (your strong passphrase) | Override the default founder password. **Without this, anyone who knows `founder123` can sign in.** |
| `DEFAULT_CLINIC_ID` | (omit) | Only used in dev/preview; production clinics are created via signup. |
| `DEFAULT_CLINIC_NAME` | (omit) | Same. |

---

## 2. Required env vars (Frontend)

| Variable | Value |
|---|---|
| `REACT_APP_BACKEND_URL` | (auto-populated by Emergent → your deploy URL) |

---

## 3. Pre-deploy verification

Before clicking "Deploy", run these locally to confirm:

```bash
# 1. Backend health
curl https://YOUR-PREVIEW-URL/api/health
# expected: {"status":"ok"}

# 2. Demo seed actually skipped if flag set
DISABLE_DEMO_SEED=1 python3 /tmp/test_disable_seed.py
# expected: only founder user + platform clinic seeded

# 3. Login rate limit fires after 10 attempts/minute
for i in {1..15}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@y.z","password":"wrong"}'
done
# expected: 401, 401, ... 429 (rate-limited) after the 10th
```

---

## 4. First-run actions on production

Within 5 minutes of deploy:

1. **Sign in as founder** (with the `FOUNDER_PASSWORD` you set)
2. **Change founder password from inside the app** → don't keep using the env var indefinitely
3. **Create your first real clinic** via Admin Panel → Tenants → Add
4. **Verify CORS** — try `fetch("https://YOUR-API/api/health")` from your browser console on the production domain (should work) AND from a random other domain (should fail with CORS error)
5. **Verify rate-limit** — try 20 logins in 30 seconds; expect 429s after the 10th

---

## 5. Recommended monitoring

Once deployed, watch for these signals in the first 7 days:

- Failed login attempts > 50/hour for any single email → possible attack
- 429 (rate-limited) responses spike → review limit tuning
- Vault setup completion rate < 30% of clinics that click "Upgrade" → onboarding UX gap
- Signup → first activity time > 24 hours → onboarding email/SMS missing (still MOCKED today)

---

## 6. Known MOCKED integrations (deploy aware)

These work in the UI but don't actually call third-party APIs:

- 💳 **Stripe** — Subscription billing UI works, but no real charges made
- 📧 **SendGrid** — Email send is logged but no actual emails delivered
- 📱 **Twilio** — SMS / WhatsApp reminders are queued but not sent

You can still launch with these MOCKED if your sales is invoice-based and you handle reminders manually for the first few clinics. **Plan to swap them in within 30 days of launch.**

---

## 7. Rollback plan

If something breaks in prod:

1. Emergent deployment dashboard → click previous successful deploy → Restore
2. Database is NOT rolled back — manually fix any data issues via MongoDB
3. Vault data: encrypted with clinic-held keys; safe even during incidents

---

Last updated: 2026-04-26
