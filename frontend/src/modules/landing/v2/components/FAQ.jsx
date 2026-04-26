/**
 * FAQ — 2-column accordion. Each item is a collapsible card with a chevron icon.
 * On mobile collapses to a single column.
 */
import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

const FAQS = [
  {
    q: 'Can AUDINEXA staff read our patient data?',
    a: "No. Each clinic's data is encrypted with a key only that clinic controls. Our support team can troubleshoot the system, but reading clinical records requires explicit authorisation from your owner — and every access is logged.",
  },
  {
    q: 'Can we use AUDINEXA for multiple branches?',
    a: 'Absolutely. Growth plan supports up to 3 branches; Enterprise is unlimited. Each branch sees its own queue, inventory, and patient list, while owners get a unified dashboard across the chain.',
  },
  {
    q: 'What happens if we forget our clinic key?',
    a: 'You receive 12 one-time recovery codes at onboarding (printable / downloadable). You can also set up multi-admin recovery, where 2-of-3 owners-or-admins together can restore access. As a last resort, a time-locked emergency reset is available with a 7-day cool-off and full audit trail.',
  },
  {
    q: 'Is AUDINEXA mobile friendly?',
    a: 'Yes — fully responsive, with a Progressive Web App so staff can install AUDINEXA on tablets and phones. Built-in offline mode keeps core flows working through internet outages.',
  },
  {
    q: 'Is the backup encrypted?',
    a: 'Yes. Daily automated backups are stored encrypted at rest. Restoring requires your clinic key — no shortcut, even for AUDINEXA staff.',
  },
  {
    q: 'Do you help with data migration?',
    a: 'Yes. Our team helps import patients, appointments, and inventory from Excel, paper books, or any existing software during onboarding. Most clinics are fully migrated within 1 week.',
  },
];

export default function FAQ() {
  const [openIdx, setOpenIdx] = useState(0);
  return (
    <section id="faq" className="py-20 md:py-24 bg-white" data-testid="landing-faq">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-center font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#0F172A] text-3xl sm:text-4xl lg:text-[40px] leading-tight">
          Frequently Asked Questions
        </h2>

        <div className="mt-12 grid md:grid-cols-2 gap-x-8 gap-y-3">
          {FAQS.map((item, i) => {
            const isOpen = openIdx === i;
            return (
              <div
                key={item.q}
                className={`rounded-xl border transition-all ${
                  isOpen
                    ? 'border-[#0B5FFF]/30 bg-[#0B5FFF]/5 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <button
                  onClick={() => setOpenIdx(isOpen ? -1 : i)}
                  data-testid={`faq-toggle-${i}`}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <HelpCircle size={16} className="shrink-0 text-[#0B5FFF]" strokeWidth={2.2} />
                    <span className="font-[Manrope,Inter,sans-serif] font-bold text-[14px] md:text-[15px] text-[#111827] truncate">
                      {item.q}
                    </span>
                  </span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-[#0B5FFF] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 pl-11 text-[13px] text-[#475569] leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
