# ACS Audiology Clinic System — PRD

## Original Problem Statement
Build Phase 0 MVP for ACS Audiology Clinic system focusing on M03 (Report Generation).
Core features: Pure Tone Audiometry (PTA) + Tympanometry plotting, speech
audiometry, template-based PDF reports with clinical accuracy.
UI/UX must replicate a professional NOAH-style clinical layout (compact, dense,
no modern SaaS fluff).

## Tech Stack
- Frontend: React + Tailwind + HTML5 Canvas (custom audiogram rendering)
- Backend: FastAPI + Motor (Async Mongo)
- DB: MongoDB
- Planned: Emergent LLM key for AI report narratives (P2)

## Architecture
```
/app/backend/  (server.py, models.py, pdf_generator.py)
/app/frontend/src/
  App.js
  components/
    AudiogramCanvas.js      (canvas draw logic — logarithmic X, symbols)
    NoahControlPanel.js     (center control panel: test mode + masked + PTA)
    SimpleTabs.js           (Pure Tone | Speech | Impedance)
    PatientInfoBar.js
    PTACalculator.js
```

## Implemented (Session 1 + 2)
- [Session 1] NOAH-style 3-tab layout (Window-in-Window container)
- [Session 1] Logarithmic X-axis frequency spacing (125 Hz … 16 kHz)
- [Session 1] Extended Frequency range toggle (10K/12.5K/16K w/ blue tint)
- [Session 1] 10 dB labels + 5 dB grid + dotted mid-frequency lines (750/1.5K/3K/6K)
- [Session 1] Center control panel: HTL, BCL, MCL, UCL, FF, FF-A + Masked + NR per ear
- [Session 1] Right-click context menu (Clear / Plot NR / Delete point)
- [Session 1] Auto PTA average (500/1K/2K)
- [Feb 2026] **Clinical NR symbols**: diagonal arrows ↙ (right ear) / ↘ (left ear) attached to AC & BC symbols (O, X, <, >, [, ], △, □)
- [Feb 2026] **NR line isolation**: connecting polyline lifts pen at any NR point — NR points never joined to neighbouring thresholds
- [Feb 2026] Uniform 10px font sizing across the control panel
- [Feb 2026] Hidden "Made with Emergent" badge (display:none in index.html)
- [Feb 2026] **Expanded to 10-tab NOAH bar**: Pure Tone | Speech | Impedance | Special Tests | OAE | Sound Field / Aided | ABR / ASSR | Pediatric | Tinnitus | Reports. Each new tab renders a structured `TabPlaceholder` listing planned sub-tests.
- [Feb 2026] **NR workflow refactored**: removed all 12 center-panel NR buttons; NR is plotted only via right-click context menu and plots at the user-chosen dB (cursor Y position, 5 dB snap) instead of fixed 120 dB.
- [Feb 2026] **Pre-Test tab added** (now the first tab) — 3-column NOAH layout for Case History (minimal: complaint / duration / onset / affected ear / tinnitus-vertigo-otalgia-otorrhea / notes), Tuning Fork battery (selectable 256/512/1024/2048 Hz + Rinne R/L / Weber / ABC R/L / Bing R/L with dropdowns + notes), and Otoscopy (Pinna / EAC / TM dropdowns + notes + client-side-resized base64 image upload per ear). Backend models `CaseHistory`, `TuningForkTest`, `EarOtoscopy`, `OtoscopyFinding`, `PreTestData` added; `pre_test_data` persisted via existing `PUT /api/sessions/{id}` with 800 ms debounced auto-save.
- [Feb 2026] **Case History expanded** with 8 collapsible accordion sections (extracted into `CaseHistorySection.js`): A·Hearing Specifics (suspect HL / better ear / progression / prior test / physician / earache-drainage / aural fullness), B·Tinnitus Detail (ear / frequency / bothersome / sound description), C·Dizziness & Falls (dizzy today / associated symptoms / falls last 12mo + injury), D·Noise Exposure, E·Family History, F·Medical History (prior surgery / head trauma / medications + 12 significant conditions), G·Hearing Aid History, H·Communication Needs (6 difficult situations + top 3 problem areas + phone ear). Backend nested models: `HearingSpecifics`, `TinnitusDetail`, `DizzinessDetail`, `NoiseExposure`, `FamilyHistory`, `MedicalHistoryDetail`, `HearingAidHistory`, `CommunicationNeeds`.
- [Feb 2026] **Reports tab built** (`ReportsPanel.js` + `ReportAudiogram.js`): live A4 print-preview with hardcoded ACS Audiology Clinic branding; **configurable Section Builder** (toggle visibility + ▲▼ reorder) for Case History / Pure Tone / PTA Table / Tuning Fork / Otoscopy / Speech / Tympanometry / Results / Recommendations; auto-generated Case History narrative from Pre-Test data; overlaid R+L audiogram with legend; live-editable Results + Recommendations (auto-save via existing `clinical_impression` + `recommendations` fields with 800 ms debounce); `@media print` CSS enables browser Print → Save-as-PDF matching on-screen preview exactly.
- [Feb 2026] **Report Audiogram display-mode toggle** added in Noah Control Panel (directly beneath Binaural): **Combined** (single overlaid R+L chart with legend) vs **Separate** (two side-by-side "Right Ear" / "Left Ear" mini-charts). Preference flows via prop from App.js to `ReportsPanel` → `PureToneSection`; default is Combined.
- [Feb 2026] **PTA Summary moved inline** (below Legend) — columns renamed from HTL/BCL to **PTA 1** (500·1K·2K avg) and **PTA 2** (1K·2K·4K avg). Report title changed from "Hearing Loss Assessment" → "Hearing Assessment". Degree column removed.
- [Feb 2026] **Impedance / Tympanometry tab built** (`ImpedancePanel.js` + `TympanogramCanvas.js`): Tympanometry always visible for both ears (inputs: Type, ME Pressure, Compliance, Volume, Notes → auto-plots Gaussian tympanogram curve in ear-specific red/blue). Auto-classifies Jerger Type (A/As/Ad/B/C) from values with override. Top-bar toggles reveal Acoustic Reflex grid (Ipsi+Contra, 250/500/1K/2K/4K Hz × Level/Volume/Pressure per ear), Reflex Decay (500 & 1K Hz), and ET Dysfunction (Toynbee / Valsalva / Pressure-app with before/after pressure + interpretation + notes). Backend models: `Tympanometry`, `AcousticReflex`, `ReflexDecay`, `ETDysfunction`, `ImpedanceData` — auto-saves via existing `PUT /api/sessions/{id}`.
- [Feb 2026] **Report tympanometry integration**: report renders tympanogram curves + Jerger summary table auto-populated from the Impedance tab. Smart placement logic — **Auto mode**: separate page when Reflex Decay or ET Dysfunction is enabled, inline on main page otherwise; user can override with Auto / Inline / New page toggle in Report Builder. Separate page gets its own patient strip + border-top dashed separator in preview; `@media print` uses `page-break-before: always` so PDF contains a dedicated Tympanometry page.
- [Feb 2026] **Customisable clinic branding**: new "Clinic Branding" collapsible section in Report Builder allows uploading a logo (client-side resized to 400 px base64, persisted to `localStorage`), selecting logo shape (circle / square / rectangle), and editing clinic name, tagline, 2 address lines, phone, and email. Report title "Hearing Assessment" moved below the header band (own row). Patient info strip compressed to single-row compact layout to save vertical space.
- [Feb 2026] **Tuning Fork smart placement in report**: Rinne + Weber are always part of the report; by default they render as a compact micro-table directly below PTA Summary in the PureTone sidebar (no notes). New "Show ABC" / "Show Bing" checkboxes in Report Builder promote the Tuning Fork block to a full main-body section (with notes) containing only Rinne + Weber + the enabled opt-in rows.
- [Feb 2026] **Tympanogram plotting correctness**: Volume / ECV is no longer used to compute the curve (pure Gaussian `y = C · exp(−(x−P)²/(2σ²))`). X-axis remains Pressure (daPa), Y-axis remains Compliance (mL) — volume is now a reported value only. Added **Probe tone selector** per ear (226 / 678 / 800 / 1000 Hz) with `probe_hz` persisted to backend `TympanogramEar` model; report summary header reflects the probe Hz dynamically; higher probe frequencies slightly broaden the curve sigma to mimic clinical response.
- [Feb 2026] **A4 report fit — Patient strip single-line**: Patient Demographics row compressed from 4-column × 2-row grid to a single flex-wrap continuous line (`Patient Name: … Age/Gender: … Referred by: … MRD: … DOB: … Audiologist: … Date: …`). Verified entire report (Header + Patient strip + Case History + Pure Tone + Tympanometry + Results 2×2 + Recommendations + Signature) now fits within the 297 mm A4 preview container (scrollHeight = clientHeight = 1123 px — zero overflow).
- [Feb 2026] **Provisional Diagnosis removed**: Report Results grid simplified to 2-column layout (Puretone Findings | Immitence Findings). Sidebar textarea and persisted field deleted.
- [Feb 2026] **Further Advice (ENT) section added + conclusion block moved to end**: new `further_advice` field persisted via debounced save. Recommendations and Further Advice render as a single row in the report (Recommendations wider 3fr, Further Advice narrower 2fr). When user selects "New page" for Tympanometry placement, the conclusion block (Results → Recommendations/Advice → Signature) is relocated to the END of the report — after the Tympanometry full-page — so ENT reads test data first, conclusions last.
- [Feb 2026] **ReportsPanel refactor**: The 1381-line monolith split into a `reports/` module with 15 focused files. New structure: `reports/constants.js`, `reports/narrative.js`, `reports/ptaCalc.js`, `reports/SectionTitle.js`, `reports/TympanometrySections.js`, `reports/BuilderSidebar.js`, `reports/layout/{ReportHeader, PatientStrip, SignatureFooter}.js`, `reports/sections/{CaseHistory, PureTone, TuningFork, Otoscopy, Placeholder, ResultsGrid, RecommendationsAdvice}.js`. `ReportsPanel.js` itself is now 245 lines of pure orchestration — holds state, dispatches to section components. Zero runtime behaviour change, lint clean, verified via screenshot + DOM-order check.
- [Feb 2026] **Audiogram size toggle (New page mode only)**: Three-button Standard / **Large (default)** / Extra Large picker in Report Builder sidebar. Adjusts audiogram chart heights — Combined mode: 240 / 380 / 550 px · Separate mode: 280 / 400 / 550 px. Size control is disabled (greyed) unless Tympanometry placement is set to "New page" — keeps the single-A4 fit intact for Auto/Inline modes.
- [Feb 2026] **Full-width stacked audiogram layout (Large / Extra Large)**: When audiogram size ≠ Standard, the Legend + PTA Summary + (optional) Tuning Fork mini are relocated from the right-hand 180 px sidebar to a **single horizontal strip BELOW** the chart. This lets the audiogram canvas auto-scale to the full A4 printable width — measured 703 px for Combined mode (previously 253 px, a 2.8× width increase) and ~347 px per chart for Separate mode. Standard mode still uses the original compact sidebar layout so the A4 single-page fit is preserved.
- [Feb 2026] **ETF-Intact TM (Williams Test) sub-test added** to Impedance tab. New toggle next to "ET Dysfunction". Captures **Volume (mL)** + **3 peak pressures (daPa)** per ear: P1 baseline · P2 post-Valsalva · P3 post-Toynbee. New `ETFCanvas.js` component plots 3 overlaid Gaussian curves (red / blue / green) at each peak pressure plus an ear-tinted shaded "normal range" rectangle (-150…+100 daPa × 0.3…1.8 mL). Backend models `ETFIntactEar` and `ETFIntact` added; `etf_intact` field persisted via existing `PUT /api/sessions/{id}`.
- [Feb 2026] **ETF-Intact graph rendered on report's Tympanometry full-page** (when enabled). Two side-by-side canvases with ear-tinted header ("Right/Left — Volume X.XX mL"), the 3-curve overlay + shaded normal range, plus a compact summary table below each graph listing Pressure 1/2/3 values in matching colors. Auto mode now also flips to "separate page" whenever ETF-Intact is toggled on (in addition to Reflex Decay and ET Dysfunction).
- [Feb 2026] **Acoustic Reflex / Reflex Decay UI overhaul**: replaced the old ipsi+contra nested grid (5 freqs × 3 rows per ear) with a cleaner layout matching clinical Interacoustics style: dedicated **Contralateral Acoustic Reflexes** and **Ipsilateral Acoustic Reflexes** sections, each showing a single-row strip per ear (red/blue "Stimulus (Probe) Right/Left Ear" rules) across **9 stimuli: 250 / 500 / 1000 / 2000 / 4000 / 6000 / BBN / LBN / HBN**. **Acoustic Reflex Decay** rendered as a compact single-line block with "Earphone R (probe L)" and "Earphone L (probe R)" pairs × 500/1000 Hz. All cells are now **free-form text inputs** (`ReflexCell.level: Optional[str]`) — accepting both numbers ("85") and alphabetic markers ("NR", "CNT", "N", "P"). Report's Tympanometry full-page reflex tables auto-updated to show all 9 columns.
- [Feb 2026] **Speech Audiometry tab built (P1)**. Replaces the placeholder. Two stacked panels: (1) **Speech Audiometry table** — 4 rows (Right / Left / Soundfield / Soundfield Aided) × 5 columns (SAT / SRT / Masking / MCL / UCL), free-form text inputs; (2) **Speech Audiogram canvas** — X-axis -10 … 120 dB HL, dual Y-axes %SR (left) and %SD (right, mirrored), pink >90 dB beyond-comfort zone, black `m` and `s` reference S-curves. Multi-channel WRS plotting (Right red / Left blue / Soundfield green / Aided magenta) with click-to-add and manual-entry controls (Undo last, Clear, Masked toggle). Backend: new `SpeechRow` + `SpeechWRSPoint` + `SpeechAudiometryData` models; `speech_data` field on `TestSession` persisted via debounced save. Also added `further_advice` field to `TestSessionUpdate` (was previously only handled on frontend).
- [Feb 2026] **Word Recognition + Word Recognition in Noise tables added to Speech tab**. Word Recognition table has shared Word List / Presentation text fields plus a 4-row × 6-col grid (Right / Left / Soundfield Right / Soundfield Left) × (dBHL, %, Masking) × (dBHL, % aided, Masking) — Masking cells grey-disabled for Soundfield rows as in the reference. Word Recognition in Noise is a 2-row × 3-col (dBHL / % / N. Level) table. Backend models `WordRecognitionRow` + `WordRecognitionInNoiseRow` added to `SpeechAudiometryData`.
- [Feb 2026] **Speech tab bottom layout rewritten to match clinical form**: removed the old 3-table layout (Speech Audiometry / Word Recognition / Word Recognition in Noise). New layout keeps the Speech Audiogram on top and adds four grouped sections below — each with a black left-edge label tag: **SRT / SAT** (R + Masked + L + Masked + Binaural R/L + SAT R/L/SF/SFA + DiscrimList + Voice Type + Reliability), **WR** (3×3 grid: Unaided / Aided / PIPB Unaided × R / L / Binaural with %/dB/Masked), **WRN** (R/L/Binaural × %/dB/Noise), **MCL · Quick SIN · UCL/LDL** (three sub-panels with footer tags). Backend: `SpeechAudiometryData` simplified to `fields: Dict[str,str]` + WRS curves — schema-free for future iteration without migrations. Report's `SpeechSection` rewritten to match.

## Backlog / Roadmap

### P1
- [ ] **Speech Audiometry tab** — Acoustic Reflexes grid + Speech data entry table (SRT, MCL, UCL, WRS)
- [ ] NR diagonal arrows for MCL/UCL/FF/FFA symbols when NR is toggled for those modes

### P2
- [ ] **Impedance / Tympanometry tab** — interactive full-screen tympanogram plotting (Type A, B, C curves)
- [ ] **AI-powered report narrative** — Emergent LLM key → GPT-5.2/Claude Sonnet integration for auto-generated diagnostic impressions
- [ ] PDF report generation with embedded audiogram render

### P3
- [ ] Historical comparison overlay (previous session threshold ghosts)
- [ ] Patient DB CRUD UI (currently hardcoded demo patient)
- [ ] Audiologist auth + multi-user sessions

## Key Technical Invariants (DO NOT BREAK)
1. `getLogPosition(freq)` provides logarithmic X mapping — must stay log scale.
2. NR points are drawn in strict isolation — never connected by any line.
3. NR arrow direction: right ear = ↙ (down-left), left ear = ↘ (down-right).
4. Control panel width fixed at 160px for NOAH density.
5. All backend API routes prefixed with `/api`.

## API Endpoints (existing)
- POST `/api/patients`
- POST `/api/sessions`
- PUT  `/api/sessions/{id}`
- GET  `/api/reports/{session_id}/pdf`

## Mocked / Pending
- Patient data: hardcoded demo (`ACS-2025-001234 — Ramesh Kumar`)
- Speech & Impedance tabs: placeholder content only

## Test Credentials
None required (no auth implemented).
