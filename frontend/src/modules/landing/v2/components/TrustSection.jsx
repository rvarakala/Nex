import React from 'react';

const STATS = [
  { num: '12+',  label: 'Indian audiology clinics piloting' },
  { num: '94%',  label: 'Tasks completed in under 3 clicks' },
  { num: '<60s', label: 'Average GST invoice generation' },
  { num: '0',    label: 'Spreadsheets needed' },
];

export default function TrustSection() {
  return (
    <section
      data-testid="trust-section"
      className="py-12 md:py-16 bg-white border-y border-slate-200"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="text-[11px] tracking-[0.22em] uppercase font-semibold text-slate-500 mb-6 text-center">
          What clinic owners say after week 1 with AUDINEXA
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-200">
          {STATS.map((s, i) => (
            <div key={s.label} className={`text-center px-4 py-3 ${i === 0 ? 'border-l-0' : ''}`}>
              <div className="font-display font-bold tracking-supertight text-slate-900 text-3xl sm:text-4xl">
                {s.num}
              </div>
              <div className="text-xs sm:text-[13px] text-slate-600 font-body mt-1.5 leading-snug">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
