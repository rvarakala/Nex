# Incident Response & Breach Notification Policy

**Document ID:** IRP-04  
**Aligned to:** ISO/IEC 27001:2022 — A.5.24-A.5.27 · DPDP Act §8(6)  
**Version:** 1.0 · **Effective:** {{effective_date}}  
**Owner:** {{clinic_name}} — {{dpo_name}} ({{dpo_email}})  
**Approved by:** {{owner_name}}

---

## 1. Purpose
Define the procedure {{clinic_name}} follows when a security incident,
suspected unauthorised access, or personal data breach is detected — to
contain damage, recover quickly, fulfil regulatory notification obligations,
and learn from the event.

## 2. Severity Classification
- **Critical (P0)** — confirmed breach of patient PD, system-wide outage, or
  ransomware. Notify {{owner_name}} immediately + DPO + AUDINEXA support.
- **Major (P1)** — single-patient PD exposure, prolonged AUDINEXA degradation,
  malware on a clinical workstation. Notify within 4 hours.
- **Minor (P2)** — phishing email opened (no credentials submitted), brief
  service blip, unauthorised but unsuccessful login attempts.

## 3. Response Workflow

### Step 1 — Detect
Anyone at the Clinic who suspects an incident must call/SMS the DPO at
{{dpo_email}} / {{clinic_phone}} immediately and **stop using** the affected
device/account.

### Step 2 — Triage (within 1 hour)
DPO ({{dpo_name}}) assigns a severity and creates a written log entry
including:
- Time of detection;
- Affected systems / devices / records;
- Identified threat actor or accidental cause.

### Step 3 — Contain
- Disable compromised AUDINEXA accounts via Settings → Users.
- Isolate compromised endpoints from the network.
- Rotate API keys / passwords.
- Open a P0 / P1 incident in AUDINEXA's `/admin/system` panel for the
  audit trail.

### Step 4 — Eradicate
- Run a full antivirus scan; reimage if needed.
- Identify the root cause (phishing, weak password, unpatched software,
  insider misuse).

### Step 5 — Recover
- Restore data from the last known-good backup (RPO ≤ 24 h, RTO ≤ 8 h —
  see BCP-07).
- Re-enable affected accounts after reset + MFA enrolment.

### Step 6 — Notify
- **Data Protection Board of India** — within **72 hours** of confirmed PD
  breach, per DPDP §8(6).
- **Affected Data Principals** — promptly, with the nature of the breach,
  consequences, and steps taken.
- **AUDINEXA** — for any incident involving the AUDINEXA platform.
- **CERT-In** — within 6 hours, per CERT-In Direction 20(3)/2022/CERT-In.

### Step 7 — Lessons learned
Within 14 days, DPO publishes a post-incident review with:
- Timeline;
- Root cause;
- What worked / what didn't;
- Corrective actions (with owners and dates).

## 4. Breach Notification Template (to Data Principal)
> Dear {Patient Name},
>
> On {date}, we detected an incident affecting some of the personal
> information you provided to {{clinic_name}}. The information that may have
> been involved includes: {fields}. We are investigating the cause, have
> taken the following steps to contain it: {actions}, and have notified the
> Data Protection Board of India.
>
> What you can do: {recommended actions, e.g. monitor SMS for suspicious
> calls; do not share OTPs}.
>
> If you have questions, please contact {{dpo_name}} at {{dpo_email}} or
> {{clinic_phone}}.
>
> We apologise for the concern this may cause and appreciate your patience.
>
> {{owner_name}}, Clinic Owner

## 5. Roles
- **Incident Commander** — DPO ({{dpo_name}}).
- **Clinic Owner** — {{owner_name}} (accountable; signs off on
  notifications).
- **AUDINEXA Liaison** — DPO ({{dpo_email}}).
- **Communications Lead** — Front-Desk Manager.

## 6. Drills
The Clinic shall conduct an incident-response **table-top drill annually**.
DPO records attendance and findings.

## 7. References
- DPDP Act 2023, §8(6) (breach notification)
- CERT-In Direction No. 20(3)/2022/CERT-In, 28 April 2022
- ISO/IEC 27035:2023 (Information security incident management)

---

*Generated from AUDINEXA's ISO 27001 / DPDP Policy Pack for {{clinic_name}}.*
