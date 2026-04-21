# ACS Audiology Clinic — Product Requirements Document

## Original Problem Statement
Build a full ACS (Audiology Clinic Suite) per the Product Vision Blueprint v1.
Multi-module India-first SaaS: **M01 Front Desk → M02 Diagnostics → M03 Reports**.
Premium UI, tenant-scoped, role-based, WhatsApp-first workflows, GST-compliant billing.

## Tech Stack (locked)
- **Frontend**: React 19 (CRA) + Tailwind + HTML5 Canvas + react-router-dom v7
- **Backend**: FastAPI + motor (async MongoDB) + bcrypt + PyJWT
- **Database**: MongoDB (Postgres migration = P2 infra task, deferred per user)
- **Auth**: JWT HS256 + 4 roles (super_admin, front_desk, audiologist, accounts)
- **Multi-tenant**: every query scoped by `clinic_id` from JWT claim
- **Key env**: `JWT_SECRET`, `DEFAULT_CLINIC_ID`, `MONGO_URL`, `DB_NAME`

## Module Status

### ✅ M01 — Front Desk & Registration (Sprint M01.A + M01.B + M01.C COMPLETE)
- **UC-01 New Patient Walk-in** (A): Full registration with auto-MRD (`ACS-YYYY-NNNNNN`), duplicate detection (last-10-digit mobile match), token issuance, Register / Register+Print / Register+Start Diagnostics flows.
- **UC-02 Returning Patient** (A): Debounced search (name/mobile/MRD), detail card with history + actions.
- **Front Desk Dashboard** (A): 7 live KPI cards + Live Queue with token-state transitions.
- **A5 Token Print** (A): Clinic branded, giant token number, auto-print.
- **UC-03 Appointments** (B): Today/Week views, drag-drop reschedule, Book modal with free-slot suggestions, waitlist panel, filters (audiologist/service/priority/status), WhatsApp/SMS/Email reminder hooks (stubbed). Double-booking 409 prevention. Cancellation logging.
- **UC-04 Billing & Report Handover** (C): Full GST invoice engine with CGST/SGST split (intra-state) or IGST (inter-state), mixed taxable (hearing aids / accessories) + exempt (healthcare) lines, HSN/SAC codes, discount per line, invoice numbering (`INV/YYYY/000001` per clinic-year). Split payments (cash/UPI/card/bank_transfer/insurance). A4 tax invoice + 80mm thermal receipt + WhatsApp share. Service catalogue CRUD (role-gated: accounts/admin only). Report Handover: lists unhandoured completed sessions, logs deliveries (print/whatsapp/email/in_person). Daily collections summary by method.

### ✅ M02 — Clinical Diagnostics (10 tabs)
Pre-Test (case history + otoscopy + tuning fork), Pure Tone (+ Ghost overlay), Speech (Audiogram + WRS), Impedance (Tymp + Reflex + ETF), Special Tests, OAE, Sound Field, ABR/ASSR, Pediatric, Tinnitus. Bridged from M01 via `TestContext`.

### ✅ M03 — Report Generation
sectionRegistry-based Builder, 14 toggleable sections, A4 print CSS, audiogram size toggles, WhatsApp share deep-link, historical audiogram ghost overlay.

## What's Implemented (changelog)

- [Feb 2026] M03 initial build: 10 clinical tabs + canvases + Report Builder + A4 print
- [Feb 2026] Phase 1 Patient Records: Patient CRUD + journal + referring doctors
- [Feb 2026] Phase 1.5: WhatsApp Share + Ghost Overlay
- [Feb 2026] **M01 Sprint A**: JWT/bcrypt auth, tenant scoping, Clinic/User/OPDToken models, MRD counter, duplicate detection, KPI endpoint + Front Desk shell (Login, AppShell, NewPatient, Returning, Queue, Dashboard, TokenPrint).
- [Feb 2026] **M01 Sprint B**: Appointments CRUD + waitlist + reminder stubs. Backend: appointment/waitlist/reminder routers; frontend: AppointmentsPage (Today/Week, drag-drop), BookAppointmentModal, WaitlistPanel. 21/21 backend pass, frontend ~95%. Follow-up fixes: status filter dropdown + email reminder button added.
- [Feb 2026] **M01 Sprint C (THIS SESSION)**: Billing engine. New `/app/backend/billing.py` (~15 endpoints) + billing models (Service, Invoice, InvoiceLine, Payment, ReportDelivery). 12 default services auto-seeded per clinic. Frontend `/app/frontend/src/modules/billing/` — BillingModule (tabbed shell), InvoicesListPage, CreateInvoicePage (patient search + service catalogue dropdown + live totals preview + optional initial payment), InvoiceDetailPage (A4 layout + PaymentDialog + thermal popup + WhatsApp share + cancel), ReportHandoverPage, ServiceCatalogPage (role-gated nav + route). Backend role gates on POST/PUT/DELETE /billing/services and POST /billing/invoices/{id}/cancel. Dashboard `collections_today` now reads real payment sum. 16/16 backend pass; frontend ~95% pass, then 2 minor fixes applied (catalog route guard, option hydration warning).

## Seed Data / Credentials
- Clinic: `clinic-acs-demo` · "ACS Audiology Clinic" · Mumbai, Maharashtra
- Users (in `/app/memory/test_credentials.md`): admin@acs.in / frontdesk@acs.in / audiologist@acs.in / accounts@acs.in
- Default service catalogue (12 items): Consultation, PTA, Immittance, OAE, ABR/BERA, ASSR, Speech, HA Fitting (all exempt HSN 999312); HA-BTE & HA-RIC (12% GST, HSN 9021); Custom Ear Mould (12%, HSN 9021); Battery pack (18%, HSN 8506).

## Backlog / Roadmap

### P1 (next)
- [ ] Real SMS/WhatsApp/Email reminder SDK wiring (currently stubbed — needs MSG91/SendGrid/WhatsApp Business keys from user). Use `integration_playbook_expert_v2`.
- [ ] Print-from-appointment-card: direct "Create Invoice" shortcut on appointment + token cards.
- [ ] Keyboard shortcuts + Cmd+K command palette.

### P2 infrastructure
- [ ] PostgreSQL migration (blueprint target; not blocking clinical MVP).
- [ ] Redis for session cache + dashboard KPI materialisation.
- [ ] AWS ap-south-1 deployment (ECS/ECR).
- [ ] Queue TV display (`/queue/:clinicId` read-only big-screen).

### P3
- [ ] Hearing aid dispensing module (serial/warranty, trial fitment workflow).
- [ ] Marketing / re-engagement campaigns.
- [ ] Clinic admin UI (multi-clinic rollout).
- [ ] ICD-10 coding (CGHS/ESIC contracts).
- [ ] Audit log viewer UI.

### Explicitly Out of Scope
NOAH real-time sync, fax, US-style insurance/claims.
