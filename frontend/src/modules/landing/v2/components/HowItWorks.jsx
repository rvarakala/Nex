import React from 'react';
import SectionHeading from './SectionHeading';
import { LogIn, Upload, Activity, BarChart3 } from 'lucide-react';

const STEPS = [
  {
    n: '01',
    icon: LogIn,
    title: 'Sign up & invite your team',
    text: 'Create your clinic account in 60 seconds. Add audiologists + front-desk staff with role-scoped permissions.',
  },
  {
    n: '02',
    icon: Upload,
    title: 'Import patients (or start fresh)',
    text: 'CSV / Excel import with smart column mapping. Or open a clean book and let walk-ins populate it as the day goes.',
  },
  {
    n: '03',
    icon: Activity,
    title: 'Run a clinic day',
    text: 'Book the appointment → run the test → fit the aid → raise the invoice → schedule the follow-up. One screen, four clicks.',
  },
  {
    n: '04',
    icon: BarChart3,
    title: 'Watch the numbers tell the truth',
    text: 'Daily revenue, branch leaderboard, top-selling SKUs, follow-up effectiveness. Make Monday-morning calls with data, not vibes.',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how"
      data-testid="how-section"
      className="py-24 md:py-32 bg-[#F8FAFC] scroll-mt-20"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <SectionHeading
          eyebrow="How it works"
          title="Live by the end of the week — not by the end of the quarter."
          lede="Most clinics are running their first real day on AUDINEXA within 4 working days of signing up. Here's what those days actually look like."
          testid="how-heading"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8 relative">
          {/* Tracking line — visible on lg+ only */}
          <div
            aria-hidden="true"
            className="hidden lg:block absolute top-7 left-[12%] right-[12%] h-px border-t border-dashed border-slate-300"
          />
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.n}
                data-testid={`how-step-${i}`}
                className="relative bg-white rounded-2xl border border-slate-200 p-6 hover:border-[#0F52BA]/40 hover:shadow-[0_18px_40px_-22px_rgba(15,82,186,0.35)] transition-all duration-300"
              >
                <div className="flex items-center gap-3 mb-5">
                  <span className="relative inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-white border-2 border-[#0F52BA] text-[#0F52BA] shadow-[0_6px_16px_-8px_rgba(15,82,186,0.4)]">
                    <Icon size={22} strokeWidth={2} />
                  </span>
                  <span className="font-display font-bold tracking-supertight text-[#0F52BA] text-3xl">
                    {s.n}
                  </span>
                </div>
                <h3 className="font-display tracking-supertight font-bold text-slate-900 text-lg sm:text-xl mb-2 leading-snug">
                  {s.title}
                </h3>
                <p className="font-body text-[14px] text-slate-600 leading-relaxed">{s.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
