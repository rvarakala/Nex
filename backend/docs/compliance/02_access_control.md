# Access Control Policy

**Document ID:** ACP-02  
**Aligned to:** ISO/IEC 27001:2022 — Annex A.5.15-A.5.18, A.8.2, A.8.3 (Access control)  
**Version:** 1.0 · **Effective:** {{effective_date}}  
**Owner:** {{clinic_name}} — {{dpo_name}} ({{dpo_email}})  
**Approved by:** {{owner_name}}

---

## 1. Purpose
Define how user identities, authorisations, and privileged access to AUDINEXA
and clinic systems are granted, reviewed, and revoked at **{{clinic_name}}**.

## 2. Scope
All AUDINEXA tenant users (`clinic_id={{clinic_id}}`), Clinic-managed
workstations, network equipment, and the physical premises across
**{{branch_count}}** branch(es).

## 3. Policy

### 3.1 Identity management
- Each individual receives a **unique** user account. Generic / shared
  accounts (e.g. `frontdesk@`) are prohibited.
- The Clinic Owner ({{owner_name}}) is responsible for approving the creation
  of new accounts via AUDINEXA's "Add User" flow.
- Account creation is logged in AUDINEXA's audit trail.

### 3.2 Role-based access (RBAC)
| Role | Patients | Diagnostics | Billing | Accounts/Revenue | HA Inventory | Admin |
|---|---|---|---|---|---|---|
| clinic_owner   | full | full | full | full | full | full |
| super_admin    | full | full | full | full | full | partial |
| clinical_staff | read+write own | full own | none | none | read | none |
| front_desk     | demo only | none | full | read | read | none |
| accounts       | demo only | none | read | full | read | none |

### 3.3 Least privilege
- New users are provisioned with the **lowest** role appropriate to their
  duties. Privilege escalation requires written approval from {{owner_name}}.
- No standing administrative access — admin roles are used only for the
  duration of the administrative task.

### 3.4 Joiners-Movers-Leavers
- **Joiners**: account created on first day of employment; access reviewed
  within 7 days by line manager.
- **Movers**: when a staff member changes role, prior privileges are revoked
  before new privileges are added (no privilege accretion).
- **Leavers**: account is **disabled within 24 hours** of last working day.
  After 30 days, the account is permanently deleted (audit log retained).

### 3.5 Periodic access review
{{dpo_name}} runs a quarterly review of all active AUDINEXA users:
- Confirms each user is still employed.
- Confirms each user's role is still appropriate.
- Documents the review in the Clinic's compliance binder.

### 3.6 Authentication
See **ISP-01 §3.3** for password requirements and MFA.

### 3.7 Physical access
- Workstations in clinical areas are positioned so screens are not visible to
  patients in waiting areas.
- The server room / network closet is locked with an audited key list.

### 3.8 Privileged access
- Administrative actions (tenant config, billing exports, audit-log access,
  bulk delete) are **logged** in AUDINEXA's `activity_logs` collection.
- {{dpo_name}} reviews the audit log monthly and signs off in writing.

## 4. Enforcement
Violations are reported to {{owner_name}}. Repeated or wilful violations may
result in disciplinary action including loss of access, suspension, or
termination.

## 5. Review
This Policy is reviewed annually or upon a structural change at the Clinic
(merger, new branch, change in software).

---

*Generated from AUDINEXA's ISO 27001 / DPDP Policy Pack for {{clinic_name}}.*
