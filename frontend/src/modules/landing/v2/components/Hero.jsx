/**
 * Hero — security-first headline, dual CTA, and a stylized SVG dashboard
 * mockup with a floating lock/shield overlay. Pure SVG, zero external libs.
 */
import React from 'react';
import { ArrowRight, ShieldCheck, KeyRound, Cloud, Stethoscope } from 'lucide-react';

const TRUST_BADGES = [
  { icon: KeyRound,     label: 'Client-Controlled Encryption' },
  { icon: ShieldCheck,  label: 'Zero-Knowledge Privacy Model' },
  { icon: Cloud,        label: 'Secure Cloud Infrastructure' },
  { icon: Stethoscope,  label: 'Built for Healthcare Workflows' },
];

export default function Hero({ onBookDemo }) {
  return (
    <section
      id="top"
      className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden"
      data-testid="landing-hero"
    >
      {/* Subtle animated grid + glow background */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(11,95,255,0.08),transparent_60%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 [background-image:linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      {/* Soft teal blob — pure CSS, no images */}
      <div aria-hidden className="absolute top-20 -right-16 w-[420px] h-[420px] -z-10 rounded-full bg-[#00C2A8]/10 blur-3xl" />
      <div aria-hidden className="absolute -top-20 -left-16 w-[420px] h-[420px] -z-10 rounded-full bg-[#0B5FFF]/10 blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* Left — copy + CTAs */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#F8FAFC] border border-slate-200 text-[#0B5FFF]">
            <ShieldCheck size={13} /> Security-first Clinic OS
          </span>
          <h1 className="mt-5 font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#111827] text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
            Run Your Audiology Clinic on the Platform That{' '}
            <span className="bg-gradient-to-r from-[#0B5FFF] to-[#00C2A8] bg-clip-text text-transparent">Even We Cannot Read</span>
          </h1>
          <p className="mt-6 text-base sm:text-lg text-[#475569] leading-relaxed max-w-xl">
            Appointments, patient records, billing, diagnostics, hearing aid workflow and reports — protected with clinic-controlled encryption keys.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
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
              className="inline-flex items-center justify-center gap-2 bg-white text-[#111827] border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-7 py-4 rounded-xl font-semibold transition-all"
            >
              See Security Architecture
            </a>
          </div>

          <ul className="mt-10 grid grid-cols-2 gap-3 max-w-lg">
            {TRUST_BADGES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-[12.5px] text-[#475569]">
                <span className="w-7 h-7 rounded-md bg-[#0B5FFF]/8 text-[#0B5FFF] flex items-center justify-center shrink-0">
                  <Icon size={14} strokeWidth={2.25} />
                </span>
                <span className="font-medium">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right — stylized SVG dashboard mockup with floating lock */}
        <HeroVisual />
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative w-full max-w-[560px] mx-auto lg:mx-0 lg:ml-auto animate-fade-up [animation-delay:120ms]">
      {/* Glow halo behind the card */}
      <div aria-hidden className="absolute -inset-6 -z-10 bg-gradient-to-tr from-[#0B5FFF]/20 via-transparent to-[#00C2A8]/20 blur-2xl rounded-[36px]" />

      {/* Card */}
      <div className="relative rounded-2xl bg-white border border-slate-200 shadow-2xl shadow-slate-300/40 overflow-hidden">
        {/* Browser chrome */}
        <div className="h-9 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 px-3">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
          <span className="ml-3 px-2 py-0.5 text-[10px] text-slate-500 bg-white rounded-md border border-slate-200 font-mono">audinexa.com/clinic</span>
        </div>

        {/* Dashboard SVG — sidebar + KPI cards + bar chart */}
        <svg viewBox="0 0 560 360" role="img" aria-label="AUDINEXA clinic dashboard preview" className="block w-full h-auto">
          {/* Sidebar */}
          <rect x="0" y="0" width="120" height="360" fill="#0F172A" />
          <rect x="14" y="20" width="92" height="10" rx="3" fill="#334155" />
          {[60, 90, 120, 150, 180].map((y, i) => (
            <g key={y}>
              <rect x="14" y={y} width="14" height="14" rx="3" fill={i === 1 ? '#0B5FFF' : '#1E293B'} />
              <rect x="34" y={y + 3} width={[60, 70, 50, 76, 56][i]} height="8" rx="2" fill={i === 1 ? '#fff' : '#475569'} />
            </g>
          ))}

          {/* Top header */}
          <rect x="120" y="0" width="440" height="56" fill="#fff" />
          <rect x="140" y="20" width="160" height="14" rx="3" fill="#0F172A" />
          <rect x="140" y="38" width="100" height="8" rx="2" fill="#94A3B8" />
          <rect x="450" y="18" width="90" height="22" rx="11" fill="#0B5FFF" />
          <text x="495" y="33" textAnchor="middle" fill="#fff" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="600">+ New</text>

          {/* KPI cards */}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={140 + i * 140} y="76" width="120" height="72" rx="10" fill="#F8FAFC" stroke="#E2E8F0" />
              <rect x={154 + i * 140} y="92" width="40" height="6" rx="2" fill="#94A3B8" />
              <text x={154 + i * 140} y="124" fontFamily="Manrope, sans-serif" fontSize="20" fontWeight="800" fill="#0F172A">
                {['127', '24', '₹84k'][i]}
              </text>
              <rect x={154 + i * 140} y="132" width={[50, 44, 60][i]} height="6" rx="2" fill={['#16A34A', '#0B5FFF', '#00C2A8'][i]} />
            </g>
          ))}

          {/* Bar chart */}
          <rect x="140" y="170" width="400" height="170" rx="10" fill="#fff" stroke="#E2E8F0" />
          <rect x="156" y="186" width="120" height="10" rx="3" fill="#0F172A" />
          {[68, 92, 54, 110, 76, 102, 134].map((h, i) => (
            <g key={i}>
              <rect x={170 + i * 50} y={326 - h} width="22" height={h} rx="4" fill={i === 6 ? '#0B5FFF' : '#DBEAFE'} />
              <rect x={170 + i * 50} y={332} width="22" height="6" rx="2" fill="#E2E8F0" />
            </g>
          ))}

          {/* Encrypted ribbon at the bottom-right of the bar chart */}
          <g transform="translate(440 290)">
            <rect width="92" height="36" rx="18" fill="#0F172A" />
            <circle cx="20" cy="18" r="9" fill="#00C2A8" />
            <text x="50" y="22" fill="#fff" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="600">ENCRYPTED</text>
          </g>
        </svg>
      </div>

      {/* Floating glassmorphism lock card — animates with float keyframe */}
      <div className="absolute -bottom-10 -left-6 sm:-left-10 bg-white/85 backdrop-blur-xl border border-white/60 shadow-[0_10px_50px_rgba(11,95,255,0.18)] rounded-2xl p-4 w-60 animate-float">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] flex items-center justify-center text-white shadow-md animate-pulse-glow">
            <KeyRound size={20} strokeWidth={2.4} />
          </div>
          <div>
            <div className="text-[12px] font-bold text-[#111827] leading-tight">Vault Unlocked</div>
            <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">Session encrypted with your clinic key. Auto-locks on logout.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
