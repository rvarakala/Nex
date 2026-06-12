import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, PlayCircle, Sparkles, Lock, CheckCircle2 } from 'lucide-react';

const HERO_DASHBOARD_IMG = '/landing/hero-dashboard.jpeg';

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
      className="relative pt-28 md:pt-32 pb-16 md:pb-20 overflow-hidden bg-slate-900 text-white"
    >
      {/* Atmospheric glow */}
      <div
        aria-hidden="true"
        className="absolute -top-40 right-0 w-[40rem] h-[40rem] rounded-full bg-[#0F52BA]/30 blur-[140px] pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute -top-20 -left-40 w-[28rem] h-[28rem] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none"
      />
      {/* Subtle grid texture */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.18] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at top, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at top, black 30%, transparent 75%)',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-6 md:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* ── Text column ── */}
          <div className="lg:col-span-6">
            <div
              data-testid="hero-eyebrow"
              className="animate-fade-up inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-semibold tracking-[0.18em] uppercase text-emerald-300"
            >
              <Sparkles size={12} className="opacity-90" />
              Built end-to-end for Indian audiology
            </div>

            <h1
              data-testid="hero-title"
              className="animate-fade-up-delay-1 font-display tracking-supertight font-bold mt-6 text-4xl sm:text-5xl lg:text-[58px] leading-[1.04]"
            >
              Run your entire audiology clinic in{' '}
              <span className="text-emerald-300">one secure system</span> —
              from audiogram to AMC.
            </h1>

            <p
              data-testid="hero-lede"
              className="animate-fade-up-delay-2 font-body text-base sm:text-lg text-slate-300 leading-relaxed mt-6 max-w-xl"
            >
              Most clinics still draw audiograms on paper, type bills in Excel,
              and chase hearing-aid serials in a third app.{' '}
              <span className="text-white font-semibold">
                AUDINEXA replaces all three
              </span>{' '}
              — with bank-grade data security and a tamper-proof audit trail your
              patients can trust.
            </p>

            {/* CTAs */}
            <div className="animate-fade-up-delay-3 mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={onBookDemo}
                data-testid="hero-join-waitlist"
                className="group inline-flex items-center px-6 py-3.5 text-[15px] font-semibold text-slate-900 bg-emerald-400 rounded-xl hover:bg-emerald-300 active:scale-[0.98] transition shadow-[0_14px_30px_-12px_rgba(16,185,129,0.5)]"
              >
                Join the beta waitlist
                <ArrowRight size={16} className="ml-2 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                onClick={onWatchTour}
                data-testid="hero-watch-tour"
                className="group inline-flex items-center px-5 py-3.5 text-[15px] font-semibold text-white bg-white/10 border border-white/20 rounded-xl hover:bg-white/15 hover:border-white/30 transition backdrop-blur-sm"
              >
                <PlayCircle size={18} className="mr-2 text-emerald-300" />
                Explore features
              </button>
              <Link
                to="/login"
                data-testid="hero-already-customer"
                className="ml-1 text-[13px] font-body text-slate-400 hover:text-slate-200 underline-offset-4 hover:underline"
              >
                Already a customer? Sign in →
              </Link>
            </div>

            <ul
              data-testid="hero-trust-pills"
              className="animate-fade-up-delay-3 mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] font-body font-medium text-slate-400"
            >
              {TRUST_PILLS.map((p) => (
                <li key={p} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          {/* ── Real product screenshot column ── */}
          <div className="lg:col-span-6 relative">
            <div className="relative animate-fade-up-delay-2">
              {/* Geometric backdrop slab */}
              <div
                aria-hidden="true"
                className="absolute -top-4 -right-4 w-[88%] h-[88%] bg-[#0F52BA]/40 rounded-3xl backdrop-blur-sm border border-[#0F52BA]/30"
              />
              <div
                aria-hidden="true"
                className="absolute -bottom-4 -left-4 w-32 h-32 border-2 border-emerald-400/30 rounded-2xl"
              />

              {/* Screenshot */}
              <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-white/10">
                <img
                  src={HERO_DASHBOARD_IMG}
                  alt="AUDINEXA dashboard — appointments, patients, hearing aids, collections in one screen"
                  className="w-full h-auto block"
                  loading="eager"
                  decoding="async"
                  data-testid="hero-product-screenshot"
                />

                {/* Glass badge top-right — DPDPA */}
                <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 backdrop-blur-md border border-white/60 shadow">
                  <ShieldCheck size={13} className="text-emerald-600" />
                  <span className="text-[10.5px] font-bold tracking-wide text-slate-800">DPDPA · Live</span>
                </div>
              </div>

              {/* Floating glass card — bottom-left, real KPI */}
              <div
                data-testid="hero-glass-card"
                className="hidden sm:block absolute -bottom-6 -left-2 sm:-left-4 max-w-[260px] p-4 rounded-2xl bg-slate-900/85 backdrop-blur-xl border border-white/20 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-emerald-300">
                    Today, in real-time
                  </span>
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="font-display font-bold text-white text-2xl tracking-supertight">7</div>
                    <div className="text-[10.5px] text-slate-400">Hearing tests</div>
                  </div>
                  <div>
                    <div className="font-display font-bold text-white text-2xl tracking-supertight">12</div>
                    <div className="text-[10.5px] text-slate-400">Hearing aids sold</div>
                  </div>
                </div>
                <div className="h-px bg-white/10 my-3" />
                <div className="text-[10.5px] text-slate-300 leading-relaxed inline-flex items-center gap-1.5">
                  <Lock size={11} className="text-emerald-400" />
                  Encrypted at rest · audit-logged
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
