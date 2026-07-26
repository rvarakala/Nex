/**
 * AUDINEXA Demo — Story data.
 *
 * Case-driven storyboard: real patient walks in → workflow unfolds →
 * features light up as they help the audiologist solve the case.
 * Each scene has:
 *   - `time`   — a scene clock stamp ("10:15 AM")
 *   - `actor`  — WHO is at the screen (Front Desk / Audiologist / System)
 *   - `title`  — the moment ("Rohan registers")
 *   - `narrative` — 1-2 sentences of storytelling
 *   - `callout`  — the SOFTWARE feature that lights up
 *   - `outcome`  — optional business/clinical outcome ribbon
 *   - `screenshot`, `url`
 */

const scene = (time, actor, title, narrative, callout, outcome, screenshot, url) => ({
  time, actor, title, narrative, callout, outcome, screenshot: `/demo/stories/${screenshot}`, url,
});

export const STORIES = [
  // ══════════════════════════════════════════════════════════════════
  // STORY 1 — DIAGNOSTIC-ONLY: MILD CONDUCTIVE HL
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'story-1',
    slug: 's1-conductive',
    title: 'Rohan Menon · 42M · The Diagnostic-Only Journey',
    lede: 'Referred by Dr. Anand Kumar (ENT) for PTA + Impedance. Diagnosis surfaces as Mild Conductive Hearing Loss — patient goes back to Dr. AK for medical management. No hearing-aid sale.',
    accent: '#D95D39',
    diagnosis: 'Bilateral Mild Conductive HL · AB Gap ~25 dB · Type As tympano',
    outcome: 'Diagnostic invoice ₹1,500 · Dr. AK earns ₹500 referral cut · Report handed over + WhatsApp\'d',
    scenes: [
      scene('10:15 AM', 'Front Desk', 'Rohan walks in with a referral note',
        'Meera at the front-desk pulls up Registration, types "Rohan Menon", selects Dr. Anand Kumar from the Referring Doctor picker, and hits Save.',
        'Every new patient captures the referring doctor at registration — no scribbled paper notes.',
        'MRD TSC-2026-STORY01 assigned automatically',
        's1-01-patient-list.png', '/patients'),
      scene('10:15 AM', 'System', 'Auto WhatsApp thank-you fires to Dr. AK',
        'The moment "Save" is hit, AUDINEXA fires a thank-you WhatsApp to Dr. Kumar\'s registered mobile: "Namaste Dr. Anand, thank you for referring Rohan Menon to The Sound Clinic. We\'ll keep you posted on the outcome."',
        'Referral opt-in per doctor. Once configured, every referral gets acknowledged inside 5 seconds — without you remembering.',
        'Sent to +91 98450 00123 at 10:15:04 AM · Logged in referral_notifications',
        's1-02-search-rohan.png', '/patients'),
      scene('10:16 AM', 'Front Desk', 'Patient profile confirmed',
        'Meera opens Rohan\'s new profile and sees the DPDPA WhatsApp opt-in, MRD, and referring doctor stamped in one glance.',
        'A single patient card with every referring-doctor, WhatsApp-consent, and MRD detail — searchable in 200 ms.',
        null,
        's1-03-rohan-profile.png', '/patients/PT-STORY-01'),
      scene('10:18 AM', 'Front Desk', 'Appointment booked for PTA + Impedance',
        'Meera drags Rohan\'s appointment onto the calendar at 11:00 AM with test type "PTA + Impedance". Dr. Aditi\'s slot auto-loads.',
        'Test-type-aware scheduling. The audiologist sees exactly which protocol is coming next — no phone-tag with reception.',
        'Slot locked · Aditi Krishnan · 45 min',
        's1-04-appointments.png', '/appointments'),
      scene('11:00 AM', 'Audiologist', 'Rohan on the kanban board',
        'Dr. Aditi\'s morning kanban surfaces Rohan in "Ready to test". She clicks in and the diagnostic workspace opens.',
        'Kanban-first workflow. Nothing forgotten. Aditi never asks "which patient is next?" again.',
        null,
        's1-05-test-kanban.png', '/test'),
      scene('11:30 AM', 'Audiologist', 'PTA + Tympano entered → diagnosis surfaces',
        'AC / BC thresholds entered. Tympanogram = Type As bilaterally. AUDINEXA computes the AB gap and flags "Conductive component" automatically. Aditi signs the report.',
        'Digital audiogram with automatic masking rules + AB-gap flagging. Tamper-proof. JSON-snapshot versioned for every visit.',
        'Diagnosis: Bilateral Mild Conductive HL · AB Gap ~25 dB',
        's1-06-reports-list.png', '/reports'),
      scene('11:38 AM', 'System', 'Diagnostic outcome pinged back to Dr. AK',
        'Report signed → a second WhatsApp fires to Dr. Kumar: "Diagnostic report ready. Mild Conductive HL — recommending ENT follow-up." The Referral Corner logs Dr. AK\'s ₹500 commission for the month.',
        'Automated ENT loop-back + per-doctor payout ledger. Referring doctors feel valued without you tracking a spreadsheet.',
        'Dr. AK · Jul payout accrued: ₹500',
        's1-07-referral-corner.png', '/referrals'),
      scene('11:40 AM', 'Front Desk', 'Invoice raised & delivered',
        'GST invoice ₹1,500 (PTA ₹750 + Tympano ₹750) issued instantly. Rohan taps UPI → paid. Printed hand-copy + WhatsApp PDF land at the same time.',
        'GST-ready invoicing · UPI + Card + Cash · WhatsApp delivery of the full signed report PDF.',
        '₹1,500 collected · Report attached to profile forever',
        's1-08-invoice-list.png', '/billing'),
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // STORY 2 — DIAGNOSTIC → HA SALE (with 4 branches)
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'story-2',
    slug: 's2-snhl',
    title: 'Priya Nair · 34F · The Full Diagnostic → HA Journey',
    lede: 'Referred by Dr. Anand Kumar (ENT). Diagnosis: Bilateral Moderate Sloping SNHL. Recommendation: bilateral hearing-aid trial. Then the story branches into 4 real-world sub-cases (2.a / 2.b / 2.c / 2.c.1) — each a different clinical reality.',
    accent: '#7C3AED',
    diagnosis: 'Bilateral Moderate Sloping SNHL · avg PTA R 49 / L 46 dB · WRS 78% / 82%',
    outcome: 'Diagnostic done → then splits into 4 branches, each a real audiology-clinic scenario',
    scenes: [
      scene('10:30 AM', 'Front Desk', 'Priya walks in with the same referral note',
        'Same flow as Rohan — Meera adds Priya, selects Dr. Anand Kumar, saves. Auto-WhatsApp thank-you fires.',
        'Same clean registration + auto thank-you. Consistency across every walk-in.',
        'MRD TSC-2026-STORY02 · WhatsApp to Dr. AK at 10:30 AM',
        's2-01-priya-profile.png', '/patients/PT-STORY-02'),
      scene('11:00 AM', 'Audiologist', 'Priya on the kanban',
        'Dr. Vikram picks up Priya\'s session. Chief complaint on-screen: "Everyone sounds like they\'re mumbling — worse in noise."',
        'Chief complaint travels with the patient card — the audiologist starts with context, not a blank slate.',
        null,
        's2-02-test-kanban.png', '/test'),
      scene('11:45 AM', 'Audiologist', 'PTA + Speech complete — SNHL confirmed',
        'AC = BC (no AB gap). 4-freq averages: R 49 / L 46 dB. WRS 78% / 82%. Diagnosis: Bilateral Moderate Sloping SNHL. Recommendation: bilateral HA trial. Report signed.',
        'Automatic classification — sloping SNHL flagged, WRS integrated with PTA in one signed report.',
        'HA candidacy confirmed → next stop: fitting room',
        's2-03-reports.png', '/reports'),
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // STORY 2.a — In-clinic HA trial (Sneha Bhat, 55F)
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'story-2a',
    slug: 's2a-in-clinic-trial',
    title: 'Branch 2.a · Sneha Bhat · In-clinic HA Trial',
    lede: 'Sneha (55F, similar SNHL profile) chooses to trial hearing aids the same day in the clinic. Aided by demo inventory.',
    accent: '#0EA5A4',
    diagnosis: 'Bilateral Moderate SNHL (pre-existing) · HA candidate',
    outcome: 'Positive feedback → Quote ₹1,71,100 issued · marked as Potential HA Lead for 3-day follow-up',
    scenes: [
      scene('12:00 PM', 'Audiologist', 'Sneha wants to try aids in-clinic',
        'Sneha didn\'t want to wait — Dr. Aditi opens the Trial workflow, picks Signia Pure C&G 7AX from Demo Stock, and programs to Sneha\'s loss curve.',
        'Demo-stock pool separates trial inventory from saleable serial ledger. No double-booking risk.',
        null,
        's2a-01-sneha-profile.png', '/patients/PT-STORY-02A'),
      scene('12:30 PM', 'Audiologist', 'Feedback captured · quote sent',
        'Aided SRT drops from 45 → 30 dB. Sneha is delighted. Aditi issues a ₹1,71,100 quote from the HA Sales pipeline; the system marks it as "Potential HA Lead" with a 3-day follow-up reminder.',
        'One-click quote generation · pipeline lead flagging · automatic follow-up cron so warm leads don\'t go cold.',
        'Quote QT-STORY-02A · Lead flag ON · Follow-up in 3 days',
        's2a-02-ha-pipeline.png', '/ha'),
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // STORY 2.b — Home trial (Karthik Iyer, 62M)
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'story-2b',
    slug: 's2b-home-trial',
    title: 'Branch 2.b · Karthik Iyer · 7-day Home Trial with Caution Deposit',
    lede: 'Karthik (62M, post-retirement HL) wants to trial the aids in his living room — where he actually watches TV. He gets a week, we get a caution deposit and a track.',
    accent: '#2563EB',
    diagnosis: 'Bilateral Moderate SNHL · post-retirement · wants at-home trial',
    outcome: 'Home trial live · ₹15,000 caution deposit collected · scheduled return 7 days · WhatsApp check-ins on days 2/4/6',
    scenes: [
      scene('3:00 PM', 'Audiologist', 'Karthik requests a home trial',
        'Aditi opens the Trial workflow, switches kind to "Home", enters caution deposit ₹15,000 (Card), sets return date +7 days.',
        'Home-trial workflow with mandatory caution deposit, return-date SLA, and automated WhatsApp check-ins on days 2/4/6.',
        'Trial TR-STORY-02B live · Karthik walked out with a pair',
        's2b-01-karthik-profile.png', '/patients/PT-STORY-02B'),
      scene('3:15 PM', 'System', 'Trial appears on the tracking board',
        'The trial shows on the Trials board with a countdown to Day 7. If Karthik doesn\'t come back, the deposit auto-forfeits (with a warning email to the owner).',
        'Trials board = the difference between an audiology practice and a lending library.',
        'Countdown: 6 days to return · Day-2 WhatsApp scheduled',
        's2b-02-ha-trials.png', '/ha/trials'),
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // STORY 2.c — Buy from stock (Meera Rao, 48F)
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'story-2c',
    slug: 's2c-buy-from-stock',
    title: 'Branch 2.c · Meera Rao · Buys Phonak Lumity 30 from Stock (₹1,30,000)',
    lede: 'Meera (48F) trialed the Phonak Audeo Lumity 30 pair for a week and returns confirmed. Fit on the spot, serial numbers marked, full invoice raised.',
    accent: '#059669',
    diagnosis: 'Bilateral Moderate SNHL · post-trial conversion',
    outcome: '₹1,30,000 fitted-sale invoice · 2 serial numbers reserved · warranty 2 yr · Dr. AK earns 5% (₹6,500) referral commission',
    scenes: [
      scene('11:00 AM', 'Front Desk', 'Meera returns to buy',
        'Front-desk opens Meera\'s profile — the past trial shows in her history. She confirms she wants the same Phonak Audeo Lumity 30 pair.',
        'Trial history stitched to the patient card — no "let me check my notes" moment.',
        null,
        's2c-01-meera-profile.png', '/patients/PT-STORY-02C'),
      scene('11:15 AM', 'Audiologist', 'Fitted from serialised inventory',
        'Aditi opens the Inventory board, picks two saleable Phonak Lumity 30 RIC units (serials PHO-L30-2026001 / …2026002), marks them Sold, and fits them onto Meera.',
        'Serialised inventory → every device tracked from GRN to warranty end. No mystery pairs, no lost devices.',
        's2c-03-inventory.png',
        's2c-03-inventory.png', '/ha/inventory'),
      scene('11:40 AM', 'Front Desk', 'GST invoice ₹1,30,000 raised',
        'Auto-priced invoice: base ₹1,10,169 + 18% GST ₹19,831 = ₹1,30,000. HSN 902140. Paid on Card. Warranty ledger auto-created for 2 years.',
        'GST-ready, HSN-tagged, warranty-linked. Your CA gets a clean e-invoice; your patient gets a compliant receipt.',
        'Invoice INV/2026/S-02C · Paid ₹1,30,000',
        's2c-02-meera-invoice.png', '/billing'),
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // STORY 2.c.1 — Out of stock, advance + PO (Ravi Kumar, 58M)
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'story-2c1',
    slug: 's2c1-out-of-stock',
    title: 'Branch 2.c.1 · Ravi Kumar · Buys but Out of Stock (Advance + PO)',
    lede: 'Ravi (58M) also loved the Phonak Lumity 30 during trial, but the pair he needs is not in stock. Advance collected, invoice split, purchase order raised to Phonak, order tracked end-to-end.',
    accent: '#EA580C',
    diagnosis: 'Bilateral Moderate SNHL · post-trial conversion · device OOS',
    outcome: 'Advance ₹10,000 collected · Balance ₹1,20,000 due on delivery · PO placed with Phonak · ETA 5 days',
    scenes: [
      scene('2:00 PM', 'Audiologist', 'Ravi confirms — but the pair is OOS',
        'Aditi checks inventory: the specific Phonak Audeo Lumity 30 pair Ravi wants is out of stock. She switches Ravi\'s sale mode to "Awaiting Stock" and takes an advance.',
        'Sale states include "Awaiting Stock" — clean bookkeeping for split payments and PO-linked sales.',
        null,
        's2c1-01-ravi-profile.png', '/patients/PT-STORY-02C1'),
      scene('2:10 PM', 'Front Desk', 'Advance ₹10,000 invoice raised',
        'Split invoice: Advance ₹10,000 (paid UPI) + Balance ₹1,20,000 (due on delivery). Full ₹1,30,000 total pre-committed. Notes: "PO placed with Phonak."',
        'Split-advance invoicing so bookkeeping stays clean even when payment is deferred.',
        'Invoice INV/2026/S-02C1 · Status: Partial (Paid ₹10k / Due ₹1.2L)',
        's2c1-02-advance-invoice.png', '/billing'),
      scene('2:15 PM', 'Owner', 'Purchase order placed with Phonak',
        'A PO auto-drafts to Phonak India\'s orders inbox — pair, quantity, expected date, patient-attach flag. Ravi\'s file now shows both the invoice and the PO linked.',
        'PO-to-Sale linking + vendor tracking. Owner sees exactly which stock is patient-committed vs floating.',
        'PO/2026/S-02C1 · Vendor: Phonak · ETA 5 days · Ravi notified on receipt',
        's2c1-03-purchase-order.png', '/ha/purchase-orders'),
    ],
  },
];

// Summary metrics
export const STORY_STATS = {
  total_stories: STORIES.length,
  total_scenes: STORIES.reduce((n, s) => n + s.scenes.length, 0),
  patients_used: 6,
  referring_doctor: 'Dr. Anand Kumar (ENT, MBBS DLO)',
};
