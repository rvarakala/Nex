import React from 'react';
import SectionHeading from './SectionHeading';
import { X, Check } from 'lucide-react';

const OLD_WAY = [
  'Patient files in physical folders + 4 different WhatsApp groups',
  'HA serials tracked on a sticky note (until it falls off the desk)',
  'GST invoices typed by hand in Word — half are missing HSN codes',
  'No idea who needs a 30-day follow-up call until they re-walk in',
  'AMC contracts? "I think we have one… let me check the email…"',
  'When a patient asks for a year of past visits, you panic-search Drive',
];

const AUDINEXA_WAY = [
  'One MRD per patient. Search by name, phone or MRD — finds in <1s',
  'Every fitting auto-decrements stock. Side-aware (L / R / both) serials',
  'GST-ready invoices in 60s. CGST/SGST/IGST split happens automatically',
  'Smart triggers send the SMS / WhatsApp on day 30 — without you remembering',
  'AMC tracked from sale day with auto-renewal reminders 60 / 30 / 7 days out',
  'Patient profile shows every visit, fitting, invoice, payment — exportable PDF',
];

export default function PainPoints() {
  return (
    <section
      data-testid="pain-section"
      className="py-24 md:py-32 bg-[#F8FAFC]"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <SectionHeading
          eyebrow="The everyday clinic chaos"
          title="You didn't open a clinic to wrestle with spreadsheets."
          lede="Every audiology clinic we've spoken to runs into the same six bottlenecks. Here's what changes when you stop fighting them — and let AUDINEXA absorb them."
          testid="pain-heading"
          align="left"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-slate-200 rounded-3xl overflow-hidden border border-slate-200 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.18)]">
          {/* Old way */}
          <div className="bg-white p-8 md:p-12">
            <div className="inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-[11px] font-semibold tracking-[0.16em] uppercase text-rose-700">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> The old way
            </div>
            <h3 className="font-display tracking-supertight font-bold text-slate-900 text-2xl sm:text-3xl mb-6">
              Today, your clinic runs on guesswork.
            </h3>
            <ul className="space-y-4">
              {OLD_WAY.map((p, i) => (
                <li key={i} className="flex items-start gap-3 group" data-testid={`pain-old-${i}`}>
                  <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-rose-100 text-rose-700 inline-flex items-center justify-center">
                    <X size={12} strokeWidth={2.5} />
                  </span>
                  <span className="font-body text-[15px] text-slate-700 leading-relaxed">{p}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* New way */}
          <div className="relative bg-slate-900 text-white p-8 md:p-12 overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute -right-32 -top-32 w-80 h-80 rounded-full bg-[#0F52BA]/30 blur-3xl"
            />
            <div className="relative">
              <div className="inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-full bg-[#0F52BA]/20 border border-[#0F52BA]/30 text-[11px] font-semibold tracking-[0.16em] uppercase text-sky-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> The AUDINEXA way
              </div>
              <h3 className="font-display tracking-supertight font-bold text-white text-2xl sm:text-3xl mb-6">
                One screen runs the entire clinic day.
              </h3>
              <ul className="space-y-4">
                {AUDINEXA_WAY.map((p, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`pain-new-${i}`}>
                    <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-emerald-500/20 text-emerald-300 inline-flex items-center justify-center">
                      <Check size={12} strokeWidth={2.5} />
                    </span>
                    <span className="font-body text-[15px] text-slate-200 leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
