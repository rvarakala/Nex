# AUDINEXA Codebase Architecture

> **Purpose**: a 1-page map for "Where do I find X?" so bug-hunting and feature
> work doesn't require grepping the whole repo.
> **Last updated**: 2026-04-29 (Phase 1-3 refactor)

---

## Top-level layout

```
/app
├── backend/                FastAPI + MongoDB
│   ├── server.py           App bootstrap, lifespan, auth/clinic-switcher inline routes
│   ├── models/             Pydantic models (split by domain — see below)
│   ├── routers/            All API endpoints, one file per domain
│   ├── seeds/              Demo / dev data seeding (run on startup)
│   ├── utils/              Cross-cutting helpers: ist, serde, rbac, activity, tiers
│   ├── auth.py             Password hashing, JWT, get_current_user, require_roles
│   ├── billing.py          GST + invoice math (the legacy billing module)
│   ├── closeout.py         Day Close-out scheduler
│   ├── pdf_generator.py    Invoice / report PDF rendering
│   ├── admin_seed.py       Founder + admin-panel demo data seed
│   ├── tests/              ~70 pytest files, ~700+ tests
│   ├── scripts/            Maintenance scripts (cleanup_demo_data.py etc.)
│   └── .env                MONGO_URL, DB_NAME, RAZORPAY_*, etc.
│
├── frontend/src/           React 18 + react-router-dom v6
│   ├── App.js              Route table + auth-guarded shell mounts
│   ├── AuthContext.jsx     Logged-in user + token state
│   ├── SubscriptionContext.jsx  Per-tenant tier + module access map
│   ├── TestContext.js      Persistent active-test session for the audiologist
│   ├── shell/              AppShell, ClinicSwitcher, CommandPalette, AppSwitcher
│   ├── pages/              Login, TokenPrintView, QueueTVPage
│   ├── modules/
│   │   ├── patients/       Unified Patients Hub (replaced legacy /frontdesk)
│   │   ├── appointments/   Calendar & booking modal
│   │   ├── billing/        Invoice list + create + pay
│   │   ├── test/           Diagnostics (PTA, Speech, Impedance, Reports)
│   │   ├── ha/             Hearing-aid sales / inventory / fittings / trials
│   │   ├── repair/         Service & repair pipeline
│   │   ├── admin/          Founder Command Center (super-admin panel)
│   │   ├── settings/       Clinic settings, staff, security, AUDINEXA Connect
│   │   ├── reports/        Stand-alone reports module
│   │   ├── closeout/       Day Close-out (extracted from frontdesk in Phase 1)
│   │   ├── care/           AUDINEXA Care support desk
│   │   ├── legal/          Public Terms / Privacy / Refund / Contact pages
│   │   ├── partner/        Referral-partner self-service portal
│   │   ├── patient/        Patient-facing kiosk / self-check-in
│   │   ├── auth/           Invite-accept page
│   │   └── landing/        Public marketing landing + signup
│   ├── components/         Reusable UI (AudiogramCanvas, ImpedancePanel etc.)
│   ├── components/ui/      Shadcn/UI primitives (button, dialog, toast, ...)
│   ├── components/reports/ Report builder (sectionRegistry, sections/, layout/)
│   ├── connectivity/       PWA online/offline + sync queue
│   ├── crypto/             Vault (BYOK) — DEK hierarchy & client-side encryption
│   ├── hooks/              usePageViewTracker, useDocumentTitle
│   ├── public/service-worker.js  PWA service worker (network-first)
│   └── .env                REACT_APP_BACKEND_URL
│
└── memory/                 PRD + test credentials kept across forks
    ├── PRD.md              Product roadmap, completed work, pending tasks
    └── test_credentials.md ALL demo/test login credentials
```

---

## Backend models — domain index

The single source of truth for every model is `models/_canonical.py`. Domain
index files re-export the relevant subset so devs can navigate by feature
area instead of scrolling a 994-line monolith.

| Domain file | What lives there |
|---|---|
| `models/auth.py`        | `Clinic`, `User`, `LoginRequest` |
| `models/queue.py`       | `OPDToken` (UC-01 front desk queue) |
| `models/appointment.py` | `Appointment`, `AppointmentCreate`, `WaitlistEntry`, `WaitlistCreate`, `CancellationLog`, `ReminderLog` + service/category/priority constants + `color_for_staff` |
| `models/billing.py`     | `Service`, `Invoice`, `InvoiceLine`, `Payment`, `ReportDelivery`, plus the `*Create` forms + `PAYMENT_METHODS`, `INVOICE_STATUSES` |
| `models/patient.py`     | `Patient`, `PatientCreate`, `ReferringDoctor`, `PatientNote` (and `*Create` forms) |
| `models/clinical.py`    | Audiogram, Speech, Pre-Test (Case History/Tuning Fork/Otoscopy), Impedance, TestSession |
| `models/_canonical.py`  | THE ACTUAL CLASS DEFINITIONS — open to edit fields |

Backwards compat: `from models import X` still works as before — the
package's `__init__.py` re-exports everything from `_canonical.py`.

---

## Backend routers — domain index

All endpoints prefix with `/api/`. Mount order is `server.py` → router file.

### Core
| Router file | Route prefix | What it does |
|---|---|---|
| `routers/patients.py`         | `/api/patients`        | Patient CRUD + MRD generation |
| `routers/appointments.py`     | `/api/appointments`    | Booking, reschedule, cancel, slots |
| `routers/tokens.py`           | `/api/tokens`          | OPD walk-in queue tokens |
| `routers/sessions.py`         | `/api/sessions`        | Diagnostic test sessions (PTA / Speech / Impedance / etc.) |
| `routers/diagnostics_queue.py`| `/api/diagnostics`     | Live audiologist queue (waiting → in_progress → completed) |
| `routers/ref_docs.py`         | `/api/referring-doctors`,`/api/patient-notes` | Doctor directory + chart notes |
| `routers/branches.py`         | `/api/branches`        | Multi-branch CRUD |
| `routers/closeouts.py`        | `/api/closeouts`       | Day-close cash + invoice reconciliation |
| `routers/reports.py`          | `/api/reports`         | Long-form clinical reports |

### Hearing Aids
| Router file | Route prefix | What it does |
|---|---|---|
| `ha_products.py`     | `/api/ha/products`     | Catalogue (brand × model × tier) |
| `ha_inventory.py`    | `/api/ha/inventory`    | Stock ledger + serial moves |
| `ha_procurement.py`  | `/api/ha/procurement`  | Purchase orders + GRNs |
| `ha_quotations.py`   | `/api/ha/quotations`   | Patient quotation studio |
| `ha_sales.py`        | `/api/ha/sales`        | Order-to-fitting pipeline |
| `ha_fittings.py`     | `/api/ha/fittings`     | Fitting ledger |
| `ha_trials.py`       | `/api/ha/trials`       | Trial loaner programme |
| `ha_crm.py`          | `/api/ha/crm`          | Patient pipeline (lead→sold→fitted→AMC) |
| `ha_analytics.py`    | `/api/ha/analytics`    | Owner KPIs + revenue charts |
| `ha_service.py` *(legacy)*    | `/api/ha/service`     | Service tickets v1 |
| `ha_loaners.py`      | `/api/ha/loaners`      | Loaner unit tracking |
| `ha_tradeins.py`     | `/api/ha/tradeins`     | Trade-in valuation + credits |
| `ha_service_v2.py`   | `/api/ha/service-v2`   | New service pipeline (drop-off → repair → return) |
| `ha_repair_ops.py`   | `/api/ha/repair`       | Service technician workflow |
| `ha_amc.py`          | `/api/ha/amc`          | AMC contracts + renewals |

### Founder / Super-Admin Panel  *(Phase 3 split)*
| Router file | Route prefix | What it does |
|---|---|---|
| `admin_panel.py`   | `/api/admin/v2`        | Dashboard, Tenants, Subscriptions, Revenue, Leads, Feature Flags, Audit, Beta-tester seed |
| `admin_activity.py`| `/api/admin/v2`        | Activity tab — logins, online users, page-views, force-logout, activation funnel, inactive tenants, unified search |
| `admin_panel_b.py` | `/api/admin/v2`        | RBAC matrix, support tickets, system health, marketing campaigns, internal users, clinic-switch audit |

### Other
| Router file | Route prefix | What it does |
|---|---|---|
| `subscription.py`        | `/api/subscription`         | Tier upgrade + trial expiry |
| `razorpay_payments.py`   | `/api/billing`              | LIVE Razorpay for SaaS subscriptions only |
| `referral_partners.py`   | `/api/partners`             | Referral-partner registration + commission |
| `patient_portal.py`      | `/api/patient-portal`       | Patient self-service kiosk |
| `report_handover.py`     | `/api/report-handover`      | Report delivery (PDF / WhatsApp / email) |
| `settings.py`            | `/api/settings`             | Clinic / staff / security settings |
| `vault.py`               | `/api/vault`                | BYOK encryption keys |
| `analytics.py`           | `/api/analytics`            | Clinical analytics (PREMIUM) |
| `connect.py`             | `/api/connect`              | AUDINEXA Connect / MSG91 WhatsApp |
| `clinic_status.py`       | `/api/clinic-status`        | Open / closed toggle |
| `greetings.py`           | `/api/greetings`            | Birthday / anniversary autosender |
| `care_support.py`        | `/api/care`                 | AUDINEXA Care support desk |
| `invitations.py`         | `/api/invitations`          | Staff invite-accept flow |
| `vendors.py`             | `/api/vendors`              | HA vendor directory |
| `stock_transfers.py`     | `/api/stock-transfers`      | Inter-branch stock movement |
| `export_data.py`         | `/api/data-export`          | DPDP-compliant clinic data dump |

---

## Where do I add a NEW model?

1. Open `/app/backend/models/_canonical.py`
2. Locate the matching `# ==================== <DOMAIN> ====================` banner.
3. Add your `class Foo(BaseModel): ...` under that banner.
4. Open the matching domain index (`models/billing.py` etc.) and add the
   class name to the import list **and** `__all__`.
5. (Optional) Update `_canonical.py`'s section header if your class introduces
   a new sub-concept.

## Where do I add a NEW router?

1. Create `/app/backend/routers/<domain>.py` with `router = APIRouter(prefix="/api/<domain>")`.
2. Add the import + `app.include_router(...)` lines to `server.py` (between
   the existing `closeouts` and `razorpay` mounts is fine).
3. Add a row to this file under "Backend routers — domain index".
4. Add a pytest under `/app/backend/tests/test_<domain>.py`.

---

## Frontend module map

| Module | URL prefix | What it does |
|---|---|---|
| `modules/patients`     | `/patients`         | Patients Hub (the unified replacement for the legacy /frontdesk) |
| `modules/appointments` | `/appointments`     | Calendar & slot picker |
| `modules/billing`      | `/billing`          | Invoices + GST + pay |
| `modules/test`         | `/test`             | Diagnostics: PTA, Speech, Impedance, Reports |
| `modules/ha`           | `/ha`               | Hearing Aid commerce + analytics |
| `modules/repair`       | `/repair`           | Service & repair pipeline |
| `modules/admin/panel`  | `/admin`            | Founder Command Center |
| `modules/settings`     | `/settings`         | Clinic & staff settings |
| `modules/reports`      | `/reports`          | Stand-alone reports |
| `modules/closeout`     | `/closeout`         | Day Close-out (extracted from frontdesk in Phase 1) |
| `modules/care`         | `/care`             | AUDINEXA Care |
| `modules/legal`        | `/terms` etc.       | Public legal pages |
| `modules/landing`      | `/`, `/signup`      | Public marketing |
| `modules/partner`      | `/partner`          | Referral-partner portal |
| `modules/patient`      | `/patient-portal`   | Patient-facing kiosk |

Legacy `/frontdesk/*` URLs are redirected to `/patients` in `App.js` — kept
for a release window so any cached browser bookmarks don't break.

---

## Recent refactor history (2026-04-28 / 04-29)

| Phase | What changed | Lines moved | Risk |
|---|---|---|---|
| 1 | Deleted legacy `modules/frontdesk/`, restored CloseoutPage / DashboardPage / ClinicPulse / BookAppointmentModal under correct module homes | ~3,000 lines deleted, 4 components relocated | LOW |
| 2 | Split `models.py` into `models/` package; extracted `_seed_defaults` into `seeds/demo.py` | server.py: 962 → 742, models.py: 994 → split | LOW |
| 3 | Extracted `/admin/v2/activity/*` + `/search` into `routers/admin_activity.py` | admin_panel.py: 1,331 → 1,104 | LOW |

All phases verified by running 74-test admin/billing regression suite — 74/74 passing.

---

## Pending technical-debt items (P2)

* `admin_panel.py` is still 1,104 lines. Future split candidates: `admin_tenants.py`, `admin_subscriptions.py`, `admin_revenue_leads.py`, `admin_features.py`.
* 403 scattered `axios.{get,post,...}` calls in frontend — central client (`src/api/client.ts`) would consolidate auth headers + retry logic.
* `models/_canonical.py` is still one big file. Future: physically split each domain into its own definition file once the test surface confirms re-export aliases are the only consumers.

---

## Quick-reference: bug-hunting checklist

1. Backend route returning 500 → tail `/var/log/supervisor/backend.err.log`
2. Login broken → check `/app/memory/test_credentials.md`, then `seeds/demo.py`
3. UI compile error → check the `Compiled with problems` banner — relative imports often the cause
4. Missing module access → `SubscriptionContext.jsx` tier→module map + per-tenant overrides in Founder Admin → Features tab
5. Razorpay payment failing → see `RAZORPAY_WEBHOOK_SECRET` in `.env` and the failure-reason-tracking logic in `routers/razorpay_payments.py`
