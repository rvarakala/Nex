import React from 'react';
import { ArrowRight } from 'lucide-react';

export default function FinalCTA({ onBookDemo }) {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden" data-testid="landing-final-cta">
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-br from-[#0B5FFF] via-[#1A3FB8] to-[#0B5FFF]" />
      <div aria-hidden className="absolute inset-0 -z-10 [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
      <div aria-hidden className="absolute -top-32 -right-32 w-96 h-96 -z-10 rounded-full bg-[#00C2A8]/30 blur-3xl" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white">
        <h2 className="font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-3xl sm:text-4xl lg:text-5xl leading-tight">
          Choose the clinic software <span className="text-[#A6F4E5]">built on trust</span>
        </h2>
        <p className="mt-5 text-base sm:text-lg text-blue-100 leading-relaxed max-w-2xl mx-auto">
          Modern workflows + premium security + clinic-owned privacy. Be one of our launch clinics — onboarding white-glove, fully assisted.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onBookDemo}
            data-testid="final-cta-book-demo"
            className="inline-flex items-center justify-center gap-2 bg-white text-[#0B5FFF] hover:bg-blue-50 px-8 py-4 rounded-xl font-bold shadow-2xl shadow-black/20 transition-all"
          >
            Book Free Demo <ArrowRight size={18} />
          </button>
          <a
            href="mailto:hello@audinexa.com"
            className="text-blue-100 hover:text-white px-6 py-4 font-medium text-sm transition"
          >
            Or email hello@audinexa.com
          </a>
        </div>
      </div>
    </section>
  );
}
