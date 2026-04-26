/**
 * FinalCTA — slim full-width blue strip with logo on the left,
 * headline + sub in the middle, and a white "Book Free Demo" button on the right.
 * Used as the very last persuasion bar before the footer.
 */
import React from 'react';
import { ArrowRight, Shield } from 'lucide-react';

export default function FinalCTA({ onBookDemo }) {
  return (
    <section className="py-10 md:py-12 bg-white" data-testid="landing-final-cta">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0B5FFF] to-[#1A3FB8] px-6 sm:px-8 md:px-10 py-6 md:py-7 flex flex-col md:flex-row items-center justify-between gap-5">
          {/* subtle pattern overlay */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-25 [background-image:radial-gradient(rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:18px_18px]"
          />

          {/* Left — logo + copy */}
          <div className="relative flex items-center gap-4 text-center md:text-left">
            <span className="hidden sm:flex shrink-0 w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/25 items-center justify-center text-white shadow-md">
              <Shield size={22} strokeWidth={2.4} />
            </span>
            <div className="leading-tight">
              <div className="font-[Manrope,Inter,sans-serif] font-extrabold text-white text-lg md:text-xl tracking-tight">
                Choose the Clinic Software Built on Trust
              </div>
              <div className="mt-1 text-blue-100 text-[13px] md:text-sm">
                Modern workflows. Premium security. Clinic-owned privacy.
              </div>
            </div>
          </div>

          {/* Right — CTA */}
          <button
            onClick={onBookDemo}
            data-testid="final-cta-book-demo"
            className="relative shrink-0 inline-flex items-center justify-center gap-2 bg-white text-[#0B5FFF] hover:bg-blue-50 px-6 py-3 rounded-xl font-bold text-[14px] md:text-[15px] shadow-lg shadow-black/15 hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            Book Free Demo <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
