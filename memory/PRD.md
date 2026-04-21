# ACS Audiology Clinic — Product Requirements Document

## Original Problem Statement
Build M03 Report Generation for audiology clinics (started as Phase 0 MVP), then expanded
into a full ACS (Audiology Clinic Suite) per the Product Vision Blueprint v1.
Multi-module India-first SaaS: M01 Front Desk → M02 Diagnostics → M03 Reports.
Premium UI, tenant-scoped, role-based, WhatsApp-first workflows.

## Tech Stack (locked)
- **Frontend**: React 19 (CRA) + Tailwind + HTML5 Canvas + react-router-dom v7
- **Backend**: FastAPI + motor (async MongoDB) + bcrypt + PyJWT
- **Database**: MongoDB (Postgres migration = P2 infra task)
- **Auth**: JWT HS256 + 4 roles (super_admin, front_desk, audiologist, accounts)
- **Multi-tenant**: every query scoped by `clinic_id` from JWT claim
- **Key env**: `JWT_SECRET`, `DEFAULT_CLINIC_ID`, `MONGO_URL`, `DB_NAME`

## Module Status

### ✅ M01 — Front Desk & Registration (Sprint M01.A COMPLETE)
- **UC-01 New Patient Walk-in**: Full registration form (demographics, contact, chief complaint triage, referral, insurance/CGHS), auto-MRD (`ACS-YYYY-NNNNNN`), duplicate detection (normalised mobile last-10-digit match), token issuance, 3 action buttons (Register / Register+Print / Register+Start Diagnostics)
- **UC-02 Returning Patient**: Debounced search (name/mobile/MRD), result list, detail card with profile + previous visits + actions (Check In / Start Diagnostics)
- **Front Desk Dashboard**: 7 KPI cards (walk-ins / returning / appointments / waiting / in-progress / collections / pending reports) + Live Queue table with token-status transitions
- **A5 Token Print View**: Clinic branded, giant token number, patient info, auto-prints on open
- **Auth**: Login page with 4 role quick-fills, JWT Bearer, role-based default landing (audiologist→/test, others→/frontdesk), logout clears localStorage

### ✅ M02 — Clinical Diagnostics (10 tabs)
Pre-Test (case history + otoscopy + tuning fork), Pure Tone (Audiogram + Ghost overlay),
Speech (Audiogram + WRS), Impedance (Tymp + Reflex + ETF), Special Tests, OAE,
Sound Field (mini audiogram), ABR/ASSR (waveforms), Pediatric, Tinnitus.
Bridged from M01 via `TestContext` (activeTest: {patient, sessionId, token?}).

### ✅ M03 — Report Generation
Report Builder with sectionRegistry, 14 toggleable sections, A4 print CSS, audiogram size toggles,
WhatsApp share deep-link with PTA summary + recs, historical audiogram ghost overlay.

## What's Implemented (timestamped changelog)

- [Feb 2026] M03 initial build: 10 clinical tabs + canvases + Report Builder + A4 print
- [Feb 2026] Phase 1 Patient Records: Patient CRUD + journal + referring doctors
- [Feb 2026] Phase 1.5: WhatsApp Share + Ghost Overlay
- [Feb 2026] **M01 Sprint A (THIS SESSION)**:
  - Backend: JWT auth + bcrypt + 4 roles + clinic seeding, Clinic/User/OPDToken models, tenant scoping on all patient/session/note/referring-doctor endpoints, MRD counter, token counter, duplicate-check (last-10-digit normalisation), dashboard KPI endpoint, activity log collection
  - Frontend: Complete re-shell with react-router, LoginPage, AppShell (left nav + topbar), ProtectedRoute/RoleGate, TestContext (M01→M02 handoff), FrontDeskModule sub-tabs, NewPatientPage (UC-01), ReturningPage (UC-02), DashboardPage, TokenPrintView (A5), thin TestProceduresModule wrapping the existing 10 tabs with "Back to Front Desk" context strip
  - Testing: 25/25 backend pytest + frontend E2E ~92% → 3 flagged UX issues all fixed (duplicate warning visibility via mobile normalisation, logout activeTest cleanup, token-print StrictMode double-fire guard)

## Seed Data / Credentials
- Clinic: `clinic-acs-demo` · "ACS Audiology Clinic" · Mumbai
- Users (in `/app/memory/test_credentials.md`):
  - `admin@acs.in` / `admin123` — Super Admin
  - `frontdesk@acs.in` / `frontdesk123` — Front Desk
  - `audiologist@acs.in` / `audio123` — Audiologist
  - `accounts@acs.in` / `accounts123` — Accounts

## Backlog / Roadmap

### M01.B (next sprint)
- [ ] **UC-03 Appointments**: Today/Week/Calendar views, drag-drop reschedule, waitlist, filters (audiologist/test type/room), cancellation logs
- [ ] WhatsApp Business API / MSG91 SMS / SendGrid reminder hooks
- [ ] Keyboard shortcuts + command palette (Cmd+K search)

### M01.C (next sprint)
- [ ] **UC-04 Billing + Report Handover**: GST invoice engine (GSTIN + HSN), split payments (Cash/UPI/Card/Bank), thermal receipt + A4 invoice PDF, WhatsApp receipt share, fetch M03 reports (delivered/pending status), mark delivered

### P2 Infrastructure
- [ ] PostgreSQL migration (blueprint target; not blocking clinical MVP)
- [ ] Redis for session cache + dashboard KPI materialisation
- [ ] AWS ap-south-1 deployment (ECS/ECR)
- [ ] Data cleanup migration: reset `pending_reports` counter from legacy dev data

### P3
- [ ] Hearing aid dispensing module (make/model/serial/warranty)
- [ ] Marketing / re-engagement campaigns
- [ ] Multi-clinic rollout (we're already tenant-scoped; just needs a Clinic admin UI)
- [ ] ICD-10 coding (only if CGHS/ESIC contracts need it)
- [ ] Audit log viewer UI (backend already logs to `activity_logs`)

### Explicitly Out of Scope (India context)
- NOAH real-time sync, fax, US-style insurance/claims
