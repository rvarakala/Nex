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
      'Appointments & EMR',
      'Audiology test workflow',
      'Billing + GST invoices',
      'Encrypted backups',
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
      'Hearing aid inventory + service',
      'WhatsApp / SMS reminders',
      'Reports dashboard',
      'Multi-admin recovery',
      'Priority support',
    ],
    highlight: true,
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    price: '₹15,999',
    period: '/year',
    tag: 'Multi-branch chains + BYOK',
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
    <section id="pricing" className="py-24 md:py-32 bg-[#F8FAFC]" data-testid="landing-pricing">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          kicker="Pricing"
          title="Simple, transparent, clinic-friendly"
          subtitle="One yearly plan. No per-seat surprises. Cancel anytime."
        />

        <div className="mt-14 grid md:grid-cols-3 gap-6 lg:gap-7">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              data-testid={`pricing-tier-${tier.id.toLowerCase()}`}
              className={`relative rounded-2xl p-7 md:p-8 transition-all duration-300 ${
                tier.highlight
                  ? 'bg-gradient-to-br from-[#0B5FFF] to-[#1A3FB8] text-white shadow-2xl shadow-[#0B5FFF]/30 lg:-translate-y-3 lg:scale-[1.02]'
                  : 'bg-white border border-slate-200 hover:shadow-xl'
              }`}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#00C2A8] text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                  <Sparkles size={11} /> Most Popular
                </span>
              )}

              <div className={`text-[11px] font-bold uppercase tracking-wider ${tier.highlight ? 'text-blue-200' : 'text-[#0B5FFF]'}`}>
                {tier.name}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className={`font-[Manrope,Inter,sans-serif] font-extrabold text-4xl ${tier.highlight ? 'text-white' : 'text-[#111827]'}`}>
                  {tier.price}
                </span>
                <span className={`text-sm ${tier.highlight ? 'text-blue-200' : 'text-slate-500'}`}>{tier.period}</span>
              </div>
              <p className={`mt-1 text-[12.5px] ${tier.highlight ? 'text-blue-100' : 'text-[#475569]'}`}>
                {tier.tag} {tier.customised && <span className="opacity-70">(customised on demo)</span>}
              </p>

              <ul className="mt-6 space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px]">
                    <Check
                      size={15}
                      strokeWidth={2.6}
                      className={`mt-0.5 shrink-0 ${tier.highlight ? 'text-[#00C2A8]' : 'text-[#16A34A]'}`}
                    />
                    <span className={tier.highlight ? 'text-blue-50' : 'text-[#334155]'}>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => onBookDemo(tier.id)}
                data-testid={`pricing-cta-${tier.id.toLowerCase()}`}
                className={`mt-7 w-full py-3 rounded-xl font-semibold text-sm transition-all ${
                  tier.highlight
                    ? 'bg-white text-[#0B5FFF] hover:bg-blue-50 shadow-md'
                    : 'bg-[#0B5FFF] text-white hover:bg-[#094acf] shadow-md'
                }`}
              >
                Book Demo
              </button>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-[12.5px] text-[#475569]">
          All plans include encrypted backups, role-based access, audit logs, and our security guarantee.
        </p>
      </div>
    </section>
  );
}
