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
- [Feb 2026] **M01 Sprint C**: Billing engine. New `/app/backend/billing.py` (~15 endpoints) + billing models (Service, Invoice, InvoiceLine, Payment, ReportDelivery). 12 default services auto-seeded per clinic. Frontend `/app/frontend/src/modules/billing/` — BillingModule (tabbed shell), InvoicesListPage, CreateInvoicePage (patient search + service catalogue dropdown + live totals preview + optional initial payment), InvoiceDetailPage (A4 layout + PaymentDialog + thermal popup + WhatsApp share + cancel), ReportHandoverPage, ServiceCatalogPage (role-gated nav + route). Backend role gates on POST/PUT/DELETE /billing/services and POST /billing/invoices/{id}/cancel. Dashboard `collections_today` now reads real payment sum. 16/16 backend pass; frontend ~95% pass, then 2 minor fixes applied.
- [Feb 2026] **Front-desk speed-ups**: Invoice shortcut (`₹`) on appointment cards & queue token rows — navigates to /billing/new with patient pre-selected. WhatsApp reminder rewired to use `wa.me` deep-link (no API needed per user's choice). SMS & Email buttons removed.
- [Feb 2026] **Power-user Enhancements**: 
  1. **Book Next Appointment CTA** — visible only on fully-paid invoices; jumps to Appointments page and auto-opens BookAppointmentModal with patient pre-filled and date +30 days.
  2. **Queue TV Display** — new unauth route `/queue/:clinicId` + public endpoint `GET /api/queue/public/{clinic_id}`. Privacy-redacted names (`First L.`), 5s polling, big emerald "Now Serving" card, amber "Next in Queue" grid, clock/date header, bilingual (English + Hindi) tagline.
  3. **Cmd+K Command Palette** — global keyboard shortcut (`⌘K` / `Ctrl+K`) opens a search palette with 9 quick actions, debounced patient + invoice search, arrow-key navigation. Single-key shortcuts `N A I R D Q /` (when not typing) jump to common routes. Topbar trigger button for discoverability. 7/7 backend + frontend validation green (iteration_5).
- [Feb 2026] **Waiting-room QR + IST Day + PDF-Attach WhatsApp (THIS SESSION)**:
  1. **QR Waiting-Room Poster** (`/frontdesk/qr-poster`) — A4 printable poster with `qrcode.react` SVG QR encoding the public `/queue/{clinic_id}` URL, clinic branding, 3-step bilingual (EN + HI) instructions, print-only CSS for clean print. Added to Front Desk tab bar and Cmd+K palette.
  2. **IST-aware day boundaries** — new `ist_day_start_utc()` + `ist_today_ymd()` helpers in `server.py`. Replaced all `datetime.utcnow().replace(hour=0,…)` and `.strftime('%Y-%m-%d')` usages in: public queue, dashboard KPIs, token counter, collections summary, appointment same-day logic. Tokens issued after 18:30 UTC (00:00 IST+) now correctly belong to today's IST day instead of getting early-cutoff.
  3. **WhatsApp-PDF Attach** — `ReportHandoverPage.shareWhatsAppWithPdf()` fetches `/api/reports/{id}/pdf` as a blob. Uses `navigator.share({files})` when `canShare` supports files (Android Chrome / iOS Safari 15+) for true native file attachment; falls back to auto-download + wa.me text deep-link on desktop.
  4. **PDF generator hardening** — fixed pre-existing NoneType bug in `pdf_generator.py` (explicit `None` values for `right_ear_audiogram`, `right_ear_degree`, etc. were crashing `.get(k, {})` / `.replace()` calls). Added `_safe_dict` + `_safe_list` helpers, `or 'Not classified'` default pattern, and orphan-patient graceful fallback in the endpoint. All 5 previously-broken sessions now return valid `%PDF-1.4` bytes.

## Seed Data / Credentials
- Clinic: `clinic-acs-demo` · "ACS Audiology Clinic" · Mumbai, Maharashtra
- Users (in `/app/memory/test_credentials.md`): admin@acs.in / frontdesk@acs.in / audiologist@acs.in / accounts@acs.in
- Default service catalogue (12 items): Consultation, PTA, Immittance, OAE, ABR/BERA, ASSR, Speech, HA Fitting (all exempt HSN 999312); HA-BTE & HA-RIC (12% GST, HSN 9021); Custom Ear Mould (12%, HSN 9021); Battery pack (18%, HSN 8506).

## Backlog / Roadmap

### P1 (next)
- [ ] Real SMS/WhatsApp/Email reminder SDK wiring (user chose `wa.me` deep-link for WhatsApp; SMS + Email deferred until user provides MSG91 / SendGrid keys; backend stub + UI removed for now).
- [ ] Attach PDF to WhatsApp share on Report Handover (currently text-only deep-link).
- [ ] Save-state on browser refresh for in-flight Book Next flow (location.state is lost on refresh).

### P2 infrastructure
- [ ] PostgreSQL migration (blueprint target; not blocking clinical MVP).
- [ ] Redis for session cache + dashboard KPI materialisation.
- [ ] AWS ap-south-1 deployment (ECS/ECR).
- [ ] Per-IP rate limit on `/api/queue/public/{clinic_id}`.
- [ ] IST-aware day boundary on public queue (currently UTC-based — tokens roll over at 05:30 IST instead of midnight).

### P3
- [ ] Hearing aid dispensing module (serial/warranty, trial fitment workflow).
- [ ] Marketing / re-engagement campaigns.
- [ ] Clinic admin UI (multi-clinic rollout).
- [ ] ICD-10 coding (CGHS/ESIC contracts).
- [ ] Audit log viewer UI.

### Explicitly Out of Scope
NOAH real-time sync, fax, US-style insurance/claims.
