/**
 * AUDINEXA Landing — Hero variant previews.
 *
 * TEMPORARY page: renders all three hero mockups stacked so the founder
 * can pick one visually before we commit to the full landing rewrite.
 * Live at `/landing-preview`. Will be deleted once a variant is picked.
 *
 * Design system source: /app/design_guidelines.json
 * Fonts loaded inline via <link> so we don't need to edit index.html yet.
 */
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Play, ShieldCheck, Sparkles, Activity } from 'lucide-react';
import { AudiogramIllustration } from './DiagnosticIllustrations';

// ---------- Design tokens (from /app/design_guidelines.json) ----------
const C = {
  bone: '#FDFBF7',
  surface: '#F3F1EC',
  ink: '#1A1C23',
  ink2: '#4A4D57',
  saffron: '#D95D39',
  saffronHover: '#B84A2A',
  emerald: '#059669',
  border: '#E2DFD8',
  navy: '#0B0D17',
};

// ---------- Shared building blocks ----------
function SaffronButton({ children, to = '/signup', testid, size = 'md' }) {
  const sizes = {
    sm: 'px-5 py-2.5 text-sm',
    md: 'px-7 py-3.5 text-base',
    lg: 'px-8 py-4 text-lg',
  };
  return (
    <Link
      to={to}
      data-testid={testid}
      className={`inline-flex items-center gap-2 rounded-full font-semibold text-white shadow-[0_4px_20px_-4px_rgba(217,93,57,0.5)] transition-transform hover:scale-[1.02] active:scale-[0.98] ${sizes[size]}`}
      style={{ background: C.saffron, fontFamily: '"Cabinet Grotesk", "Inter", sans-serif' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.saffronHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.saffron)}
    >
      {children}
      <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
    </Link>
  );
}
function GhostButton({ children, testid }) {
  return (
    <button
      data-testid={testid}
      className="inline-flex items-center gap-2 rounded-full border border-[#E2DFD8] px-6 py-3.5 font-medium text-[#1A1C23] hover:border-[#1A1C23] transition-colors bg-white"
      style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}
    >
      <Play className="w-4 h-4" strokeWidth={2.5} />
      {children}
    </button>
  );
}
function MonoChip({ children, tone = 'ink' }) {
  const bg = tone === 'emerald' ? '#DCFCE7' : tone === 'saffron' ? '#FEF0EA' : '#F3F1EC';
  const fg = tone === 'emerald' ? C.emerald : tone === 'saffron' ? C.saffron : C.ink2;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest"
      style={{ background: bg, color: fg, fontFamily: '"IBM Plex Mono", monospace' }}
    >
      {children}
    </span>
  );
}
function PulseDot({ color = C.emerald }) {
  return (
    <span className="relative inline-flex w-2 h-2">
      <span className="absolute inset-0 rounded-full opacity-60 animate-ping" style={{ background: color }} />
      <span className="relative rounded-full w-2 h-2" style={{ background: color }} />
    </span>
  );
}

// ---------- Section headers between mockups ----------
function VariantLabel({ name, tagline }) {
  return (
    <div className="max-w-6xl mx-auto px-8 pt-16 pb-6 border-t border-[#E2DFD8]">
      <MonoChip tone="saffron">HERO VARIANT · {name.split(' ')[1]}</MonoChip>
      <h2 className="mt-3 text-3xl font-bold text-[#1A1C23]" style={{ fontFamily: '"Cabinet Grotesk", sans-serif', letterSpacing: '-0.02em' }}>
        {name}
      </h2>
      <p className="mt-1 text-[#4A4D57]" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>
        {tagline}
      </p>
    </div>
  );
}

// ---------- HERO A — Outcome focus ----------
function HeroA() {
  return (
    <section className="relative overflow-hidden" style={{ background: C.bone }}>
      {/* Grain */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence baseFrequency=%220.9%22 stitchTiles=%22stitch%22/></filter><rect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22/></svg>")' }} />
      <div className="relative max-w-7xl mx-auto px-8 py-24 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-16 items-center">
        <div>
          <MonoChip tone="emerald">
            <PulseDot />BUILT FOR INDIAN AUDIOLOGY
          </MonoChip>
          <h1
            className="mt-6 text-6xl md:text-7xl font-extrabold text-[#1A1C23] leading-[0.95]"
            style={{ fontFamily: '"Cabinet Grotesk", "Inter", sans-serif', letterSpacing: '-0.04em' }}
          >
            The Audiology<br />
            Clinic OS built<br />
            for <span style={{ color: C.saffron }}>India</span>.
          </h1>
          <p className="mt-8 text-lg text-[#4A4D57] max-w-lg leading-relaxed" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>
            Ditch spreadsheets and WhatsApp. Manage patients, diagnostic testing, hearing-aid sales, and GST billing in one <strong className="text-[#1A1C23]">DPDPA-compliant</strong> platform your team actually wants to use.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <SaffronButton size="lg" testid="hero-a-start-trial">Start 30-day trial</SaffronButton>
            <GhostButton testid="hero-a-explore">Explore features</GhostButton>
          </div>
          <div className="mt-6 flex items-center gap-2 text-sm text-[#4A4D57]" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>
            <ShieldCheck className="w-4 h-4 text-[#059669]" />
            No credit card required · full Premium access · cancel anytime
          </div>
        </div>

        {/* Asymmetric card cluster */}
        <div className="relative h-[540px]">
          {/* Card 1 — Audiogram */}
          <div className="absolute top-0 right-4 w-[85%] rounded-2xl border border-[#E2DFD8] shadow-2xl bg-white p-5 rotate-[-2deg] z-30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[#4A4D57] font-mono">Session · 2026-07-25</p>
                <p className="font-bold text-[#1A1C23] mt-0.5" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>Priya Nair · MRD-4210</p>
              </div>
              <MonoChip tone="emerald">SIGNED</MonoChip>
            </div>
            <div className="mt-3 h-40">
              <AudiogramIllustration />
            </div>
          </div>

          {/* Card 2 — GST Invoice */}
          <div className="absolute bottom-14 left-0 w-[68%] rounded-2xl border border-[#E2DFD8] shadow-xl bg-white p-5 rotate-[3deg] z-20">
            <div className="flex items-center justify-between">
              <MonoChip>GST INVOICE</MonoChip>
              <span className="text-xs text-[#059669] font-semibold">Paid ✓</span>
            </div>
            <p className="text-3xl font-extrabold text-[#1A1C23] mt-3" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>₹78,400</p>
            <p className="text-xs text-[#4A4D57] mt-1">Signia Pure Charge&amp;Go 7AX · Pair · 18% GST · ITC</p>
            <div className="mt-3 pt-3 border-t border-[#E2DFD8] flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#4A4D57] uppercase tracking-widest">INV-2026-0821</span>
              <span className="text-xs font-semibold" style={{ color: C.saffron }}>Auto-filed</span>
            </div>
          </div>

          {/* Card 3 — Live counter */}
          <div className="absolute bottom-0 right-12 w-[52%] rounded-2xl bg-[#0B0D17] text-white shadow-2xl p-5 rotate-[-1deg] z-10">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              <PulseDot color="#34D399" /> Today, real-time
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-3xl font-extrabold" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>12</p>
                <p className="text-[11px] text-white/60">Hearing tests</p>
              </div>
              <div>
                <p className="text-3xl font-extrabold" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>7</p>
                <p className="text-[11px] text-white/60">HA sales</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- HERO B — Tech showpiece ----------
function HeroB() {
  return (
    <section className="relative overflow-hidden" style={{ background: C.bone }}>
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence baseFrequency=%220.9%22 stitchTiles=%22stitch%22/></filter><rect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22/></svg>")' }} />
      <div className="relative max-w-7xl mx-auto px-8 py-24 text-center">
        <MonoChip tone="saffron"><Sparkles className="w-3 h-3" /> AUDINEXA v3 · JULY 2026 LAUNCH</MonoChip>
        <h1
          className="mt-8 text-6xl md:text-8xl font-extrabold text-[#1A1C23] leading-[0.92] max-w-5xl mx-auto"
          style={{ fontFamily: '"Cabinet Grotesk", "Inter", sans-serif', letterSpacing: '-0.045em' }}
        >
          Run your clinic<br />
          like a <span style={{ color: C.saffron }}>modern hospital.</span>
        </h1>
        <p className="mt-8 text-xl text-[#4A4D57] max-w-2xl mx-auto leading-relaxed" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>
          Diagnostics · Hearing-aid sales · Repair · Referrals · GST billing — one system,
          bank-grade security, DPDPA-ready. Built by audiologists, for audiologists.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <SaffronButton size="lg" testid="hero-b-start-trial">Start 30-day trial</SaffronButton>
          <GhostButton testid="hero-b-explore">Explore features</GhostButton>
        </div>

        {/* Massive 2.5D dashboard mockup */}
        <div className="mt-16 relative mx-auto max-w-5xl">
          <div className="absolute -inset-8 rounded-3xl blur-3xl opacity-30" style={{ background: `radial-gradient(circle at 30% 20%, ${C.saffron}, transparent 60%)` }} />
          <div
            className="relative rounded-2xl border border-[#E2DFD8] shadow-2xl bg-white overflow-hidden"
            style={{ transform: 'perspective(1600px) rotateX(6deg)' }}
          >
            {/* Fake window chrome */}
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[#E2DFD8] bg-[#F3F1EC]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FCA5A5]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#FCD34D]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#86EFAC]" />
              <span className="ml-4 text-[10px] font-mono text-[#4A4D57] uppercase tracking-widest">audinexa · diagnostics</span>
            </div>
            <div className="p-8 grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-[#4A4D57]">Pure Tone Audiometry</p>
                <p className="mt-1 text-2xl font-extrabold text-[#1A1C23]" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>Priya Nair · 34 · Female</p>
                <div className="mt-5 h-56">
                  <AudiogramIllustration />
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg border border-[#E2DFD8] p-4">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[#4A4D57]">R Ear · 4-frequency avg</p>
                  <p className="text-3xl font-extrabold text-[#1A1C23] mt-1" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>42 dB</p>
                  <p className="text-xs text-[#4A4D57]">Moderate SNHL</p>
                </div>
                <div className="rounded-lg border border-[#E2DFD8] p-4">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[#4A4D57]">Recommendation</p>
                  <p className="text-sm text-[#1A1C23] mt-1 font-semibold">Bilateral RIC hearing aids · trial 7d</p>
                </div>
                <div className="rounded-lg p-4" style={{ background: C.saffron, color: 'white' }}>
                  <p className="text-[10px] font-mono uppercase tracking-widest opacity-80">Quick action</p>
                  <p className="text-sm font-bold mt-1">Generate GST quote · ₹65,000 →</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- HERO C — Human trust proof ----------
function HeroC() {
  return (
    <section className="relative overflow-hidden" style={{ background: C.bone }}>
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence baseFrequency=%220.9%22 stitchTiles=%22stitch%22/></filter><rect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22/></svg>")' }} />
      <div className="relative max-w-7xl mx-auto px-8 py-24 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="relative">
          {/* Photo */}
          <div className="relative rounded-2xl overflow-hidden aspect-[4/5] shadow-2xl border border-[#E2DFD8]">
            <img
              src="https://images.pexels.com/photos/5888168/pexels-photo-5888168.jpeg?auto=compress&cs=tinysrgb&h=800&w=640&fit=crop"
              alt="Audiologist in clinic"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 40%, rgba(11,13,23,0.35) 100%)' }} />
          </div>

          {/* Floating UI widgets */}
          <div className="absolute -top-6 -right-6 rounded-xl bg-white border border-[#E2DFD8] shadow-xl p-4 w-56">
            <div className="flex items-center gap-2">
              <MonoChip tone="emerald">GST BILLED</MonoChip>
            </div>
            <p className="mt-2 text-2xl font-extrabold text-[#1A1C23]" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>₹4,52,300</p>
            <p className="text-[11px] text-[#4A4D57]">This month · 47 invoices</p>
          </div>

          <div className="absolute bottom-8 -left-6 rounded-xl bg-[#0B0D17] text-white shadow-2xl p-4 w-56">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              <PulseDot color="#34D399" /> Live now
            </div>
            <p className="mt-2 text-lg font-bold" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>3 patients in queue</p>
            <p className="text-[11px] text-white/60 mt-0.5">Est wait · 12 min</p>
          </div>

          <div className="absolute top-1/2 -right-10 rounded-xl bg-white border border-[#E2DFD8] shadow-xl p-3 w-40">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: C.saffron }} />
              <p className="text-[10px] font-mono uppercase tracking-widest text-[#4A4D57]">Audiogram signed</p>
            </div>
            <p className="mt-1 text-xs font-semibold text-[#1A1C23]">Priya Nair · 34</p>
          </div>
        </div>

        {/* Copy side */}
        <div>
          <MonoChip tone="emerald"><PulseDot />TRUSTED BY INDIAN AUDIOLOGISTS</MonoChip>
          <h1
            className="mt-6 text-5xl md:text-6xl font-extrabold text-[#1A1C23] leading-[0.98]"
            style={{ fontFamily: '"Cabinet Grotesk", "Inter", sans-serif', letterSpacing: '-0.04em' }}
          >
            Every clinic deserves<br />
            <span style={{ color: C.saffron }}>real</span> software.
          </h1>
          <p className="mt-8 text-lg text-[#4A4D57] leading-relaxed max-w-md" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>
            Built with 30+ Indian audiologists, hands-on. AUDINEXA replaces the six tabs of Excel,
            three WhatsApp groups, and one PDF binder that your clinic currently runs on.
          </p>
          <blockquote className="mt-8 pl-4 border-l-4 text-[#1A1C23] italic" style={{ borderColor: C.saffron, fontFamily: '"IBM Plex Sans", sans-serif' }}>
            &ldquo;First month with AUDINEXA we invoiced 27% more — the software found revenue our reception was losing.&rdquo;
            <footer className="mt-2 not-italic text-sm text-[#4A4D57]">— Dr. Rajesh Iyer · The Sound Clinic, Bengaluru</footer>
          </blockquote>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <SaffronButton size="lg" testid="hero-c-start-trial">Start 30-day trial</SaffronButton>
            <GhostButton testid="hero-c-explore">Explore features</GhostButton>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Preview page ----------
export default function LandingPreviewPage() {
  useEffect(() => {
    // Inject fonts once
    const id = 'audinexa-preview-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800,500,300&f[]=jetbrains-mono@400&display=swap';
    document.head.appendChild(link);
    const plex = document.createElement('link');
    plex.rel = 'stylesheet';
    plex.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap';
    document.head.appendChild(plex);
    document.body.style.background = C.bone;
    return () => {
      document.body.style.background = '';
    };
  }, []);

  return (
    <div style={{ background: C.bone, minHeight: '100vh' }} data-testid="landing-preview-page">
      {/* Fixed preview banner */}
      <div className="sticky top-0 z-50 px-8 py-3 flex items-center justify-between shadow-sm" style={{ background: '#1A1C23', color: 'white' }}>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded" style={{ background: C.saffron, color: 'white' }}>PREVIEW</span>
          <span className="text-sm font-semibold" style={{ fontFamily: '"Cabinet Grotesk", sans-serif' }}>AUDINEXA landing — hero variants A / B / C</span>
        </div>
        <span className="text-xs text-white/60 hidden md:inline" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>Pick one and tell me. This page will be deleted.</span>
      </div>

      <VariantLabel name="Variant A — Outcome focus" tagline="Bold headline · asymmetric proof cards · fastest B2B conversion." />
      <HeroA />

      <VariantLabel name="Variant B — Tech showpiece" tagline="Centered hero · massive tilted dashboard mockup · most visually striking." />
      <HeroB />

      <VariantLabel name="Variant C — Human trust proof" tagline="Photograph of an audiologist · floating UI widgets · warmest and most humanising." />
      <HeroC />

      <div className="max-w-6xl mx-auto px-8 py-16 border-t border-[#E2DFD8]">
        <p className="text-sm text-[#4A4D57]" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>
          → Reply with A, B, or C and I&rsquo;ll ship the full landing (module bento, diagnostics deep-dive, comparison, pricing, FAQ, footer) with that hero. All three keep the &ldquo;Explore features&rdquo; secondary CTA per your request.
        </p>
      </div>
    </div>
  );
}
