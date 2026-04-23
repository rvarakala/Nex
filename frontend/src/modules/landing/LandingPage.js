/**
 * AUDINEXA marketing landing page — rebuilt for beta launch.
 *
 * Sections:
 *   1. Hero
 *   2. Module grid (Live / Coming Soon badges)
 *   3. Diagnostics Deep-Dive (Audiogram + Tympanogram illustrations)
 *   4. Pricing (fetched from /api/subscription/tiers)
 *   5. Waitlist
 *   6. Footer
 */
import React, { useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import {
  CheckCircle2, Sparkles, Clock3, Users, Calendar, Headphones,
  Stethoscope, Wrench, LineChart, Package, HandCoins, ShieldCheck,
  Receipt, Handshake, HeartPulse, ArrowRight, Lock, Activity,
} from 'lucide-react';
import { AudiogramIllustration, TympanogramIllustration } from './DiagnosticIllustrations';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ==================== MODULE CATALOGUE ====================
// Status: 'live' | 'beta' | 'soon'
const MODULES = [
  { id: 'M01', name: 'Front Desk', status: 'live',  tier: 'Basic',
    icon: Users,
    desc: 'Patient registration, MRD, queue & token system, appointments, walk-ins.' },
  { id: 'M02', name: 'Diagnostics', status: 'live',  tier: 'Basic',
    icon: Stethoscope, highlight: true,
    desc: 'Audiometry suite: PTA, Tympanometry, OAE, ABR, Speech, Sound Field, Pediatric, Tinnitus.' },
  { id: 'M03', name: 'Hearing Aid Sales', status: 'live',  tier: 'Standard',
    icon: Headphones,
    desc: 'Quotations → sales orders → GST invoices. Serialised inventory, trials, trade-ins.' },
  { id: 'M04', name: 'Service & Repair', status: 'live',  tier: 'Premium',
    icon: Wrench,
    desc: '13-state pipeline — courier, loaners, vendor RMA, customer approvals, SLAs.' },
  { id: 'M05', name: 'Owner Analytics', status: 'live', tier: 'Premium',
    icon: LineChart,
    desc: 'Revenue, conversion funnel, device mix, diagnosis trends, multi-branch rollups.' },
  { id: 'M06', name: 'AMC & Subscriptions', status: 'live', tier: 'Standard',
    icon: ShieldCheck,
    desc: 'Annual maintenance plans, renewals, expiry alerts, subscription billing.' },
  { id: 'M07', name: 'Patient Portal', status: 'live', tier: 'Standard',
    icon: HeartPulse,
    desc: 'Patients view reports, upcoming visits, device warranty & book follow-ups.' },
  { id: 'M08', name: 'Referral Partners', status: 'live', tier: 'Premium',
    icon: Handshake,
    desc: 'ENT doctor portal — submit referrals, track outcomes, earn commissions.' },
  { id: 'M09', name: 'Inventory & Procurement', status: 'live', tier: 'Standard',
    icon: Package,
    desc: 'Purchase orders, GRN, batch serials, vendor ledger, reorder alerts.' },
  { id: 'M10', name: 'Billing & GST', status: 'live', tier: 'Standard',
    icon: Receipt,
    desc: 'GST-compliant invoices, e-receipts, collections, day close-out, tax reports.' },
  { id: 'M11', name: 'Cochlear Implants', status: 'soon', tier: 'Premium',
    icon: Activity,
    desc: 'Candidacy workups, programming, mapping sessions, rehab milestones.' },
  { id: 'M12', name: 'Rehabilitation', status: 'soon', tier: 'Premium',
    icon: HeartPulse,
    desc: 'Auditory training, Speech-Language therapy scheduling, progress notes.' },
  { id: 'M13', name: 'Tele-Audiology', status: 'soon', tier: 'Premium',
    icon: Calendar,
    desc: 'Remote tuning, teleconsultation, asynchronous fitting adjustments.' },
  { id: 'M14', name: 'Insurance Claims', status: 'soon', tier: 'Premium',
    icon: HandCoins,
    desc: 'Pre-auth, claim submission, payer reconciliation, EOB imports.' },
];

// ==================== DIAGNOSTIC PANELS (for deep-dive section) ====================
const DIAGNOSTIC_PANELS = [
  { name: 'Pre-Test',      basic: true,  desc: 'Case history · otoscopy · tuning fork' },
  { name: 'Pure Tone',     basic: true,  desc: 'AC · BC · masking · extended freq · MCL / UCL' },
  { name: 'Impedance',     basic: true,  desc: 'Tympanometry · reflex · decay · ETF' },
  { name: 'Speech',        basic: false, desc: 'SRT · WRS · aided · soundfield' },
  { name: 'OAE',           basic: false, desc: 'DPOAE · TEOAE screening & diagnostic' },
  { name: 'ABR / ASSR',    basic: false, desc: 'Click · tone burst · ASSR thresholds' },
  { name: 'Special Tests', basic: false, desc: 'SISI · tone decay · ABLB' },
  { name: 'Sound Field',   basic: false, desc: 'Aided threshold measurement' },
  { name: 'Pediatric',     basic: false, desc: 'VRA · play audiometry · BOA' },
  { name: 'Tinnitus',      basic: false, desc: 'Matching · LDL · residual inhibition' },
];

// ==================== STATUS BADGE ====================
const StatusBadge = ({ status }) => {
  if (status === 'live')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </span>
    );
  if (status === 'beta')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <Sparkles size={9} />
        Beta
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full bg-slate-500/15 text-slate-400 border border-slate-600/40">
      <Clock3 size={9} />
      Coming Soon
    </span>
  );
};

// ==================== HEADER ====================
const Header = () => (
  <header className="sticky top-0 z-40 backdrop-blur-xl bg-slate-950/75 border-b border-slate-900">
    <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
      <a href="#top" className="flex items-center gap-2" data-testid="landing-logo">
        <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-rose-600 rounded flex items-center justify-center font-black text-sm text-white">A</div>
        <div className="text-xl font-black tracking-tight text-white">AUDINEXA</div>
      </a>
      <nav className="flex items-center gap-3 sm:gap-5 text-sm">
        <a href="#modules" className="hidden sm:inline text-slate-400 hover:text-white transition-colors">Modules</a>
        <a href="#diagnostics" className="hidden md:inline text-slate-400 hover:text-white transition-colors">Diagnostics</a>
        <a href="#waitlist" className="hidden sm:inline text-slate-400 hover:text-white transition-colors">Waitlist</a>
        <a
          href="/login"
          data-testid="landing-login-cta"
          className="px-3 sm:px-4 py-1.5 border border-slate-700 hover:border-white rounded text-slate-200 hover:text-white transition-colors"
        >
          Sign in
        </a>
      </nav>
    </div>
  </header>
);

// ==================== HERO ====================
const Hero = () => (
  <section id="top" className="relative overflow-hidden">
    {/* ambient glow */}
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute top-20 -left-40 w-[420px] h-[420px] bg-orange-500/10 blur-[120px] rounded-full" />
      <div className="absolute top-40 right-0 w-[420px] h-[420px] bg-indigo-500/10 blur-[120px] rounded-full" />
    </div>
    <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-28">
      <div className="inline-flex items-center gap-2 mb-6 px-3 py-1 text-[11px] font-bold tracking-wider uppercase bg-orange-500/10 text-orange-300 border border-orange-500/30 rounded-full">
        <Sparkles size={11} />
        <span>Private Beta · 10 founding clinics · Q2 2026</span>
      </div>
      <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] mb-6 text-white">
        The Operating System <br className="hidden sm:block" />
        <span className="bg-gradient-to-r from-orange-400 via-rose-400 to-fuchsia-400 bg-clip-text text-transparent">
          for Modern Audiology Clinics.
        </span>
      </h1>
      <p className="text-lg sm:text-xl text-slate-400 max-w-2xl leading-relaxed mb-10">
        Registration to repair closure, tracked in one place.{' '}
        <span className="text-white font-semibold">14 modules, one tenant, full GST.</span>{' '}
        Designed for Indian audiology — multi-branch, multi-role, zero sticky notes.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <a
          href="/signup"
          data-testid="landing-hero-cta"
          className="inline-flex items-center gap-2 px-6 py-3 bg-white text-slate-950 font-bold rounded-lg hover:bg-orange-100 transition-colors shadow-lg shadow-orange-500/10"
        >
          Start free trial <ArrowRight size={16} />
        </a>
        <a
          href="#waitlist"
          data-testid="landing-waitlist-cta"
          className="inline-flex items-center gap-2 px-6 py-3 border border-slate-700 hover:border-white text-slate-200 font-bold rounded-lg transition-colors"
        >
          Join waitlist
        </a>
        <div className="text-sm text-slate-500 hidden md:block">
          30-day Premium trial · No card required
        </div>
      </div>
      {/* tiny stats strip */}
      <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl">
        {[
          { k: '14', v: 'Modules' },
          { k: '13', v: 'Repair states' },
          { k: '10+', v: 'Diagnostic protocols' },
          { k: '606', v: 'Automated tests' },
        ].map((s) => (
          <div key={s.v} className="border-l-2 border-orange-500/60 pl-3">
            <div className="text-3xl font-black text-white">{s.k}</div>
            <div className="text-xs uppercase tracking-wider text-slate-500">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

// ==================== MODULE GRID ====================
const ModuleGrid = () => {
  const liveCount = useMemo(() => MODULES.filter((m) => m.status === 'live').length, []);
  const soonCount = useMemo(() => MODULES.filter((m) => m.status === 'soon').length, []);

  return (
    <section id="modules" className="max-w-6xl mx-auto px-6 py-24 scroll-mt-20">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-orange-400 font-bold mb-1">Platform</div>
          <h2 className="text-4xl sm:text-5xl font-black text-white mb-3">Every clinic workflow, unified.</h2>
          <p className="text-slate-400 text-lg max-w-2xl">
            <span className="text-emerald-400 font-semibold">{liveCount} modules live today.</span>{' '}
            <span className="text-slate-500">{soonCount} more shipping this year.</span>
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          const comingSoon = m.status === 'soon';
          return (
            <div
              key={m.id}
              data-testid={`module-card-${m.id}`}
              className={`group relative rounded-xl p-5 border transition-all ${
                m.highlight
                  ? 'border-orange-500/60 bg-gradient-to-br from-orange-500/10 via-rose-500/5 to-transparent shadow-lg shadow-orange-500/5'
                  : comingSoon
                    ? 'border-slate-800 bg-slate-900/40'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700'
              }`}
            >
              {m.highlight && (
                <div className="absolute -top-2 left-4 px-2 py-0.5 text-[9px] font-black tracking-wider uppercase bg-orange-500 text-white rounded">
                  ★ Featured
                </div>
              )}
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  m.highlight ? 'bg-orange-500/20 text-orange-300' : comingSoon ? 'bg-slate-800 text-slate-500' : 'bg-indigo-500/10 text-indigo-300'
                }`}>
                  <Icon size={20} strokeWidth={2} />
                </div>
                <StatusBadge status={m.status} />
              </div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                {m.id} · {m.tier}
              </div>
              <div className={`text-lg font-bold mb-1.5 ${comingSoon ? 'text-slate-400' : 'text-white'}`}>
                {m.name}
              </div>
              <p className={`text-sm leading-relaxed ${comingSoon ? 'text-slate-600' : 'text-slate-400'}`}>
                {m.desc}
              </p>
              {m.highlight && (
                <a
                  href="#diagnostics"
                  className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-orange-300 hover:text-orange-200"
                >
                  See the Diagnostics deep-dive <ArrowRight size={12} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ==================== DIAGNOSTICS DEEP-DIVE ====================
const DiagnosticsSection = () => (
  <section
    id="diagnostics"
    className="relative scroll-mt-20 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border-y border-slate-900"
  >
    <div className="max-w-6xl mx-auto px-6 py-24">
      <div className="mb-12 text-center">
        <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 text-[11px] font-bold tracking-wider uppercase bg-orange-500/10 text-orange-300 border border-orange-500/30 rounded-full">
          <Stethoscope size={11} /> Flagship Module
        </div>
        <h2 className="text-4xl sm:text-5xl font-black text-white mb-4">
          The most complete <span className="bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">diagnostic suite</span> in India.
        </h2>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          Built with audiologists, for audiologists. Paper audiograms, PDF reports, NOAH interop —
          and a pediatric-to-geriatric protocol library that covers everything.
        </p>
      </div>

      {/* Illustration row */}
      <div className="grid lg:grid-cols-2 gap-6 mb-12">
        <div className="relative rounded-2xl border border-slate-800 bg-slate-900/60 p-5 overflow-hidden group hover:border-orange-500/40 transition-colors">
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-rose-500/10 blur-3xl rounded-full group-hover:bg-rose-500/20 transition-colors" />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-wider font-bold text-rose-300 mb-1">Pure-Tone Audiometry</div>
            <div className="text-xl font-bold text-white mb-3">Audiogram · AC / BC / Masking</div>
            <AudiogramIllustration className="w-full h-auto rounded-lg" />
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-300">
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>Click-to-plot AC &amp; BC</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>Auto-masking logic</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>Extended high-freq (9–16 kHz)</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>PTA &amp; SRT auto-calc</li>
            </ul>
          </div>
        </div>

        <div className="relative rounded-2xl border border-slate-800 bg-slate-900/60 p-5 overflow-hidden group hover:border-orange-500/40 transition-colors">
          <div className="absolute -top-20 -left-20 w-60 h-60 bg-emerald-500/10 blur-3xl rounded-full group-hover:bg-emerald-500/20 transition-colors" />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-300 mb-1">Impedance Audiometry</div>
            <div className="text-xl font-bold text-white mb-3">Tympanogram · Reflex · ETF</div>
            <TympanogramIllustration className="w-full h-auto rounded-lg" />
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-300">
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>Jerger A/As/Ad/B/C typing</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>Acoustic reflex (ipsi/contra)</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>Reflex decay · ETF</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 flex-shrink-0"/>226 Hz &amp; 1 kHz probes</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Protocol matrix */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-orange-400 mb-0.5">Protocol library</div>
            <h3 className="text-xl font-bold text-white">10 diagnostic panels · tier-gated access</h3>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            <span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-1" /> Basic includes
            <span className="inline-block w-2 h-2 bg-amber-400 rounded-full ml-3 mr-1" /> Standard+ unlocks
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {DIAGNOSTIC_PANELS.map((p) => (
            <div
              key={p.name}
              data-testid={`panel-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              className={`rounded-lg p-3 border ${
                p.basic
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-amber-500/25 bg-amber-500/5'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className={`text-xs font-bold ${p.basic ? 'text-emerald-200' : 'text-amber-200'}`}>{p.name}</div>
                {p.basic ? (
                  <CheckCircle2 size={13} className="text-emerald-400" />
                ) : (
                  <Lock size={11} className="text-amber-400" />
                )}
              </div>
              <div className={`text-[10px] leading-snug ${p.basic ? 'text-emerald-100/70' : 'text-amber-100/70'}`}>
                {p.desc}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 text-[11px] text-slate-500 text-center">
          BASIC includes Pre-Test · Pure Tone · Impedance · Reports. Upgrade to STANDARD for Speech, OAE, ABR, Sound Field, Pediatric &amp; Tinnitus.
        </div>
      </div>
    </div>
  </section>
);

// ==================== WAITLIST FORM (stateful) ====================
const WaitlistForm = () => {
  const [email, setEmail] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [city, setCity] = useState('');
  const [tierInterest, setTierInterest] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
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
    <section id="waitlist" className="max-w-2xl mx-auto px-6 py-24 scroll-mt-20">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
        <h2 className="text-3xl font-black text-white mb-2">Join the waitlist</h2>
        <p className="text-slate-400 mb-6 text-sm">
          We'll email you when AUDINEXA opens to your clinic + a 30-day free Premium trial.
        </p>
        {submitted ? (
          <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-lg p-5 text-center" data-testid="waitlist-success">
            <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-2" />
            <div className="font-bold mb-1">You're on the list.</div>
            <div className="text-sm">We'll email <b>{email}</b> when we launch.</div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3" data-testid="waitlist-form">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Work email"
              data-testid="waitlist-email"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:border-orange-500 outline-none text-white placeholder-slate-500"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="Clinic name"
                data-testid="waitlist-clinic"
                className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:border-orange-500 outline-none text-white placeholder-slate-500"
              />
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                data-testid="waitlist-city"
                className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:border-orange-500 outline-none text-white placeholder-slate-500"
              />
            </div>
            <select
              value={tierInterest}
              onChange={(e) => setTierInterest(e.target.value)}
              data-testid="waitlist-tier"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:border-orange-500 outline-none text-white"
            >
              <option value="">Clinic size (optional)</option>
              <option value="SOLO">Solo practice (1 audiologist)</option>
              <option value="SMALL">Small clinic (2–5 staff)</option>
              <option value="MULTI">Multi-branch / hospital group</option>
            </select>
            {err && <div className="bg-rose-500/10 text-rose-300 text-xs p-2 rounded">{err}</div>}
            <button
              type="submit"
              disabled={busy}
              data-testid="waitlist-submit"
              className="w-full bg-white text-slate-950 font-bold py-3 rounded-lg hover:bg-orange-100 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
            >
              {busy ? 'Submitting…' : 'Join the waitlist →'}
            </button>
            <div className="text-[10px] text-center text-slate-500 pt-1">
              We'll never spam you. Unsubscribe with one click.
            </div>
          </form>
        )}
      </div>
    </section>
  );
};

// ==================== FOOTER ====================
const Footer = () => (
  <footer className="border-t border-slate-900 py-8 text-center text-xs text-slate-600">
    © {new Date().getFullYear()} AUDINEXA · Built for audiologists.
    <span className="mx-2">·</span>
    <a href="/login" className="hover:text-slate-400" data-testid="landing-footer-login">Staff sign in</a>
  </footer>
);

// ==================== PAGE ====================
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans" data-testid="landing-page">
      <Header />
      <Hero />
      <ModuleGrid />
      <DiagnosticsSection />
      <WaitlistForm />
      <Footer />
    </div>
  );
}
