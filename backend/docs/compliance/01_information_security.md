# Information Security Policy

**Document ID:** ISP-01  
**Aligned to:** ISO/IEC 27001:2022 — Annex A.5 (Organizational controls)  
**Version:** 1.0 · **Effective:** {{effective_date}}  
**Owner:** {{clinic_name}} — {{dpo_name}} ({{dpo_email}})  
**Approved by:** {{owner_name}} (Clinic Owner / Information Security Manager)

---

## 1. Purpose
This Information Security Policy ("Policy") establishes the framework by which
**{{clinic_name}}** ("the Clinic") protects the confidentiality, integrity,
and availability of patient health information, billing data, and operational
records processed in the AUDINEXA Software-as-a-Service platform.

The Clinic recognises that its patients entrust it with personal and clinical
data of a sensitive nature, and that responsible stewardship of that data is a
foundational requirement of medical practice in India under the Digital
Personal Data Protection Act, 2023 (DPDP), the Clinical Establishments
(Registration & Regulation) Act, 2010, and the Information Technology
(Reasonable Security Practices and Procedures) Rules, 2011.

## 2. Scope
This Policy applies to:
- All employees, contractors, locums, and trainees of the Clinic with access
  to AUDINEXA;
- All branches operating under {{clinic_name}} (currently: **{{branch_count}}**);
- All patient and operational data stored in the AUDINEXA tenant
  `{{clinic_id}}`;
- All endpoints used to access AUDINEXA, including clinic-issued workstations
  and bring-your-own mobile devices.

## 3. Policy Statements

### 3.1 Information classification
Data is classified as one of:
- **Restricted** — patient health records, audiograms, prescriptions, billing
  with PII (Aadhaar, PAN, mobile, email, address);
- **Internal** — staff records, vendor contracts, internal pricing;
- **Public** — clinic name, public-facing services, marketing collateral.

Restricted data shall be stored only in AUDINEXA or in the Clinic's
fire-resistant physical archive. It shall not be copied to consumer cloud
storage (Google Drive personal, Dropbox, WhatsApp), pen drives, or personal
email.

### 3.2 Access control
Access to AUDINEXA is granted on a **need-to-know, role-based** basis:
- `clinic_owner` — full access to the tenant.
- `super_admin` — administrative access excluding deletion of audit logs.
- `clinical_staff` — access to patient records assigned to the staff member.
- `front_desk` — access to scheduling, billing, and patient demographics
  only.
- `accounts` — access to revenue, invoices, payments. No clinical write.

User accounts are de-provisioned within **24 hours** of an employee's last
working day. Quarterly access reviews are conducted by {{dpo_name}}.

### 3.3 Authentication & passwords
Minimum requirements:
- 12 character passwords with mixed case + digit + special character.
- 90-day rotation for `clinic_owner` / `super_admin`.
- No shared passwords; no sticky-notes; password manager mandatory.
- Multi-factor authentication enabled for all admin roles.

### 3.4 Encryption
- AUDINEXA enforces HTTPS (TLS 1.2+) for all data in transit. The Clinic
  shall not access AUDINEXA over plain HTTP or unsecured public Wi-Fi.
- AUDINEXA encrypts the production MongoDB cluster at rest (AES-256). The
  Clinic does not need to manage these keys.

### 3.5 Endpoint security
Every device used to access AUDINEXA shall:
- Auto-lock after 5 minutes of inactivity;
- Run a current antivirus / endpoint-protection product;
- Apply OS security patches within 30 days of release;
- Have full-disk encryption enabled (BitLocker / FileVault / LUKS).

### 3.6 Backups & business continuity
Refer to **BCP-07 — Business Continuity & Backup Policy**.

### 3.7 Incident response
Refer to **IRP-04 — Incident Response & Breach Notification Policy**.
All suspected security incidents must be reported to {{dpo_email}}
within **2 hours** of discovery.

### 3.8 Vendor management
Third-party services that process Clinic data (AUDINEXA, payment gateway,
SMS / email gateways) are tracked in the **Vendor / Sub-processor Register**
(VSR-06). Each vendor's compliance posture is reviewed annually.

## 4. Roles & Responsibilities
- **Clinic Owner ({{owner_name}})** — accountable for the overall security
  posture, signs off on this Policy annually.
- **Data Protection Officer ({{dpo_name}})** — operates the Policy day to
  day, runs access reviews, owns incident response.
- **All staff** — comply with this Policy, complete annual security refresher
  training, report suspected incidents.

## 5. Compliance & Review
This Policy is reviewed at least **annually** or when material changes occur
in the Clinic's operations, the regulatory environment, or AUDINEXA itself.
Non-compliance may result in disciplinary action up to and including
termination of employment or contract.

## 6. References
- ISO/IEC 27001:2022, Annex A.5 (Organizational controls)
- Digital Personal Data Protection Act, 2023 (India)
- IT (Reasonable Security Practices and Procedures and Sensitive Personal
  Data or Information) Rules, 2011 (India)

---

*Document automatically generated for {{clinic_name}} from AUDINEXA's
ISO 27001 / DPDP Policy Pack. Review and customise before formal adoption.*
