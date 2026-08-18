# NAV-006 P2 — CLINICAL SESSION INTEGRITY AUDIT

**Date:** 2026-08-18 · IST
**Mode:** READ-ONLY. No code, config, or database changed.
**Scope:** F-003 / F-004 / F-006 / F-007 + any additional P2-grade issues surfaced by the trace.
**Preview state:** NAV-006 P1 + P1B (F-001, F-002, B1, B2) live and green (20/20 regression, verified below).

---

## Executive Summary

| Bucket | Count | IDs |
|---|---|---|
| P0 | **0** | — |
| P1 | **0** | — |
| P2 | **3** | F-006 · F-007 (clinical-context loss) · F-004-A (walk-in + explicit-appt bypass) |
| P3 | **4** | F-003 · F-007 (cosmetic subset) · F-008 (legacy `sessions` fallback still present) · F-004-B (mixed `updated_at` timezones) |
| ORPHAN | **1** (grouped) | VEMP / VNG / vHIT / Posturography / Vestibular Assessment / Vestibular Rehab |
| NEW P2 discovered | **1** | F-013 · `report_handover.py` uses PATIENT ownership as tenant guard for sessions (see §Additional) |

Nothing warrants a P1 immediate patch. Every finding is fix-in-planned-sprint. Tenant isolation on the clinical data-plane is intact; the P2 items are defence-in-depth + clinical-context UX, not confirmed IDORs.

---

## F-003 — IST/UTC Boundary

**Status:** CONFIRMED · narrow window · low blast-radius.
**Severity:** **P3** (was P2 in Sprint-P1 audit; downgraded here because the F-002 fix removed the primary vector — explicit `appointment_id` now uses direct lookup instead of the regex prefix. Only the auto-discover fallback remains impacted.)
**Affected endpoints:**
- `POST /api/sessions` — `test_sessions.py:66` (`today_prefix = datetime.utcnow().strftime("%Y-%m-%d")`)
- `PUT /api/sessions/{id}` — `test_sessions.py:130` (`update_data["updated_at"] = datetime.utcnow()`) — only affects the stored `updated_at` timestamp, not any lookup.

**Exact code path (POST /api/sessions):**
```python
# When session.appointment_id is NOT supplied (walk-in flow):
today_prefix = datetime.utcnow().strftime("%Y-%m-%d")           # ← UTC clock
appt = await db.appointments.find_one({
    "start_at": {"$regex": f"^{today_prefix}"},                 # ← IST wall-clock stored
    ...
})
```
Appointments' `start_at` field is stored as IST-wall-clock ISO string (e.g., `"2026-08-18T09:00:00"`). During **00:00–05:30 IST daily** the UTC clock is on the previous day → the regex prefix is D-1 → any scheduled morning appointment for day D fails to auto-link.

**User impact:**
- Walk-in patient registered at, say, **02:30 IST** — their fresh test session's auto-linked appointment lookup runs with UTC prefix from the previous day → the patient's **04:30 IST scheduled appointment doesn't match** → session persists with `appointment_id=None` (walk-in).
- Recommended-tests / `referred_by` / `visit_type` are NOT prefilled from the appointment → audiologist manually re-enters them.
- Report generated from that session omits the appointment-derived context. No data corruption, no cross-tenant leak.

**Data-integrity impact:**
- Bounded by the 5h30m nightly window (00:00–05:30 IST).
- Confined to `/api/sessions` no-appointment-id branch (F-002 removed the with-id branch).
- Silent — no error surfaces to the user; the session simply lacks appointment context.
- Reversible by manually re-linking (there's a UI path via `?appointment=<id>`).

**Evidence:**
- `git grep 'datetime.utcnow' routers/test_sessions.py` → 2 hits, both in the POST/PUT paths.
- `utils/ist.py` already exports `ist_today_ymd()` and `ist_day_start_utc()` — the fix is one import + two-line swap.
- `routers/diagnostics_queue.py` already migrated to `_ymd_ist()` (line 377), demonstrating the same pattern.
- `routers/appointments.py`, `routers/tokens.py` already use `ist_today_ymd()` correctly.

**Recommendation:**
Replace `test_sessions.py:66` with:
```python
today_prefix = ist_today_ymd()
```
`test_sessions.py:130` (`updated_at = datetime.utcnow()`) is cosmetic; migrate to `datetime.now(timezone.utc)` for consistency with the rest of the codebase but no user-visible change.

---

## F-004 — Draft Session Reuse (broader audit)

**Status:** MIXED — most reuse paths are safe post-P1B; **two residual holes** remain.
**Severity:** **P2** for F-004-A (patient-vs-appointment-scope inconsistency); **P3** for F-004-B (mixed timezone `updated_at`).

**All reuse paths traced:**

| # | Endpoint | Reuse filter | Filters by clinic_id | Filters by appointment_id | Filters by patient_id | Verdict |
|---|---|---|---|---|---|---|
| 1 | `POST /api/sessions` — CASE A (no appt id) | `{clinic_id, patient_id, start_at$regex}` on appointments (no session-reuse — every call creates a new session) | ✓ | n/a (no session lookup) | ✓ | **SAFE** (F-003 boundary aside) |
| 2 | `POST /api/sessions` — CASE B (explicit appt id) | supplied appointment must resolve in caller's clinic; new session created | ✓ | ✓ direct lookup | — | **SAFE** — F-002 in force |
| 3 | `POST /api/diagnostics/queue/start` — session_id pinned | `{session_id, clinic_id}` + drop-if-mismatched-appointment | ✓ | ✓ post-check | — | **SAFE** — B2 in force |
| 4 | `POST /api/diagnostics/queue/start` — no session_id, appt resolved | `{clinic_id, patient_id, status:"draft", created_at≥today_ist, appointment_id=appt.id}` | ✓ | ✓ | ✓ | **SAFE** — B2 in force |
| 5 | `POST /api/diagnostics/queue/start` — no session_id, no appt (walk-in) | `{clinic_id, patient_id, status:"draft", created_at≥today_ist}` — **no appointment_id filter** | ✓ | ✗ | ✓ | ⚠ **F-004-A** below |
| 6 | `GET /api/sessions/{id}` | `{session_id, clinic_id}` | ✓ | — | — | **SAFE** |
| 7 | `PUT /api/sessions/{id}` | `{session_id, clinic_id}` on both existence check AND write | ✓ | — | — | **SAFE** |
| 8 | `DELETE /api/sessions/{id}` | `{session_id, clinic_id}` | ✓ | — | — | **SAFE** |
| 9 | `POST /api/sessions/{id}/generate-report` | `_get_session_tenant_scoped()` — see §F-013 | ⚠ indirect | — | ✓ | ⚠ **F-013** below |
| 10 | `POST /api/sessions/{id}/report-pdf` | same helper as #9 | ⚠ indirect | — | ✓ | ⚠ **F-013** |
| 11 | `POST /api/hearing-reports/save` (`_load_session`) | `{session_id}` then post-check `session.clinic_id == user.clinic_id` | ⚠ indirect | — | — | ⚠ **F-006** below |
| 12 | Diagnostics Queue board (`/api/diagnostics/queue`) | `{clinic_id, status:"draft", created_at≥today_ist}` collectively; then keyed by `(patient_id, appointment_id)` per F-001 | ✓ | ✓ | ✓ | **SAFE** — F-001 in force |

### F-004-A · Walk-in draft can be reused across two independent walk-in visits same day

**Scenario:**
1. Patient P walks in at 09:00 IST; audiologist starts a walk-in session (no appt_id). Row #5 creates a fresh draft `S1` with `appointment_id=None`.
2. Audiologist half-completes, forgets to click "Complete", closes tab.
3. Same patient P walks in AGAIN at 15:00 IST for a completely different service; audiologist clicks Start on the walk-in queue card again.
4. Row #5 filter (`patient_id, status="draft", created_at≥today_ist` — **no appointment_id filter**) finds `S1` → **REUSES it**.
5. The 15:00 audiogram data is written into `S1`, corrupting the 09:00 session.

**Data-integrity impact:** Loss of the earlier walk-in's clinical data. Silent — the audiologist thinks they started fresh; both visits' data is now co-mingled under S1. Rare because two same-day walk-ins for the same patient are uncommon, but the bug is real.

**Why B2 didn't cover this:** B2's appointment-aware filter only activates when `appt` is truthy. In the pure walk-in flow, `appt=None` and we fall back to the historic behaviour.

**Recommendation (P2):** When `appt is None` AND we find a draft with `appointment_id is None`, additionally require that the draft is EITHER:
- created within the last N minutes (say 30 min — same as a natural single-visit window), OR
- explicitly resumable via a pinned `session_id` (already handled by row #3).
Otherwise mint a new session. Simplest patch: add `"appointment_id": None` to the draft_filter when `appt is None`, and add a `"created_at": {"$gte": <30-min-ago>}` guard. Roughly 4 lines in `diagnostics_queue.py`.

### F-004-B · Mixed timezone in `updated_at` writes

`test_sessions.py:130` writes `datetime.utcnow()` (naive) while every other write (queue/start line 448, report_handover line 84, hearing_report_versions.py) uses `datetime.now(timezone.utc)` (tz-aware). Sorting by `updated_at` across rows will alternate between naive and tz-aware datetimes, which pymongo will happily store but Python comparisons in code (e.g., a "sessions modified in the last hour" report) will raise `TypeError: can't compare offset-naive and offset-aware datetimes`. Latent; no user-visible bug today.

**Recommendation (P3):** normalise `test_sessions.py:130` to `datetime.now(timezone.utc)`.

---

## F-006 — Reports Tenant Isolation

**Status:** DEFENCE-IN-DEPTH gap (no confirmed IDOR).
**Severity:** **P2**.

**Endpoint-by-endpoint classification:**

| Endpoint | File:Line | Initial query | Tenant check timing | Classification |
|---|---|---|---|---|
| `GET /api/reports/{sid}/pdf` | reports.py:36-39, 157-163 | `find_one({session_id})` — no clinic_id | Post-fetch (line 160-163) | **DEFENCE-IN-DEPTH** — 403 fires before PDF stream, no data leak |
| `POST /api/reports/{sid}/share-link` | reports.py:36-39, 183-189 | same helper | Post-fetch (line 186-189) | **DEFENCE-IN-DEPTH** |
| `GET /api/reports/shared/{token}` | reports.py:228-242 | same helper + token.clinic_id compare | Post-fetch (line 231-242) | **SAFE** — token itself is clinic-scoped signed |
| `GET /api/reports/{sid}/share-audit` | reports.py:266 | `find_one({session_id})` — no clinic_id | Post-fetch (line 269-270) | **DEFENCE-IN-DEPTH** |
| `POST /api/hearing-reports/save` | hearing_report_versions.py:82-88 | `find_one({session_id})` on `test_sessions` then legacy `sessions` fallback | Post-fetch (line 201-202) | **DEFENCE-IN-DEPTH + F-008 latent** |
| `POST /api/sessions/{id}/generate-report` | report_handover.py:41-51 | `find_one({session_id})` then `find_one({patient_id, clinic_id})` | Uses PATIENT clinic as gate | **F-013** — see Additional |
| `POST /api/sessions/{id}/report-pdf` | same as above | same | same | **F-013** |
| `GET /api/reports` (list) | report_handover.py:220-222 | `{clinic_id, report_status}` | Baked in | **SAFE** |
| `GET /api/patients/{pid}/history` | report_handover.py:322-323 | `{clinic_id, patient_id}` on both sessions + invoices | Baked in | **SAFE** |

**Reasoning for DEFENCE-IN-DEPTH classification:**
The pattern `find_one({session_id}) → check clinic_id after fetch` is not exploitable today because:
1. The 403 error fires BEFORE any response data is returned.
2. Response body on 403 does NOT include any session/patient data (just the fixed string "Not authorised").
3. Timing side-channel probing would be needed to distinguish "session exists but foreign" from "session doesn't exist" — and even then, session_ids are 12-char UUID-hex prefixed with `SES-` (~52 bits of entropy — infeasible to brute).

**Why still worth fixing:**
A future refactor could accidentally return the fetched document (or a subset like `patient_name` in an error message) before the tenant check. Push the filter INTO the `find_one` and the risk permanently disappears.

**Recommendation (P2):** Replace:
```python
session = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})
if not session:
    raise HTTPException(404, ...)
if session.get("clinic_id") != user["clinic_id"]:
    raise HTTPException(403, ...)
```
with:
```python
session = await db.test_sessions.find_one(
    {"session_id": session_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
)
if not session:
    raise HTTPException(404, ...)   # foreign existence NOT revealed
```
Apply to `reports.py:36`, `reports.py:266`, `hearing_report_versions.py:82`. Roughly 3 × 3-line edits.

---

## F-007 — UNKNOWN Patient Resolution

**Status:** CONFIRMED — but scope is smaller than the P1 audit assumed.
**Severity:** **P2** (clinical context loss) + **P3** (cosmetic-only in subset)

**Merge resolution path:**
- `POST /api/patients/merge` (patients.py:813) — rewrites `test_sessions.patient_id` from secondary → primary. `test_sessions` IS in `_MERGEABLE_COLLECTIONS` (line 6-11) since NAV-005 Sprint-3A.
- After a fresh merge: `session.patient_id == primary.patient_id`, so subsequent `db.patients.find_one({patient_id: session.patient_id})` returns the SURVIVING primary → no UNKNOWN fallback.

**When UNKNOWN CAN legitimately fire:**
1. **Pre-Sprint-3A legacy merges** — merges applied BEFORE `test_sessions` was added to the whitelist would have LEFT the session pointing at the deactivated secondary. The secondary row still exists (`active=False, merged_into=<primary>`) so the current find_one WOULD find it (returns the deactivated patient) → **actually NOT UNKNOWN — the deactivated row is returned**.
2. **Hard-deleted patient row** (via admin console or manual DB op) — session.patient_id no longer resolves. UNKNOWN fires.
3. **Chained merge with deleted intermediate** — merge A→B, then B→C, then somebody hard-deletes B. If any session still points at B, UNKNOWN fires.

**Where UNKNOWN fallback lives:** `reports.py:44-50` — synthesises a fake patient inheriting session.clinic_id for tenant guard, then renders the PDF with "Unknown Patient" text.

**Where UNKNOWN does NOT fall back:** `report_handover.py:48-49` (`_get_session_tenant_scoped`) — raises **403 "Not authorised for this session"** instead. **Inconsistent behaviour across sibling endpoints.**

**Potential clinical impact:**
- Report PDF renders with "Unknown Patient" header. Legally / clinically defective if handed to a patient.
- Handover flow refuses to complete ("403 Not authorised"), locking the audiologist out of finalising the report — a *worse* UX than reports.py's UNKNOWN.
- Neither branch attempts to resolve via `patient_merge_events` to find the surviving primary.

**Evidence:**
- `reports.py:41-50` — the UNKNOWN fallback block.
- `report_handover.py:45-49` — the divergent 403 branch.
- `patient_merge_events` collection queries exist ONLY in `routers/patients.py` (5 refs) — no report/history code consults it.

**Recommendation (P2):** Add a shared helper `resolve_patient_for_session(db, session)` that:
1. Try direct lookup `{patient_id, clinic_id}`.
2. On miss, look up `patient_merge_events.find({secondary_patient_id: session.patient_id, undone_at: None})` sorted by merged_at desc.
3. Follow the `primary_patient_id` chain to the current live row.
4. Only fall back to UNKNOWN if step 3 also fails.
Wire both `reports.py::_load_session_and_patient` and `report_handover.py::_get_session_tenant_scoped` into this helper so their behaviours converge.

---

## Additional P2 Findings

### F-013 · `report_handover.py` uses patient-ownership as tenant guard (NEW — surfaced during F-006 trace)

**Location:** `report_handover.py:41-51` (`_get_session_tenant_scoped`).

**Current behaviour:**
```python
s = await db.test_sessions.find_one({"session_id": session_id}, {"_id": 0})         # ← no clinic_id
if not s: raise 404
p = await db.patients.find_one({"patient_id": s.patient_id, "clinic_id": clinic_id})
if not p: raise 403  # ← uses PATIENT's clinic-scope to gate the SESSION
```

**The bug:** The tenant guard on the session is INDIRECT — it relies on the patient row also existing in the caller's clinic. This has two consequences:

1. **False 403 on legitimate handover** if the patient row was hard-deleted OR has an outdated `clinic_id` (e.g., a data-repair migration wrote to `test_sessions.clinic_id` but not `patients.clinic_id`). The session is legitimately in the caller's clinic but the audiologist can't complete the handover.

2. **Missed direct tenant check** — never asserts `session.clinic_id == user["clinic_id"]`. If a session was ever migrated to another clinic (currently impossible, but hypothetically) while its patient row stayed in the original clinic, the endpoint would 403 correctly *by coincidence* but for the wrong reason.

**Severity:** **P2**. Blocks completion in edge cases; not a security bug.

**Recommendation:** Assert `session.clinic_id == user["clinic_id"]` DIRECTLY in the query (same pattern as F-006 fix). Then optionally fetch the patient. The patient's existence check should NOT be the tenant guard.

---

## Endpoint Matrix

| Endpoint | Patient scoped | Appointment scoped | Session scoped | Clinic scoped | Risk |
|---|---|---|---|---|---|
| POST `/api/sessions` (create) | ✓ | ✓ (explicit) / ⚠ (auto via UTC regex) | new session | ✓ direct | **F-003 (P3)** |
| GET `/api/sessions` (list) | optional | — | — | ✓ direct | SAFE |
| GET `/api/sessions/{id}` | — | — | ✓ | ✓ direct | SAFE |
| PUT `/api/sessions/{id}` | — | — | ✓ | ✓ direct (both check & write) | SAFE |
| DELETE `/api/sessions/{id}` | — | — | ✓ | ✓ direct | SAFE |
| POST `/api/diagnostics/queue/start` | ✓ | ✓ (B1) / ⚠ walk-in-only draft reuse (F-004-A) | ✓ (B2) | ✓ direct | **F-004-A (P2)** |
| POST `/api/diagnostics/queue/complete` | — | via session | ✓ | ✓ direct | SAFE |
| POST `/api/diagnostics/queue/checkin` | ✓ | ✓ | — | ✓ direct | SAFE |
| GET `/api/diagnostics/queue` | ✓ | ✓ (F-001) | ✓ | ✓ direct | SAFE |
| GET `/api/reports/{sid}/pdf` | via session | — | ✓ (find-first) | ⚠ post-fetch check | **F-006 (P2)** |
| POST `/api/reports/{sid}/share-link` | via session | — | ✓ (find-first) | ⚠ post-fetch check | **F-006 (P2)** |
| GET `/api/reports/shared/{token}` | via session | — | ✓ + token.clinic_id | ⚠ post-fetch + token | SAFE (defence-in-depth ok) |
| GET `/api/reports/{sid}/share-audit` | — | — | ✓ (find-first) | ⚠ post-fetch check | **F-006 (P2)** |
| POST `/api/hearing-reports/save` | — | — | ✓ (find-first + legacy fallback) | ⚠ post-fetch check | **F-006 + F-008 (P2/P3)** |
| POST `/api/sessions/{id}/generate-report` | ✓ (as gate) | — | ✓ | ⚠ indirect via patient | **F-013 (P2)** |
| POST `/api/sessions/{id}/report-pdf` | ✓ (as gate) | — | ✓ | ⚠ indirect via patient | **F-013 (P2)** |
| GET `/api/reports` (list) | — | — | via clinic | ✓ direct | SAFE |
| GET `/api/patients/{pid}/history` | ✓ | — | ✓ | ✓ direct | SAFE |

---

## Identifier Authority Matrix

Which identifier is the source-of-truth at each transition:

| Workflow step | patient_id | appointment_id | session_id | token_id | clinic_id | Authority |
|---|---|---|---|---|---|---|
| Appointment create | REQUIRED input | GENERATED here | — | — | REQUIRED via JWT | `clinic_id` from JWT |
| Queue GET (board) | derived | authoritative post-F-001 | derived | derived | REQUIRED filter | `(patient_id, appointment_id)` composite (F-001) |
| Queue check-in | input | input (optional) | — | input (optional) | REQUIRED filter | `appointment_id` primary, `token_id` secondary, patient_id last |
| Queue start | REQUIRED input | authoritative post-B1/B2 | may be pinned | may be pinned | REQUIRED via JWT | **`appointment_id` (post-B1/B2)** — never silently substituted |
| Session PUT | — | — | REQUIRED path param | — | REQUIRED filter | `session_id` + `clinic_id` composite |
| Session complete | — | derived from session | REQUIRED | derived (auto-close matching) | REQUIRED filter | `session_id` (session is source-of-truth for appointment closure) |
| Report generate | — | — | REQUIRED path param | — | inherited from session | `session_id`; **patient re-derived from session** |
| Report share-link | — | — | REQUIRED path param | — | signed into token | `session_id` + `clinic_id` signed-token |
| Patient history | REQUIRED path param | — | — | — | REQUIRED filter | `patient_id` + `clinic_id` |
| Merge apply | primary + secondary inputs | — | — | — | REQUIRED filter | `primary_patient_id` becomes authoritative for all whitelisted collections including `test_sessions` |
| Merge undo | via `merge_events.rewrites[]` — precise _id | — | — | — | REQUIRED filter | `_id` list from the merge event (reversible even after chained merges) |

**Silent-substitution paths eliminated by P1/P1B:**
- Queue board: patient_id → (patient_id, appointment_id) ✓
- POST /sessions: foreign appt_id → auto-substitute REMOVED ✓
- Queue/start: foreign appt_id → auto-substitute REMOVED ✓
- Queue/start: draft-A reused for appt-B → REMOVED (B2) ✓

**Silent-substitution paths still present:**
- POST /sessions **no-appt-id branch**: UTC vs IST → wrong-day appointment miss (F-003, P3, narrow window)
- Queue/start **walk-in-only branch**: two same-day walk-ins for same patient → cross-contamination (F-004-A, P2)

---

## Regression Verification (P1 + P1B still intact)

| Marker | File | Count | Verdict |
|---|---|---|---|
| `NAV-006 F-001` / `by_card` / `_card_key` | `routers/diagnostics_queue.py` | 10 markers | ✓ present |
| `NAV-006 F-002` / `Appointment not found in this clinic` | `routers/test_sessions.py` | 2 markers | ✓ present |
| `NAV-006 Sprint-P1B` | `routers/diagnostics_queue.py` | 2 markers | ✓ present |
| Pytest — P1 suite (11 tests) + P1B suite (9 tests) | — | **20 / 20 PASS** in 8.58 s | ✓ green |

Deploy commit `503b527` on production has not regressed.

---

## Test Results

Executed during this audit (read-only, no data writes):

| Suite | Result | Note |
|---|---|---|
| `tests/test_nav006_p1_queue_and_session_fixes.py` | **11 / 11 PASS** | F-001 + F-002 regression |
| `tests/test_nav006_p1b_queue_start_appointment_fix.py` | **9 / 9 PASS** | B1 + B2 regression |
| **Combined** | **20 / 20 PASS** · 8.58 s | preview parity with production code |

No new tests were run. No production tests were run. No test data was created.

---

## Files Inspected (read-only)

**Backend (16):**
- `backend/utils/ist.py`
- `backend/routers/test_sessions.py`
- `backend/routers/diagnostics_queue.py`
- `backend/routers/appointments.py`
- `backend/routers/reports.py`
- `backend/routers/report_handover.py`
- `backend/routers/hearing_report_versions.py`
- `backend/routers/patients.py`
- `backend/routers/tokens.py`
- `backend/routers/analytics.py`
- `backend/routers/patient_portal.py`
- `backend/routers/referrals.py`
- `backend/routers/ha_custom_ha_orders.py`
- `backend/routers/ha_fittings.py`
- `backend/models/_canonical.py`
- `backend/server.py`

**Test-suite discovery only (not executed except for the P1/P1B regressions):**
- `backend/tests/test_nav005_sprint3a_merge_and_isolation.py`
- `backend/tests/test_nav005_sprint3b_profile_hygiene.py`
- `backend/tests/test_nav005_sprint3c_registration_hardening.py`
- `backend/tests/test_iter11_cross_tenant.py`
- `backend/tests/test_iter12_security_audit.py`
- `backend/tests/test_cross_tenant_numbering_collision.py`

**Frontend** — no files inspected this pass. F-011/F-012 remain per prior audit; not in this audit's scope.

---

## Production Data

Confirming for the record:

- ✅ **No production writes.**
- ✅ **No test patients created** in any environment.
- ✅ **No test appointments created** in any environment.
- ✅ **No test sessions created** in any environment.
- ✅ **No production data modified.**
- ✅ **No configuration or environment variables changed.**
- ✅ **No deployment triggered.**
- ✅ Preview-only pytest regression suites (20 tests) executed against the local containerised MongoDB. Every fixture-created row is auto-deleted in teardown.

---

## Final Recommendation — prioritised fix plan (proposal only, no work started)

### Sprint-P2A (next quarter, ~1 day)
- **F-006** — Push `clinic_id` into every `find_one` on `test_sessions` and `patients` in `reports.py`, `report_handover.py`, `hearing_report_versions.py`. Roughly 5 × 3-line edits. Adds regression tests confirming 404 (not 403 with data-leak potential).
- **F-013** — Rewrite `report_handover.py::_get_session_tenant_scoped` to use direct `session.clinic_id` filter as the tenant guard, not the patient row's existence.
- **F-007** — Add `resolve_patient_for_session()` helper that consults `patient_merge_events` before falling back to UNKNOWN. Wire both `reports.py` and `report_handover.py` to it.

### Sprint-P2B (later, ~half day)
- **F-004-A** — Walk-in draft reuse should require `appointment_id: None` in the filter AND a `created_at ≥ 30-min-ago` guard so two same-day walk-ins for the same patient never cross-contaminate.

### P3 backlog
- **F-003** — Swap `datetime.utcnow().strftime("%Y-%m-%d")` for `ist_today_ymd()` in `test_sessions.py:66`. One-line change.
- **F-004-B** — Normalise `test_sessions.py:130` `updated_at` writes to `datetime.now(timezone.utc)`.
- **F-008** — DB probe of legacy `sessions` collection; migrate + delete the fallback branch in `hearing_report_versions.py:85`.
- **F-005 / F-009 / F-010 / F-011 / F-012** — as documented in the P1 audit.

### ORPHAN (product decision required)
- **VEMP / VNG / vHIT / Posturography / Vestibular Assessment / Vestibular Rehab** — build panels or reword landing copy.

---

## STOP

This audit made no code changes. No database rows were touched (the pytest suites created + deleted their own fixtures in the ephemeral preview MongoDB only). No deployment was triggered. No new sprint is being started.

**Awaiting your approval on which findings — if any — to move into the next scoped fix sprint.**
