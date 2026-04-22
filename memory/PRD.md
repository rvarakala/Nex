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
- [Feb 2026] **HA Module — Phase 4 (Clinical Workflows: Fitting Ledger) (THIS SESSION)**:
  1. **Backend — new router** `routers/ha_fittings.py` (7 endpoints): list / get / create / update / append-visit / set-aided-audiogram / fittings-candidates. New collection `ha_fittings` with compound indexes on (status, created_at) and (patient_id). Write roles: audiologist + clinic_owner + super_admin. Read: all authenticated clinic users (front-desk scheduling visibility).
  2. **Data model**: Fitting doc embeds an unbounded `visits[]` array (programming ledger — per-visit summary: kind / notes / adjustments[] per ear / wear_hours_per_day / comfort_score 1-5), an optional `aided_audiogram` (sound-field or insertion-gain thresholds at 500/1k/2k/4k Hz per ear — Q1=a embedded), and serials lifted from a linked Sale. Status machine: `active → completed` (one-way; cannot append visits once completed). REM postponed (Q2 deferred to future; placeholder field `rem: Optional[dict]` reserved for DSL v5 integration).
  3. **M02 ↔ HA bridge**: `GET /api/ha/fittings-candidates/{patient_id}` returns the patient's open Sales (reserved/invoiced/paid not yet tied to an active fitting) + last PTA session for pre-filling target gains. "Start Fitting →" button added to the `TestProceduresModule.js` context strip — deep-links to `/ha/fittings?patient_id=X&auto=1` which auto-opens the create modal.
  4. **Frontend — Fitting Ledger page** (`/app/frontend/src/modules/ha/FittingLedgerPage.js`): list page + status filter + role-gated "+ New Fitting" button; CreateModal with debounced patient search, open-sales radio picker (sale-link or stand-alone), last-PTA hint; 3-tab DetailDrawer (Ledger with in-tab visit form + adjustment grid, Aided Audiogram with RIGHT/LEFT × 4-frequency editable matrix, Info). Front-desk / accounts / audiologists have read-only drawer.
  5. **33/33 backend pytest green** (iter 16; Phase 3 + Phase 4 combined = 71/71). Frontend smoke verified (3 fittings with full ledger + adjustment trail rendered). Baseline at `/app/backend/tests/test_phase4_ha_clinical.py`.
- [Feb 2026] **HA Module — Phase 4.5 (Trial Module — catch-up per user's original 7-phase plan) (THIS SESSION)**:
  1. **Backend — new router** `routers/ha_trials.py` (8 endpoints): list (with status + overdue + patient + serial filters) / get / create / extend / return / lost / convert → Sale / trials-kpis. New collection `ha_trials` with compound indexes on (status, return_date) + (patient_id). Uses existing `TRIAL-YYYY-NNNN` numbering (was already registered, unused).
  2. **Lifecycle & serial state transitions** (matches user's plan): `active → extended → converted | returned | lost`. Create transitions serials `IN_STOCK → TRIAL_OUT` (+ stamps current_patient_id). Return → `IN_STOCK`. Lost → `DAMAGED`. Convert mints a full Sale + moves serials `TRIAL_OUT → SOLD` directly; margin-approval gate identical to quote→sale path.
  3. **Roles**: create = front_desk + audiologist + clinic_owner + super_admin; mutate = audiologist + clinic_owner + super_admin.
  4. **Frontend** `/app/frontend/src/modules/ha/TrialsPage.js`: list + 5 KPI tiles (Active / Overdue / Converted / Returned / Lost) + overdue-only filter + status filter, CreateModal with debounced patient search + branch-scoped IN_STOCK serial picker (with L/R/Single side) + deposit + accessories + return date, 3-action DetailDrawer (Extend / Return / Convert-to-Sale / Lost) with overdue visual flag. Added "Trials" tab to HAModule.
  5. **26/26 backend pytest green** (iter 17). Covers role gates, serial state guard rails, extend → earlier-date 400, duplicate-serial-in-request 400, IN_STOCK-only 409, trial-to-sale length mismatch 400, lifecycle transitions, KPIs structure, and regression of all previous phases. Baseline at `/app/backend/tests/test_phase4_5_ha_trials.py`.
- [Feb 2026] **HA Module — Phase 6 (CRM + Retention Automation) (THIS SESSION)**:
  1. **Backend — new router** `routers/ha_crm.py` + `utils/followup_rules.py` (cadence engine + WhatsApp templates per kind). New collections: `ha_followups` (append-only task queue; compound indexes on status/due_date + (patient,kind,ref_id) for idempotency), `ha_subscriptions` (consumable cadences per patient).
  2. **Cadence rules** (verbatim from user's 7-phase plan):
     - **Fittings** → `1 week` (adaptation) · `1 month` (review) · `3 months` (review) · `annual` (review). Plus `NPS` ask piggybacked on the 30-day checkpoint.
     - **Trials** → `day 3` (check-in) · `day 7` (decision) · `overdue` (auto-fires whenever today > return_date on active/extended trial).
     - **Consumables** → fires the moment `subscription.next_due_date <= today`; one open row per subscription at a time.
     - **Upgrades** → paid/invoiced HA sales older than 3 years.
  3. **Scheduler**: daily APScheduler job at **09:30 IST** (`daily_followup_scan_0930_ist`) attached to the existing scheduler — runs `run_daily_followup_scan` across all clinics. Manual `POST /ha/followups/generate` endpoint lets owners force-refresh (idempotent — rerun creates 0). Inserts are guarded by `(clinic_id, patient_id, kind, ref_id)` uniqueness to prevent duplicates.
  4. **Endpoints (12)**: Subscriptions CRUD (list / create / update / deliver), FollowUps (list with bucket filters: overdue / today / upcoming / done, kind filter, KPIs, mark-sent / done / dismiss / generate), Upgrade candidates.
  5. **Frontend** — 2 new tabs in HAModule nav:
     - `/ha/followups` → Follow-up Board with 5 KPI tiles + 4 bucket tabs + kind dropdown + color-coded kind badges + **1-click WhatsApp send** (opens wa.me deep-link with pre-composed template + logs `mark-sent`) + Done / ✕ dismiss actions + "↻ Run daily scan" (super_admin only).
     - `/ha/subscriptions` → Consumable subscription manager (list + create modal with patient search + kind/item-label/cadence-days + Deliver/Pause/Resume actions).
  6. **30/30 backend pytest green** (iter 18). Combined P3+P4+P4.5+P6 = **127/127** passing. Baseline at `/app/backend/tests/test_phase6_ha_crm.py`.
  7. **Bug fix caught during build**: a prior `mcp_insert_text` mis-landed inside the `TrialConvert` class, merging its fields into `SubscriptionDeliver` — caused a 422 "unit_prices required" on deliver endpoint. Fixed by rewriting the affected class boundaries in `models_ha.py`. All tests now green.
- [Feb 2026] **HA Module — Phase 7 (Analytics & Owner Dashboard — FINAL PHASE) (THIS SESSION)**:
  1. **Backend — new router** `routers/ha_analytics.py` — 5 aggregation endpoints (all using MongoDB `$group` / `$lookup` / `$dateFromString`+`$dateToString(tz=Asia/Kolkata)` pipelines for IST-bucketed monthly series; no per-doc looping):
     - `GET /ha/analytics/revenue?months=N` — monthly revenue series + brand-wise split (last 12mo) + totals (revenue / sales / avg ticket).
     - `GET /ha/analytics/audiologists?days=N` — per-user sales count, revenue, below-floor %, paid-conversion %, WhatsApp send volume (from `sent_channels.actor_user_id` aggregation).
     - `GET /ha/analytics/inventory?aging_days=N&dead_days=N` — in-stock totals + aging/dead rollup per product (with cost-blocked ₹) + fast-moving accessories (30-day burn).
     - `GET /ha/analytics/funnel?days=N` — consultations → quotations → trials → converted/returned/lost → sales → paid + 5 conversion rates + avg trial-to-convert days.
     - `GET /ha/analytics/retention` — missed follow-ups, dismissal %, active subscriptions, loyalty (≥2 deliveries), upgrade pipeline size.
  2. **Role gates**: all 5 endpoints require `clinic_owner` + `super_admin` + `accounts`. Front-desk & audiologists blocked (403).
  3. **Frontend** `OwnerAnalyticsPage.js` — single responsive grid dashboard: 4 top-line KPI tiles + 12-month revenue bar chart (pure CSS) + Brand Split table with share bars + Team Performance table (below-floor % color-coded rose/amber/emerald) + Commercial Funnel horizontal bar view with rates + Inventory Health (in-stock/aging/dead mini-KPIs + per-product table) + Retention Health (4 big metrics). Denied-role card for unauthorized roles.
  4. **41/41 backend pytest green** (iter 19). Combined **P3+P4+P4.5+P6+P7 = 168/168** passing. Frontend screenshot-verified — full dashboard renders with live data (₹17.55L revenue, 85.9%/14.1% brand split, funnel 18→67→32→4, team performance rows, etc.). Baseline at `/app/backend/tests/test_phase7_ha_analytics.py`.
  5. 🎉 **The full 7-phase Hearing Aid Commerce & Lifecycle Engine v2.0 is now shipped.** Aligned end-to-end with user's original blueprint: P0 Architecture ✅ → P1 Foundation ✅ → P2 Inventory ✅ → P3 Procurement ✅ → P4 Trial+Sales ✅ → P5 Fitting+Programming ✅ → P6 CRM+Retention ✅ → P7 Analytics ✅.
- [Feb 2026] **HA Module — Service Tickets + Analytics Enhancements (Post-P7 backlog catch-up) (THIS SESSION)**:
  1. **Service Tickets** — new router `routers/ha_service.py` (7 endpoints: list / get / create / update / resolve / close / cancel / KPIs). `JOB-YYYY-NNNN` numbering live (was registered, unused). State machine: `open → in_progress → resolved → closed` + cancel from any. Serial state transitions on lifecycle: `SOLD → SERVICE_IN` (create) → `RETURNED` (resolve, patient-owned) or `IN_STOCK` (clinic-owned); → `DAMAGED` (cancel). New collection `service_tickets` with compound indexes.
  2. **Roles**: create = front_desk + audiologist + technician + clinic_owner + super_admin. Mutate (update/resolve/close/cancel) = technician + audiologist + clinic_owner + super_admin. Read = all.
  3. **Frontend** `ServiceTicketsPage.js` — list + 5 KPI tiles (Open / In Progress / Resolved / Closed / Warranty) + status filter + CreateModal (patient search → branch-scoped serial picker with current state display) + DetailDrawer with state-machine-aware action buttons (Start Work / Set Diagnosis / Resolve with cost + warranty checkbox / Close / Cancel).
  4. **Analytics drill-down** — new `GET /ha/analytics/sales-drill` endpoint supports date range + brand + user_id filters. UI: clicking any revenue bar, brand row, or team row opens a modal with the individual Sale rows behind that tile.
  5. **Date-range picker** on Owner Analytics header (From/To) — recomputes the revenue window dynamically.
  6. **CSV export** — three streaming endpoints: `/ha/analytics/export/{sales,revenue,inventory}.csv`. Each auto-downloads a timestamped CSV. Role-gated (clinic_owner / super_admin / accounts only).
  7. **31/31 backend pytest green** (iter 20). Covers lifecycle, role gates, CSV content-type + headers, drill date-range filter. Combined total = **199/199** across P3–P7 + this session. Baseline at `/app/backend/tests/test_phase8_service_and_drilldown.py`.
- [Feb 2026] **Response Rate per Audiologist tile (THIS SESSION — P6 lead-in delivered)**:
  1. **Backend** — extended `GET /ha/analytics/audiologists` to compute `wa_sends`, `wa_done`, `response_rate_pct` per user via a single $unwind+$group over `ha_followups.sent_channels`. Surfaces actors (front-desk / technicians) who send follow-ups but don't post sales — previously invisible in team perf.
  2. **Frontend** — two integrations on Owner Analytics:
     - Inline `ResponseRateBar` in the Team Performance table ("WA Response" column).
     - New standalone **"Response Rate per Audiologist"** card below the dashboard — full-width horizontal bars colored green/amber/rose at 50% / 25% thresholds, with `done/sent` legend and a coaching tip.
  3. **2/2 backend pytest green** (iter 21) — validates field presence, done ≤ sends invariant, formula consistency, accounts-role exclusion. Baseline at `/app/backend/tests/test_phase9_response_rate.py`.
  4. Screenshot-verified: Super Admin 100% (1/1), Front Desk 0% (0/5) — instantly surfaces coaching gaps.
- [Feb 2026] **Phase 10 — Service Revenue Tile + Loaner Allocation Module (THIS SESSION)**:
  1. **Backend** — `GET /api/ha/analytics/service-revenue?days=N` aggregates resolved/closed tickets into `{paid_revenue, warranty_tickets, total_tickets}` totals + breakdowns by ticket kind and technician. Zero-revenue warranty tickets are isolated from paid revenue via `$ifNull: [$warranty_covered, false]` conditionals. Role-gated to clinic_owner/super_admin/accounts.
  2. **Backend** — new router `routers/ha_loaners.py` (5 endpoints: list / kpis / get / issue / return). Serial lifecycle: `IN_STOCK → LOANER → IN_STOCK` (clean return) OR `IN_STOCK → LOANER → DAMAGED` (damaged return). Guardrails: non-IN_STOCK serial → 409, past-dated expected-return → 400, linked service-ticket patient-mismatch → 400, cross-branch serial → 403. Append-only audit trail via `transition_serial()`. Collection `ha_loaners` with compound indexes on (status, expected_return_date) + (patient_id).
  3. **Bug fix** — `OwnerAnalyticsPage.js` had duplicate `RevenueChart` + `FunnelView` component declarations (from a bad prior `search_replace`) breaking the build, plus a missing `ServiceRevenueCard` component. Fixed: duplicates removed, `ServiceRevenueCard` component added (renders top-line KPIs + warranty-burden %, by-kind table, by-technician table, with color-coded burden >30% rose / >15% amber).
  4. **Frontend** `LoanersPage.js` — list + 4 KPI tiles (Active/Overdue/Returned/Damaged) + overdue-only checkbox + status filter + `+ Issue Loaner` modal (patient search, branch-scoped IN_STOCK serial picker, deposit, expected return, service-ticket link) + per-row Return/Damaged action buttons. Wired into HAModule at `/ha/loaners` tab.
  5. **11/11 new backend pytest green** (iter 22) covering lifecycle, role gates (accounts blocked from create), state guardrails, KPI computation, and service-revenue aggregation. Baseline at `/app/backend/tests/test_phase10_loaners_and_service_revenue.py`. Frontend smoke-verified: Service Revenue card renders on /ha/analytics, Loaners page renders with all UI elements.
  6. 🎯 **All user-requested post-P7 backlog items now shipped**: Service Tickets ✅ · Drill-down ✅ · Date-range ✅ · CSV export ✅ · Response Rate tile ✅ · Service Revenue & Warranty Burden tile ✅ · Loaner Allocations ✅.

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
