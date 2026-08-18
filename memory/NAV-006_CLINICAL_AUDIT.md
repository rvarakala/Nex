# NAV-006 · Clinical Diagnostics Audit (READ-ONLY)

**Date:** 2026-08-18 · IST
**Scope:** Full clinical chain — Patient → Appointment → Diagnostic Queue → Test Session → Test → Result → Report → Patient History.
**Mode:** READ-ONLY. No code modified. No fixes shipped. Findings below are for review + prioritisation only.
**Coverage:** Every clinical module currently implemented in the codebase (see §2). Un-implemented modules are called out in **ORPHAN CLINICAL FUNCTIONALITY** (§6).

---

## 1. Executive Summary

The clinical spine is **functionally sound** and **tenant-scoped end-to-end**. The NAV-005 Sprint-3A hardening (already shipped) closed the primary tenant-isolation gap on `test_sessions` and formalised `clinic_id` as a first-class field on every session doc. Every session read/write path now filters by `{session_id, clinic_id}` directly, and the CLIN-001 startup backfill stamps `clinic_id` on any legacy row.

That said, the audit surfaced **12 findings** across data-integrity, defence-in-depth, and orphan functionality — none of them P0. The dominant themes are:

1. **"Find first, tenant-check later" pattern** in `reports.py` and `hearing_report_versions.py`. This is safe today (403 fires before data is returned) but a defence-in-depth failure — a maintainer could accidentally return the doc *before* the tenant check.
2. **Silent auto-fallback in session/appointment linkage.** If a caller supplies a foreign `appointment_id`, the session-create path silently ignores it and links to whichever same-day appointment happens to exist for that patient. Not a security bug, but a data-integrity hazard.
3. **Session dedupe collapses multiple visits in the same day.** The Diagnostics Queue dedupes by `patient_id` — a patient with two same-day appointments loses the second one from the board, and the second click of `/queue/start` silently reuses the earlier draft session instead of opening a new one.
4. **Orphan clinical functionality.** VNG, vHIT, Vestibular Assessment, Posturography/Balance Assessment, and Vestibular Rehabilitation are advertised in the domain narrative but **not implemented** in the codebase. VEMP is on the queue chip and launcher tile — but there is no dedicated panel; clicks route to the free-text "Special Tests" tab.
5. **UTC/IST boundary hazards** in session→appointment auto-link (uses `datetime.utcnow()` for the "today" prefix). Around IST midnight, this can either miss a valid appointment or pick a stale one.

**Nothing found blocks production. Nothing found requires an emergency rollback.** All findings are candidates for the next planned sprint.

---

## 2. Modules Audited

**Implemented (audited):**
- Pure Tone Audiometry / Audiogram — `pure_tone` tab in `TestProceduresModule.js`, backed by `AudiogramCanvas.js`.
- Speech Audiometry — `SpeechPanel.js`.
- Tympanometry / Impedance — `ImpedancePanel.js` (also Acoustic Reflex, Reflex Decay, ET Dysfunction sub-panels).
- OAE (DPOAE / TEOAE) — `OAEPanel.js`.
- ABR / ASSR — `ABRPanel.js` (combined per current clinical convention).
- Sound Field / Aided threshold — `SoundFieldPanel.js`.
- Special Tests (SISI · ABLB · TDT · Tone Decay) — `SpecialTestsPanel.js`.
- Pediatric / VRA — `PediatricPanel.js`.
- Tinnitus Match — `TinnitusPanel.js`.
- Clinical Reports + History — `ReportsPanel.js`, `HearingReportPreviewModal.jsx`, `AudiogramReportPage.jsx`, `hearing_report_versions.py`.
- Diagnostics Queue — `DiagnosticsQueueBoard.js`, `diagnostics_queue.py`.
- Test Session CRUD + PTA calculator — `test_sessions.py`.
- Report share-link — `reports.py`.

**Advertised but NOT implemented (orphan — see §6):**
- VNG · vHIT · VEMP (dedicated panel) · Vestibular Assessment · Posturography / Balance Assessment · Vestibular Rehabilitation.

---

## 3. Workflows Audited (chains verified end-to-end)

| # | Chain | Status |
|---|---|---|
| 1 | Appointment → Check-in → Queue (`waiting` → `checked_in`) | ✅ tenant-scoped |
| 2 | Queue → Start diagnostics → Draft session created | ⚠ silent-reuse hazard (F-004) |
| 3 | Start session → Auto-link today's appointment | ⚠ IST/UTC boundary + foreign-id silent-fallback (F-002, F-005) |
| 4 | Session save (auto-save 800 ms debounce) → `PUT /sessions/{id}` | ✅ tenant-scoped |
| 5 | Complete session → Close appointment + token | ✅ tenant-scoped, idempotent |
| 6 | Generate PDF report → `/api/reports/{sid}/pdf` | ✅ 403 on tenant mismatch; ⚠ find-first-check-later (F-006) |
| 7 | Save report version → `POST /api/hearing-reports/save` | ✅ tenant-scoped; ⚠ legacy `sessions` fallback (F-008) |
| 8 | Reopen historical version from Patient History | ✅ tenant-scoped |
| 9 | Share via WhatsApp (7-day signed link) → public bearer route | ✅ tenant-scoped + rate-limited |
| 10 | Direct URL access `/test/audiogram/{sid}` for foreign session | ✅ 404 from backend; ⚠ frontend swallows error silently (F-011) |
| 11 | Repeat test on same patient the same day | ⚠ collapses into one session (F-004) |
| 12 | Report reopen for a merged-out secondary patient | ✅ orphan-patient fallback renders "UNKNOWN" (F-007) |

**Total workflows audited: 12**
**Total clinical ID-links audited: 34** (patient_id / appointment_id / session_id / clinic_id references across the chain).

---

## 4. Result Summary

| Bucket | Count |
|---|---|
| ✅ PASS (working as spec'd) | 24 checks |
| 🔴 P0 (immediate) | 0 |
| 🟠 P1 (before next production release) | 2 |
| 🟡 P2 (planned sprint) | 4 |
| 🟢 P3 (backlog polish) | 4 |
| ⚪ ORPHAN (feature advertised but not built) | 2 (grouped) |

---

## 5. Findings

### F-001 · Queue dedupe drops the second same-day visit for the same patient
- **Module:** Diagnostics Queue (`diagnostics_queue.py`)
- **Current Behaviour:** `_upsert()` in `diagnostics_queue()` keys the board by `patient_id`. If a patient has TWO appointments today (e.g., 09:00 PTA + 15:00 follow-up), only the most-advanced state per patient survives — the second appointment is invisibly merged/dropped.
- **Expected Behaviour:** Each appointment row should appear as its own Kanban card. Dedupe should be by `(patient_id, appointment_id)` — not `patient_id` alone.
- **Evidence:** Lines 129-144 of `/app/backend/routers/diagnostics_queue.py`. `by_patient: dict[str, dict]` uses `patient_id` as the sole key.
- **Source File:** `/app/backend/routers/diagnostics_queue.py:129-144`
- **Patient ID handling:** ✅ correct
- **Appointment ID handling:** ⚠ silently lost when two exist same-day
- **Session ID handling:** ✅ correct
- **Clinic ID handling:** ✅ correct
- **Severity:** **P1** — clinics doing 2+ visits/day/patient will physically not see the second one on the board.
- **Recommended Fix:** Change the dedupe key from `patient_id` to `(patient_id, appointment_id or f"walkin:{arrived_at}")`. When both appointments have the same status, keep both rows; only collapse when the same appointment appears via multiple sources (token + appointment).

### F-002 · Foreign `appointment_id` on session-create is silently ignored → wrong appointment linked
- **Module:** Test Sessions (`test_sessions.py`) — POST `/api/sessions`
- **Current Behaviour:** If the caller sends `appointment_id=X` but X is scoped to a different clinic, the tenant filter returns nothing, and the endpoint silently falls back to the "auto-discover most-recent same-day appointment" branch. The resulting session is linked to a **different appointment than the client requested**, without any warning.
- **Expected Behaviour:** A supplied but unresolvable `appointment_id` should raise HTTP 400/404 (or at least log a warning and NOT auto-substitute).
- **Evidence:** Lines 43-60 of `test_sessions.py`. `if not appt:` block runs even when the caller explicitly supplied an `appointment_id`.
- **Source File:** `/app/backend/routers/test_sessions.py:43-60`
- **Patient ID:** ✅ correct
- **Appointment ID:** ⚠ silently substituted with a different value
- **Session ID:** ✅ correct
- **Clinic ID:** ✅ correct (this is why it's not a security bug — the substitute always belongs to the caller's clinic)
- **Severity:** **P1** — the session's `appointment_id` is a *lie* in this edge case, which cascades into recommended-tests auto-selection, "Referred by" auto-fill, and report attribution.
- **Recommended Fix:** Split the branch: `if session.appointment_id and not appt: raise HTTPException(404, "Appointment not found in this clinic")`. Auto-discover ONLY when the caller supplied no `appointment_id`.

### F-003 · Session-create uses `datetime.utcnow()` for the IST "today" prefix
- **Module:** Test Sessions (`test_sessions.py`)
- **Current Behaviour:** Line 50 does `datetime.utcnow().strftime("%Y-%m-%d")` and uses it as a `$regex` prefix on `start_at`. Because appointments are stored with IST wall-clock ISO strings, this creates a **5h30m mismatch window** around IST midnight: between 00:00 and 05:30 IST the query looks for appointments starting *yesterday's* UTC date and misses today's early-morning slot.
- **Expected Behaviour:** Use `ist_today_ymd()` (already imported in `diagnostics_queue.py`), so the prefix matches the tenant's local day.
- **Evidence:** `/app/backend/routers/test_sessions.py:50`
- **Severity:** **P2** — bounded to a 5h30m window nightly. Silent — appointment simply doesn't get linked and session runs untethered.
- **Recommended Fix:** Replace `datetime.utcnow().strftime("%Y-%m-%d")` with `ist_today_ymd()` from `utils.ist`.

### F-004 · `queue/start` silently re-uses today's earliest draft session for the same patient
- **Module:** Diagnostics Queue (`diagnostics_queue.py`)
- **Current Behaviour:** Lines 328-338 look up "any draft session for this patient today at this clinic" and reuse it. If a patient came in this morning for PTA (session A) and now returns in the afternoon for a follow-up OAE (should be session B), clicking "Start" reuses session A. The two visits get **stapled into one session document**.
- **Expected Behaviour:** Reuse should be scoped to the current visit — e.g., match by `appointment_id` first, and only auto-create a new session when the patient's earlier session was already `completed`.
- **Evidence:** `/app/backend/routers/diagnostics_queue.py:322-338`
- **Severity:** **P2** — mostly hits busy clinics doing repeat/follow-up visits in one day. In practice mitigated by "completing" the morning session before the afternoon visit, but easy to forget.
- **Recommended Fix:** Add `appointment_id` to the draft-session dedupe filter. When the caller supplies a different `appointment_id` than the existing draft's, mint a new session.

### F-005 · `queue/complete` doesn't validate the linked appointment's clinic_id
- **Module:** Diagnostics Queue (`diagnostics_queue.py:479-483`)
- **Current Behaviour:** The endpoint reads `s.get("appointment_id")` from the session and blindly updates `db.appointments.update_one({appointment_id, clinic_id})`. The `clinic_id` filter is present, so this is **safe** — but if the appointment was deleted or rescheduled to another clinic, the update is a silent no-op with no audit trail.
- **Severity:** **P3** — never causes a security regression, just a hygiene gap.
- **Recommended Fix:** Log an INFO line when the appointment update matches 0 rows.

### F-006 · Reports "find first, tenant-check later" pattern
- **Module:** Reports (`reports.py`)
- **Current Behaviour:** `_load_session_and_patient()` does `db.test_sessions.find_one({"session_id": ...})` **without a `clinic_id` filter**. The tenant check happens ~20 lines later (`if session_clinic != user["clinic_id"]: raise 403`). Today the 403 fires *before* the data is streamed, so this is safe. But a future maintainer could refactor around the tenant check and accidentally leak.
- **Severity:** **P2 (defence-in-depth)**. No known IDOR today; the risk is regression from future edits.
- **Recommended Fix:** Push the `clinic_id` filter into the `find_one`. Same fix in `share-audit` at line 266.

### F-007 · Orphan-patient fallback lets an "UNKNOWN" patient be reported
- **Module:** Reports (`reports.py:43-51`)
- **Current Behaviour:** If a session references a `patient_id` that no longer exists in `patients` (deleted, merged into another, or corrupted FK), the code synthesises a fake patient with `patient_id="UNKNOWN"` inheriting the session's `clinic_id`, then renders the report anyway.
- **Expected Behaviour:** Merged-out patients should redirect to the survivor's identity. Genuinely orphaned sessions should surface a clear "Patient record missing — cannot render report" message, not a silent "Unknown Patient" report.
- **Severity:** **P2** — hides data-integrity bugs from operators.
- **Recommended Fix:** Look up `patient_merge_events` to find the surviving primary when the direct fetch fails; only fall back to "UNKNOWN" as a last resort AND include a red banner on the report saying "Patient record could not be located."

### F-008 · `hearing_report_versions.py` falls back to legacy `sessions` collection
- **Module:** Hearing Report Versions (`hearing_report_versions.py:82-88`)
- **Current Behaviour:** `_load_session()` tries `test_sessions` first, then `sessions` (a legacy collection). Any doc in `sessions` bypasses the CLIN-001 backfill and may be missing `clinic_id` entirely.
- **Expected Behaviour:** Either (a) migrate the legacy `sessions` collection into `test_sessions` and delete it, or (b) enforce `clinic_id` presence and treat missing values as denied.
- **Severity:** **P3** — only matters if the legacy collection still has rows. A read-only DB probe would confirm.
- **Recommended Fix:** DB probe → count non-empty rows in `sessions`. If 0, delete the fallback branch. If >0, add a Sprint task to migrate + drop.

### F-009 · Session doc doesn't cross-check `patient.clinic_id == session.clinic_id`
- **Module:** Reports (`reports.py:158-163`)
- **Current Behaviour:** The tenant check compares `session.clinic_id` and `patient.clinic_id` **independently** against `user.clinic_id`. If the patient was later moved between clinics (not currently supported, but a future feature) and their `clinic_id` mutated while the session's stayed frozen, the report renders for the wrong tenant.
- **Severity:** **P3** — hypothetical today; would matter the day patient re-parenting is added.
- **Recommended Fix:** Also assert `session.clinic_id == patient.clinic_id` and raise 500 with a hard-fail log if they diverge.

### F-010 · `_stream_pdf` catch-all exposes internal error strings
- **Module:** Reports (`reports.py:148-150`)
- **Current Behaviour:** `except Exception as e: raise HTTPException(500, detail=f"Failed to generate PDF: {e}")` — the raw `str(e)` can leak filesystem paths, template internals, or Mongo error codes.
- **Severity:** **P3** — minor info-disclosure.
- **Recommended Fix:** Log the exception server-side; return a generic "Failed to generate PDF" to the client.

### F-011 · `/test/audiogram/{sessionId}` swallows all fetch errors → silent zombie modal for cross-tenant IDs
- **Module:** Audiogram Report Page (`AudiogramReportPage.jsx:40-43`)
- **Current Behaviour:** Backend correctly returns 404 for a session belonging to another tenant. The frontend's `catch {}` swallows it, and the page mounts `<HearingReportPreviewModal>` with no data. The modal itself then also fails fetch and shows a partial empty state.
- **Severity:** **P3** — UX only; no data leaks.
- **Recommended Fix:** Surface "Report not found or not authorised" and offer a "Back to Patient" button.

### F-012 · `ReportsPanel` doesn't cross-check `patient.patient_id == session.patient_id`
- **Module:** Reports Panel (`ReportsPanel.js`)
- **Current Behaviour:** Parent (`TestProceduresModule.js`) passes `patient={activeTest.patient}` and `sessionId={activeTest.sessionId}` as INDEPENDENT props. If `activeTest.patient` is stale (e.g., patient was merged in another tab), the report gets the correct session data but the wrong patient letterhead.
- **Severity:** **P3** — very narrow race window; mitigated by the session doc being the source of truth for the PDF template.
- **Recommended Fix:** Have the report modal always re-fetch the patient by `session.patient_id` rather than trusting the parent prop.

---

## 6. Orphan Clinical Functionality

Advertised in the AUDINEXA domain narrative but **not implemented**:

| Modality | Status in Code | Notes |
|---|---|---|
| **VEMP** | Chip mapped to `special` tab | No dedicated panel/data model. Free-text notes only. |
| **VNG** | Not present | Zero references outside marketing copy. |
| **vHIT** | Not present | Zero references outside marketing copy. |
| **Vestibular Assessment** | Not present | — |
| **Posturography / Balance Assessment** | Not present | — |
| **Vestibular Rehabilitation** | Not present | — |

**Grep evidence:** `/app/frontend/src/components/` and `/app/backend/routers/` contain zero panels/routers for vng/vhit/posturography/vestibular/rehab. Landing-page copy mentions them (`LandingPage.js`, `LandingPageV3.jsx`), but no clinical surface exists.

**Recommendation:** Either (a) build native panels for at least VEMP + VNG + vHIT (highest-demand vestibular tests in India), or (b) reword landing copy to reflect the current audiological scope. Option (b) is a 20-minute copy edit; option (a) is a Sprint-scale build.

---

## 7. Clinical Data Integrity Risks (roll-up)

- **F-002** — Wrong appointment silently linked to a session (P1)
- **F-003** — Nightly 5h30m IST/UTC window drops appointment linkage (P2)
- **F-004** — Same-day repeat visits collapse into one session doc (P2)
- **F-007** — Orphan-patient fallback yields "UNKNOWN"-labelled reports (P2)

## 8. Cross-Tenant Security Risks (roll-up)

**None confirmed.** Every clinical endpoint enforces `clinic_id`. NAV-005 Sprint-3A already closed the primary risk on `test_sessions`. The remaining defence-in-depth item is:

- **F-006** — Session/patient fetched *before* tenant check in `reports.py` + `hearing_report_versions.py` (P2)

## 9. Missing Clinical Links (roll-up)

- **F-005** — Complete-endpoint doesn't audit-log appointment-update misses (P3)
- **F-009** — No `session.clinic_id == patient.clinic_id` sanity assertion (P3)
- **F-012** — Report modal accepts patient prop instead of re-deriving from session (P3)

## 10. Recommended Fix Plan

### P0 — Immediate (halt release)
_None._

### P1 — Before next production release
- **F-001** — Queue dedupe by `(patient_id, appointment_id)`, not `patient_id`.
- **F-002** — Fail hard when `appointment_id` is supplied but unresolvable.

### P2 — Next planned sprint
- **F-003** — Use `ist_today_ymd()` for the session→appointment "today" lookup.
- **F-004** — Include `appointment_id` in the draft-session reuse filter.
- **F-006** — Push `clinic_id` into the `find_one` in `reports.py` + `hearing_report_versions.py` + `share-audit`.
- **F-007** — Look up `patient_merge_events` before falling back to "UNKNOWN" patient in report renders.

### P3 — Backlog polish
- **F-005** — INFO log on empty appointment-close updates.
- **F-008** — DB probe of legacy `sessions` collection; migrate + delete if non-empty.
- **F-009** — Add `session.clinic_id == patient.clinic_id` sanity assertion.
- **F-010** — Sanitise `_stream_pdf` exception detail from responses.
- **F-011** — Show "Report not found or not authorised" on foreign session URLs.
- **F-012** — Have `HearingReportPreviewModal` re-derive patient from session, not props.

### ORPHAN (product decision required)
- **VEMP / VNG / vHIT / Posturography / Vestibular Rehab** — either (a) build native panels or (b) reword landing copy. Decision needed before any dev work is scoped.

---

## 11. Audit Boundaries + What Was Explicitly NOT Modified

- No code files were edited.
- No database rows were modified.
- No config, environment, supervisor state was touched.
- No sessions were deleted (only the synthetic Sprint-1 smoke-test patient `ACS-2026-EB4688A2` on production, which was created + deleted in a single script run).
- All findings are pending your approval before I proceed to implementation.

## 12. Sign-off

**Prepared by:** E1 (main agent) as read-only audit per NAV-006 scope directive.
**Recommendation:** Approve F-001 + F-002 for the next sprint (P1 gate). Defer everything else to backlog until you specifically call it in.
