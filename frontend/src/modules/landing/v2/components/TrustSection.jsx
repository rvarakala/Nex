import React from 'react';
import { KeyRound, ShieldCheck, Lock } from 'lucide-react';
import SectionHeading from './SectionHeading';

const CARDS = [
  { icon: KeyRound,    title: 'Your Key, Your Data',     body: 'Only your clinic unlocks records. The encryption key never leaves your control — not even with us.' },
  { icon: ShieldCheck, title: 'Zero-Knowledge Privacy',  body: 'Platform staff cannot casually access clinic data. Every read is gated by your authorisation.' },
  { icon: Lock,        title: 'Encrypted by Default',    body: 'Patient records, billing, files and reports stay protected — encrypted at rest, in transit, and on every device.' },
];

export default function TrustSection() {
  return (
    <section className="py-24 md:py-32 bg-white" data-testid="landing-trust">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          kicker="Why Clinics Trust Us"
          title="Privacy isn't a setting. It's the foundation."
          subtitle="AUDINEXA is engineered around a simple principle: your clinic's data belongs to your clinic — full stop."
        />
        <div className="mt-14 grid md:grid-cols-3 gap-6 lg:gap-8">
          {CARDS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="group relative rounded-2xl bg-white border border-slate-100 p-8 md:p-10 shadow-sm hover:shadow-2xl hover:shadow-[#0B5FFF]/8 hover:-translate-y-1 transition-all duration-300">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] flex items-center justify-center text-white shadow-md shadow-[#0B5FFF]/30 group-hover:scale-105 transition-transform">
                <Icon size={24} strokeWidth={2.2} />
              </div>
              <h3 className="mt-5 font-[Manrope,Inter,sans-serif] font-extrabold text-xl text-[#111827] tracking-tight">{title}</h3>
              <p className="mt-2 text-[#475569] text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
