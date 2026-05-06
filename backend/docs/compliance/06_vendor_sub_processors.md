# Vendor / Sub-processor Register

**Document ID:** VSR-06  
**Aligned to:** ISO/IEC 27001:2022 — A.5.19-A.5.22 · DPDP Act §8(2)  
**Version:** 1.0 · **Effective:** {{effective_date}}  
**Owner:** {{clinic_name}} — {{dpo_name}} ({{dpo_email}})  
**Approved by:** {{owner_name}}

---

## 1. Purpose
Maintain a register of every third party that processes Clinic data, with
their compliance posture, contractual safeguards, and access scope — so the
Clinic can demonstrate controlled data sharing and meet DPDP §8(2)
obligations on Data Fiduciaries.

## 2. Vendor Register

| Vendor | Service provided | Data processed | Region | Sub-processor of | Contract / DPA | Last review |
|---|---|---|---|---|---|---|
| **AUDINEXA** (Emergent Labs) | SaaS clinic management — Patients, Diagnostics, Billing, HA Commerce, Analytics | All clinic operational + clinical PD | India (Mumbai region — `MONGO_URL`) | Clinic | DPA signed at onboarding; SOC 2 / ISO 27001 in progress | {{effective_date}} |
| **Razorpay** (when enabled) | Online payment collection (UPI / cards / netbanking) | Patient name, mobile, email, payment amount, payment method | India | Clinic | Razorpay PCI-DSS L1 certified; merchant agreement | {{effective_date}} |
| **Twilio** (when SMS enabled) | SMS delivery for OTPs & appointment reminders | Patient mobile, message text | US (with India transit) | Clinic | Twilio MSA + Twilio HIPAA / SOC 2 | {{effective_date}} |
| **ZeptoMail** (Zoho Corporation) | Transactional email delivery | Patient email, message text, attached PDFs (where applicable) | India | Clinic | Zoho ISO 27001 / SOC 2 certified | {{effective_date}} |
| **MSG91** (when WhatsApp enabled) | WhatsApp Business API delivery | Patient mobile, message text | India | Clinic | MSG91 DLT-compliant; ISO 27001 in progress | {{effective_date}} |
| **MongoDB Atlas** (sub-processor of AUDINEXA) | Managed MongoDB cluster | All clinic operational + clinical PD (encrypted at rest) | India | AUDINEXA | MongoDB SOC 2 Type II, ISO 27001, HIPAA-ready | {{effective_date}} |

## 3. Onboarding a New Vendor
Before a new vendor receives Clinic data, {{dpo_name}} confirms:
1. **Necessity** — the data shared is the minimum needed.
2. **Contract** — a DPA (Data Processing Agreement) is in place.
3. **Compliance posture** — ISO 27001 / SOC 2 / HIPAA certifications, or
   equivalent independent audit, are reviewed.
4. **Sub-processor list** — the vendor's sub-processors are known.
5. **Breach notification** — vendor commits to ≤ 24 h breach notification.
6. **Data residency** — preference for India-resident processing.
7. **Termination** — exit / data-return clause is documented.

## 4. Annual Vendor Review
Every March, {{dpo_name}}:
- Re-confirms each vendor's certifications are current.
- Reviews any sub-processor changes notified in the past 12 months.
- Reviews any incident reports from the vendor in the past 12 months.
- Updates the table above with `Last review` = today.

## 5. Decommissioning
When a vendor is no longer used:
- All clinic data is deleted from the vendor's systems (request in writing).
- Vendor confirms deletion within 60 days.
- The Clinic removes the vendor from the active register but retains the
  audit trail.

## 6. Patient Notice
The current Vendor Register is a **public document** at
{{public_legal_url}}/vendors. Patients may inspect it on request.

---

*Generated from AUDINEXA's ISO 27001 / DPDP Policy Pack for {{clinic_name}}.*
