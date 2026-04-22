# HA Module — Phase 0 Architecture Freeze

> **Status**: Draft for sign-off. No code is written yet. Every section below becomes a non-negotiable contract for Phase 1-7 implementation.

---

## 1. Core Entities (16)

Each row = one MongoDB collection. `PK` = primary key; `FK` = foreign key to PK of another entity.

| # | Entity | PK | Key Fields | Belongs-to (FK) | Notes |
|---|---|---|---|---|---|
| 1 | **Clinic** | `clinic_id` | name, gstin, billing_address, state, pan | — | Already exists (`clinics`). No schema change. |
| 2 | **Branch** | `branch_id` | clinic_id, name, city, state, gstin, phone | clinic_id | **NEW.** A clinic may have many branches; inventory lives at the branch. Mumbai HQ + Delhi test = 2 branches under 1 clinic. |
| 3 | **User** | `user_id` | email, name, role, clinic_id, branch_ids[] | clinic_id | Extended: `branch_ids[]` restricts which branches a user sees. |
| 4 | **Role** | `role_code` | code, label, permissions[] | — | See § 2. Static registry, not user-editable. |
| 5 | **Patient** | `patient_id` | mrd, name, mobile, dob, gender | clinic_id | Already exists. No schema change. |
| 6 | **Vendor** | `vendor_id` | name, gstin, state, contact, terms | clinic_id | **NEW.** Phonak / Signia India / Widex India etc. |
| 7 | **Product** | `product_id` | brand, model, form_factor, tech_tier, connectivity[], warranty_months, mrp, cost, min_sell_price, hsn, gst_rate, is_serialised | clinic_id | **NEW.** Catalogue SKU. `is_serialised=true` for HA units; `false` for bulk accessories. |
| 8 | **SerialItem** | `serial_id` | serial_no (manufacturer), product_id, branch_id, state, pool, warranty_end_date, current_patient_id | product_id, branch_id | **NEW.** One row per physical HA unit. Serial_no is the unique physical sticker on the device. See § 3 state machine. |
| 9 | **AccessorySKU** | `sku_id` | product_id, side, size, length, power_level, recurrent, replacement_cycle_days, qty_on_hand | product_id, branch_id | **NEW.** Non-serialised stock tracked by qty, not by unit. |
| 10 | **PurchaseOrder** | `po_no` | vendor_id, branch_id, lines[], total, status, expected_date | branch_id, vendor_id | **NEW.** Format `PO-YYYY-NNNN`. Lines = {product_id OR sku_id, qty, unit_cost}. |
| 11 | **GRN** | `grn_no` | po_no, received_at, lines[] (w/ serial_nos[] for serialised), invoice_ref | po_no | **NEW.** Goods-receipt note. Serials captured here become SerialItem rows. |
| 12 | **Trial** | `trial_no` | patient_id, serial_id, audiologist_id, start_date, end_date, deposit_amount, condition_photos[], consent_url, status, reason_code | patient_id, serial_id | **NEW.** Format `TRIAL-YYYY-NNNN`. |
| 13 | **Sale** | `sale_id` | patient_id, serial_ids[] (L+R for pair), invoice_no, price_per_unit[], discount, paid_total | patient_id | **NEW.** Wraps an invoice but is HA-specific. Links to pair logic (UC-HA16). |
| 14 | **Invoice** | `invoice_id` | sale_id (nullable), lines[], gst, grand_total, payments[], status | sale_id (nullable) | Already exists. Extend with optional `sale_id` link + serial-aware lines. |
| 15 | **Payment** | `payment_id` | invoice_id, amount, method, paid_at, reference | invoice_id | Already exists. No schema change. |
| 16 | **FollowUp** | `followup_id` | patient_id, serial_id, kind (adaptation/consumable/review), due_date, status, sent_channels[] | patient_id | **NEW.** Drives UC-HA20/21/22/23. APScheduler cron picks due rows. |
| 17 | **ServiceTicket** | `job_no` | patient_id, serial_id, issue, status, technician_id, opened_at, closed_at, resolution | serial_id | **NEW.** Format `JOB-YYYY-NNNN`. Records repair/service cycle. |
| 18 | **UpgradeOpportunity** | `opp_id` | patient_id, serial_id, trigger (age_3y/repeat_repair/new_tech/lifestyle), score, created_at, status | patient_id | **NEW.** UC-HA24. Daily job scans eligibility. |

**Collections created**: `branches`, `vendors`, `ha_products`, `serial_items`, `accessory_skus`, `purchase_orders`, `grns`, `trials`, `ha_sales`, `ha_followups`, `service_tickets`, `upgrade_opportunities`.
**Collections extended**: `users` (+`branch_ids[]`), `invoices` (+optional `sale_id`).

---

## 2. Role × Permission Matrix

7 roles. Every endpoint must declare which role(s) may call it; anything else is 403.

| Role | Patients | Inventory | Sales/Billing | Clinical (M02) | Trials | Service | Analytics | Users/Branches |
|---|---|---|---|---|---|---|---|---|
| **Super Admin** | R/W | R/W | R/W | R/W | R/W | R/W | R (all branches) | **R/W** |
| **Clinic Owner** | R/W | R/W | R/W | R | R/W | R | R (own clinic) | R/W (own clinic) |
| **Audiologist** | R/W | R (own branch) | R | **R/W** | R/W | R | R (own) | — |
| **Front Desk** | R/W | R (own branch) | R/W (cashier: create invoice, record payment) | — | R/W (initiate trial) | R (create ticket) | — | — |
| **Inventory Manager** | R (basic) | **R/W** (PO / GRN / transfers) | R (price only) | — | R | R/W | R (inventory dashboards only) | — |
| **Accounts** | R | R (cost) | **R/W** (invoice adjust, cancel, refunds) | — | R | — | R (revenue / margin) | — |
| **Technician** | R (basic) | R (stock at own branch) | — | — | R | **R/W** | — | — |

Principle: **least privilege + branch scope**. `Audiologist.branch_ids` restricts the inventory view; `Accounts` sees all branches of the clinic.

All existing endpoints already have a `get_current_user` gate — Phase 1 introduces `require_roles("...")` + `require_branch(branch_id)` helpers in `auth.py`.

---

## 3. Serial-Item State Machine (9 states)

```
                   ┌───────────┐
     GRN ───────►  │ IN_STOCK  │ ◄─── (service complete)
                   └─────┬─────┘
                ┌────────┼────────┬─────────┬──────────┐
                ▼        ▼        ▼         ▼          ▼
            RESERVED TRIAL_OUT   SOLD      LOANER   SERVICE_IN
                │        │        │         │          │
                │        │        │         │          ▼
                │        │        │         │      ┌──────────┐
                │        │        │         │      │ RETURNED │
                │        │        │         └────► │ (to      │
                │        │        │                │  vendor) │
                │        │        │                └──────────┘
                └────────┴────────┼──────► DAMAGED ──► RETIRED
                                  ▼
                             (paired with partner)
```

### Allowed transitions (enforced server-side, any other → 409)

| From | Allowed targets | Trigger event |
|---|---|---|
| `IN_STOCK` | `RESERVED`, `TRIAL_OUT`, `SOLD`, `LOANER`, `SERVICE_IN`, `DAMAGED` | quote-lock / trial-start / direct-sale / loan / service / damage-report |
| `RESERVED` | `SOLD`, `IN_STOCK` | sale-confirm / reservation-expire |
| `TRIAL_OUT` | `SOLD`, `IN_STOCK`, `DAMAGED` | trial-convert / trial-return / trial-damage |
| `LOANER` | `IN_STOCK`, `DAMAGED` | loaner-return / loaner-damage |
| `SERVICE_IN` | `IN_STOCK`, `RETURNED`, `DAMAGED` | service-complete / vendor-return / unrepairable |
| `SOLD` | `SERVICE_IN`, `RETURNED` | customer-service-claim / customer-return |
| `RETURNED` | *(terminal; can go to `RETIRED`)* | vendor-credit-note |
| `DAMAGED` | `SERVICE_IN`, `RETIRED` | repair-attempt / scrap |
| `RETIRED` | *(terminal)* | — |

**Every transition writes an audit row** to `serial_events` collection: `{serial_id, from, to, at, actor_user_id, ref_doc}`. Enables the full lifecycle ledger of UC-HA03.

**No event-sourcing overengineering** — the state lives on the `SerialItem` row; the audit log is append-only metadata.

---

## 4. Numbering Scheme (locked)

All identifiers are **clinic-scoped, year-reset** counters stored in the existing `counters` collection with `_id = "{kind}:{clinic_id}:{year}"`. Same pattern already powers `INV/YYYY/NNNNNN` in billing.

| Entity | Format | Counter key | Notes |
|---|---|---|---|
| Invoice (existing) | `INV/YYYY/NNNNNN` | `invoice:{clinic_id}:{year}` | Already live. No change. |
| Purchase Order | `PO-YYYY-NNNN` | `po:{clinic_id}:{year}` | 4-digit, resets Jan 1. |
| GRN | `GRN-YYYY-NNNN` | `grn:{clinic_id}:{year}` | 4-digit. |
| Trial | `TRIAL-YYYY-NNNN` | `trial:{clinic_id}:{year}` | 4-digit. |
| Service Ticket | `JOB-YYYY-NNNN` | `job:{clinic_id}:{year}` | 4-digit. |
| Sale | `SAL-YYYY-NNNN` | `sale:{clinic_id}:{year}` | 4-digit. Internal; customers see the invoice-no. |
| MRD (existing) | `ACS-YYYY-NNNNNN` | `mrd:{clinic_id}:{year}` | Already live. |
| Token (existing) | Daily reset | `token:{clinic_id}:{YYYY-MM-DD}` | Already live. |

Separator standardised: **dash** for HA counters (`PO-…`), **slash** for invoice (existing). I'll keep both — changing the invoice format would break every printed invoice.

`SerialItem.serial_no` is the **manufacturer's physical sticker** — entered by the Inventory Manager at GRN, typed or barcode-scanned. The system does NOT mint its own local serial; this matches how audiology clinics actually work (service claims require the factory serial).

---

## 5. Integration Map (with what already exists)

| Source | HA Module consumer | Contract |
|---|---|---|
| **M02 sessions** (audiogram) | UC-HA06 candidacy | read-only `/api/sessions/{id}` |
| **Patients** (M01) | every HA flow | read-only join on `patient_id` |
| **Billing invoice** | UC-HA14 Smart Billing | `Sale.invoice_no` links to existing `invoices.invoice_id`; HA line carries `serial_id` |
| **Share-token infra** | UC-HA13 Quotation share | reuse `share_token.py` with new `type: "quotation"` |
| **Audit/rate-limit** | UC-HA02 serial audit | reuse `utils/rate_limit.py` + audit-log pattern |
| **WhatsApp wa.me** | UC-HA10, 20, 21 touch-points | reuse existing deep-link helper |
| **APScheduler** | UC-HA20, 21, 24, 29 | add jobs to existing scheduler (21:00 IST slot already reserved) |
| **Closeout trend aggregation** | UC-HA12, 26, 27 dashboards | reuse `$dateToString(tz="Asia/Kolkata")` pattern |

Zero new infra: the HA module is a **new set of routers + collections**, leveraging every platform primitive we've already built.

---

## 6. Open Items — Need Your Sign-off Before Phase 1

🔴 **Must-decide (blocking Phase 1 start):**

1. **Branch seed for existing data** — the current `clinic-acs-demo` has no branches. Shall I:
   - (a) Auto-create a single "Mumbai HQ" branch for `clinic-acs-demo` + "Delhi" branch for `clinic-delhi-test` and backfill all current inventory/users to it? **← recommended**
   - (b) Leave legacy users branch-less until someone assigns them manually
2. **Candidacy scoring mode (UC-HA06)** — rule-based (deterministic, ships today) vs LLM-assisted (Claude, richer rationale). Still need your call.

🟡 **Nice-to-have (won't block Phase 1):**

3. Pre-seed 5 brands × 2-3 models as demo catalogue? Or start with empty `ha_products` and let the clinic add their own SKUs?
4. **Reservation auto-expiry window** — how long should an `IN_STOCK → RESERVED` lock hold before auto-reverting? Default **48 hours**?

🟢 **Already decided from your message:**

- ✅ Branch is a first-class entity
- ✅ 7 roles as listed
- ✅ 9-state serial-item machine
- ✅ `INV-` / `PO-` / `TRIAL-` / `JOB-` numbering
- ✅ Build in 7 phases (Foundation → Inventory → Transactions → Clinical → CRM → Analytics → Scale)

---

## 7. Phase Sequence (7 layers, locked)

| Phase | Scope | UC coverage | Est effort |
|---|---|---|---|
| **P0** (this doc) | Architecture freeze | — | 0 — sign-off only |
| **P1 Foundation** | Branch + Role + Vendor CRUD + numbering-counter utility + state-machine helper + role/branch guard | scaffolding for all | 2-3 days |
| **P2 Core Inventory** | Product Master, SerialItem, AccessorySKU, PO, GRN, Inventory board, serial lifecycle timeline | UC-HA01→05 | 4-5 days |
| **P3 Transactions** | Quotation Studio, Smart Billing (extends existing), Margin gates, Pair logic, Sale entity | UC-HA13→16 | 4-5 days |
| **P4 Clinical Workflows** | Candidacy, Lifestyle, Recommendation, Trial flow + guided journey, Fitting session, Programming ledger, Adaptation | UC-HA06→12, 17→19 | 6-7 days |
| **P5 CRM Automation** | Follow-up cron, consumable subscription, NPS+referral, reactivation, service tickets | UC-HA20→23, service | 3-4 days |
| **P6 Upgrade Engine** | Eligibility tracker, exchange program, upgrade funnel | UC-HA24→26 | 2-3 days |
| **P7 Executive Analytics** | Revenue intelligence, commercial funnel, LTV score | UC-HA27→29 | 3-4 days |

Each phase ends with `testing_agent_v3_fork` and a green baseline in `/app/backend/tests/`.

---

## 8. Guardrails (will be enforced in code)

1. **No direct state writes** on `SerialItem` — every transition goes through `transition_serial(serial_id, to_state, actor, ref_doc)` helper that checks the transition table and writes the audit row atomically.
2. **No cross-branch reads** — every HA query is scoped by `branch_id IN user.branch_ids` unless role is Super Admin / Accounts (clinic-wide).
3. **No in-place counter increment outside the numbering helper** — single `next_number(kind, clinic_id)` function; anything else is a lint violation.
4. **No HA line on an invoice without a matching `SerialItem.state == RESERVED`** — prevents overselling.
5. **Every write endpoint** declares its allowed roles in a decorator; missing decorator = test fail.
