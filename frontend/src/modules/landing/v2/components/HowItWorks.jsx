/**
 * HowItWorks — 4 steps with chevron arrows in between.
 * Each step is a circular icon + title + 1-line subtext.
 * Stacks vertically on mobile with downward chevrons.
 */
import React from 'react';
import { User, KeyRound, Unlock, ShieldCheck, ChevronRight, ChevronDown } from 'lucide-react';

const STEPS = [
  { icon: User,         iconBg: 'bg-slate-100 text-slate-600',           title: 'User Logs In',         body: 'Enter your username and password' },
  { icon: KeyRound,     iconBg: 'bg-emerald-100 text-emerald-600',       title: 'Enter Clinic Key',     body: 'Authorized user enters clinic secret key' },
  { icon: Unlock,       iconBg: 'bg-emerald-100 text-emerald-600',       title: 'Data Unlocked',        body: 'Data decrypts securely for this session' },
  { icon: ShieldCheck,  iconBg: 'bg-[#0B5FFF]/10 text-[#0B5FFF]',        title: 'Auto Lock on Logout',  body: 'When you logout, data locks automatically' },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-20 md:py-24 bg-[#F8FAFC]" data-testid="landing-how">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-center font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#0F172A] text-3xl sm:text-4xl lg:text-[40px] leading-tight">
          How Clinic-Controlled Security Works
        </h2>

        {/* Desktop: row with chevron arrows between cards */}
        <div className="mt-14 hidden lg:flex items-start justify-between gap-2">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.title}>
              <Step {...s} />
              {i < STEPS.length - 1 && (
                <div className="pt-9 shrink-0" aria-hidden>
                  <ChevronRight size={28} className="text-slate-300" strokeWidth={2.4} />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Mobile / tablet: stacked with downward chevrons */}
        <div className="mt-12 lg:hidden grid sm:grid-cols-2 gap-6">
          {STEPS.map((s) => (
            <Step key={s.title} {...s} centered />
          ))}
        </div>

        <p className="mt-12 text-center text-sm text-[#475569]">
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span><span className="font-semibold text-[#111827]">Simple for your staff.</span> Powerful for your privacy.</span>
          </span>
        </p>
      </div>
    </section>
  );
}

function Step({ icon: Icon, iconBg, title, body, centered }) {
  return (
    <div className={`flex flex-col items-center text-center ${centered ? '' : 'flex-1 max-w-[230px]'}`}>
      <div className={`w-20 h-20 rounded-full flex items-center justify-center ${iconBg}`}>
        <Icon size={30} strokeWidth={2} />
      </div>
      <h3 className="mt-5 font-[Manrope,Inter,sans-serif] font-extrabold text-[16px] text-[#0F172A]">{title}</h3>
      <p className="mt-1.5 text-[12.5px] text-[#64748B] leading-relaxed max-w-[200px]">{body}</p>
    </div>
  );
}
