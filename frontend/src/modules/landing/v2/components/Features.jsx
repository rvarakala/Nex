import React from 'react';
import SectionHeading from './SectionHeading';
import {
  UserSquare2, CalendarDays, Headphones, Receipt, FileSignature,
  ClipboardList, MessageSquare, ShieldCheck, BarChart3, ArrowRight,
} from 'lucide-react';

/* Bento grid — asymmetric column spans. The two "anchor" features
   (HA Sales + Billing) get bigger tiles to telegraph what makes
   AUDINEXA different from a generic clinic CRM. */
const FEATURES = [
  {
    span: 'lg:col-span-7 lg:row-span-2',
    icon: Headphones,
    eyebrow: 'Anchor feature',
    title: 'Hearing-aid sales that actually track inventory.',
    blurb:
      'Side-aware serials (L / R / both), live stock decrement, auto-warranty start dates, and a Quick HA Sale that creates fitting + sale + invoice in one click — atomically.',
    accent: true,
  },
  {
    span: 'lg:col-span-5',
    icon: Receipt,
    eyebrow: 'GST-ready',
    title: 'Compliant invoicing in 60s.',
    blurb:
      'CGST / SGST / IGST split based on patient state. HSN/SAC codes pre-mapped. PDF download.',
  },
  {
    span: 'lg:col-span-5',
    icon: UserSquare2,
    eyebrow: 'Patient hub',
    title: 'Every visit, fitting, payment — searchable.',
    blurb:
      'One MRD. Phone-number lookup. Full longitudinal history exportable as a single PDF.',
  },
  {
    span: 'lg:col-span-4',
    icon: CalendarDays,
    title: 'Appointments + Calendar',
    blurb: 'Multi-test bookings (PTA + IMP + OAE) with auto-summed durations.',
  },
  {
    span: 'lg:col-span-4',
    icon: ClipboardList,
    title: 'Quotations & Trials',
    blurb: 'Bilateral quotes, trial-to-sale conversion, status workflow.',
  },
  {
    span: 'lg:col-span-4',
    icon: FileSignature,
    title: 'AMC Contracts',
    blurb: 'Tracked from sale day. Auto-renewal alerts at 60 / 30 / 7.',
  },
  {
    span: 'lg:col-span-6',
    icon: MessageSquare,
    title: 'SMS · Email · WhatsApp',
    blurb:
      'Real-time triggers — appointment reminders, follow-ups, AMC renewals, invoice receipts. ZeptoMail + MSG91 + Twilio integrated.',
  },
  {
    span: 'lg:col-span-6',
    icon: BarChart3,
    title: 'Insights & exports',
    blurb:
      'Daily revenue, top SKUs, branch comparison, audiologist productivity. Excel + PDF, one-click.',
  },
];

export default function Features({ onBookDemo }) {
  return (
    <section
      id="features"
      data-testid="features-section"
      className="py-24 md:py-32 bg-white scroll-mt-20"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-14">
          <SectionHeading
            eyebrow="What's inside"
            title="Built for audiology — not adapted from generic clinic software."
            lede="Nine modules that ship together, share the same data model, and stay in sync. No copy-paste between tools. No exports to Excel. Just one screen, all day."
            testid="features-heading"
            align="left"
          />
          <button
            onClick={onBookDemo}
            data-testid="features-cta"
            className="group inline-flex items-center px-5 py-3 text-sm font-semibold text-[#0F52BA] hover:bg-[#0F52BA]/5 rounded-xl border border-[#0F52BA]/30 transition"
          >
            See it live · Join the waitlist
            <ArrowRight size={15} className="ml-2 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const accent = f.accent;
            return (
              <article
                key={i}
                data-testid={`feature-card-${i}`}
                className={`${f.span} group relative rounded-3xl p-6 md:p-8 transition-all duration-300 ${
                  accent
                    ? 'bg-slate-900 text-white overflow-hidden'
                    : 'bg-white border border-slate-200 hover:-translate-y-1 hover:shadow-[0_20px_40px_-20px_rgba(15,23,42,0.18)] hover:border-slate-300'
                }`}
              >
                {accent && (
                  <div
                    aria-hidden="true"
                    className="absolute -right-24 -bottom-24 w-72 h-72 rounded-full bg-[#0F52BA]/35 blur-3xl"
                  />
                )}
                <div className="relative">
                  <div className={`inline-flex items-center justify-center h-11 w-11 rounded-xl mb-5 ${
                    accent ? 'bg-white/10 text-white' : 'bg-[#0F52BA]/10 text-[#0F52BA]'
                  }`}>
                    <Icon size={20} strokeWidth={2} />
                  </div>
                  {f.eyebrow && (
                    <div className={`text-[10px] tracking-[0.2em] uppercase font-semibold mb-2 ${
                      accent ? 'text-sky-300' : 'text-[#0F52BA]'
                    }`}>
                      {f.eyebrow}
                    </div>
                  )}
                  <h3 className={`font-display tracking-supertight font-bold leading-tight mb-3 ${
                    accent ? 'text-white text-2xl sm:text-3xl' : 'text-slate-900 text-lg sm:text-xl'
                  }`}>
                    {f.title}
                  </h3>
                  <p className={`font-body leading-relaxed ${
                    accent ? 'text-slate-300 text-base' : 'text-slate-600 text-[14px]'
                  }`}>
                    {f.blurb}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
