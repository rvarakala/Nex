# AUDINEXA — Beta Tester Onboarding Guide

*The 5-minute quickstart for your clinic.*

**Welcome!** You've been invited to the AUDINEXA private beta. This guide walks you through your first hour on the platform.

---

## 1. Log In

- **URL**: https://www.audinexa.com/login
- **Email**: *(provided in your invite email)*
- **Temporary Password**: *(provided in your invite email — please change it after first login)*

After login, you land on your **Clinic Owner Dashboard**. Your clinic workspace and primary branch are already set up — no configuration needed to start.

---

## 2. Your First 5 Actions (≈ 10 minutes)

### ① Register a patient
`Patients → + Add Patient`
Enter name, phone, age, gender → save. An MRD number is auto-generated (e.g. `BET01-2026-000001`).

### ② Book an appointment
`Appointments → + New Appointment`
Pick the patient, select type (Diagnostic / Fitting / Counselling), assign the audiologist, save. A queue token is generated automatically.

### ③ Run an audiometry test
`Diagnostics → Audiometry` → select patient → plot thresholds on the audiogram → save.
Generate PDF report → downloadable/shareable via secure link.

### ④ Create a hearing aid quotation
`Hearing Aid → Sales → + Quotation` → select patient → pick model + price → save → convert to Sales Order once approved → auto-generates GST invoice.

### ⑤ Open a Service & Repair ticket
`Service & Repair → + New Ticket` → pick patient → describe issue → track across 13 states (Received → Diagnosed → Quoted → Approved → Repaired → ... → Delivered).

---

## 3. Modules You Have Access To (STANDARD Trial)

| Module | What it does |
|---|---|
| **Patients** | MRD, demographics, medical history, documents |
| **Appointments** | Calendar + token queue + reminders |
| **Diagnostics** | PTA, Tympanometry, OAE, ABR, Speech Audiometry |
| **Hearing Aid Sales** | Quotations → Sales Orders → Delivery → Invoices |
| **Service & Repair** | 13-state repair pipeline with turnaround SLA |
| **Trade-Ins** | Accept old aids, value them, apply credit |
| **AMC (Annual Maintenance)** | Plans, activations, expiry alerts |
| **Patient Portal** | Patients can view their own history |
| **Referral Partners** | ENT doctors send referrals, earn commissions |
| **Analytics** | Revenue, conversion, device mix, diagnosis trends |

---

## 4. Default User Roles

Already seeded for your clinic:
- **Clinic Owner** (you) — full access

To add staff, go to `Settings → Users → + Invite User`. Available roles:
- `front_desk` — reception, appointments, patient intake
- `audiologist` — diagnostics, reports, fittings
- `accounts` — invoices, payments, GST
- `inventory_manager` — stock, purchase orders, GRN
- `technician` — service & repair operations

---

## 5. Known Limitations During Beta

- **Payments**: Subscription billing is currently **manual** (your Founder contact will invoice you directly)
- **Email/SMS**: Automated patient reminders via email/WhatsApp are coming soon — for now, use the "Copy WhatsApp link" button to send manually
- **File uploads**: Stable, but we recommend keeping a local backup for the first 2 weeks

---

## 6. How to Report Bugs / Request Features

- **In-app**: Click the `? Help` icon → *Report Issue*
- **Email**: beta@audinexa.com
- **WhatsApp group**: You'll be added to the "AUDINEXA Beta Testers" group after onboarding

Please include:
1. What you were trying to do
2. What you expected
3. What actually happened
4. A screenshot (if visual)

---

## 7. Keyboard Shortcuts (Power Users)

- `Ctrl/Cmd + K` → Global search (patients, invoices, orders)
- `G` then `P` → Go to Patients
- `G` then `A` → Go to Appointments
- `G` then `D` → Go to Diagnostics
- `N` → New item (context-aware)

---

## 8. Security & Privacy

- All data is **tenant-isolated** — your clinic's data is only visible to your users
- **HTTPS** end-to-end
- **Bcrypt** password hashing
- Daily DB backups
- 2FA can be enabled for any user (`Profile → Security → Enable 2FA`)

---

## 9. What We Need From You

Over the next **30 days**, please:
1. Use AUDINEXA for **≥ 5 real patients** (not test data)
2. Fill in the **weekly 3-question feedback form** (link in your invite email)
3. Join the **30-min bi-weekly video call** (calendar invite will follow)

In return, you get:
- **Lifetime 50% discount** on whichever tier you choose after beta
- **Founder's credit** on our website and launch announcement
- **Direct feature-request line** to the product team

---

## 10. Contact

| Reason | Contact |
|---|---|
| Technical issue | beta@audinexa.com |
| Onboarding help | onboard@audinexa.com |
| Anything urgent | *(founder's mobile — provided in invite)* |

---

**Thank you for helping us build the best audiology clinic software in India. 🎧**

— Team AUDINEXA
