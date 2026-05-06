# Data Protection & Privacy Policy

**Document ID:** DPP-03  
**Aligned to:** Digital Personal Data Protection Act, 2023 (India) ·
ISO/IEC 27701:2019 (Privacy Information Management)  
**Version:** 1.0 · **Effective:** {{effective_date}}  
**Owner:** {{clinic_name}} — {{dpo_name}} ({{dpo_email}})  
**Approved by:** {{owner_name}}

---

## 1. Purpose
This Policy describes how **{{clinic_name}}** ("the Clinic") collects, uses,
discloses, retains, and protects personal data ("PD") of patients, employees,
and other individuals it interacts with — in compliance with the Digital
Personal Data Protection Act, 2023 ("DPDP Act") and applicable Indian
healthcare regulations.

## 2. Definitions
- **Personal Data (PD)** — any data about an identifiable individual.
- **Data Principal** — the individual to whom PD relates (e.g. a patient).
- **Data Fiduciary** — the entity that determines the purpose and means of
  processing PD. {{clinic_name}} is the Data Fiduciary.
- **Data Processor** — an entity that processes PD on behalf of the Data
  Fiduciary. AUDINEXA is the Clinic's primary Data Processor.

## 3. Lawful Basis for Processing
{{clinic_name}} processes patient PD on the following bases under DPDP §6 / §7:
- **Consent** for marketing communications, WhatsApp follow-ups, surveys.
- **Specified legitimate use** (DPDP §7(d) — "for taking specified action in
  the public interest" and §7(c) — for performance of any function under any
  law) for clinical care delivery, billing, statutory record-keeping.

## 4. Data Principal Rights (DPDP Chapter III)
Patients have the right to:
1. **Access** their PD held by the Clinic.
2. **Correct** inaccurate or incomplete PD.
3. **Erase** their PD where retention is no longer necessary (subject to
   medical record retention obligations — see §6).
4. **Grievance redressal** — file a complaint with the Clinic's DPO and, if
   unresolved within 30 days, escalate to the Data Protection Board of India.
5. **Nominate** another individual to exercise rights in case of death or
   incapacity.

To exercise any of these rights, contact: **{{dpo_email}}** /
**{{clinic_phone}}**.

## 5. Categories of Data Collected
- **Identity** — name, age, gender, mobile, email, address, photo (optional).
- **Government IDs** — Aadhaar last-4, PAN (when required for GST invoices).
- **Clinical** — chief complaint, audiograms, prescriptions, fitting reports,
  service tickets, hearing-aid serial numbers.
- **Financial** — invoice details, payment method, payment reference.
- **Operational** — appointment history, communication preferences, consent
  records.

## 6. Retention
- **Active patient records** — retained for the duration of the patient's
  relationship with the Clinic plus **8 years** after the last visit
  (Indian Medical Council guidance).
- **Audit logs** — retained for **3 years** in AUDINEXA.
- **Billing & GST records** — retained for **8 years** (GST Act §36).
- **Audiogram report PDFs** — auto-purged from blob storage after
  **30 days** (PDF_RETENTION_DAYS) but **regenerated on demand** from source
  data — clinical content is never lost. (See AUDINEXA Hybrid PDF Storage.)
- **Marketing-only consent records** — retained until consent is withdrawn
  plus 1 year.

## 7. Disclosure
PD is disclosed only:
- To AUDINEXA (Data Processor) under a Data Processing Agreement.
- To Government authorities when legally required.
- To referring doctors / vendors with the patient's consent (e.g. a follow-up
  letter to an ENT).
- To insurance companies / third-party payers for claim processing.

PD is **never sold**.

## 8. Data Localisation
All PD is stored on servers within India. Cross-border transfer is permitted
only under DPDP §16 to "trusted countries" notified by the Central Government.
{{clinic_name}} does **not** transfer PD outside India.

## 9. Children's Data
Where the patient is a child (under 18), PD is processed only with the
verified consent of the parent or lawful guardian. Behavioural tracking,
targeted advertising, and marketing to children are prohibited.

## 10. Breach Notification
See **IRP-04 — Incident Response & Breach Notification Policy**.

## 11. Roles
- **Data Fiduciary** — {{clinic_name}}.
- **Clinic Owner** — {{owner_name}} (accountable).
- **DPO** — {{dpo_name}} ({{dpo_email}}, {{clinic_phone}}).
- **Data Processor** — AUDINEXA (operated by Emergent Labs).

## 12. Review
This Policy is reviewed annually or upon material regulatory change.

---

*Generated from AUDINEXA's ISO 27001 / DPDP Policy Pack for {{clinic_name}}.*
