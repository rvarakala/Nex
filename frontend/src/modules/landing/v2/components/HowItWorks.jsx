/**
 * HowItWorks — the audiology clinic journey on one horizontal ribbon.
 *
 * Replaces the old 4-step text-heavy "How it works". This is the visual
 * summary every clinic owner can grok in 5 seconds — a flow chart of how
 * a real patient moves through the platform from first call to follow-up.
 */
import React from 'react';
import {
  CalendarDays, UserPlus, Activity, Headphones, FileSignature,
  Wrench, Receipt, Bell, ArrowRight,
} from 'lucide-react';
import SectionHeading from './SectionHeading';

const STEPS = [
  { icon: UserPlus,      label: 'New patient',     sub: 'MRD + auto-dedupe' },
  { icon: CalendarDays,  label: 'Appointment',     sub: 'Multi-test chips' },
  { icon: Activity,      label: 'Audiogram + Tymp', sub: 'Plotted in-app' },
  { icon: Headphones,    label: 'HA trial',        sub: 'Side-aware serial' },
  { icon: FileSignature, label: 'Quotation',       sub: 'WhatsApp / PDF' },
  { icon: Wrench,        label: 'Fitting',         sub: 'Inv. auto-decrements' },
  { icon: Receipt,       label: 'GST invoice',     sub: 'CGST/SGST/IGST split' },
  { icon: Bell,          label: 'Follow-up',       sub: 'SMS + WhatsApp' },
];

export default function HowItWorks() {
  return (
    <section
      id="how"
      data-testid="how-it-works"
      className="py-24 md:py-32 bg-slate-900 text-white relative overflow-hidden"
    >
      {/* Glow accents */}
      <div
        aria-hidden="true"
        className="absolute -top-40 left-1/3 w-[28rem] h-[28rem] rounded-full bg-[#0F52BA]/25 blur-[120px]"
      />

      <div className="relative max-w-7xl mx-auto px-6 md:px-12">
        <div className="max-w-3xl mb-12 md:mb-16">
          <div className="text-xs tracking-[0.22em] uppercase font-semibold text-emerald-300 mb-4">
            <span className="inline-flex items-center gap-2">
              <span className="h-px w-8 bg-emerald-400" /> The audiology journey
            </span>
          </div>
          <h2 className="font-display tracking-supertight font-bold text-white text-3xl sm:text-4xl lg:text-5xl leading-[1.05]">
            One patient. One platform. <span className="text-emerald-300">Eight clicks.</span>
          </h2>
          <p className="font-body text-base sm:text-lg text-slate-300 leading-relaxed mt-5 max-w-2xl">
            From the first phone call to the 30-day follow-up SMS — every step
            of an audiology clinic visit lives on one screen, in one record, on
            one timeline.
          </p>
        </div>

        {/* ── Desktop: horizontal ribbon ── */}
        <div className="hidden md:block">
          <div className="relative">
            {/* Horizontal line behind tiles */}
            <div className="absolute left-0 right-0 top-9 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" aria-hidden="true" />

            <ol className="relative grid grid-cols-8 gap-2">
              {STEPS.map(({ icon: Icon, label, sub }, i) => (
                <li
                  key={label}
                  data-testid={`journey-step-${i}`}
                  className="group relative flex flex-col items-center text-center"
                >
                  {/* Tile */}
                  <div className="relative w-[72px] h-[72px] rounded-2xl bg-white/5 backdrop-blur-sm border border-white/15 flex items-center justify-center text-[#7EB1FF] group-hover:bg-[#0F52BA] group-hover:border-[#0F52BA] group-hover:text-white transition-all duration-300 z-10">
                    <Icon size={26} strokeWidth={2.1} />
                    {/* Step number */}
                    <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-emerald-400 text-slate-900 text-[10px] font-display font-bold flex items-center justify-center shadow-md">
                      {i + 1}
                    </span>
                  </div>

                  <div className="mt-4 font-display tracking-supertight font-bold text-[13px] text-white leading-tight">
                    {label}
                  </div>
                  <div className="font-body text-[11px] text-slate-400 leading-tight mt-1">
                    {sub}
                  </div>

                  {/* Arrow */}
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="hidden md:flex absolute top-7 -right-3 lg:-right-4 w-5 h-5 items-center justify-center text-slate-500"
                    >
                      <ArrowRight size={14} strokeWidth={2.5} />
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* ── Mobile: vertical timeline ── */}
        <ol className="md:hidden relative ml-2 border-l-2 border-white/15 space-y-5">
          {STEPS.map(({ icon: Icon, label, sub }, i) => (
            <li key={label} data-testid={`journey-step-mobile-${i}`} className="pl-6 relative">
              <span className="absolute -left-[15px] top-0 w-7 h-7 rounded-full bg-[#0F52BA] flex items-center justify-center text-white shadow-md">
                <Icon size={14} strokeWidth={2.4} />
              </span>
              <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-emerald-300">
                Step {i + 1}
              </div>
              <div className="font-display tracking-supertight font-bold text-[15px] text-white mt-0.5">
                {label}
              </div>
              <div className="font-body text-[12.5px] text-slate-400 mt-0.5">{sub}</div>
            </li>
          ))}
        </ol>

        {/* Bottom signature row */}
        <div className="mt-12 md:mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-8">
          <div className="font-body text-[13px] text-slate-400 max-w-xl">
            Every step writes to the <span className="text-white font-semibold">same patient record</span> —
            no re-typing, no second app, no Excel sheet. The timeline is your audit trail.
          </div>
          <a
            href="#features"
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-emerald-300 hover:text-emerald-200"
            data-testid="journey-explore-features"
          >
            Explore each module
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
