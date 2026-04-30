/**
 * Hero — "Your Data. Your Key. Your Control."
 *
 * Visual right-side rebuilt as an Apple-style **bento grid** showcasing real
 * product surfaces (encrypted vault · live audiogram · calendar · INR billing
 * · multi-branch). Each tile has its own colour identity and micro-animation
 * so the product itself becomes the hero — no static dashboard PNG.
 *
 * Pure inline SVG/CSS, no images, no extra deps.
 */
import React from 'react';
import {
  ArrowRight, ShieldCheck, Check, Award, HeartPulse, Cloud, Activity, PlayCircle,
  Lock, Building2, IndianRupee, Calendar,
} from 'lucide-react';

const TRUST_SEALS = [
  { icon: Award,       title: 'ISO 27001',      sub: 'Aligned' },
  { icon: HeartPulse,  title: 'HIPAA',          sub: 'Aligned' },
  { icon: Cloud,       title: 'Secure Cloud',   sub: 'AES-256' },
  { icon: Activity,    title: '99.9%',          sub: 'Uptime SLA' },
];

const QUICK_WINS = ['Appointments to reports', 'Fully encrypted', 'Clinic-controlled keys'];

export default function Hero({ onBookDemo, onWatchTour }) {
  return (
    <section
      id="top"
      className="relative pt-28 pb-28 md:pt-36 md:pb-32 overflow-hidden bg-[#FAFAFB]"
      data-testid="landing-hero"
    >
      {/* Background — single soft spotlight (Apple-product-page style) */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_70%_30%,rgba(11,95,255,0.10),transparent_60%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_45%_45%_at_15%_85%,rgba(0,194,168,0.08),transparent_60%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 [background-image:radial-gradient(rgba(15,23,42,0.06)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_70%)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[1fr_1.05fr] gap-12 lg:gap-14 items-center">
        {/* LEFT — copy + CTAs + trust */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#0B5FFF]/8 border border-[#0B5FFF]/15 text-[#0B5FFF]">
            <ShieldCheck size={13} /> Client-Controlled Encryption
          </span>
          <h1 className="mt-5 font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#0F172A] text-4xl sm:text-5xl lg:text-[58px] xl:text-[64px] leading-[1.02]">
            <span className="whitespace-nowrap">Your Data. Your Key.</span><br />
            <span className="bg-gradient-to-r from-[#0B5FFF] via-[#0B5FFF] to-[#00C2A8] bg-clip-text text-transparent">Your Control.</span>
          </h1>
          <p className="mt-6 text-base sm:text-lg text-[#475569] leading-relaxed max-w-xl">
            Run your entire audiology clinic on the platform that <span className="font-semibold text-[#0B5FFF]">even we</span> cannot read. Appointments, patient records, billing, diagnostics — all protected with clinic-controlled encryption keys.
          </p>

          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {QUICK_WINS.map((w) => (
              <li key={w} className="inline-flex items-center gap-1.5 text-[13px] text-[#334155] font-medium">
                <Check size={14} strokeWidth={3} className="text-[#16A34A]" /> {w}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
            <button
              onClick={onBookDemo}
              data-testid="hero-book-demo"
              className="inline-flex items-center justify-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] text-white px-7 py-4 rounded-xl font-semibold shadow-md shadow-[#0B5FFF]/25 hover:shadow-lg hover:shadow-[#0B5FFF]/35 transition-all focus:ring-4 focus:ring-blue-100"
            >
              Book Free Demo <ArrowRight size={18} />
            </button>
            <a
              href="#how-it-works"
              onClick={(e) => { e.preventDefault(); document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' }); }}
              data-testid="hero-see-security"
              className="inline-flex items-center justify-center gap-2 bg-white text-[#0B5FFF] border-2 border-[#0B5FFF]/15 hover:border-[#0B5FFF]/40 hover:bg-[#0B5FFF]/4 px-7 py-4 rounded-xl font-semibold transition-all"
            >
              See Security Architecture
            </a>
            <button
              type="button"
              onClick={onWatchTour}
              data-testid="hero-watch-tour"
              className="group inline-flex items-center justify-center gap-2 text-[#0B5FFF] hover:text-[#094acf] px-2 py-3 sm:py-4 font-semibold text-[14px] transition-colors"
            >
              <PlayCircle size={20} className="group-hover:scale-110 transition-transform" />
              <span>Watch <span className="font-extrabold">60-sec</span> product tour</span>
            </button>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-200/70">
            <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-3">
              Trusted by modern audiology clinics & hearing centers
            </div>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl">
              {TRUST_SEALS.map(({ icon: Icon, title, sub }) => (
                <li key={title} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#0B5FFF]/30 hover:shadow-sm transition">
                  <span className="w-9 h-9 rounded-md bg-gradient-to-br from-[#0B5FFF]/10 to-[#00C2A8]/10 text-[#0B5FFF] flex items-center justify-center shrink-0">
                    <Icon size={16} strokeWidth={2.2} />
                  </span>
                  <div>
                    <div className="text-[12px] font-bold text-[#0F172A] leading-none">{title}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* RIGHT — bento grid showcase */}
        <HeroBento />
      </div>
    </section>
  );
}

// ============================================================================
// HeroBento — 5-tile asymmetric grid. Each tile is a self-contained mini-
// product demo. Hover lifts + soft glow per tile colour.
// ============================================================================

function HeroBento() {
  return (
    <div className="relative w-full max-w-[640px] mx-auto lg:mx-0 lg:ml-auto animate-fade-up [animation-delay:140ms]">
      {/* Halo */}
      <div aria-hidden className="absolute -inset-6 -z-10 bg-gradient-to-tr from-[#0B5FFF]/12 via-transparent to-[#00C2A8]/14 blur-3xl rounded-[40px]" />

      <div className="grid grid-cols-6 grid-rows-6 gap-3 sm:gap-4 h-[520px] sm:h-[560px]">
        {/* Vault tile — top left, large */}
        <BentoVault className="col-span-3 row-span-3" />
        {/* Audiogram tile — top right, large */}
        <BentoAudiogram className="col-span-3 row-span-3" />
        {/* Calendar tile — bottom left */}
        <BentoCalendar className="col-span-2 row-span-3" />
        {/* Revenue tile — bottom centre */}
        <BentoRevenue className="col-span-2 row-span-3" />
        {/* Multi-branch tile — bottom right */}
        <BentoMultiBranch className="col-span-2 row-span-3" />
      </div>
    </div>
  );
}

// ---- Tile 1: Encrypted Vault (deep navy, premium) -------------------------
function BentoVault({ className = '' }) {
  return (
    <div
      data-testid="bento-vault"
      className={`group relative overflow-hidden rounded-2xl bg-[#0F172A] text-white p-5 shadow-[0_20px_60px_-20px_rgba(11,95,255,0.4)] hover:shadow-[0_24px_80px_-20px_rgba(11,95,255,0.55)] hover:-translate-y-0.5 transition-all duration-300 ${className}`}
    >
      {/* Animated rings behind the lock */}
      <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-40 h-40 rounded-full border border-white/8" />
      </div>
      <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-28 h-28 rounded-full border border-[#22D3EE]/20 animate-pulse-glow" />
      </div>
      <div aria-hidden className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#0B5FFF]/30 blur-3xl" />

      <div className="relative flex items-start justify-between">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-bold bg-[#22D3EE]/15 text-[#67E8F9] ring-1 ring-[#22D3EE]/25">
          <ShieldCheck size={11} /> Active
        </span>
        <span className="text-[10px] font-mono text-slate-400">AES-256</span>
      </div>

      <div className="relative mt-7 flex justify-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0B5FFF] to-[#22D3EE] flex items-center justify-center shadow-lg shadow-[#0B5FFF]/40 group-hover:scale-110 transition-transform duration-500">
          <Lock size={28} strokeWidth={2.2} className="text-white" />
        </div>
      </div>

      <div className="relative absolute bottom-5 left-5 right-5">
        <div className="text-[11px] uppercase tracking-wider font-bold text-[#67E8F9]">Encrypted Vault</div>
        <div className="text-[15px] font-bold leading-tight mt-0.5">Even we can't read it</div>
        <div className="text-[11px] text-slate-400 mt-1">Clinic-controlled keys · Zero-knowledge</div>
      </div>
    </div>
  );
}

// ---- Tile 2: Live Audiogram (signature tile) -------------------------------
function BentoAudiogram({ className = '' }) {
  // Simulated ear-response curve points (frequency vs threshold, dB HL).
  const points = [
    [40, 30], [110, 25], [180, 28], [260, 35], [340, 50], [420, 65], [500, 70],
  ];
  const path = `M ${points.map((p) => p.join(',')).join(' L ')}`;

  return (
    <div
      data-testid="bento-audiogram"
      className={`group relative overflow-hidden rounded-2xl bg-white border border-slate-200 p-5 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 ${className}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-[#0B5FFF]">Audiology Tests</div>
          <div className="text-[15px] font-bold text-[#0F172A] mt-0.5">Live audiogram</div>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Recording
        </span>
      </div>

      <div className="mt-3">
        <svg viewBox="0 0 540 140" className="w-full h-auto">
          {/* dB grid (rows) */}
          {[20, 50, 80, 110].map((y) => (
            <line key={y} x1="20" x2="520" y1={y} y2={y} stroke="#E2E8F0" strokeDasharray="2 4" />
          ))}
          {/* Frequency grid (cols) */}
          {[40, 110, 180, 260, 340, 420, 500].map((x) => (
            <line key={x} x1={x} x2={x} y1="10" y2="125" stroke="#F1F5F9" />
          ))}
          {/* Right-ear curve (red, traditional audiology colour) */}
          <path d={path} fill="none" stroke="#EF4444" strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round"
            style={{ strokeDasharray: 700, strokeDashoffset: 700, animation: 'draw 1.6s cubic-bezier(0.16,1,0.3,1) 0.3s forwards' }}
          />
          {/* Right-ear plot circles */}
          {points.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="4.5" fill="#fff" stroke="#EF4444" strokeWidth="2"
              style={{ opacity: 0, animation: `pop 0.4s ease-out ${0.4 + i * 0.12}s forwards` }} />
          ))}
          {/* Left-ear curve (blue) — slight offset */}
          <path d={`M 40,38 L 110,30 L 180,33 L 260,42 L 340,55 L 420,70 L 500,76`}
            fill="none" stroke="#0B5FFF" strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round"
            style={{ strokeDasharray: 700, strokeDashoffset: 700, animation: 'draw 1.6s cubic-bezier(0.16,1,0.3,1) 0.6s forwards' }}
          />
          {/* Frequency labels */}
          {[
            ['40', '250'], ['180', '1k'], ['340', '4k'], ['500', '8k'],
          ].map(([x, label]) => (
            <text key={label} x={x} y="138" textAnchor="middle" fontSize="9" fill="#94A3B8" fontFamily="Inter, sans-serif" fontWeight="600">{label}</text>
          ))}
        </svg>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1 text-rose-600 font-semibold"><span className="w-2 h-2 rounded-full bg-rose-500" />Right ear</span>
        <span className="inline-flex items-center gap-1 text-[#0B5FFF] font-semibold"><span className="w-2 h-2 rounded-full bg-[#0B5FFF]" />Left ear</span>
        <span className="ml-auto text-slate-500 font-mono">PTA · 27 dB HL</span>
      </div>

      {/* Inline keyframes — local to this tile */}
      <style>{`
        @keyframes draw { to { stroke-dashoffset: 0; } }
        @keyframes pop  { to { opacity: 1; } from { opacity: 0; transform: scale(0.5); } }
      `}</style>
    </div>
  );
}

// ---- Tile 3: Today's Calendar ---------------------------------------------
function BentoCalendar({ className = '' }) {
  const slots = [
    { time: '09:00', name: 'Anita S.', tone: 'bg-[#0B5FFF]' },
    { time: '10:30', name: 'Ramesh K.', tone: 'bg-emerald-500' },
    { time: '11:15', name: 'Vikram P.', tone: 'bg-amber-500' },
    { time: '12:00', name: 'Sneha N.', tone: 'bg-rose-500' },
  ];
  return (
    <div
      data-testid="bento-calendar"
      className={`group relative overflow-hidden rounded-2xl bg-white border border-slate-200 p-4 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 ${className}`}
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[#0B5FFF]/10 text-[#0B5FFF] flex items-center justify-center">
          <Calendar size={14} strokeWidth={2.4} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Today</div>
          <div className="text-[12px] font-bold text-[#0F172A] leading-none">8 appts</div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {slots.map((s, i) => (
          <div
            key={s.time}
            className="flex items-center gap-2 rounded-lg bg-slate-50 hover:bg-slate-100 px-2 py-1.5 transition-colors"
            style={{ animation: `slideRight 0.5s ease-out ${0.1 + i * 0.08}s both` }}
          >
            <div className={`w-1 h-7 rounded-full ${s.tone}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono text-slate-500">{s.time}</div>
              <div className="text-[11px] font-bold text-[#0F172A] truncate">{s.name}</div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideRight { from { opacity: 0; transform: translateX(-16px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>
    </div>
  );
}

// ---- Tile 4: Revenue (warm tile) ------------------------------------------
function BentoRevenue({ className = '' }) {
  return (
    <div
      data-testid="bento-revenue"
      className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 via-emerald-50 to-teal-50 border border-emerald-200 p-4 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Month</div>
        <span className="text-[10px] font-bold text-emerald-600 bg-white/60 px-1.5 py-0.5 rounded">+18%</span>
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <IndianRupee size={20} className="text-[#0F172A]" strokeWidth={2.6} />
        <span className="text-[26px] font-extrabold text-[#0F172A] leading-none">2,45,600</span>
      </div>
      <div className="text-[10px] text-emerald-700 font-semibold">vs ₹2,08,000 last month</div>

      {/* Mini bar chart */}
      <div className="mt-4 flex items-end gap-1 h-12">
        {[35, 50, 42, 60, 48, 70, 80].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-emerald-400/60 group-hover:bg-emerald-500 transition-colors"
            style={{
              height: `${h}%`,
              animation: `barGrow 0.8s cubic-bezier(0.16,1,0.3,1) ${0.2 + i * 0.06}s both`,
            }}
          />
        ))}
      </div>
      <div className="mt-1 text-[9px] text-emerald-700/70 font-mono uppercase tracking-wider">Mon Tue Wed Thu Fri Sat Sun</div>

      <style>{`
        @keyframes barGrow { from { transform: scaleY(0); transform-origin: bottom; } to { transform: scaleY(1); transform-origin: bottom; } }
      `}</style>
    </div>
  );
}

// ---- Tile 5: Multi-Branch (compact) ---------------------------------------
function BentoMultiBranch({ className = '' }) {
  const branches = [
    { city: 'Mumbai', count: 124, hue: 'bg-[#0B5FFF]' },
    { city: 'Bengaluru', count: 87, hue: 'bg-amber-500' },
    { city: 'Delhi',  count: 56, hue: 'bg-emerald-500' },
  ];
  return (
    <div
      data-testid="bento-multibranch"
      className={`group relative overflow-hidden rounded-2xl bg-[#0F172A] text-white p-4 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 ${className}`}
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-white/8 text-[#67E8F9] flex items-center justify-center">
          <Building2 size={14} strokeWidth={2.4} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Branches</div>
          <div className="text-[12px] font-bold text-white leading-none">3 locations</div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {branches.map((b, i) => (
          <div
            key={b.city}
            className="rounded-lg bg-white/5 px-2 py-1.5 ring-1 ring-white/8"
            style={{ animation: `slideUp 0.5s ease-out ${0.1 + i * 0.1}s both` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold">{b.city}</span>
              <span className="text-[10px] text-slate-400">{b.count} pts</span>
            </div>
            <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full ${b.hue} rounded-full`}
                style={{
                  width: `${(b.count / 124) * 100}%`,
                  animation: `widthGrow 0.9s cubic-bezier(0.16,1,0.3,1) ${0.3 + i * 0.1}s both`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes widthGrow { from { width: 0; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
