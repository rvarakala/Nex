import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, PlayCircle, Sparkles } from 'lucide-react';

const HERO_IMG = 'https://images.pexels.com/photos/14558557/pexels-photo-14558557.jpeg';

const TRUST_PILLS = [
  'DPDPA-compliant',
  'GST-ready',
  '14-day free trial',
  'No card needed',
];

export default function Hero({ onBookDemo, onWatchTour }) {
  return (
    <section
      data-testid="hero-section"
      className="relative pt-28 md:pt-36 pb-20 md:pb-28 overflow-hidden bg-[#FDFDFD]"
    >
      {/* Subtle grid texture — anchors the editorial feel without competing for attention. */}
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

      <div className="relative max-w-7xl mx-auto px-6 md:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* ── Text column ── (cols 1-7) */}
          <div className="lg:col-span-7">
            {/* Eyebrow */}
            <div
              data-testid="hero-eyebrow"
              className="animate-fade-up inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0F52BA]/8 border border-[#0F52BA]/15 text-[11px] font-semibold tracking-[0.18em] uppercase text-[#0F52BA]"
            >
              <Sparkles size={12} className="opacity-80" />
              Built end-to-end for Indian audiology
            </div>

            {/* H1 */}
            <h1
              data-testid="hero-title"
              className="animate-fade-up-delay-1 font-display tracking-supertight font-bold text-slate-900 mt-6 text-4xl sm:text-5xl lg:text-[64px] leading-[1.02]"
            >
              Run your{' '}
              <span className="relative inline-block">
                <span className="relative z-10">audiology clinic</span>
                <span
                  aria-hidden="true"
                  className="absolute left-0 right-0 bottom-1 h-3 bg-[#0F52BA]/15 -z-0"
                />
              </span>
              {' '}like it's 2026 — not 2006.
            </h1>

            {/* Lede */}
            <p
              data-testid="hero-lede"
              className="animate-fade-up-delay-2 font-body text-base sm:text-lg lg:text-xl text-slate-600 leading-relaxed mt-6 max-w-2xl"
            >
              The only clinic SaaS that ties patients, hearing-aid serials, GST
              invoices, AMC contracts and patient follow-ups into{' '}
              <span className="text-slate-900 font-semibold">one screen</span> —
              with the compliance, audit trail and SMS / WhatsApp triggers a
              modern Indian clinic actually needs.
            </p>

            {/* CTAs */}
            <div className="animate-fade-up-delay-3 mt-9 flex flex-wrap items-center gap-3">
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
              className="animate-fade-up-delay-3 mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[12px] font-body font-medium text-slate-600"
            >
              {TRUST_PILLS.map((p) => (
                <li key={p} className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          {/* ── Image column ── (cols 8-12) */}
          <div className="lg:col-span-5 relative">
            <div className="relative animate-fade-up-delay-2">
              {/* Geometric backdrop slab */}
              <div
                aria-hidden="true"
                className="absolute -top-4 -right-4 w-[88%] h-[88%] bg-[#0F52BA] rounded-3xl opacity-95"
              />
              <div
                aria-hidden="true"
                className="absolute -bottom-4 -left-4 w-32 h-32 border-2 border-slate-900 rounded-2xl"
              />

              {/* Hero image */}
              <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-slate-900/15 ring-1 ring-slate-900/5">
                <img
                  src={HERO_IMG}
                  alt="Audiologist examining a patient — AUDINEXA"
                  className="w-full h-[440px] sm:h-[520px] object-cover"
                  loading="eager"
                  decoding="async"
                />

                {/* Glass badge top-left — DPDPA compliance */}
                <div className="absolute top-4 left-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/85 backdrop-blur-md border border-white/60 shadow">
                  <ShieldCheck size={14} className="text-emerald-600" />
                  <span className="text-[11px] font-semibold tracking-wide text-slate-800">DPDPA Compliant</span>
                </div>

                {/* Glass card bottom — live stat */}
                <div
                  data-testid="hero-glass-card"
                  className="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-[280px] p-4 rounded-2xl bg-white/85 backdrop-blur-xl border border-white/60 shadow-2xl"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[#0F52BA]">
                      Today, in real-time
                    </span>
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="font-display font-bold text-slate-900 text-2xl tracking-tight">42</div>
                      <div className="text-[11px] text-slate-500">Patients seen</div>
                    </div>
                    <div>
                      <div className="font-display font-bold text-slate-900 text-2xl tracking-tight">₹2.1L</div>
                      <div className="text-[11px] text-slate-500">Revenue today</div>
                    </div>
                  </div>
                  <div className="h-px bg-slate-200 my-3" />
                  <div className="text-[11px] text-slate-600 leading-relaxed">
                    9 HA fittings · 14 follow-ups sent ·{' '}
                    <span className="text-emerald-700 font-semibold">0 errors</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
