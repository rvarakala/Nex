# Data Retention & Deletion Policy

**Document ID:** DRP-05  
**Aligned to:** ISO/IEC 27001:2022 — A.8.10 · DPDP Act §8(7)-(8)  
**Version:** 1.0 · **Effective:** {{effective_date}}  
**Owner:** {{clinic_name}} — {{dpo_name}} ({{dpo_email}})  
**Approved by:** {{owner_name}}

---

## 1. Purpose
Specify how long different types of data created at **{{clinic_name}}** are
retained, when they are deleted, and how deletion is verified — striking a
balance between regulatory record-keeping requirements, clinical safety, and
the data-minimisation principle of the DPDP Act.

## 2. Retention Schedule

| Data type | Retention | Justification | Auto-purge? |
|---|---|---|---|
| Active patient demographics + clinical record | Last visit + 8 years | MCI / clinical-establishment guidance | Manual |
| Audiograms (raw test sessions) | Same as above | Diagnostic continuity | Manual |
| Audiogram-report PDFs (rendered blobs) | **30 days** | On-demand regenerable from session data | **Yes** — daily 03:15 IST sweep |
| Invoices + Payments | 8 years | GST Act §36 | Manual |
| Appointments | Last visit + 8 years | Linked to the medical record | Manual |
| Audit logs (`activity_logs`, `platform_audit`) | 3 years | Operational forensics | Manual |
| Marketing consent records | Until consent withdrawn + 1 year | DPDP §6(3) accountability | Manual |
| Failed login / brute-force logs | 1 year | Incident-response forensics | Manual |
| Backup snapshots | 30 days rolling | RPO compliance | **Yes** — by AUDINEXA infra |
| Outbox / queued offline writes | 30 days after delivery | Operational hygiene | **Yes** — by AUDINEXA infra |

## 3. Patient Right to Erasure
Per DPDP §12(c), a patient may request erasure of their PD. {{clinic_name}}
will:
1. Verify the patient's identity.
2. Determine if any retention obligation overrides the request (e.g. ongoing
   GST audit period, statutory medical record window).
3. Where the override applies, retain only the minimum required data and
   redact the rest.
4. Where no override applies, erase the data in AUDINEXA within 30 days
   and confirm in writing to the patient.

Erasure is performed via Settings → Users / Settings → Patients in AUDINEXA.
The audit log retains a hash of the deleted record so erasure is verifiable.

## 4. Deletion Methodology
- **Soft delete** is used for accidental-recovery resilience for the first
  30 days (`status: deleted`, hidden from all UIs).
- **Hard delete** is performed on day 31 — record removed from primary
  collection. Backups continue to age out per the 30-day rolling window.

## 5. End-of-Contract
On termination of the AUDINEXA subscription, {{clinic_name}} may request:
- A complete machine-readable export (CSV / JSON) of its data within 30 days
  of termination.
- Deletion of all data from AUDINEXA's primary store within 60 days.
- Deletion from backups within 90 days.

## 6. Verification
Annual review by {{dpo_name}}:
- Sample 20 records older than the retention window — confirm purged.
- Reconcile audit-log hashes with deleted-record list.
- Document findings in the compliance binder.

## 7. References
- DPDP Act 2023, §8(7)-(8) (retention)
- GST Act, §36 (record retention)
- ISO/IEC 27001:2022, A.8.10 (Information deletion)

---

*Generated from AUDINEXA's ISO 27001 / DPDP Policy Pack for {{clinic_name}}.*
