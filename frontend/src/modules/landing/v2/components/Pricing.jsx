import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import SectionHeading from './SectionHeading';

const TIERS = [
  {
    id: 'STARTER',
    name: 'Starter',
    price: '₹4,999',
    period: '/year',
    tag: 'For single-location clinics',
    features: [
      '1 clinic, up to 5 staff',
      'Patient records + appointments',
      'Audiogram + tympanogram in-app',
      'GST-ready invoices',
      'Encrypted daily backups',
      'Email support',
    ],
    highlight: false,
  },
  {
    id: 'GROWTH',
    name: 'Growth',
    price: '₹9,999',
    period: '/year',
    tag: 'Most popular for growing clinics',
    features: [
      'Up to 3 branches, unlimited staff',
      'HA inventory + serial register',
      'WhatsApp / SMS reminders',
      'Quotation Studio + AMC tracker',
      'Analytics + referrer reports',
      'Priority support',
    ],
    highlight: true,
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    price: '₹15,999',
    period: '/year',
    tag: 'Multi-branch chains + bring-your-own-key',
    features: [
      'Unlimited branches',
      'BYOK (Bring Your Own Key)',
      'On-premise deployment option',
      'Custom roles & SSO',
      'Dedicated success manager',
      '24×7 priority support',
    ],
    customised: true,
    highlight: false,
  },
];

export default function Pricing({ onBookDemo }) {
  return (
    <section
      id="pricing"
      data-testid="landing-pricing"
      className="py-24 md:py-32 bg-[#FDFDFD]"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple, transparent, clinic-friendly."
          lede="One yearly plan. No per-seat surprises. Cancel anytime."
          align="left"
          testid="pricing-heading"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              data-testid={`pricing-tier-${tier.id.toLowerCase()}`}
              className={`relative rounded-2xl p-7 md:p-9 transition-all duration-300 ${
                tier.highlight
                  ? 'bg-slate-900 text-white shadow-2xl shadow-slate-900/20 lg:-translate-y-3 ring-1 ring-[#0F52BA]/40'
                  : 'bg-white border border-slate-200 hover:-translate-y-1 hover:shadow-lg hover:border-slate-300'
              }`}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#0F52BA] text-white text-[10px] font-bold uppercase tracking-[0.18em] shadow-md">
                  <Sparkles size={11} /> Most Popular
                </span>
              )}

              <div
                className={`text-[11px] font-bold uppercase tracking-[0.2em] ${
                  tier.highlight ? 'text-sky-300' : 'text-[#0F52BA]'
                }`}
              >
                {tier.name}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span
                  className={`font-display tracking-supertight font-bold text-5xl ${
                    tier.highlight ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {tier.price}
                </span>
                <span className={`font-body text-sm ${tier.highlight ? 'text-slate-400' : 'text-slate-500'}`}>
                  {tier.period}
                </span>
              </div>
              <p
                className={`mt-2 font-body text-[13px] ${
                  tier.highlight ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                {tier.tag}{' '}
                {tier.customised && (
                  <span className="opacity-70">(customised on demo)</span>
                )}
              </p>

              <ul className="mt-7 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
                    <Check
                      size={16}
                      strokeWidth={2.6}
                      className={`mt-0.5 shrink-0 ${
                        tier.highlight ? 'text-emerald-400' : 'text-emerald-600'
                      }`}
                    />
                    <span className={tier.highlight ? 'text-slate-200' : 'text-slate-700'}>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => onBookDemo(tier.id)}
                data-testid={`pricing-cta-${tier.id.toLowerCase()}`}
                className={`mt-8 w-full py-3 rounded-xl font-semibold text-sm transition-all ${
                  tier.highlight
                    ? 'bg-white text-slate-900 hover:bg-slate-100 shadow-md'
                    : 'bg-[#0F52BA] text-white hover:bg-[#0C4399] shadow-md'
                }`}
              >
                Book Demo
              </button>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center font-body text-[13px] text-slate-600">
          All plans include encrypted backups, role-based access, audit logs, and our
          <span className="text-slate-900 font-semibold"> data-security guarantee</span>.
        </p>
      </div>
    </section>
  );
}
