/**
 * Testimonials — "Loved by Audiology Clinics".
 * 3 quote cards with 5-star rating, quote text, avatar + name + role.
 */
import React from 'react';
import { Star } from 'lucide-react';

const QUOTES = [
  {
    quote: 'We moved to AUDINEXA because of the security model. Our data is finally in safe hands — our own.',
    name: 'Dr. Rohit Verma',
    role: 'Hearing Wellness Clinic',
    initials: 'RV',
    avatarBg: 'bg-blue-100 text-blue-700',
  },
  {
    quote: 'Best software we\'ve used! Staff training was easy and the privacy controls give us complete peace of mind.',
    name: 'Anita Nair',
    role: 'Chief Audiologist',
    initials: 'AN',
    avatarBg: 'bg-emerald-100 text-emerald-700',
  },
  {
    quote: 'Multi-branch management is excellent. The encryption and audit logs are a big plus for our chain.',
    name: 'Manoj Kapoor',
    role: 'Director, HearCare India',
    initials: 'MK',
    avatarBg: 'bg-amber-100 text-amber-700',
  },
];

export default function Testimonials() {
  return (
    <section className="py-20 md:py-24 bg-white" data-testid="landing-testimonials">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-center font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#0F172A] text-3xl sm:text-4xl lg:text-[40px] leading-tight">
          Loved by Audiology Clinics
        </h2>

        <div className="mt-12 grid md:grid-cols-3 gap-6 lg:gap-7">
          {QUOTES.map((q) => (
            <figure
              key={q.name}
              className="rounded-2xl bg-white border border-slate-100 p-6 md:p-7 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="flex items-center gap-0.5 text-amber-400">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={16} fill="currentColor" strokeWidth={0} />
                ))}
              </div>
              <blockquote className="mt-4 text-[14.5px] text-[#334155] leading-relaxed">
                &ldquo;{q.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3">
                <span className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-[13px] ${q.avatarBg}`}>
                  {q.initials}
                </span>
                <span className="leading-tight">
                  <span className="block font-[Manrope,Inter,sans-serif] font-bold text-[14px] text-[#0F172A]">{q.name}</span>
                  <span className="block text-[12px] text-[#64748B] mt-0.5">{q.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
