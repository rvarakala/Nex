/**
 * FAQ — minimalist accordion list. Bottom-border-only items, no surrounding boxes.
 * Aligned with the Swiss / High-Contrast B2B design system.
 */
import React, { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import SectionHeading from './SectionHeading';

const FAQS = [
  {
    q: 'Can AUDINEXA staff read our patient data?',
    a: 'No. Each clinic\'s data is encrypted and isolated. Our team can troubleshoot the platform, but reading clinical records requires explicit, time-bound authorisation from your owner — and every access is logged in a tamper-proof audit trail.',
  },
  {
    q: 'Where is the data hosted?',
    a: 'On India-resident servers, aligned with the Digital Personal Data Protection Act (DPDPA). Daily encrypted backups are taken automatically and tested weekly via an internal restore drill.',
  },
  {
    q: 'Can we plot the audiogram and tympanogram inside AUDINEXA?',
    a: 'Yes. Both PTA and tympanometry plot natively in the software — no paper, no second app. They auto-save to the patient record and print with your clinic letterhead.',
  },
  {
    q: 'Can we use AUDINEXA across multiple branches?',
    a: 'Absolutely. Growth supports up to 3 branches; Enterprise is unlimited. Each branch has its own queue, inventory and patient list — owners get a unified dashboard across the chain.',
  },
  {
    q: 'How does billing + GST work?',
    a: 'Invoices are generated directly from the test or fitting screen. CGST / SGST / IGST is split automatically based on the patient\'s state. Tally / GSTN export is one click.',
  },
  {
    q: 'Do you help us migrate from our existing software / Excel?',
    a: 'Yes. Our team imports patients, past visits, billing history and HA inventory from Excel, CSV, Tally or any existing software during onboarding. Most clinics are fully migrated within one week — and your existing MRD numbers are preserved.',
  },
  {
    q: 'Is AUDINEXA mobile-friendly?',
    a: 'Yes — fully responsive, with a Progressive Web App so staff can install AUDINEXA on tablets and phones. Built-in offline mode keeps core flows working through internet outages.',
  },
  {
    q: 'What roles and permissions are supported?',
    a: 'Owner, audiologist, front desk, accounts, and technician are built in — and you can edit each of them. Audiologists can be branch-restricted, accounts can be billing-only, and front-desk users can be hidden from clinical notes.',
  },
];

export default function FAQ() {
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <section
      id="faq"
      data-testid="landing-faq"
      className="py-24 md:py-32 bg-[#F8FAFC]"
    >
      <div className="max-w-5xl mx-auto px-6 md:px-12">
        <SectionHeading
          eyebrow="FAQ"
          title="Questions clinic owners ask before they sign up."
          lede="Direct answers — the same ones we'd give you on a 30-min demo call."
          align="left"
          testid="faq-heading"
        />

        <div className="border-t border-slate-200">
          {FAQS.map((item, i) => {
            const isOpen = openIdx === i;
            return (
              <div key={item.q} className="border-b border-slate-200">
                <button
                  onClick={() => setOpenIdx(isOpen ? -1 : i)}
                  data-testid={`faq-toggle-${i}`}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-6 py-6 md:py-7 text-left group"
                >
                  <span
                    className={`font-display tracking-supertight font-bold text-lg md:text-xl transition-colors ${
                      isOpen ? 'text-[#0F52BA]' : 'text-slate-900 group-hover:text-[#0F52BA]'
                    }`}
                  >
                    {item.q}
                  </span>
                  <span
                    className={`shrink-0 w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
                      isOpen
                        ? 'bg-[#0F52BA] border-[#0F52BA] text-white'
                        : 'border-slate-300 text-slate-500 group-hover:border-[#0F52BA] group-hover:text-[#0F52BA]'
                    }`}
                  >
                    {isOpen ? <Minus size={16} /> : <Plus size={16} />}
                  </span>
                </button>
                <div
                  className={`grid transition-all duration-300 ${
                    isOpen ? 'grid-rows-[1fr] opacity-100 pb-7' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="font-body text-[15px] md:text-base text-slate-600 leading-relaxed max-w-3xl">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
