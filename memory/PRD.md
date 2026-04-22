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
- [Feb 2026] **Waiting-room QR + IST Day + PDF-Attach WhatsApp**:
  1. **QR Waiting-Room Poster** (`/frontdesk/qr-poster`) — A4 printable poster with `qrcode.react` SVG QR encoding the public `/queue/{clinic_id}` URL, clinic branding, 3-step bilingual (EN + HI) instructions, print-only CSS for clean print. Added to Front Desk tab bar and Cmd+K palette.
  2. **IST-aware day boundaries** — new `ist_day_start_utc()` + `ist_today_ymd()` helpers in `server.py`. Replaced all `datetime.utcnow().replace(hour=0,…)` and `.strftime('%Y-%m-%d')` usages in: public queue, dashboard KPIs, token counter, collections summary, appointment same-day logic. Tokens issued after 18:30 UTC (00:00 IST+) now correctly belong to today's IST day instead of getting early-cutoff.
  3. **WhatsApp-PDF Attach** — `ReportHandoverPage.shareWhatsAppWithPdf()` fetches `/api/reports/{id}/pdf` as a blob. Uses `navigator.share({files})` when `canShare` supports files (Android Chrome / iOS Safari 15+) for true native file attachment; falls back to auto-download + wa.me text deep-link on desktop.
  4. **PDF generator hardening** — fixed pre-existing NoneType bug in `pdf_generator.py` (explicit `None` values for `right_ear_audiogram`, `right_ear_degree`, etc. were crashing `.get(k, {})` / `.replace()` calls). Added `_safe_dict` + `_safe_list` helpers, `or 'Not classified'` default pattern, and orphan-patient graceful fallback in the endpoint. All 5 previously-broken sessions now return valid `%PDF-1.4` bytes.
- [Feb 2026] **Housekeeping**:
  1. **FastAPI lifespan migration** — replaced deprecated `@app.on_event('startup'/'shutdown')` decorators with a single `@asynccontextmanager async def lifespan(_app)` passed to `FastAPI(lifespan=lifespan)`. Cleaner startup (indexes + seeding + counter cleanup) and deterministic `"MongoDB client closed"` shutdown log. No more Starlette deprecation warnings.
  2. **Stale counter cleanup** — at every startup, lifespan deletes any `counters` docs matching `^token:.+:YYYY-MM-DD$` whose date suffix is not today's IST-YMD. Verified: planted 2 stale rows (2026-01-15, 2026-04-20) → removed on restart, only today's (2026-04-22) remains. Counters auto-regenerate on next token issue.
- [Feb 2026] **Daily Close-out**:
  1. **Backend**: New `/app/backend/closeout.py` — `compute_daily_summary()`, `generate_and_store_closeout()`, `start_scheduler()`. APScheduler `AsyncIOScheduler(timezone=IST)` with `CronTrigger(hour=21, minute=0)` started in lifespan. Five REST endpoints under `/api/closeouts/*` (list / latest / get-by-date / generate / mark-read). Role-gated: only `super_admin` + `accounts` can trigger generate. Idempotent upsert on `(clinic_id, date)` so `$setOnInsert` preserves `closeout_id` across regenerations.
  2. **Frontend**: New `/frontdesk/closeout` page (role-gated, hidden for front_desk + audiologist) with dark gradient primary card (headline metrics: collections / walk-ins / appointments), 2 split cards (collections-by-method + outstanding ledger), 14-day history table, and `📤 Share on WhatsApp` button that opens `wa.me/{91-clinic-phone}?text=…` with a pre-composed multi-line summary. Auto-marks read on share.
  3. **Topbar bell**: 60s-polling `closeout-bell` (only for accounts/super_admin) appears when `/api/closeouts/latest.read == false`, pulsing rose dot, vanishes after mark-read.
  4. **Discovery**: FrontDesk tab bar entry + Cmd+K palette entry ("Day Close-out" / 📊).
  5. 14/14 backend pass + 100% frontend (iter 7).
- [Feb 2026] **Sparkline + Refactor (THIS SESSION)**:
  1. **30-day Collections Sparkline** — new `GET /api/closeouts/trend/collections?days=N` endpoint (caps at 90d) with IST-bucketed series + week-on-week delta %. Frontend `CollectionsSparkline.js` renders an inline SVG with area gradient, line path, last-point dot, and a WoW-pill badge (hidden when last week is zero). Colour flips red on negative WoW. Placed above the primary close-out card for a "day done + weekly trajectory" glance.
  2. **`utils/ist.py`** — extracted `IST`, `ist_today_ymd()`, `ist_day_start_utc(ymd?)`, `ist_next_day_start_utc(ymd?)` out of `server.py` / `closeout.py` / `billing.py` into one shared module. Added `from __future__ import annotations` for py3.9 forward-compat.
  3. **Router split** — new `/app/backend/routers/` package. Extracted close-out endpoints (6) → `routers/closeouts.py` and PDF report endpoint → `routers/reports.py`. Both use `attach_db()` pattern for DI. `server.py` dropped from 1306 → 1153 LOC. Remaining candidate extractions (noted for next session): patients, appointments, tokens/dashboard, auth.
  4. 24/24 backend + 100% frontend (iter 8). Zero regressions, zero console errors.
- [Feb 2026] **Router finalisation + Clinic Pulse (THIS SESSION)**:
  1. **P0 blocker fix** — `routers/patients.py`, `routers/appointments.py`, `routers/tokens.py` had been extracted in a prior session but the `app.include_router(...)` calls were never added to `server.py`, leaving `/api/patients`, `/api/appointments`, `/api/dashboard/frontdesk`, `/api/tokens`, `/api/queue/public/{clinic_id}` all returning 404. Mounted all three routers alongside existing closeouts/reports. Routes now use idiomatic `Depends(get_db)` DI throughout.
  2. **Clinic Pulse mini-tile** — new `/app/frontend/src/modules/frontdesk/ClinicPulse.js` mounted at the top of `DashboardPage.js`. Premium dark gradient card with animated ping dot, today's collections headline, vs-7-day-rolling-avg delta, WoW pill, inline 14-day SVG mini-sparkline, and 5 live chiplets (Walk-ins / Appts / Waiting / Live / Reports) driven from the existing `/api/dashboard/frontdesk` KPI feed. Sparkline colour flips green/rose based on trend direction.
  3. 22/22 backend pytest + 100% frontend (iter 9). Zero regressions. New regression baseline at `/app/backend/tests/test_iter9_remount.py`.
- [Feb 2026] **Perf + Router Finalisation + Signed Share Links (THIS SESSION)**:
  1. **MongoDB aggregation refactor** — `/api/closeouts/trend/collections` and `/walkins` now use a `$match → $group` pipeline with `$dateFromString` + `$dateToString(timezone: "Asia/Kolkata")` for IST bucketing. Eliminates per-doc Python iteration; scales to tens of thousands of payments without streaming them into the FastAPI worker.
  2. **N+1 fix** — `/api/dashboard/frontdesk` previously did `find_one` per token to compute `returning_today` (100+ round-trips / 15s refresh). Now a single bulk `find({"patient_id": {"$in": token_pids}})` builds an in-memory map.
  3. **Router split completion** — extracted `test_sessions` CRUD + `/calculate/pta` → `routers/sessions.py`, and `referring_doctors` + `patient_notes` → `routers/ref_docs.py`. `server.py` dropped from 529 → 294 LOC (under the 500 target).
  4. **Signed share-links for PDFs** — new `/app/backend/share_token.py` mints HS256 JWTs (type `report_share`, default 7-day TTL, max 30d). New endpoints: `POST /api/reports/{session_id}/share-link` (auth + tenant-checked) returns `{path, token, expires_at, ttl_hours}`; `GET /api/reports/shared/{token}` (public) validates signature + expiry and streams the PDF. Expired tokens → 410. Existing `GET /api/reports/{session_id}/pdf` is now **auth-gated + tenant-checked** (was anonymous); frontend axios interceptor already attaches Bearer, so no UX regression. New 🔗 Link button on `ReportHandoverPage` copies the full public URL to clipboard.
  5. 24/24 backend pytest + 100% frontend (iter 10). Baseline at `/app/backend/tests/test_iter10_shares_refactor.py`.
- [Feb 2026] **Cross-tenant Hardening + DI Convergence + Desktop WA-link (THIS SESSION)**:
  1. **Second clinic seed** — `_seed_second_clinic()` in `server.py` idempotently provisions `clinic-delhi-test` ("Delhi Test Branch") with 2 users (`admin@delhi.test` / `frontdesk@delhi.test`) + the 12 default services. Enables real cross-tenant 403 tests: Delhi→Mumbai PDF = 403, cross-clinic share-link mint = 403, Mumbai→Delhi patient = 404, tampered share-token (Delhi clinic + Mumbai session, signed correctly) = 401. Documented in `/app/memory/test_credentials.md`.
  2. **Billing DI convergence** — all 13 endpoints in `/app/backend/billing.py` now use `db=Depends(get_db)`. The legacy `_db()` alias and deprecated `attach_db()` stub are DELETED. No backend module still uses the legacy pattern.
  3. **Desktop WhatsApp auto-embed** — `ReportHandoverPage.shareWhatsAppWithPdf()` on desktop browsers (no `navigator.canShare` for files) now mints a signed 7-day share URL server-side and embeds it directly in the `wa.me` message body. Zero downloads, zero manual-attach step. Mobile Web-Share-Level-2 path still attaches the real PDF file. The PDF blob is no longer fetched speculatively on desktop (perf: saves ~50-100KB per click on slow connections).
  4. 28/28 backend pytest + 100% frontend (iter 11). Baseline at `/app/backend/tests/test_iter11_cross_tenant.py`.
- [Feb 2026] **Security & Audit Hardening (THIS SESSION)**:
  1. **Share-link access audit** — every successful `GET /api/reports/shared/{token}` now does `$inc access_count` + `$set last_accessed_at/last_accessed_ip` on the `report_share_links` Mongo document, keyed by `sha256(token)` (the raw bearer is never persisted). New read-only endpoint `GET /api/reports/{session_id}/share-audit` (auth-gated, tenant-scoped) returns the full audit trail — with `_id` AND `token_hash` both projected out. Closes the HIPAA-style access-review gap flagged by iter 10's reviewer.
  2. **Forensic clinic-mismatch log** — tampered share-tokens (right signing key + wrong clinic_id claim) now emit a structured WARNING: `share_link.clinic_mismatch session_id=... token.clinic_id=... session.clinic_id=... ip=...`. Two branches (session vs. patient clinic mismatch).
  3. **In-memory rate limiter** — new `/app/backend/utils/rate_limit.py` sliding-window limiter, zero new deps. Applied: `/api/reports/shared/{token}` at 20 req / 60s per IP, `/api/queue/public/{clinic_id}` at 120 req / 60s per IP (covers a TV polling every 5s with 6× headroom). Exceeded → 429 + `Retry-After` header. Respects `X-Forwarded-For` from ingress. Fail-open on internal errors.
  4. 27 new + 28 regression = **55/55** backend pytest green (iter 12). Baseline at `/app/backend/tests/test_iter12_security_audit.py`.
- [Feb 2026] **HA Module — Phase 0 (Architecture Freeze) + Phase 1 (Foundation) (THIS SESSION)**:
  1. **Phase 0 — architecture frozen** at `/app/memory/HA_MODULE_ARCHITECTURE.md`. 18 entities, 7-role permission matrix, 9-state SerialItem machine with exhaustive transition table, numbering scheme (PO/GRN/TRIAL/JOB/SAL), integration map with existing primitives, 5 code-enforced guardrails.
  2. **Phase 1 — Foundation shipped**:
     - New entities: `Branch`, `Vendor` (`/app/backend/models_ha.py`).
     - New routers: `/api/branches` + `/api/vendors` (full CRUD, role-gated, branch-scoped, soft-delete, primary-branch "exactly one" invariant).
     - User model extended: `branch_ids: List[str]` + role enum now includes `clinic_owner`, `inventory_manager`, `technician`. `branch_ids` surfaced in `/api/auth/login` and `/api/auth/me`.
     - `auth.py` additions: `CLINIC_WIDE_ROLES`, `user_can_see_branch()`, `assert_branch_access()`.
     - New utility: `utils/numbering.py` — `next_number(db, kind, clinic_id)` — atomic year-reset, clinic-scoped counter (uses `ReturnDocument.AFTER` for correctness).
     - New utility: `utils/ha_states.py` — 9 states + frozen transition table + `transition_serial()` helper that writes append-only `serial_events` audit rows.
     - Auto-seed: Mumbai HQ branch (clinic-acs-demo) + Delhi branch (clinic-delhi-test) on every boot; 6 existing users backfilled to their clinic's primary branch.
  3. **35 new + 27 regression = 62/62 backend pytest green** (iter 13). No frontend this phase (intentional; UI starts in Phase 2 when there's an inventory board to render). Baseline at `/app/backend/tests/test_phase1_ha_foundation.py`.
- [Feb 2026] **HA Module — Phase 2 (Core Inventory + First HA UI) (THIS SESSION)**:
  1. **Backend — 3 new routers**:
     - `routers/ha_products.py` — Product catalogue CRUD (brand/model/form_factor/tech_tier/connectivity/warranty/mrp/cost/min_sell/hsn/gst/is_serialised), role-gated (inventory_manager + clinic_owner for writes), search + filter. 5 endpoints.
     - `routers/ha_inventory.py` — SerialItem list (filter by branch/state/pool/product/search), aggregated `by-branch-summary`, get-by-id, **serial lifecycle timeline** (`serial_events` log), pool update, **state-transition endpoint** with per-transition role policy (destructive DAMAGED/RETIRED/RETURNED require inventory_manager+). AccessoryStock list + +/- delta adjust (writes to `accessory_events`). 8 endpoints.
     - `routers/ha_procurement.py` — PurchaseOrder CRUD + status transition table (draft→approved→ordered→partial/received→closed + cancelled), **GRN create** atomically spawns SerialItems (state=IN_STOCK, pool=saleable, warranty_end computed from received_at+warranty_months, writes (new)→IN_STOCK audit), upserts AccessoryStock qty, auto-advances PO status through the allowed table. **Pre-insert over-receipt validation** + duplicate-serial rejection + qty/serial-count mismatch rejection. 6 endpoints.
  2. **utils/serde.py** — extended `STRING_DATE_KEYS` to preserve HA ISO-string date fields (warranty_end_date, received_at, expected_date, approved_at, closed_at, updated_at, start_date, end_date, expires_at, last_accessed_at).
  3. **Frontend — first HA UI** (module at `/app/frontend/src/modules/ha/`):
     - `HAModule.js` — 3-tab sub-nav router.
     - `ProductCataloguePage.js` — table + search + filter + new/edit modal.
     - `InventoryBoardPage.js` — 9 state KPI chips + pool filter + serial search + serial row table + **TimelineDrawer** slide-out with full lifecycle ledger and in-drawer state-transition UI.
     - `ProcurementPage.js` — PO list + CreatePO modal (multi-line with GST calc) + PODetailDrawer with state-action buttons + **GRNModal** with per-line serial-number capture (N input fields auto-generated based on qty).
     - New nav entry `/ha` (hidden from audiologists).
  4. 30 new + 35 regression = **65/65 backend pytest + 100% frontend smoke green** (iter 14). Reviewer nits fixed post-test: (a) PO status walks through allowed table (no skipping 'ordered'), (b) over-receipt check moved BEFORE inventory inserts (prevents orphan serials on 409), (c) stricter per-transition role policy (front_desk/audiologist blocked from DAMAGED/RETIRED/RETURNED). Baseline at `/app/backend/tests/test_phase2_ha_core.py`.
- [Feb 2026] **HA Module — Phase 3 (Transactions: Quotations + Sales) (THIS SESSION)**:
  1. **Backend — 2 new routers** (`routers/ha_quotations.py`, `routers/ha_sales.py`): quotation status machine (draft→sent→accepted/rejected/expired→converted), margin analysis (floor/below-floor flag per line), **pair rule** (binaural quote requires exactly 1 LEFT + 1 RIGHT serialised line), role gate (accounts blocked from create), Sale = quote→sale conversion with **serial reservation** + **margin-approval gate** (below-floor line without approver → 409; front-desk approver → 403; super-admin approver → 200), mark-paid idempotency, cancel-unreserve flow that preserves audit trail (`converted_sale_no` on quote kept even after sale cancel).
  2. **Tech debt**: (a) unique compound index `(clinic_id, serial_no)` on `serial_items` — duplicate-serial GRN now returns **409 Conflict** (not 500). Root-cause fix: catch both `DuplicateKeyError` AND `BulkWriteError` from motor's `insert_many`. (b) `python-dateutil` added — warranty_end_date now uses `relativedelta` (calendar months, not 30-day approximations).
  3. **Frontend — Quotation Studio** (`/app/frontend/src/modules/ha/QuotationStudioPage.js`): list page + status filter, NewQuoteModal with debounced race-safe patient search, per-line margin analysis, below-floor warnings, Sale conversion drawer. Audiologists see view-only (no create button).
  4. **38/38 backend pytest green** (iter 15 + P0 fix iter 16). Baseline at `/app/backend/tests/test_phase3_ha_transactions.py`.

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
