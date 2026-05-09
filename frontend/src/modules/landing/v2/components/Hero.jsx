import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, PlayCircle, Sparkles, Lock } from 'lucide-react';
import LivePlotShowcase from './LivePlotShowcase';

const TRUST_PILLS = [
  'DPDPA-compliant',
  'GST-ready invoicing',
  'Built for Indian audiology',
  'No card needed',
];

export default function Hero({ onBookDemo, onWatchTour }) {
  return (
    <section
      data-testid="hero-section"
      className="relative pt-28 md:pt-32 pb-20 md:pb-28 overflow-hidden bg-[#FDFDFD]"
    >
      {/* Subtle grid texture */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(15,82,186,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,82,186,0.06) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at top, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at top, black 30%, transparent 75%)',
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-12">
        {/* Eyebrow */}
        <div className="text-center">
          <div
            data-testid="hero-eyebrow"
            className="animate-fade-up inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0F52BA]/8 border border-[#0F52BA]/15 text-[11px] font-semibold tracking-[0.18em] uppercase text-[#0F52BA]"
          >
            <Sparkles size={12} className="opacity-80" />
            Built end-to-end for Indian audiology clinics
          </div>

          {/* H1 */}
          <h1
            data-testid="hero-title"
            className="animate-fade-up-delay-1 font-display tracking-supertight font-bold text-slate-900 mt-6 text-4xl sm:text-5xl lg:text-[64px] leading-[1.04] max-w-4xl mx-auto"
          >
            Plot the audiogram. Print the bill. Track the hearing aid.{' '}
            <span className="relative inline-block">
              <span className="relative z-10">All on one screen.</span>
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 bottom-1 h-3 bg-[#0F52BA]/15 -z-0"
              />
            </span>
          </h1>

          {/* Lede */}
          <p
            data-testid="hero-lede"
            className="animate-fade-up-delay-2 font-body text-base sm:text-lg lg:text-xl text-slate-600 leading-relaxed mt-6 max-w-3xl mx-auto"
          >
            Most audiology clinics still draw audiograms on paper, type bills in
            Excel, and chase hearing-aid serials in a third app.{' '}
            <span className="text-slate-900 font-semibold">
              AUDINEXA replaces all three
            </span>{' '}
            — with bank-grade data security and a tamper-proof audit trail your
            patients can trust.
          </p>

          {/* CTAs */}
          <div className="animate-fade-up-delay-3 mt-9 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onBookDemo}
              data-testid="hero-book-demo"
              className="group inline-flex items-center px-6 py-3.5 text-[15px] font-semibold text-white bg-[#0F52BA] rounded-xl hover:bg-[#0C4399] active:scale-[0.98] transition shadow-[0_14px_30px_-12px_rgba(15,82,186,0.6)]"
            >
              Book a 30-min demo
              <ArrowRight size={16} className="ml-2 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={onWatchTour}
              data-testid="hero-watch-tour"
              className="group inline-flex items-center px-5 py-3.5 text-[15px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 hover:border-slate-400 transition"
            >
              <PlayCircle size={18} className="mr-2 text-[#0F52BA]" />
              Watch product tour
            </button>
            <Link
              to="/login"
              data-testid="hero-already-customer"
              className="ml-1 text-[13px] font-body text-slate-500 hover:text-slate-700 underline-offset-4 hover:underline"
            >
              Already a customer? Sign in →
            </Link>
          </div>

          {/* Trust pills */}
          <ul
            data-testid="hero-trust-pills"
            className="animate-fade-up-delay-3 mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[12.5px] font-body font-medium text-slate-600"
          >
            {TRUST_PILLS.map((p) => (
              <li key={p} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* ── LIVE PLOT SHOWCASE (the "GIF") ── */}
        <div className="mt-14 md:mt-16 animate-fade-up-delay-3">
          <LivePlotShowcase />

          {/* Caption row under the showcase */}
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-[12.5px] text-slate-500">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span><span className="font-semibold text-slate-700">Encrypted at rest.</span> Daily backups. India-resident.</span>
            </span>
            <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-300" />
            <span className="inline-flex items-center gap-2">
              <Lock size={14} className="text-[#0F52BA]" />
              <span><span className="font-semibold text-slate-700">Role-based access.</span> Tamper-proof audit log.</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
