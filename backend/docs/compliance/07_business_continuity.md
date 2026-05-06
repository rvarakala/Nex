# Business Continuity & Backup Policy

**Document ID:** BCP-07  
**Aligned to:** ISO/IEC 27001:2022 — A.5.29-A.5.30, A.8.13 · ISO 22301:2019  
**Version:** 1.0 · **Effective:** {{effective_date}}  
**Owner:** {{clinic_name}} — {{dpo_name}} ({{dpo_email}})  
**Approved by:** {{owner_name}}

---

## 1. Purpose
Ensure {{clinic_name}} can continue serving patients and meeting regulatory
obligations even when AUDINEXA, the network, or a clinic location is
disrupted.

## 2. Recovery Objectives
- **RPO (Recovery Point Objective)** — ≤ **24 hours**. We accept losing at
  most a single business day's data in a worst-case event.
- **RTO (Recovery Time Objective)** — ≤ **8 hours** for clinical operations
  to resume from backup; ≤ **48 hours** for full feature parity.

## 3. Backup Strategy

### 3.1 AUDINEXA-managed
AUDINEXA performs the following backups on the MongoDB cluster on the
Clinic's behalf:
- **Continuous oplog tail** → point-in-time recovery within the last 24 h.
- **Daily snapshot** → retained for 30 days.
- **Weekly snapshot** → retained for 90 days.

The Clinic does not need to run any backup tooling itself — but **must keep
its account credentials safe**, since access to backups is gated by the
clinic owner's account.

### 3.2 Clinic-side
On a USB drive locked in {{owner_name}}'s desk, the Clinic shall keep:
- A **monthly CSV export** of patients, invoices, and appointments
  (Settings → Data Export).
- A **monthly PDF export** of the previous month's invoices.

This is the offline contingency for an extended AUDINEXA outage.

## 4. Failure Scenarios

### 4.1 AUDINEXA outage (< 4 hours)
- Use the AUDINEXA mobile-friendly read-only mode (cached patient list).
- Record new appointments/visits on paper.
- After recovery, manually back-fill into AUDINEXA via Settings → Data
  Import (CSV / Excel).

### 4.2 AUDINEXA outage (> 4 hours)
- Notify patients of any rescheduled appointments via WhatsApp / phone
  (using the offline patient list export).
- Halt non-urgent diagnostics until service is restored.
- Escalate to AUDINEXA support via the in-app contact link or
  `support@emergent.sh`.

### 4.3 Clinic-internet outage
- AUDINEXA is web-based; the Clinic shall maintain a **secondary internet
  link** (4G/5G dongle or alternate ISP) at every branch with > 5 daily
  appointments.

### 4.4 Cyber-incident (ransomware on a workstation)
- See **IRP-04 — Incident Response Policy**.

### 4.5 Natural disaster / clinic-premises loss
- Patient records remain safe in AUDINEXA cloud, accessible from any
  device.
- Only locally-printed reports / paper forms are at risk.

## 5. Testing
- **Restore test** — semi-annually, the DPO requests a test-restore from
  AUDINEXA and verifies the previous month's data is intact.
- **Table-top exercise** — annually, simulate an AUDINEXA outage during peak
  hours and confirm the team can fall back to paper without losing care
  continuity.

## 6. Roles
- **Business Continuity Owner** — {{owner_name}}.
- **DPO** — {{dpo_name}} (executes drills, maintains evidence).
- **AUDINEXA Liaison** — DPO ({{dpo_email}}).
- **Branch Operations Lead** — designated at each branch.

## 7. Communication During Disruption
- Internal: WhatsApp group of clinic staff + DPO.
- External: appointment reminders use the SMS channel only when the AUDINEXA
  in-app push is unavailable.

## 8. Review
This Plan is reviewed annually or after each real or simulated incident.

---

*Generated from AUDINEXA's ISO 27001 / DPDP Policy Pack for {{clinic_name}}.*
