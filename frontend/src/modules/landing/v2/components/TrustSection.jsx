/**
 * TrustSection — "Why Clinics Trust AUDINEXA": 3 light pastel cards.
 * Matches reference: soft circular icon backgrounds (mint, sky, mint),
 * centered text, light section background.
 */
import React from 'react';
import { KeyRound, ShieldCheck, Lock } from 'lucide-react';

const CARDS = [
  {
    icon: KeyRound,
    iconWrap: 'bg-emerald-100 text-emerald-600',
    title: 'Your Key, Your Data',
    body: 'Your clinic controls the encryption key. Only you can unlock your data.',
  },
  {
    icon: ShieldCheck,
    iconWrap: 'bg-[#0B5FFF]/10 text-[#0B5FFF]',
    title: 'Zero-Knowledge Privacy',
    body: 'Even AUDINEXA cannot read your clinic data without your key.',
  },
  {
    icon: Lock,
    iconWrap: 'bg-emerald-100 text-emerald-600',
    title: 'Encrypted by Default',
    body: 'All patient records, files, billing, reports & backups are encrypted.',
  },
];

export default function TrustSection() {
  return (
    <section className="py-20 md:py-24 bg-white" data-testid="landing-trust">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-center font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#0F172A] text-3xl sm:text-4xl lg:text-[40px] leading-tight">
          Why Clinics Trust <span className="text-[#0B5FFF]">AUDINEXA</span>
        </h2>

        <div className="mt-12 grid md:grid-cols-3 gap-6 lg:gap-8">
          {CARDS.map(({ icon: Icon, iconWrap, title, body }) => (
            <div
              key={title}
              className="rounded-2xl bg-white border border-slate-100 p-7 md:p-8 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 text-center"
            >
              <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${iconWrap}`}>
                <Icon size={26} strokeWidth={2.2} />
              </div>
              <h3 className="mt-5 font-[Manrope,Inter,sans-serif] font-extrabold text-lg text-[#0F172A] tracking-tight">{title}</h3>
              <p className="mt-2 text-[13.5px] text-[#64748B] leading-relaxed max-w-[28ch] mx-auto">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
