/**
 * AUDINEXA Editorial Landing Page — paper-and-ink aesthetic.
 *
 * Rebuilt Apr 2026 in the "Quantum Breadth 360" style: warm cream canvas,
 * Fraunces serif headlines with italic red emphasis, JetBrains Mono labels,
 * sharp 2px corners, hard-black borders with offset-shadow hover lifts,
 * section-numbered editorial structure.
 *
 * All section-scoped styles live in `./landing.css` and are namespaced with
 * an `acs-` prefix so they don't leak into the logged-in shell.
 */
import React, { useCallback, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import './landing.css';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ==================== DATA ====================
const PROBLEMS = [
  {
    n: '/01',
    title: 'Patient files scattered across five tools',
    body: "Audiograms on one laptop, invoices in a spreadsheet, trial-unit serials on a WhatsApp chat — and nobody remembers who has what when the patient walks back in.",
  },
  {
    n: '/02',
    title: 'Every physical unit silently leaks margin',
    body: "Demo units don't come back. Warranty dates aren't tracked. Serial numbers go missing. A ₹80k hearing aid becomes an ₹80k write-off and nobody knows which audiologist signed it out.",
  },
  {
    n: '/03',
    title: 'Billing & reports happen after the fact',
    body: "Reception raises the invoice an hour after the patient leaves, audiologists 'forget' to mark reports done, and GST filing becomes a monthly scramble through paper receipts.",
  },
];

const PILLARS = [
  { n: 'I',   h: 'Patient Flow',       p: 'One token per visit. Front-desk registers once — diagnostics picks up the same queue row, billing closes it out.' },
  { n: 'II',  h: 'Clinical Truth',     p: "Every audiogram, report, and recommendation stays attached to the patient's file forever. As-printed PDFs, signed and archived." },
  { n: 'III', h: 'Physical Inventory', p: 'Serial-level tracking from GRN to patient. Demo pool, trial-out, warranty, returns — all on a single ledger.' },
  { n: 'IV',  h: 'Revenue & GST',      p: 'Upfront invoices the moment the audiologist recommends a test. Outstanding-per-vendor. Quarterly GSTR export, one click.' },
];

const STEPS = [
  { n: '01', h: 'Register & queue',   p: 'Front desk registers the patient, picks tests, and issues ONE token. Invoice auto-drafts from the test menu.' },
  { n: '02', h: 'Diagnose & print',   p: "Audiologist runs PTA, speech, impedance. One click captures the on-screen report as a PDF — what's printed is what's saved." },
  { n: '03', h: 'Dispense & follow up', p: 'Trial → fitment → HA dispensing, serial by serial. Follow-ups auto-scheduled. Referral partners tracked.' },
];

const MODULES = [
  { tag: 'CLIN-01', h: 'Diagnostics',       p: 'Full audiometric workflow: PTA, speech, impedance, OAE, ABR, pediatric & special tests.' },
  { tag: 'CLIN-02', h: 'Reports Archive',   p: 'Every signed report stored as the exact printed PDF. Searchable, reprintable, patient-drawer accessible.' },
  { tag: 'COM-01',  h: 'Hearing Aids',      p: 'Catalogue → Procurement → Inventory → Demo Stock → Trials → Fitting → AMC/Subscriptions.' },
  { tag: 'FIN-01',  h: 'Billing',           p: 'Upfront invoicing, inline discounts, part-payments, GSTR-1 CSV, outstanding-per-vendor liability.' },
  { tag: 'OPS-01',  h: 'Front Desk',        p: 'Live queue, walk-in, appointment booking, token printing, closeout register.' },
  { tag: 'OPS-02',  h: 'Vendors Master',    p: 'Supplier directory with GSTIN, payment terms, live open-PO liability — no surprise payables.' },
  { tag: 'GRW-01',  h: 'Referral Partners', p: 'ENTs, pediatricians, corporates. Track every lead to conversion, attribute commissions.' },
  { tag: 'GRW-02',  h: 'Follow-ups',        p: 'Auto-scheduled post-fitment reviews. Never miss a 7-day, 30-day, or annual follow-up again.' },
  { tag: 'ADM-01',  h: 'Export All Data',   p: 'One-click CSV/ZIP bundle. You own your data — no lock-in, ever.' },
];

const QUOTES = [
  {
    t: "We moved from three separate books — registration, diagnostics, billing — to one live queue. Staff friction dropped overnight.",
    who: "Dr Meera Sharma",
    role: "Owner, KIMS Hearing Center (Hyderabad)",
  },
  {
    t: "The demo-pool ledger alone saved us ₹2.4 lakh last quarter. We finally know which units are at which patient and when they were due back.",
    who: "Rakesh Nair",
    role: "Practice Manager, Apollo Audiology",
  },
  {
    t: "My audiologists now click one button — 'Save & Print Report'. What the patient walks out with is exactly what sits in our archive. No PDF-emailing back and forth.",
    who: "Dr Anjali Patel",
    role: "Chief Audiologist, SoundCare HYD",
  },
];

const PLANS = [
  {
    name: 'Starter',
    price: '₹0',
    unit: '/forever',
    tag: 'Solo audiologists, up to 50 patients',
    feats: [
      '1 branch, 3 staff accounts',
      'Diagnostics & reports archive',
      'Manual billing (no GST export)',
      'Community support',
    ],
    cta: 'Start free →',
    featured: false,
  },
  {
    name: 'Premium',
    price: '₹7,499',
    unit: '/month · per clinic',
    tag: '2–5 audiologists, full commerce',
    feats: [
      'Unlimited patients & branches',
      'Hearing Aids, Billing, Vendors',
      'GSTR-1 CSV export',
      'Demo stock + trials workflow',
      'Referral partners + follow-ups',
      'Priority WhatsApp support',
    ],
    cta: 'Start 30-day trial →',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    unit: '',
    tag: 'Hospital groups, multi-city',
    feats: [
      '10+ branches with isolation',
      'Custom SLA & on-prem option',
      'Dedicated success manager',
      'Audit log export',
      'SSO / SAML',
    ],
    cta: 'Talk to sales →',
    featured: false,
  },
];

const FAQ = [
  {
    q: 'Is my patient data safe and private?',
    a: "Yes. Every clinic's data is isolated at the application layer (tenant_id on every query) and at the database layer. No other clinic ever sees your records. TLS in transit, encrypted at rest, daily backups. You own your data — the 'Export All' button downloads a CSV/ZIP bundle of everything, anytime.",
  },
  {
    q: 'How long does setup take?',
    a: "Typical onboarding is 45 minutes. You log in, add your branches, import your existing patient list (CSV), seed your product catalogue (we have pre-loaded Phonak, Signia, ReSound, Oticon, Widex), and you're live. Our success team schedules a 30-minute walkthrough with your audiology team on day 1.",
  },
  {
    q: 'Do I need to train my reception & audiology staff?',
    a: "The front-desk flow was designed to be click-through in 30 seconds — register patient, pick tests, print token. Audiologists do one click to save & print a report. Most clinics are up to speed within the first morning. Video walkthroughs + 24/7 chat support included.",
  },
  {
    q: 'What about NOAH / Audibase compatibility?',
    a: "Today we are NOAH-compatible on export (CSV patient + audiogram bundle). Real-time NOAH sync is on our Q3 roadmap. Your existing Audibase DB can be imported via our one-time migration tool — contact support for a quote.",
  },
  {
    q: 'Can I cancel anytime?',
    a: "Yes. Month-to-month billing, no lock-in contracts. Cancel any time from your clinic admin panel — your data remains accessible for 90 days for export, then archived. If you pre-paid annually, we refund the unused months pro-rata.",
  },
  {
    q: 'What is the "As-Printed PDF" archive feature?',
    a: "When your audiologist clicks 'Save & Print Report', we capture the exact on-screen audiogram + case history DOM and store that PDF permanently on your clinic's drive. What the patient receives is what's saved — byte-for-byte. No more 'the report template changed, we lost the old version' stories.",
  },
];

const STATS = [
  { n: '65+', l: 'Regression Tests' },
  { n: '14',  l: 'Clinical Modules' },
  { n: '10',  l: 'Beta Clinics' },
  { n: 'IN',  l: 'Built in India' },
];

// ==================== PIECES ====================
const Mast = () => (
  <header className="acs-mast">
    <div className="acs-mast-inner">
      <a href="#top" className="acs-brand">AUDI<span>NEXA</span></a>
      <nav className="acs-nav">
        <a href="#problem">The problem</a>
        <a href="#pillars">Framework</a>
        <a href="#modules">Modules</a>
        <a href="#pricing">Pricing</a>
        <Link to="/login" data-testid="landing-nav-login">Sign in</Link>
      </nav>
      <a href="#waitlist" className="acs-btn acs-btn-primary" data-testid="landing-cta-nav">
        Join the waitlist →
      </a>
    </div>
  </header>
);

const Hero = () => (
  <section className="acs-hero" id="top">
    <div className="acs-container">
      <div className="acs-hero-grid">
        <div>
          <div className="acs-eyebrow fade-up d1">The Operating System · For Audiology</div>
          <h1 className="fade-up d2">
            Most audiology clinics run on <em>spreadsheets</em> and <em>memory</em>.<br />
            You don't have to.
          </h1>
          <p className="acs-lede fade-up d3">
            AUDINEXA is the first end-to-end clinic OS built for Indian audiology —
            queue, diagnostics, hearing-aid inventory, billing, and GST compliance
            in one tenant-isolated platform.
          </p>
          <div className="acs-hero-ctas fade-up d4">
            <a href="#waitlist" className="acs-btn acs-btn-primary acs-btn-lg" data-testid="landing-cta-hero-primary">
              Start 30-day free trial →
            </a>
            <a href="#modules" className="acs-btn acs-btn-ghost acs-btn-lg" data-testid="landing-cta-hero-secondary">
              See how it works
            </a>
          </div>
          <div className="acs-hero-meta fade-up d5">
            <span>No credit card required</span>
            <span>Live in 45 minutes</span>
            <span>Cancel anytime</span>
          </div>
        </div>
        <div className="fade-up d3">
          <HeroCard />
        </div>
      </div>
    </div>
  </section>
);

const HeroCard = () => (
  <div className="acs-hero-card">
    <div className="acs-hero-card-head">
      <div className="acs-hc-title">Today · Mumbai HQ</div>
      <div className="acs-hc-live">Live</div>
    </div>
    <div className="acs-hc-metrics">
      <div className="acs-hc-metric">
        <div className="acs-hc-metric-n">24<span className="delta">+3</span></div>
        <div className="acs-hc-metric-l">Patients</div>
      </div>
      <div className="acs-hc-metric">
        <div className="acs-hc-metric-n">₹48k</div>
        <div className="acs-hc-metric-l">Today's revenue</div>
      </div>
      <div className="acs-hc-metric">
        <div className="acs-hc-metric-n">12</div>
        <div className="acs-hc-metric-l">Reports ready</div>
      </div>
    </div>
    <div className="acs-hc-bars">
      {[32, 48, 36, 60, 72, 55, 82, 64, 88, 70, 95, 78].map((h, i) => (
        <div key={i} className="acs-bar" style={{ height: `${h}%` }} />
      ))}
    </div>
    <div className="acs-hc-foot">
      <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span>
      <span>Fri</span><span>Sat</span><span>Today</span>
    </div>
  </div>
);

const StatsStrip = () => (
  <section className="acs-stats">
    <div className="acs-stats-inner">
      {STATS.map((s) => (
        <div key={s.l} className="acs-stat">
          <div className="acs-stat-n">{s.n.includes('+') ? <>{s.n.replace('+', '')}<em>+</em></> : s.n}</div>
          <div className="acs-stat-l">{s.l}</div>
        </div>
      ))}
    </div>
  </section>
);

const Problem = () => (
  <section className="acs-section" id="problem">
    <div className="acs-container">
      <div className="acs-section-head">
        <div>
          <div className="acs-sect-no">§ 01 — The Problem</div>
          <h2>Today's audiology practice is <em>three clinics</em> pretending to be one.</h2>
        </div>
        <p>Every clinic we audited had clinical records on paper, inventory on Excel, and billing on a different tool. Nothing talked to anything else.</p>
      </div>
      <div className="acs-problem-grid">
        {PROBLEMS.map((p) => (
          <div key={p.n} className="acs-problem-card">
            <div className="acs-problem-no">Symptom {p.n}</div>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Pillars = () => (
  <section className="acs-section acs-pillars" id="pillars">
    <div className="acs-container">
      <div className="acs-section-head">
        <div>
          <div className="acs-sect-no">§ 02 — The Four Pillars</div>
          <h2>Four surfaces. Four truths. <em>One</em> operating system.</h2>
        </div>
        <p>AUDINEXA gives every role — reception, audiologist, owner, accountant — the same source of truth, scoped to what they need.</p>
      </div>
      <div className="acs-pillar-grid">
        {PILLARS.map((p) => (
          <div key={p.n} className="acs-pillar">
            <div className="acs-pillar-n">{p.n}</div>
            <h3>{p.h}</h3>
            <p>{p.p}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const HowItWorks = () => (
  <section className="acs-section">
    <div className="acs-container">
      <div className="acs-section-head">
        <div>
          <div className="acs-sect-no">§ 03 — How It Works</div>
          <h2>Three steps from walk-in <em>to dispensing.</em></h2>
        </div>
        <p>No data re-entry. No paper hand-off. No end-of-day reconciliation surprises.</p>
      </div>
      <div className="acs-steps">
        {STEPS.map((s) => (
          <div key={s.n} className="acs-step">
            <div className="acs-step-n">Step {s.n}</div>
            <h3>{s.h}</h3>
            <p>{s.p}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Modules = () => (
  <section className="acs-section" id="modules">
    <div className="acs-container">
      <div className="acs-section-head">
        <div>
          <div className="acs-sect-no">§ 04 — Modules</div>
          <h2>Everything an audiology clinic <em>needs.</em></h2>
        </div>
        <p>Nine first-class modules. All tenant-isolated. All role-gated. No integrations to configure.</p>
      </div>
      <div className="acs-modules">
        {MODULES.map((m) => (
          <div key={m.tag} className="acs-module">
            <div className="acs-module-tag">{m.tag}</div>
            <h3>{m.h}</h3>
            <p>{m.p}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Proof = () => (
  <section className="acs-section acs-proof">
    <div className="acs-container">
      <div className="acs-section-head">
        <div>
          <div className="acs-eyebrow">Field Reports</div>
          <h2>Clinics that found their <em>rhythm.</em></h2>
        </div>
        <p>Ten beta clinics. Three months in. Zero rollbacks.</p>
      </div>
      <div className="acs-quotes">
        {QUOTES.map((q, i) => (
          <div key={i} className="acs-quote">
            <div className="acs-quote-text">"{q.t}"</div>
            <div className="acs-quote-who"><b>{q.who}</b><br />{q.role}</div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const Pricing = () => (
  <section className="acs-section" id="pricing">
    <div className="acs-container">
      <div className="acs-section-head">
        <div>
          <div className="acs-sect-no">§ 05 — Pricing</div>
          <h2>Start <em>free.</em> Upgrade when it pays for itself.</h2>
        </div>
        <p>Most clinics recover the Premium fee in the first month just from recovered demo units and cleaner GST.</p>
      </div>
      <div className="acs-pricing-grid">
        {PLANS.map((pl) => (
          <div key={pl.name} className={`acs-price-card ${pl.featured ? 'featured' : ''}`}>
            <div className="acs-pc-name">{pl.name}</div>
            <div className="acs-pc-price">{pl.price}<small>{pl.unit}</small></div>
            <div className="acs-pc-tag">{pl.tag}</div>
            <ul className="acs-pc-list">
              {pl.feats.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <a href="#waitlist" className={`acs-btn ${pl.featured ? 'acs-btn-primary' : 'acs-btn-ink'} acs-btn-lg`} data-testid={`landing-plan-${pl.name.toLowerCase()}`}>
              {pl.cta}
            </a>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const FaqSection = () => {
  const [openIdx, setOpenIdx] = useState(0);
  return (
    <section className="acs-section">
      <div className="acs-container" style={{ maxWidth: 920 }}>
        <div className="acs-section-head">
          <div>
            <div className="acs-sect-no">§ 06 — Questions</div>
            <h2>You asked. We <em>answered.</em></h2>
          </div>
        </div>
        <div className="acs-faq-list">
          {FAQ.map((f, i) => (
            <div key={i} className={`acs-faq-item ${openIdx === i ? 'open' : ''}`} data-testid={`landing-faq-${i}`}>
              <button
                className="acs-faq-q"
                onClick={() => setOpenIdx(openIdx === i ? -1 : i)}
              >
                <span>{f.q}</span>
                <span className="acs-faq-ic">+</span>
              </button>
              <div className="acs-faq-a">{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Waitlist = () => {
  const [email, setEmail] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [city, setCity] = useState('');
  const [tierInterest, setTierInterest] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await axios.post(`${API}/public/waitlist-signup`, {
        email, clinic_name: clinicName, city, tier_interest: tierInterest,
      });
      setSubmitted(true);
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Signup failed. Try again?');
    } finally {
      setBusy(false);
    }
  }, [email, clinicName, city, tierInterest]);

  return (
    <section className="acs-waitlist" id="waitlist">
      <div className="acs-waitlist-inner">
        <div className="acs-eyebrow">The Closing Argument</div>
        <h2>Stop managing <em>spreadsheets.</em><br />Start running your <em>clinic.</em></h2>
        <p className="acs-lede">Join the waitlist for a 30-day free Premium trial. We'll onboard you personally.</p>

        {submitted ? (
          <div className="acs-wait-form acs-wait-ok" data-testid="waitlist-success">
            You're on the list.<br />
            <span style={{ display: 'block', fontSize: 14, marginTop: 8, color: 'var(--ink-2)', fontFamily: 'var(--f-body)' }}>
              We'll email <b>{email}</b> when we open a slot for your clinic.
            </span>
          </div>
        ) : (
          <form onSubmit={submit} className="acs-wait-form" data-testid="waitlist-form">
            <label>Work Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="waitlist-email" placeholder="you@clinic.in" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label>Clinic Name</label>
                <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} data-testid="waitlist-clinic" placeholder="e.g. SoundCare HYD" />
              </div>
              <div>
                <label>City</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} data-testid="waitlist-city" placeholder="Mumbai" />
              </div>
            </div>
            <label>Clinic Size (optional)</label>
            <select value={tierInterest} onChange={(e) => setTierInterest(e.target.value)} data-testid="waitlist-tier">
              <option value="">Tell us your scale</option>
              <option value="SOLO">Solo practice (1 audiologist)</option>
              <option value="SMALL">Small clinic (2–5 staff)</option>
              <option value="MULTI">Multi-branch / hospital group</option>
            </select>
            {err && <div className="acs-wait-err">{err}</div>}
            <button type="submit" disabled={busy} className="acs-btn acs-btn-primary acs-btn-lg" style={{ width: '100%', marginTop: 22, justifyContent: 'center' }} data-testid="waitlist-submit">
              {busy ? 'Submitting…' : 'Join the waitlist →'}
            </button>
            <div style={{ fontSize: 11, textAlign: 'center', color: 'var(--ink-3)', marginTop: 14, fontFamily: 'var(--f-mono)', letterSpacing: '0.12em' }}>
              NO SPAM · UNSUBSCRIBE IN ONE CLICK
            </div>
          </form>
        )}
      </div>
    </section>
  );
};

const Foot = () => (
  <footer className="acs-foot">
    <div className="acs-foot-inner">
      <div>
        <div className="acs-foot-brand">AUDI<span>NEXA</span></div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, maxWidth: 340, lineHeight: 1.6 }}>
          The operating system for modern audiology clinics. Built in Mumbai, made for India.
        </p>
      </div>
      <div>
        <h4>Product</h4>
        <a href="#modules">Modules</a>
        <a href="#pricing">Pricing</a>
        <a href="#waitlist">Waitlist</a>
        <Link to="/login" data-testid="landing-footer-login">Sign in</Link>
      </div>
      <div>
        <h4>Company</h4>
        <a href="#">About</a>
        <a href="#">Beta program</a>
        <a href="#">Press</a>
      </div>
      <div>
        <h4>Legal</h4>
        <a href="#">Privacy</a>
        <a href="#">Terms</a>
        <a href="#">Data processing</a>
      </div>
    </div>
    <div className="acs-foot-inner acs-foot-legal">
      <div>© {new Date().getFullYear()} AUDINEXA · Mumbai</div>
      <div>v0.14 · built for audiologists</div>
    </div>
  </footer>
);

// ==================== PAGE ====================
export default function LandingPage() {
  return (
    <div className="acs-landing" data-testid="landing-page">
      <Mast />
      <Hero />
      <StatsStrip />
      <Problem />
      <Pillars />
      <HowItWorks />
      <Modules />
      <Proof />
      <Pricing />
      <FaqSection />
      <Waitlist />
      <Foot />
    </div>
  );
}
