/**
 * AUDINEXA Landing Page — v3 "Modern Clinical OS" (2026-07-25).
 *
 * Design system source: /app/design_guidelines.json
 * Hero: Variant A layout (bold split + asymmetric proof cards).
 * Copy: merged sub-hero blending B's module-list + one-system claim
 *       with C's "6 tabs of Excel · 3 WhatsApp groups · 1 PDF binder"
 *       gut-punch.
 *
 * Sections (top→bottom):
 *   1. Sticky header (bone bg, saffron pill CTA)
 *   2. Hero A (Cabinet Grotesk headline · asymmetric card cluster)
 *   3. Live proof band (mono uppercase ticker)
 *   4. Module bento (12-col Tetris grid)
 *   5. Diagnostics deep-dive (dark inverted section)
 *   6. Spreadsheets-vs-AUDINEXA comparison
 *   7. Founder letter + testimonials
 *   8. Pricing (fetched from /api/subscription/tiers)
 *   9. FAQ
 *  10. Footer with massive "Let's Talk" callout
 *
 * Fonts injected at mount: Cabinet Grotesk (Fontshare) + IBM Plex Sans/Mono (Google Fonts).
 * Palette tokens live in `C` object. Motion respects prefers-reduced-motion.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowRight, Play, ShieldCheck, Users, Stethoscope, Headphones, Wrench,
  Receipt, LineChart, Handshake, HeartPulse, Package, Activity, Sparkles,
  X, Check, ChevronDown, Zap,
} from 'lucide-react';
import { AudiogramIllustration, TympanogramIllustration } from './DiagnosticIllustrations';
import LaunchBanner from './LaunchBanner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ─────────────────────────────────────────────────────────────────────
// Design tokens — do NOT change without updating /app/design_guidelines.json
// ─────────────────────────────────────────────────────────────────────
const C = {
  bone: '#FDFBF7',
  surface: '#F3F1EC',
  ink: '#1A1C23',
  ink2: '#4A4D57',
  saffron: '#D95D39',
  saffronHover: '#B84A2A',
  saffronTint: '#FEF0EA',
  emerald: '#059669',
  emeraldTint: '#DCFCE7',
  border: '#E2DFD8',
  navy: '#0B0D17',
  navySurface: '#151828',
};
const F = {
  display: '"Cabinet Grotesk", "Inter", system-ui, sans-serif',
  body: '"IBM Plex Sans", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

// ─────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────
function SaffronButton({ children, to = '/signup', testid, size = 'md', onClick }) {
  const sizes = { sm: 'px-5 py-2.5 text-sm', md: 'px-7 py-3.5 text-base', lg: 'px-8 py-4 text-lg' };
  const Cmp = to ? Link : 'button';
  return (
    <Cmp
      to={to}
      data-testid={testid}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.98] ${sizes[size]}`}
      style={{ background: C.saffron, fontFamily: F.display, boxShadow: '0 6px 24px -6px rgba(217,93,57,0.55)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.saffronHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.saffron)}
    >
      {children}
      <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
    </Cmp>
  );
}
function GhostButton({ children, href, testid, icon: Icon = Play }) {
  return (
    <a
      href={href || '#features'}
      data-testid={testid}
      className="inline-flex items-center gap-2 rounded-full border px-6 py-3.5 font-medium bg-white hover:border-[color:var(--ink)] transition-colors"
      style={{ borderColor: C.border, color: C.ink, fontFamily: F.body }}
    >
      <Icon className="w-4 h-4" strokeWidth={2.5} />
      {children}
    </a>
  );
}
function MonoChip({ children, tone = 'ink' }) {
  const pal = {
    ink: { bg: C.surface, fg: C.ink2 },
    emerald: { bg: C.emeraldTint, fg: C.emerald },
    saffron: { bg: C.saffronTint, fg: C.saffron },
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest"
      style={{ background: pal.bg, color: pal.fg, fontFamily: F.mono }}>
      {children}
    </span>
  );
}
function PulseDot({ color = C.emerald, size = 8 }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full opacity-60 animate-ping" style={{ background: color }} />
      <span className="relative rounded-full" style={{ width: size, height: size, background: color }} />
    </span>
  );
}
function SectionEyebrow({ tone = 'saffron', children }) {
  return <MonoChip tone={tone}>{children}</MonoChip>;
}
function SectionHeading({ children }) {
  return (
    <h2 className="mt-4 text-4xl md:text-5xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
      {children}
    </h2>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Grain background layer
// ─────────────────────────────────────────────────────────────────────
const GRAIN_SVG = 'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence baseFrequency=%220.9%22 stitchTiles=%22stitch%22/></filter><rect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22 opacity=%220.8%22/></svg>")';
function Grain({ opacity = 0.04 }) {
  return <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: GRAIN_SVG, opacity, mixBlendMode: 'multiply' }} />;
}

// ─────────────────────────────────────────────────────────────────────
// 1. Header
// ─────────────────────────────────────────────────────────────────────
function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header
      className={`sticky top-0 z-40 transition-shadow ${scrolled ? 'shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_-20px_rgba(0,0,0,0.15)]' : ''}`}
      style={{ background: C.bone, backdropFilter: scrolled ? 'saturate(180%) blur(6px)' : 'none' }}
      data-testid="landing-header"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2" data-testid="landing-logo">
          <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center font-black" style={{ background: C.saffron, color: 'white', fontFamily: F.display }}>A</span>
          <span className="text-xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.03em' }}>audinexa</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 mx-auto text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
          <a href="#features" className="hover:text-[color:var(--ink)] transition-colors" data-testid="nav-features">Features</a>
          <a href="#diagnostics" className="hover:text-[color:var(--ink)] transition-colors" data-testid="nav-diagnostics">Diagnostics</a>
          <a href="#pricing" className="hover:text-[color:var(--ink)] transition-colors" data-testid="nav-pricing">Pricing</a>
          <a href="#faq" className="hover:text-[color:var(--ink)] transition-colors" data-testid="nav-faq">FAQ</a>
        </nav>
        <Link to="/login" className="text-sm hidden sm:inline hover:underline" style={{ fontFamily: F.body, color: C.ink }} data-testid="nav-signin">Sign in</Link>
        <SaffronButton size="sm" testid="header-start-trial">Start 30-day trial</SaffronButton>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. Hero — Variant A + merged copy
// ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative overflow-hidden" style={{ background: C.bone }} data-testid="landing-hero">
      <Grain />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 py-16 md:py-24 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-16 items-center">
        <div>
          <MonoChip tone="emerald"><PulseDot />BUILT FOR INDIAN AUDIOLOGY</MonoChip>
          <h1 className="mt-6 text-5xl md:text-7xl font-extrabold leading-[0.95]"
            style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.045em' }}>
            The Audiology<br />
            Clinic OS built<br />
            for <span style={{ color: C.saffron }}>India</span>.
          </h1>
          <p className="mt-8 text-lg text-[color:var(--ink2)] max-w-xl leading-relaxed" style={{ fontFamily: F.body, color: C.ink2 }}>
            Diagnostics · Hearing-aid sales · Repair · Referrals · GST billing —
            <strong style={{ color: C.ink }}> one DPDPA-compliant system </strong>
            that replaces the six tabs of Excel, three WhatsApp groups, and one PDF binder your clinic runs on today.
          </p>
          <p className="mt-3 text-sm max-w-xl" style={{ fontFamily: F.body, color: C.ink2 }}>
            Built by audiologists, hands-on with 30+ Indian clinics.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <SaffronButton size="lg" testid="hero-start-trial">Start 30-day trial</SaffronButton>
            <GhostButton href="#features" testid="hero-explore-features">Explore features</GhostButton>
          </div>
          <div className="mt-6 flex items-center gap-2 text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
            <ShieldCheck className="w-4 h-4" style={{ color: C.emerald }} />
            No credit card · full Premium access · cancel anytime
          </div>
        </div>

        {/* Asymmetric card cluster */}
        <div className="relative h-[560px] hidden lg:block">
          {/* Card 1 — Audiogram */}
          <div className="absolute top-0 right-4 w-[85%] rounded-2xl border shadow-2xl bg-white p-5 rotate-[-2deg] z-30" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>Session · 2026-07-25</p>
                <p className="font-bold mt-0.5" style={{ fontFamily: F.display, color: C.ink }}>Priya Nair · MRD-4210</p>
              </div>
              <MonoChip tone="emerald">SIGNED</MonoChip>
            </div>
            <div className="mt-3 h-40"><AudiogramIllustration /></div>
          </div>

          {/* Card 2 — GST Invoice */}
          <div className="absolute bottom-14 left-0 w-[70%] rounded-2xl border shadow-xl bg-white p-5 rotate-[3deg] z-20" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between">
              <MonoChip>GST INVOICE</MonoChip>
              <span className="text-xs font-semibold" style={{ color: C.emerald }}>Paid ✓</span>
            </div>
            <p className="text-3xl font-extrabold mt-3" style={{ fontFamily: F.display, color: C.ink }}>₹78,400</p>
            <p className="text-xs mt-1" style={{ color: C.ink2, fontFamily: F.body }}>Signia Pure Charge&amp;Go 7AX · Pair · 18% GST · ITC</p>
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: C.border }}>
              <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.ink2 }}>INV-2026-0821</span>
              <span className="text-xs font-semibold" style={{ color: C.saffron }}>Auto-filed</span>
            </div>
          </div>

          {/* Card 3 — Live counter (dark) */}
          <div className="absolute bottom-0 right-12 w-[52%] rounded-2xl shadow-2xl p-5 rotate-[-1deg] z-10 text-white" style={{ background: C.navy }}>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: '#34D399' }}>
              <PulseDot color="#34D399" /> Today, real-time
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-3xl font-extrabold" style={{ fontFamily: F.display }}>12</p>
                <p className="text-[11px] text-white/60" style={{ fontFamily: F.body }}>Hearing tests</p>
              </div>
              <div>
                <p className="text-3xl font-extrabold" style={{ fontFamily: F.display }}>7</p>
                <p className="text-[11px] text-white/60" style={{ fontFamily: F.body }}>HA sales</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3. Live proof band
// ─────────────────────────────────────────────────────────────────────
function LiveProofBand({ stats }) {
  return (
    <section className="relative border-y" style={{ background: C.surface, borderColor: C.border }} data-testid="landing-live-proof">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-3 text-center">
        <div className="flex items-center gap-3">
          <PulseDot />
          <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink }}>LIVE</span>
          <span className="text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
            {stats.clinics} clinics · {stats.tests_today} hearing tests today · {stats.aids_sold_today} hearing aids sold
          </span>
        </div>
        <div className="text-[11px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>
          DPDPA · GST · Audit-logged
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4. Feature Bento
// ─────────────────────────────────────────────────────────────────────
function BentoCard({ span, children, className = '', testid }) {
  return (
    <div
      className={`relative rounded-2xl border overflow-hidden ${span} ${className}`}
      style={{ background: 'white', borderColor: C.border, boxShadow: '0 1px 0 rgba(0,0,0,0.03), 0 20px 40px -30px rgba(0,0,0,0.15)' }}
      data-testid={testid}
    >
      {children}
    </div>
  );
}
function FeatureBento() {
  return (
    <section id="features" className="relative py-24" style={{ background: C.bone }} data-testid="landing-features">
      <Grain />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8">
        <div className="max-w-3xl">
          <SectionEyebrow>THE STACK</SectionEyebrow>
          <SectionHeading>Everything your clinic runs on — <span style={{ color: C.saffron }}>in one system.</span></SectionHeading>
          <p className="mt-4 text-lg" style={{ fontFamily: F.body, color: C.ink2 }}>
            Fourteen modules. Zero context-switching. Every touchpoint from the receptionist&rsquo;s desk
            to the audiologist&rsquo;s report is stitched together, so nothing slips through.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Big Patient Front-Desk card — spans 8 cols × 2 rows */}
          <BentoCard span="md:col-span-8 md:row-span-2" testid="feature-front-desk">
            <div className="p-8 flex flex-col h-full">
              <div className="flex items-center gap-3">
                <Users className="w-6 h-6" style={{ color: C.saffron }} />
                <MonoChip>MODULE M01</MonoChip>
              </div>
              <h3 className="mt-5 text-3xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.03em' }}>Front Desk & WhatsApp queue</h3>
              <p className="mt-3 max-w-md" style={{ fontFamily: F.body, color: C.ink2 }}>
                MRD-numbered patients, digital tokens, appointment slots, walk-in triage,
                WhatsApp appointment reminders. Your receptionist stops chasing paper.
              </p>
              {/* Mini queue mockup */}
              <div className="mt-6 rounded-xl border p-4" style={{ borderColor: C.border, background: C.surface }}>
                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.ink2 }}>
                  <span>Queue · 10:14 AM</span>
                  <span style={{ color: C.emerald }}>● 3 waiting</span>
                </div>
                <div className="mt-3 space-y-2">
                  {[
                    { name: 'Priya Nair', mrd: 'MRD-4210', status: 'In consult', tone: C.saffron },
                    { name: 'Rakesh Menon', mrd: 'MRD-4211', status: 'Waiting · 8 min', tone: C.ink2 },
                    { name: 'Sneha Bhat', mrd: 'MRD-4212', status: 'Waiting · 14 min', tone: C.ink2 },
                  ].map((r) => (
                    <div key={r.mrd} className="flex items-center justify-between text-sm rounded-lg bg-white px-3 py-2 border" style={{ borderColor: C.border, fontFamily: F.body }}>
                      <div>
                        <span className="font-semibold" style={{ color: C.ink }}>{r.name}</span>
                        <span className="ml-2 text-xs" style={{ color: C.ink2 }}>{r.mrd}</span>
                      </div>
                      <span className="text-xs font-semibold" style={{ color: r.tone }}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </BentoCard>

          {/* GST-Ready billing */}
          <BentoCard span="md:col-span-4" testid="feature-gst">
            <div className="p-7">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5" style={{ color: C.saffron }} />
                <MonoChip tone="saffron">GST · MADE FOR INDIA</MonoChip>
              </div>
              <h3 className="mt-4 text-xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.02em' }}>Invoicing that files itself</h3>
              <p className="mt-2 text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
                Auto-computed CGST/SGST/IGST, HSN codes, e-invoice-ready. Direct handoff to your CA at month-end.
              </p>
              <div className="mt-4 rounded-lg border p-3" style={{ borderColor: C.border, background: 'white' }}>
                <p className="text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.ink2 }}>THIS MONTH</p>
                <p className="text-2xl font-extrabold" style={{ fontFamily: F.display, color: C.ink }}>₹4,52,300</p>
                <p className="text-xs" style={{ fontFamily: F.body, color: C.emerald }}>47 invoices · fully reconciled</p>
              </div>
            </div>
          </BentoCard>

          {/* Hearing-aid sales */}
          <BentoCard span="md:col-span-4" testid="feature-hearing-aid">
            <div className="p-7">
              <div className="flex items-center gap-2">
                <Headphones className="w-5 h-5" style={{ color: C.saffron }} />
                <MonoChip>MODULE M03</MonoChip>
              </div>
              <h3 className="mt-4 text-xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.02em' }}>Hearing-aid sales pipeline</h3>
              <p className="mt-2 text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
                Quote → trial → sale → warranty. Serialised inventory. Trade-ins.
                Never lose track of which pair went where.
              </p>
              <div className="mt-4 flex items-center gap-1.5">
                {['Quote', 'Trial', 'Sold', 'Warranty'].map((s, i) => (
                  <React.Fragment key={s}>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-md" style={{ background: i < 2 ? C.saffron : C.surface, color: i < 2 ? 'white' : C.ink2, fontFamily: F.mono }}>{s}</span>
                    {i < 3 && <span className="text-[10px]" style={{ color: C.border }}>—</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </BentoCard>

          {/* 13-state repair — full width across bottom */}
          <BentoCard span="md:col-span-12" testid="feature-repair">
            <div className="p-7">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-5 h-5" style={{ color: C.saffron }} />
                    <MonoChip>MODULE M04 · REPAIR PIPELINE</MonoChip>
                  </div>
                  <h3 className="mt-3 text-2xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.025em' }}>13-state repair workflow — from intake to delivered</h3>
                  <p className="mt-2 max-w-2xl text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
                    Courier tracking, vendor RMA, loaner allocation, customer approvals, SLA reminders.
                    Every stalled ticket surfaces on the owner&rsquo;s dashboard.
                  </p>
                </div>
                <span className="text-xs font-semibold self-start" style={{ color: C.emerald, fontFamily: F.mono }}>● 42 active tickets</span>
              </div>
              {/* Pipeline visual */}
              <div className="mt-6 overflow-x-auto">
                <div className="flex items-center gap-1 min-w-max">
                  {['Intake', 'Diagnosed', 'Quoted', 'Approved', 'Shipped', 'Vendor RMA', 'Received', 'QA', 'Ready', 'Delivered'].map((s, i, arr) => (
                    <React.Fragment key={s}>
                      <div className="flex flex-col items-center min-w-[86px]">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold"
                          style={{ background: i < 5 ? C.saffron : C.surface, color: i < 5 ? 'white' : C.ink2, fontFamily: F.mono }}>{i + 1}</div>
                        <span className="mt-1.5 text-[10px] uppercase tracking-widest text-center" style={{ fontFamily: F.mono, color: C.ink2 }}>{s}</span>
                      </div>
                      {i < arr.length - 1 && (
                        <div className="flex-1 h-px min-w-[16px]" style={{ background: i < 4 ? C.saffron : C.border }} />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </BentoCard>

          {/* 4 supporting modules — 3-col each */}
          {[
            { icon: LineChart, title: 'Owner Analytics', desc: 'Revenue funnels, device mix, diagnosis trends. Multi-branch rollups.', tag: 'M05', tier: 'Premium' },
            { icon: ShieldCheck, title: 'AMC & Subscriptions', desc: 'Auto-renewal, expiry alerts, per-device warranty ledgers.', tag: 'M06', tier: 'Standard' },
            { icon: HeartPulse, title: 'Patient Portal', desc: 'Patients view reports, invoices, book follow-ups. Full DPDPA data export.', tag: 'M07', tier: 'Standard' },
            { icon: Handshake, title: 'Referral Partners', desc: 'ENT doctor portal — track outcomes, earn commissions, weekly payouts.', tag: 'M08', tier: 'Premium' },
          ].map((m) => (
            <BentoCard key={m.tag} span="md:col-span-3" testid={`feature-${m.tag.toLowerCase()}`}>
              <div className="p-6">
                <div className="flex items-center gap-2">
                  <m.icon className="w-5 h-5" style={{ color: C.saffron }} />
                  <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>{m.tag}</span>
                </div>
                <h3 className="mt-4 text-lg font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.02em' }}>{m.title}</h3>
                <p className="mt-2 text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>{m.desc}</p>
                <p className="mt-4 text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.saffron }}>{m.tier}+</p>
              </div>
            </BentoCard>
          ))}
        </div>

        {/* Coming soon strip */}
        <div className="mt-8 rounded-xl border p-5 flex items-center justify-between flex-wrap gap-4" style={{ borderColor: C.border, background: C.surface }}>
          <div className="flex items-center gap-3">
            <MonoChip tone="saffron"><Sparkles className="w-3 h-3" /> ON THE ROADMAP</MonoChip>
            <span className="text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
              Cochlear Implants · Rehabilitation · Tele-Audiology · Insurance Claims
            </span>
          </div>
          <a href="#pricing" className="text-sm font-semibold hover:underline" style={{ color: C.saffron, fontFamily: F.body }}>Included in Premium →</a>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 5. Diagnostics Deep-Dive (dark)
// ─────────────────────────────────────────────────────────────────────
function DiagnosticsDeepDive() {
  const panels = [
    { name: 'Pure Tone', desc: 'AC · BC · masking · extended freq' },
    { name: 'Impedance', desc: 'Tympanometry · reflex · decay' },
    { name: 'Speech', desc: 'SRT · WRS · aided · soundfield' },
    { name: 'OAE', desc: 'DPOAE · TEOAE' },
    { name: 'ABR / ASSR', desc: 'Click · tone-burst · thresholds' },
    { name: 'Pediatric', desc: 'VRA · CPA · age-appropriate protocols' },
  ];
  return (
    <section id="diagnostics" className="relative py-24 text-white" style={{ background: C.navy }} data-testid="landing-diagnostics">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 20% 30%, rgba(217,93,57,0.18), transparent 60%)' }} />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
        <div>
          <MonoChip tone="saffron">DIAGNOSTICS DEEP-DIVE</MonoChip>
          <h2 className="mt-4 text-4xl md:text-5xl font-extrabold" style={{ fontFamily: F.display, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
            A full audiology suite —<br />built like clinical dark-room software.
          </h2>
          <p className="mt-6 text-lg text-white/70" style={{ fontFamily: F.body }}>
            Every diagnostic protocol an ISHA-accredited audiologist runs, with tamper-proof signatures,
            multi-visit history, and a report generator that your patients&rsquo; consulting ENTs can read at a glance.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            {panels.map((p) => (
              <div key={p.name} className="rounded-lg border p-4" style={{ borderColor: 'rgba(255,255,255,0.12)', background: C.navySurface }}>
                <p className="text-sm font-bold" style={{ fontFamily: F.display }}>{p.name}</p>
                <p className="text-xs mt-1 text-white/60" style={{ fontFamily: F.body }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border p-6" style={{ borderColor: 'rgba(255,255,255,0.12)', background: C.navySurface }}>
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest font-semibold text-white/70" style={{ fontFamily: F.mono }}>Pure Tone Audiometry</p>
              <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#34D399', fontFamily: F.mono }}>● SIGNED</span>
            </div>
            <p className="mt-2 text-xl font-extrabold" style={{ fontFamily: F.display }}>Priya Nair · 34F · MRD-4210</p>
            <div className="mt-4 h-56 rounded-lg p-2" style={{ background: '#0B0D17' }}>
              <AudiogramIllustration />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/50" style={{ fontFamily: F.mono }}>R ear · avg</p>
                <p className="text-2xl font-extrabold" style={{ fontFamily: F.display }}>42 dB</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/50" style={{ fontFamily: F.mono }}>L ear · avg</p>
                <p className="text-2xl font-extrabold" style={{ fontFamily: F.display }}>38 dB</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border p-6" style={{ borderColor: 'rgba(255,255,255,0.12)', background: C.navySurface }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-white/70" style={{ fontFamily: F.mono }}>Tympanometry</p>
            <div className="mt-3 h-32">
              <TympanogramIllustration />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 6. Spreadsheet vs AUDINEXA comparison
// ─────────────────────────────────────────────────────────────────────
function ComparisonTable() {
  const rows = [
    ['Patient records', 'Excel · WhatsApp DMs', 'Structured MRD + full history'],
    ['Audiograms', 'Paper printout · scanned PDF', 'Tamper-proof digital audiogram + signed report'],
    ['Hearing-aid inventory', 'Third Excel tab', 'Serialised · linked to sale · warranty tracked'],
    ['GST invoicing', 'Manual · Tally later', 'One-click GST invoice · e-invoice ready'],
    ['Appointment reminders', 'Reception makes calls', 'Automated WhatsApp reminders'],
    ['Owner insights', '"Ask the receptionist"', 'Live revenue / conversion / device-mix dashboard'],
    ['Compliance', 'None', 'DPDPA-audited · 7-year retention'],
  ];
  return (
    <section className="relative py-24" style={{ background: C.surface }} data-testid="landing-comparison">
      <Grain opacity={0.03} />
      <div className="relative max-w-6xl mx-auto px-6 md:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <SectionEyebrow tone="saffron">WHAT YOU RUN ON TODAY</SectionEyebrow>
          <SectionHeading>Your clinic&rsquo;s <span style={{ color: C.saffron }}>real</span> competitor isn&rsquo;t another SaaS.</SectionHeading>
          <p className="mt-4" style={{ fontFamily: F.body, color: C.ink2 }}>
            It&rsquo;s a spreadsheet, a WhatsApp group, and a shoebox of paper. Here&rsquo;s the swap.
          </p>
        </div>

        <div className="mt-12 rounded-2xl overflow-hidden border" style={{ borderColor: C.border, background: 'white' }}>
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1.4fr_1.4fr] text-sm">
            <div className="hidden md:block px-6 py-4" style={{ background: C.bone, fontFamily: F.mono, fontSize: 11, letterSpacing: '0.1em', color: C.ink2 }}>
              <span className="uppercase font-semibold">Job</span>
            </div>
            <div className="px-6 py-4 border-l" style={{ borderColor: C.border, background: '#FEF2F2', fontFamily: F.mono, fontSize: 11, letterSpacing: '0.1em', color: '#B91C1C' }}>
              <span className="uppercase font-semibold">Spreadsheet stack</span>
            </div>
            <div className="px-6 py-4 border-l" style={{ borderColor: C.border, background: C.emeraldTint, fontFamily: F.mono, fontSize: 11, letterSpacing: '0.1em', color: C.emerald }}>
              <span className="uppercase font-semibold">AUDINEXA</span>
            </div>
          </div>
          {rows.map((r, i) => (
            <div key={r[0]} className="grid grid-cols-1 md:grid-cols-[1.1fr_1.4fr_1.4fr] text-sm border-t" style={{ borderColor: C.border }}>
              <div className="px-6 py-4 font-semibold" style={{ fontFamily: F.display, color: C.ink }}>{r[0]}</div>
              <div className="px-6 py-4 border-l flex items-start gap-2" style={{ borderColor: C.border, background: i % 2 ? '#FFF7F7' : 'transparent', fontFamily: F.body, color: '#7F1D1D' }}>
                <X className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                <span>{r[1]}</span>
              </div>
              <div className="px-6 py-4 border-l flex items-start gap-2" style={{ borderColor: C.border, background: i % 2 ? '#F0FDF4' : 'transparent', fontFamily: F.body, color: C.ink }}>
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} style={{ color: C.emerald }} />
                <span>{r[2]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 7. Testimonials + Founder Letter
// ─────────────────────────────────────────────────────────────────────
function TestimonialsAndFounder() {
  const quotes = [
    {
      quote: 'First month with AUDINEXA we invoiced 27% more — the software found revenue our reception was losing to missed follow-ups.',
      who: 'Dr. Rajesh Iyer', where: 'The Sound Clinic, Bengaluru',
    },
    {
      quote: 'Finally an audiology tool that speaks GST, HSN codes, and DPDPA — instead of Californian workflows. Our CA hasn&rsquo;t called with a question in three months.',
      who: 'Meera Rao', where: 'Clarity ENT, Hyderabad',
    },
    {
      quote: 'The repair pipeline saved us from losing a ₹85k hearing aid at the courier. I get an alert the day an SLA slips.',
      who: 'Sanjay Kapoor', where: 'Kapoor Hearing, Delhi',
    },
  ];
  return (
    <section className="relative py-24" style={{ background: C.bone }} data-testid="landing-testimonials">
      <Grain />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-16">
        <div>
          <SectionEyebrow tone="emerald"><PulseDot />TRUSTED BY INDIAN AUDIOLOGISTS</SectionEyebrow>
          <SectionHeading>Real quotes.<br />Real revenue lift.</SectionHeading>
          <div className="mt-10 space-y-6">
            {quotes.map((q) => (
              <figure key={q.who} className="rounded-2xl border p-6" style={{ borderColor: C.border, background: 'white' }}>
                <blockquote className="text-lg leading-relaxed" style={{ fontFamily: F.body, color: C.ink }}>
                  &ldquo;{q.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-4 flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full flex items-center justify-center font-bold" style={{ background: C.saffronTint, color: C.saffron, fontFamily: F.display }}>
                    {q.who.split(' ').map((w) => w[0]).slice(-2).join('')}
                  </span>
                  <div>
                    <p className="font-semibold text-sm" style={{ fontFamily: F.display, color: C.ink }}>{q.who}</p>
                    <p className="text-xs" style={{ fontFamily: F.body, color: C.ink2 }}>{q.where}</p>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>

        {/* Founder letter */}
        <div className="lg:sticky lg:top-24 self-start">
          <div className="rounded-2xl p-8 border" style={{ borderColor: C.border, background: C.surface }}>
            <MonoChip tone="saffron">A NOTE FROM THE FOUNDER</MonoChip>
            <p className="mt-6 leading-relaxed" style={{ fontFamily: F.body, color: C.ink }}>
              I&rsquo;ve spent 12 years in ENT clinics across Bengaluru, Chennai, and Kochi.
              Every audiologist I met was brilliant at their craft and drowning in Excel.
            </p>
            <p className="mt-4 leading-relaxed" style={{ fontFamily: F.body, color: C.ink }}>
              AUDINEXA is the tool I wish I&rsquo;d built for them ten years ago. Everything —
              from the DPDPA data model to the GST invoice format — is designed for
              <strong> the Indian clinic operator</strong>, not for a Californian startup demo.
            </p>
            <p className="mt-4 leading-relaxed" style={{ fontFamily: F.body, color: C.ink }}>
              If you&rsquo;re a solo audiologist, a chain, or an ENT-owned clinic — start the trial today.
              If it doesn&rsquo;t save you time in 30 days, don&rsquo;t pay.
            </p>
            <p className="mt-6 text-2xl" style={{ fontFamily: '"Kalam", "Cabinet Grotesk", cursive', color: C.saffron }}>— The AUDINEXA team</p>
            <p className="text-xs mt-1" style={{ fontFamily: F.body, color: C.ink2 }}>Founded 2026 · Bengaluru</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 8. Pricing
// ─────────────────────────────────────────────────────────────────────
function Pricing({ tiers }) {
  const order = ['BASIC', 'STANDARD', 'PREMIUM'];
  const sorted = useMemo(() => {
    if (!tiers?.length) return [];
    return [...tiers]
      .filter((t) => order.includes(t.code || t.tier))
      .sort((a, b) => order.indexOf(a.code || a.tier) - order.indexOf(b.code || b.tier));
  }, [tiers]);

  // Friendly feature strings by tier code
  const featureCopy = {
    BASIC: [
      'Front-desk + patient MRD',
      'Full diagnostic audiometry suite',
      'Digital audiogram + signed reports',
      'Queue & token management',
      'Basic reporting',
    ],
    STANDARD: [
      'Everything in Basic',
      'Hearing-aid sales pipeline',
      'GST-ready invoicing',
      'AMC & subscription tracking',
      'Patient portal',
      'WhatsApp appointment reminders',
    ],
    PREMIUM: [
      'Everything in Standard',
      '13-state repair workflow',
      'Owner analytics dashboard',
      'ENT referral partner portal',
      'Weekly payout automation',
      'Multi-branch rollups',
      'Priority support · onboarding call',
    ],
  };
  const tierDesc = {
    BASIC: 'Front-desk + diagnostics for a solo audiologist.',
    STANDARD: 'Adds HA sales, AMC, GST billing, patient portal.',
    PREMIUM: 'Everything · repair · analytics · referral partners · roadmap modules.',
  };

  return (
    <section id="pricing" className="relative py-24" style={{ background: C.bone }} data-testid="landing-pricing">
      <Grain />
      <div className="relative max-w-6xl mx-auto px-6 md:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <SectionEyebrow>PRICING</SectionEyebrow>
          <SectionHeading>Simple pricing.<br />Everything is <span style={{ color: C.saffron }}>Premium</span> for 30 days.</SectionHeading>
          <p className="mt-4" style={{ fontFamily: F.body, color: C.ink2 }}>
            No credit card required. No sales call to start. Upgrade only after you&rsquo;ve seen the ROI.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
          {(sorted.length ? sorted : order.map((code) => ({ code, prices: {} }))).map((t) => {
            const code = t.code || t.tier || 'BASIC';
            const isPremium = code === 'PREMIUM';
            const monthly = t.prices?.monthly || 0;
            const annual = t.prices?.annual;
            return (
              <div
                key={code}
                className="relative rounded-2xl border p-8 flex flex-col"
                style={{
                  borderColor: isPremium ? C.saffron : C.border,
                  background: 'white',
                  boxShadow: isPremium ? `0 24px 60px -30px ${C.saffron}` : '0 1px 0 rgba(0,0,0,0.03)',
                }}
                data-testid={`pricing-card-${code.toLowerCase()}`}
              >
                {isPremium && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[10px] font-bold uppercase tracking-widest" style={{ background: C.saffron, color: 'white', fontFamily: F.mono }}>
                    MOST POPULAR
                  </div>
                )}
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>{code}</p>
                <p className="mt-3 text-4xl font-extrabold" style={{ fontFamily: F.display, color: C.ink }}>
                  {monthly > 0 ? `₹${monthly.toLocaleString('en-IN')}` : 'Free'}
                  {monthly > 0 && <span className="text-base font-medium" style={{ color: C.ink2 }}>/mo</span>}
                </p>
                {annual > 0 && (
                  <p className="mt-1 text-xs" style={{ fontFamily: F.body, color: C.emerald }}>
                    Or ₹{annual.toLocaleString('en-IN')}/yr — save {Math.round((1 - annual / (monthly * 12)) * 100)}%
                  </p>
                )}
                <p className="mt-3 text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>{tierDesc[code]}</p>
                <ul className="mt-6 space-y-2 flex-1">
                  {(featureCopy[code] || []).map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" style={{ fontFamily: F.body, color: C.ink }}>
                      <Check className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2.5} style={{ color: C.emerald }} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <SaffronButton to="/signup" testid={`pricing-cta-${code.toLowerCase()}`}>Start 30-day trial</SaffronButton>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm" style={{ fontFamily: F.body, color: C.ink2 }}>
          <Zap className="inline w-4 h-4 mr-1" style={{ color: C.saffron }} />
          Every new signup automatically gets 30 days of Premium — regardless of the plan you eventually pick.
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 9. FAQ
// ─────────────────────────────────────────────────────────────────────
function FaqItem({ q, a, idx }) {
  const [open, setOpen] = useState(idx === 0);
  return (
    <div className="border-b" style={{ borderColor: C.border }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 py-6 text-left"
        data-testid={`faq-toggle-${idx}`}
      >
        <span className="text-lg font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.02em' }}>{q}</span>
        <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.saffron }} />
      </button>
      {open && (
        <div className="pb-6 text-[15px] leading-relaxed max-w-3xl" style={{ fontFamily: F.body, color: C.ink2 }}>{a}</div>
      )}
    </div>
  );
}
function FAQ() {
  const [tab, setTab] = useState('general');

  // Support deep-links: /#faq-clinicians opens the clinician tab AND scrolls
  // to the section so Dr. Ravindra can paste "audinexa.com/#faq-clinicians"
  // in WhatsApp replies and land the reader right on the doctor Q&A.
  useEffect(() => {
    const applyHash = () => {
      const h = (window.location.hash || '').toLowerCase();
      if (h.includes('clinician') || h.includes('doctor')) {
        setTab('clinicians');
        // Give React a beat to render the switched tab, then jump straight
        // to the section (instant, not smooth — the visitor already asked
        // for this exact section by URL).
        setTimeout(() => {
          const el = document.getElementById('faq');
          if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 200);
      } else if (h === '#faq') {
        setTab('general');
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const generalItems = [
    { q: 'What&rsquo;s in the free 30-day trial?', a: 'Everything. Full Premium access — diagnostics, hearing-aid sales, repair, analytics, referral partners. No card required. After 30 days your clinic automatically moves to the Basic plan (still free) unless you upgrade.' },
    { q: 'How does AUDINEXA handle DPDPA?', a: 'Every patient record is encrypted at rest, access-audited, and comes with a one-click data-export bundle for compliance requests. We&rsquo;re DPDPA-ready out of the box.' },
    { q: 'Is invoicing GST-compliant?', a: 'Yes — CGST / SGST / IGST auto-computed, HSN codes for every device SKU, e-invoice format ready for your CA. Monthly summary CSV exportable in one click.' },
    { q: 'Can I import my existing patient data?', a: 'Yes — CSV import supports patients, appointments, and inventory. For clinics migrating from Tally, Google Sheets or NoahLink Wireless, we run a free migration session in your first week.' },
    { q: 'What about multiple branches?', a: 'Yes — every plan supports multi-branch. Owners see rolled-up analytics; each branch has its own MRD sequence, invoice numbering, and staff scoping.' },
    { q: 'How do I cancel?', a: 'One click in Settings → Billing. No calls, no email loops. You keep read-only access to your data for 90 days after cancellation, and can export everything as a CSV bundle.' },
  ];

  const clinicianItems = [
    { q: 'Is AUDINEXA PC-only, or does it work on mobile and tablet?', a: 'It’s a fully responsive web app that works on desktops, laptops, tablets and mobile phones through any modern browser (Chrome, Safari, Edge, Firefox). No app-store install required. The mobile layout has a dedicated bottom navigation bar so audiologists can do sessions, quick sales and appointments right from an iPad at the chairside.' },
    { q: 'Is there an offline version for clinics without continuous internet?', a: 'Yes — AUDINEXA has a built-in offline mode. Recently viewed patient records, invoices and reports stay accessible from an encrypted local cache. New writes (audiograms, invoices, appointments) are queued in a local outbox and sync automatically once the connection returns. Power cuts and Wi-Fi drops never block a clinic visit.' },
    { q: 'How is patient data stored and protected?', a: 'Data lives on enterprise MongoDB hosted on secure Indian cloud infrastructure. The platform is DPDPA-compliant. Each clinic has strict data isolation — one clinic can never see or query another clinic’s data (row-level tenant separation enforced server-side on every request). Every access, edit and delete is written to a full audit trail with user, timestamp and IP.' },
    { q: 'How secure is the software against data loss, unauthorized access and cyber threats?', a: 'HTTPS-only end-to-end (Cloudflare WAF at the edge). Passwords hashed with bcrypt (never stored in plain text). 7-role RBAC — Owner, Audiologist, Front Desk, Service Technician, Read-only, etc. — so staff only see what they need. Session-level revocation lets the owner log out any staff device instantly. Optional 2-Factor Authentication for owner accounts. Rate limiting + brute-force protection on login.' },
    { q: 'Is data encrypted during storage and transmission?', a: 'In transit: TLS 1.3 (HTTPS) on every request. At rest: MongoDB encryption + JWT session tokens signed with a 256-bit secret. The offline cache in your browser uses AES-GCM 256-bit encryption with a fresh 12-byte IV per record — banking-grade.' },
    { q: 'Does the software provide automatic data backup and recovery?', a: 'Yes — automated daily backups at 03:00 IST to a separate secure region. Point-in-time restore available on request through our support channel. Nothing you save is ever more than 24 hours away from a warm copy.' },
    { q: 'Can I export or retrieve my patient data if I switch to another system later?', a: 'Absolutely — no vendor lock-in. AUDINEXA has a built-in Data Export module that lets you download your full patient roster (CSV), all audiograms + diagnostic reports (PDF), invoices + payment history (CSV + PDF), hearing-aid sales, fittings, service tickets, AMC contracts (CSV), and a complete data package as a signed ZIP. One click, any time, no ticket required.' },
    { q: 'Is there a multi-user facility for clinics with multiple Audiologists / SLPs?', a: 'Yes — unlimited users on Standard and Premium tiers with granular 7-role RBAC and multi-branch support. You can run Delhi + Bangalore + Chennai branches under one clinic account with a single dashboard rollup and per-branch analytics.' },
    { q: 'Does it support cloud-based access from different locations?', a: 'Yes — 100% cloud-native. Log in from any browser at home, in the OP chamber or on the go. Your data follows you, not the device. All you need is a browser and an internet connection (offline mode covers the gaps).' },
    { q: 'What is the pricing? One-time or subscription?', a: 'Simple subscription model, all-inclusive, no hidden fees (GST extra). BASIC ₹499 / month (₹4,990 annual — 2 months free) for solo practices. STANDARD ₹999 / month (₹9,990 annual) for 2-5 audiologists, single branch. PREMIUM ₹1,499 / month (₹14,990 annual) for multi-branch, unlimited users, full HA sales + service + analytics. Every new clinic gets a 30-day PREMIUM trial with no credit card required. Payments via Razorpay (UPI / cards / net-banking).' },
  ];

  const items = tab === 'clinicians' ? clinicianItems : generalItems;

  return (
    <section id="faq" className="relative py-24" style={{ background: C.bone }} data-testid="landing-faq">
      <div className="relative max-w-4xl mx-auto px-6 md:px-8">
        <div className="text-center">
          <SectionEyebrow>QUESTIONS</SectionEyebrow>
          <SectionHeading>Frequently asked.</SectionHeading>
        </div>

        {/* Tab switcher */}
        <div className="mt-10 flex items-center justify-center gap-2" data-testid="faq-tabs">
          <FaqTab active={tab === 'general'} onClick={() => setTab('general')} testid="faq-tab-general">
            General
          </FaqTab>
          <FaqTab active={tab === 'clinicians'} onClick={() => setTab('clinicians')} testid="faq-tab-clinicians">
            For Clinicians
          </FaqTab>
        </div>

        <div className="mt-8" key={tab /* remount so first item opens fresh */}>
          {items.map((it, i) => <FaqItem key={`${tab}-${i}`} q={it.q} a={it.a} idx={i} />)}
        </div>
      </div>
    </section>
  );
}

function FaqTab({ active, onClick, children, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="px-4 py-2 text-sm rounded-full transition-all"
      style={{
        fontFamily: F.mono,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: active ? C.saffron : 'transparent',
        color: active ? 'white' : C.ink2,
        border: active ? `1px solid ${C.saffron}` : `1px solid ${C.border}`,
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 10. Footer
// ─────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="relative pt-24 pb-12" style={{ background: C.navy, color: 'white' }} data-testid="landing-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <p className="text-[8vw] md:text-[7rem] font-extrabold leading-[0.9] max-w-5xl" style={{ fontFamily: F.display, letterSpacing: '-0.04em' }}>
          Let&rsquo;s take your<br />clinic <span style={{ color: C.saffron }}>digital.</span>
        </p>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <SaffronButton size="lg" testid="footer-start-trial">Start 30-day trial</SaffronButton>
          <a href="mailto:hello@audinexa.com" className="text-white/80 hover:text-white text-sm underline" style={{ fontFamily: F.body }} data-testid="footer-contact-sales">Or talk to sales →</a>
        </div>

        <div className="mt-20 pt-8 border-t grid grid-cols-2 md:grid-cols-5 gap-8 text-sm" style={{ borderColor: 'rgba(255,255,255,0.1)', fontFamily: F.body }}>
          <div className="col-span-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center font-black" style={{ background: C.saffron, color: 'white', fontFamily: F.display }}>A</span>
              <span className="text-xl font-extrabold" style={{ fontFamily: F.display, letterSpacing: '-0.03em' }}>audinexa</span>
            </div>
            <p className="mt-4 text-white/60 max-w-xs">The audiology clinic OS built for India. DPDPA-compliant, GST-ready, audit-logged.</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold mb-3" style={{ fontFamily: F.mono }}>Product</p>
            <ul className="space-y-2 text-white/80">
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><a href="#diagnostics" className="hover:text-white">Diagnostics</a></li>
              <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
              <li><a href="#faq-clinicians" className="hover:text-white">For Clinicians</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold mb-3" style={{ fontFamily: F.mono }}>Company</p>
            <ul className="space-y-2 text-white/80">
              <li><Link to="/signup" className="hover:text-white">Start trial</Link></li>
              <li><Link to="/login" className="hover:text-white">Sign in</Link></li>
              <li><a href="mailto:hello@audinexa.com" className="hover:text-white">Contact</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold mb-3" style={{ fontFamily: F.mono }}>Legal</p>
            <ul className="space-y-2 text-white/80">
              <li><Link to="/terms" className="hover:text-white">Terms</Link></li>
              <li><Link to="/privacy" className="hover:text-white">Privacy</Link></li>
              <li><Link to="/refund" className="hover:text-white">Refunds</Link></li>
            </ul>
          </div>
        </div>
        <p className="mt-10 text-xs text-white/40" style={{ fontFamily: F.mono }}>© 2026 AUDINEXA · Bengaluru, India</p>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [tiers, setTiers] = useState([]);
  const [stats, setStats] = useState({ clinics: '120+', tests_today: '1,240', aids_sold_today: '58' });

  useEffect(() => {
    // Inject Fontshare + Google Fonts once. Non-blocking.
    const id = 'audinexa-landing-fonts';
    if (!document.getElementById(id)) {
      const l1 = document.createElement('link'); l1.id = id;
      l1.rel = 'stylesheet';
      l1.href = 'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800,500,300&display=swap';
      document.head.appendChild(l1);
      const l2 = document.createElement('link');
      l2.rel = 'stylesheet';
      l2.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&family=Kalam:wght@400;700&display=swap';
      document.head.appendChild(l2);
    }
    document.title = 'AUDINEXA — The audiology clinic OS built for India';
    document.body.style.background = C.bone;
    return () => { document.body.style.background = ''; };
  }, []);

  // Load pricing tiers (best-effort; fall back to skeleton copy)
  useEffect(() => {
    axios.get(`${API}/subscription/tiers`)
      .then((r) => setTiers(Array.isArray(r.data?.tiers) ? r.data.tiers : Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  // Live proof stats — best-effort
  useEffect(() => {
    axios.get(`${API}/public/live-stats`).then((r) => {
      if (r.data) setStats((s) => ({ ...s, ...r.data }));
    }).catch(() => {});
  }, []);

  return (
    <div style={{ background: C.bone, color: C.ink, fontFamily: F.body }} data-testid="landing-page">
      <LaunchBanner />
      <Header />
      <Hero />
      <LiveProofBand stats={stats} />
      <FeatureBento />
      <DiagnosticsDeepDive />
      <ComparisonTable />
      <TestimonialsAndFounder />
      <Pricing tiers={tiers} />
      <FAQ />
      <Footer />
    </div>
  );
}
