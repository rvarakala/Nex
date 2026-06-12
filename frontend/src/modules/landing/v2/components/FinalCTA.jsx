/**
 * FinalCTA — full-bleed sapphire panel with massive editorial typography.
 * The last persuasion bar before the footer.
 */
import React from 'react';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

export default function FinalCTA({ onBookDemo }) {
  return (
    <section
      data-testid="landing-final-cta"
      className="py-20 md:py-24 bg-[#FDFDFD]"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div
          className="relative overflow-hidden rounded-3xl bg-slate-900 text-white px-8 sm:px-12 md:px-16 py-16 md:py-24"
        >
          {/* Texture */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:22px_22px]"
          />
          {/* Glow accents */}
          <div
            aria-hidden="true"
            className="absolute -top-40 -right-32 w-[28rem] h-[28rem] rounded-full bg-[#0F52BA]/40 blur-[120px]"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-40 -left-32 w-[22rem] h-[22rem] rounded-full bg-emerald-500/15 blur-[100px]"
          />

          <div className="relative max-w-4xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-400/15 border border-amber-300/30 text-[11px] font-semibold tracking-[0.18em] uppercase text-amber-200">
              <Sparkles size={12} /> Beta cohort full · Queue is now open
            </div>

            <h2 className="font-display tracking-supertight font-bold text-4xl sm:text-5xl lg:text-6xl leading-[1.02] mt-6">
              Stop juggling apps. Run your clinic the way it deserves —
              <span className="text-emerald-300"> securely.</span>
            </h2>

            <p className="font-body text-base sm:text-lg text-slate-300 leading-relaxed mt-6 max-w-2xl">
              The beta cohort is full. We open one batch at a time so every
              clinic gets white-glove onboarding. Join the queue — you'll
              be first to know when the next batch opens.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                onClick={onBookDemo}
                data-testid="final-cta-join-waitlist"
                className="group inline-flex items-center gap-2 px-7 py-4 text-[15px] font-semibold text-slate-900 bg-white rounded-xl hover:bg-slate-100 active:scale-[0.98] transition shadow-[0_18px_40px_-12px_rgba(255,255,255,0.35)]"
              >
                Reserve my spot in the queue
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#security"
                data-testid="final-cta-security"
                className="inline-flex items-center gap-2 px-5 py-4 text-[15px] font-semibold text-white border border-white/30 rounded-xl hover:bg-white/10 transition"
              >
                <ShieldCheck size={16} className="text-emerald-300" />
                Read security architecture
              </a>
            </div>

            <ul className="mt-9 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl">
              {[
                'No card needed',
                'No data lock-in',
                'India-resident',
                'DPDPA-aligned',
              ].map((p) => (
                <li
                  key={p}
                  className="text-[12px] font-medium text-slate-300 inline-flex items-center gap-1.5"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
