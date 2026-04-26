/**
 * PainPoints — side-by-side "Outdated vs Modern" comparison.
 *
 * Left card (light rose): list of unsafe/outdated practices with red X icons.
 * Center: animated gradient arrow.
 * Right card (light emerald): list of AUDINEXA secure workflows with green checks.
 * Stacks vertically on mobile, with a downward arrow between cards.
 */
import React from 'react';
import { Check, X, ArrowRight, ArrowDown } from 'lucide-react';

const OUTDATED = [
  'Excel sheets & paper files',
  'Shared passwords',
  'No encryption',
  'Data loss risk',
  'Weak backups',
  'No activity tracking',
];

const MODERN = [
  'Fully encrypted cloud',
  'Role-based access',
  'Audit logs & tracking',
  'Secure backups',
  'Anywhere access',
  'Built for audiology clinics',
];

export default function PainPoints() {
  return (
    <section className="relative py-20 md:py-24 bg-white" data-testid="landing-pain">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative grid lg:grid-cols-[1fr_auto_1fr] gap-6 lg:gap-8 items-stretch">
          {/* LEFT — Outdated systems (rose) */}
          <div
            className="relative rounded-2xl p-7 md:p-8 bg-rose-50 border border-rose-100 overflow-hidden"
            data-testid="pain-outdated-card"
          >
            <h3 className="font-[Manrope,Inter,sans-serif] font-extrabold text-[22px] md:text-2xl text-[#9F1239] leading-snug max-w-[18ch]">
              Still Using Unsafe & Outdated Systems?
            </h3>
            <ul className="mt-6 space-y-3">
              {OUTDATED.map((label) => (
                <li key={label} className="flex items-center gap-3 text-[14px] md:text-[15px] text-[#7F1D1D] font-medium">
                  <span className="w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
                    <X size={12} strokeWidth={3.5} />
                  </span>
                  {label}
                </li>
              ))}
            </ul>

            {/* Stylised illustration: stressed person at laptop with floating excel/file icons */}
            <OutdatedIllustration />
          </div>

          {/* MIDDLE arrow — desktop only */}
          <div className="hidden lg:flex items-center justify-center" aria-hidden>
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] text-white flex items-center justify-center shadow-xl shadow-[#0B5FFF]/30">
              <ArrowRight size={22} strokeWidth={2.6} />
            </div>
          </div>

          {/* MIDDLE arrow — mobile only */}
          <div className="lg:hidden flex justify-center" aria-hidden>
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] text-white flex items-center justify-center shadow-xl shadow-[#0B5FFF]/25">
              <ArrowDown size={20} strokeWidth={2.6} />
            </div>
          </div>

          {/* RIGHT — Modern AUDINEXA workflows (emerald) */}
          <div
            className="relative rounded-2xl p-7 md:p-8 bg-emerald-50 border border-emerald-100 overflow-hidden"
            data-testid="pain-modern-card"
          >
            <h3 className="font-[Manrope,Inter,sans-serif] font-extrabold text-[22px] md:text-2xl text-emerald-900 leading-snug max-w-[20ch]">
              AUDINEXA Brings Secure & Modern Workflows
            </h3>
            <ul className="mt-6 space-y-3">
              {MODERN.map((label) => (
                <li key={label} className="flex items-center gap-3 text-[14px] md:text-[15px] text-emerald-900 font-medium">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    <Check size={12} strokeWidth={3.5} />
                  </span>
                  {label}
                </li>
              ))}
            </ul>

            <ModernIllustration />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Inline SVG illustrations ---------- */

function OutdatedIllustration() {
  return (
    <svg
      viewBox="0 0 240 160"
      aria-hidden
      className="absolute right-2 bottom-2 w-[180px] sm:w-[210px] opacity-95 pointer-events-none"
    >
      {/* desk */}
      <rect x="40" y="120" width="180" height="6" rx="2" fill="#E5C2C2" />
      {/* laptop */}
      <rect x="80" y="86" width="110" height="38" rx="3" fill="#1F2937" />
      <rect x="84" y="90" width="102" height="28" rx="2" fill="#FFE4E6" />
      <rect x="88" y="94" width="40" height="3" rx="1" fill="#9F1239" opacity="0.5" />
      <rect x="88" y="100" width="60" height="3" rx="1" fill="#9F1239" opacity="0.4" />
      <rect x="88" y="106" width="48" height="3" rx="1" fill="#9F1239" opacity="0.4" />
      {/* person body */}
      <path d="M118 104 q14 -22 36 0 v16 h-36 z" fill="#94A3B8" />
      {/* head */}
      <circle cx="136" cy="78" r="14" fill="#FBCFE8" />
      {/* hair */}
      <path d="M122 76 q14 -22 28 0 q-4 -10 -14 -10 q-12 0 -14 10 z" fill="#1F2937" />
      {/* glasses */}
      <circle cx="131" cy="80" r="3.2" stroke="#1F2937" strokeWidth="1.2" fill="none" />
      <circle cx="141" cy="80" r="3.2" stroke="#1F2937" strokeWidth="1.2" fill="none" />
      <line x1="134.2" y1="80" x2="137.8" y2="80" stroke="#1F2937" strokeWidth="1.2" />
      {/* worried mouth */}
      <path d="M132 86 q4 -3 8 0" stroke="#1F2937" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* sweat drop */}
      <path d="M122 70 q-2 4 0 6 q2 -2 0 -6 z" fill="#60A5FA" />
      {/* floating excel icon */}
      <g transform="translate(28 28)">
        <rect width="34" height="42" rx="3" fill="#16A34A" />
        <text x="17" y="28" textAnchor="middle" fontFamily="Arial" fontSize="14" fontWeight="800" fill="#fff">X</text>
      </g>
      {/* alert bubble */}
      <g transform="translate(190 30)">
        <circle r="14" fill="#F59E0B" />
        <text textAnchor="middle" y="5" fontFamily="Arial" fontSize="18" fontWeight="800" fill="#fff">!</text>
      </g>
      {/* speech ellipsis */}
      <g transform="translate(200 70)">
        <rect x="-22" y="-10" width="40" height="20" rx="10" fill="#fff" stroke="#FCA5A5" strokeWidth="1" />
        <circle cx="-10" cy="0" r="2" fill="#9F1239" />
        <circle cx="-2" cy="0" r="2" fill="#9F1239" />
        <circle cx="6" cy="0" r="2" fill="#9F1239" />
      </g>
    </svg>
  );
}

function ModernIllustration() {
  return (
    <svg
      viewBox="0 0 240 160"
      aria-hidden
      className="absolute right-2 bottom-2 w-[180px] sm:w-[210px] opacity-95 pointer-events-none"
    >
      <rect x="40" y="120" width="180" height="6" rx="2" fill="#A7F3D0" />
      {/* laptop */}
      <rect x="80" y="86" width="110" height="38" rx="3" fill="#0F172A" />
      <rect x="84" y="90" width="102" height="28" rx="2" fill="#ECFDF5" />
      <rect x="88" y="94" width="60" height="3" rx="1" fill="#0B5FFF" opacity="0.6" />
      <rect x="88" y="100" width="48" height="3" rx="1" fill="#10B981" opacity="0.6" />
      <rect x="88" y="106" width="55" height="3" rx="1" fill="#10B981" opacity="0.6" />
      {/* person body in green tee */}
      <path d="M118 104 q14 -22 36 0 v16 h-36 z" fill="#10B981" />
      {/* head */}
      <circle cx="136" cy="78" r="14" fill="#FCD5B5" />
      {/* hair */}
      <path d="M122 76 q14 -20 28 0 q-4 -10 -14 -10 q-12 0 -14 10 z" fill="#1F2937" />
      {/* smile */}
      <path d="M131 84 q5 4 10 0" stroke="#1F2937" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* eyes */}
      <circle cx="131" cy="79" r="1.4" fill="#1F2937" />
      <circle cx="141" cy="79" r="1.4" fill="#1F2937" />
      {/* shield badge floating */}
      <g transform="translate(196 32)">
        <path d="M0 -14 L12 -8 v10 q0 10 -12 16 q-12 -6 -12 -16 v-10 z" fill="#0B5FFF" />
        <path d="M-5 0 l3 3 l8 -8" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
      {/* lock chip */}
      <g transform="translate(28 36)">
        <rect width="34" height="34" rx="6" fill="#0B5FFF" />
        <rect x="11" y="14" width="12" height="10" rx="2" fill="#fff" />
        <path d="M13 14 v-3 a4 4 0 0 1 8 0 v3" stroke="#fff" strokeWidth="2" fill="none" />
      </g>
      {/* sparkle */}
      <circle cx="80" cy="40" r="2" fill="#10B981" />
      <circle cx="200" cy="100" r="2" fill="#0B5FFF" />
    </svg>
  );
}
