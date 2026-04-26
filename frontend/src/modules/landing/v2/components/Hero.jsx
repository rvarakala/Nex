/**
 * Hero — "Your Data. Your Key. Your Control." security-first headline.
 *
 * Layout: copy-left, stylized laptop + phone mockup right, big shield ribbon
 * floating bottom-right of the visual, trust-seal row underneath the CTAs.
 * All visuals are pure inline SVG/CSS — no images, no external libs.
 */
import React from 'react';
import { ArrowRight, ShieldCheck, Check, Award, HeartPulse, Cloud, Activity } from 'lucide-react';

const TRUST_SEALS = [
  { icon: Award,       title: 'ISO 27001',      sub: 'Aligned' },
  { icon: HeartPulse,  title: 'HIPAA',          sub: 'Aligned' },
  { icon: Cloud,       title: 'Secure Cloud',   sub: 'AES-256' },
  { icon: Activity,    title: '99.9%',          sub: 'Uptime SLA' },
];

const QUICK_WINS = [
  'Appointments to reports',
  'Fully encrypted',
  'Clinic-controlled keys',
];

export default function Hero({ onBookDemo }) {
  return (
    <section
      id="top"
      className="relative pt-28 pb-24 md:pt-36 md:pb-28 overflow-hidden"
      data-testid="landing-hero"
    >
      {/* Background — soft gradient + subtle grid + corner blobs */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,rgba(11,95,255,0.07),transparent_55%),radial-gradient(ellipse_at_top_right,rgba(0,194,168,0.07),transparent_55%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 [background-image:linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div aria-hidden className="absolute -bottom-24 -right-24 w-[480px] h-[480px] -z-10 rounded-full bg-[#00C2A8]/10 blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
        {/* Left — copy + CTAs + trust seals */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#0B5FFF]/8 border border-[#0B5FFF]/15 text-[#0B5FFF]">
            <ShieldCheck size={13} /> Client-Controlled Encryption
          </span>
          <h1 className="mt-5 font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#111827] text-4xl sm:text-5xl lg:text-[56px] xl:text-[60px] leading-[1.05]">
            <span className="whitespace-nowrap">Your Data. Your Key.</span><br />
            <span className="bg-gradient-to-r from-[#0B5FFF] to-[#00C2A8] bg-clip-text text-transparent">Your Control.</span>
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
              className="inline-flex items-center justify-center gap-2 bg-white text-[#0B5FFF] border-2 border-[#0B5FFF]/15 hover:border-[#0B5FFF]/40 hover:bg-[#0B5FFF]/4 px-7 py-4 rounded-xl font-semibold transition-all"
            >
              See Security Architecture
            </a>
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
                    <div className="text-[12px] font-bold text-[#111827] leading-none">{title}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right — laptop + phone composite + floating shield ribbon */}
        <HeroVisual />
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative w-full max-w-[600px] mx-auto lg:mx-0 lg:ml-auto animate-fade-up [animation-delay:140ms]">
      {/* Halo */}
      <div aria-hidden className="absolute -inset-8 -z-10 bg-gradient-to-tr from-[#0B5FFF]/15 via-transparent to-[#00C2A8]/20 blur-3xl rounded-[40px]" />

      {/* Laptop frame */}
      <div className="relative">
        <div className="relative rounded-[18px] bg-slate-900 p-2 shadow-2xl shadow-slate-900/30">
          {/* Laptop screen — dashboard SVG inside */}
          <div className="rounded-[10px] bg-white overflow-hidden">
            <svg viewBox="0 0 600 380" role="img" aria-label="AUDINEXA dashboard preview" className="block w-full h-auto">
              {/* Sidebar */}
              <rect x="0" y="0" width="130" height="380" fill="#0F172A" />
              <g fontFamily="Inter, sans-serif" fontSize="9" fill="#94A3B8" fontWeight="600">
                <rect x="14" y="18" width="100" height="9" rx="2" fill="#1E293B" />
                <rect x="14" y="20" width="60" height="5" rx="2" fill="#334155" />
              </g>
              {['Dashboard', 'Appointments', 'Patients', 'Audiology', 'Billing', 'Inventory', 'Repairs', 'Reports', 'Staff', 'Settings'].map((label, i) => {
                const y = 50 + i * 30;
                const active = i === 0;
                return (
                  <g key={label}>
                    {active && <rect x="6" y={y - 4} width="118" height="24" rx="6" fill="#0B5FFF" opacity="0.18" />}
                    <rect x="14" y={y} width="14" height="14" rx="3" fill={active ? '#0B5FFF' : '#1E293B'} />
                    <text x="34" y={y + 11} fontFamily="Inter, sans-serif" fontSize="10" fontWeight={active ? 700 : 500} fill={active ? '#fff' : '#64748B'}>{label}</text>
                  </g>
                );
              })}

              {/* Top header */}
              <rect x="130" y="0" width="470" height="44" fill="#fff" />
              <line x1="130" y1="44" x2="600" y2="44" stroke="#E2E8F0" />
              <text x="148" y="27" fontFamily="Manrope, sans-serif" fontSize="14" fontWeight="800" fill="#0F172A">Dashboard</text>

              {/* KPI cards */}
              {[
                { label: "Today's Appts",     value: '24',     accent: '#16A34A', w: 50 },
                { label: 'New Patients',      value: '12',     accent: '#0B5FFF', w: 36 },
                { label: 'Revenue (Mo)',      value: '₹2,45,600', accent: '#00C2A8', w: 84 },
                { label: 'Follow-ups',        value: '18',     accent: '#F59E0B', w: 36 },
              ].map((k, i) => (
                <g key={k.label}>
                  <rect x={148 + i * 110} y="60" width="100" height="68" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
                  <text x={158 + i * 110} y="76" fontFamily="Inter, sans-serif" fontSize="8" fontWeight="600" fill="#94A3B8">{k.label.toUpperCase()}</text>
                  <text x={158 + i * 110} y="100" fontFamily="Manrope, sans-serif" fontSize="18" fontWeight="800" fill="#0F172A">{k.value}</text>
                  <rect x={158 + i * 110} y="110" width={k.w} height="5" rx="2" fill={k.accent} />
                </g>
              ))}

              {/* Calendar block (left) */}
              <rect x="148" y="142" width="216" height="170" rx="8" fill="#fff" stroke="#E2E8F0" />
              <text x="160" y="160" fontFamily="Manrope, sans-serif" fontSize="11" fontWeight="800" fill="#0F172A">Appointments</text>
              <text x="316" y="160" fontFamily="Inter, sans-serif" fontSize="9" fill="#0B5FFF" fontWeight="600">May 2026 ›</text>
              {/* Days */}
              {Array.from({ length: 28 }, (_, i) => {
                const row = Math.floor(i / 7);
                const col = i % 7;
                const isToday = i === 14;
                return (
                  <g key={i}>
                    <rect x={160 + col * 28} y={172 + row * 28} width="24" height="24" rx="4" fill={isToday ? '#0B5FFF' : 'transparent'} />
                    <text x={172 + col * 28} y={188 + row * 28} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="9" fontWeight={isToday ? 700 : 500} fill={isToday ? '#fff' : '#475569'}>{i + 1}</text>
                  </g>
                );
              })}

              {/* Recent patients (right) */}
              <rect x="378" y="142" width="208" height="170" rx="8" fill="#fff" stroke="#E2E8F0" />
              <text x="390" y="160" fontFamily="Manrope, sans-serif" fontSize="11" fontWeight="800" fill="#0F172A">Recent Patients</text>
              {['Ramesh K.', 'Anita S.', 'Vikram P.', 'Sneha N.'].map((name, i) => (
                <g key={name}>
                  <circle cx={400} cy={184 + i * 30} r="9" fill={['#FCA5A5', '#A7F3D0', '#BFDBFE', '#FDE68A'][i]} />
                  <text x={418} y={188 + i * 30} fontFamily="Inter, sans-serif" fontSize="10" fontWeight="600" fill="#0F172A">{name}</text>
                  <text x={418} y={199 + i * 30} fontFamily="Inter, sans-serif" fontSize="8" fill="#94A3B8">PTA · {['10:00', '10:30', '11:15', '12:00'][i]}</text>
                  <rect x={552} y={180 + i * 30} width="22" height="12" rx="6" fill="#16A34A" opacity="0.15" />
                  <text x={563} y={189 + i * 30} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="7" fontWeight="700" fill="#16A34A">DONE</text>
                </g>
              ))}

              {/* Encrypted ribbon */}
              <g transform="translate(486 320)">
                <rect width="100" height="38" rx="19" fill="#0F172A" />
                <circle cx="20" cy="19" r="9" fill="#00C2A8" />
                <text x="34" y="23" fill="#fff" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="700">ENCRYPTED</text>
              </g>
            </svg>
          </div>
          {/* Laptop hinge bar */}
          <div className="h-1 mt-1 mx-auto w-1/3 rounded-full bg-slate-700/70" />
        </div>

        {/* Phone — overlaid bottom-right of the laptop */}
        <div className="absolute -bottom-14 right-4 sm:right-12 w-[140px] h-[280px] rounded-[22px] bg-slate-900 p-1.5 shadow-2xl shadow-slate-900/40 hidden sm:block">
          <div className="rounded-[18px] h-full bg-white overflow-hidden flex flex-col">
            <div className="h-3 bg-slate-900 rounded-t-[18px] flex justify-center pt-1">
              <div className="w-12 h-1.5 bg-black rounded-full" />
            </div>
            <div className="flex-1 p-2.5 text-[8px] flex flex-col gap-1.5">
              <div className="text-[#0F172A] font-bold">Dashboard</div>
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 px-2 py-1.5">
                <div className="text-[6px] text-slate-500 font-bold uppercase">Today's Appts</div>
                <div className="text-[12px] text-[#0F172A] font-extrabold">24</div>
              </div>
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 px-2 py-1.5">
                <div className="text-[6px] text-slate-500 font-bold uppercase">New Patients</div>
                <div className="text-[12px] text-[#0F172A] font-extrabold">12</div>
              </div>
              <div className="rounded-md bg-[#F8FAFC] border border-slate-200 px-2 py-1.5">
                <div className="text-[6px] text-slate-500 font-bold uppercase">Revenue</div>
                <div className="text-[12px] text-[#0F172A] font-extrabold">₹2.4L</div>
              </div>
              <div className="rounded-md bg-[#0B5FFF] text-white px-2 py-1.5 mt-auto">
                <div className="text-[7px] font-semibold opacity-80">Follow-ups</div>
                <div className="text-[11px] font-extrabold">18</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Big floating shield ribbon — bottom-right of the visual block */}
      <div className="absolute -bottom-6 left-4 sm:left-0 lg:-left-6 bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-[#0B5FFF]/15 px-4 py-3 flex items-center gap-3 animate-float">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] flex items-center justify-center text-white shadow-md animate-pulse-glow">
          <ShieldCheck size={22} strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="text-[12px] font-extrabold text-[#111827]">Your Key. Your Data.</div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">Our Commitment.</div>
        </div>
      </div>
    </div>
  );
}
