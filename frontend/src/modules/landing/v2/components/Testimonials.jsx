import React from 'react';
import SectionHeading from './SectionHeading';

const QUOTES = [
  {
    body: '“We replaced three different tools — patient register, invoicing, and a WhatsApp follow-up sheet — with AUDINEXA in a week. My audiologists stopped dreading Mondays.”',
    name: 'Dr. Ravindar Reddy',
    title: 'Owner, Harmony Hearing · Hyderabad',
  },
  {
    body: '“The HA serial tracking alone justified the price. I used to lose ₹40-50k a quarter to mis-recorded fittings. That\'s gone now.”',
    name: 'Dr. Anjali Mehta',
    title: 'Founder, The Sound Clinic · Bengaluru',
  },
  {
    body: '“GST and AMC tracking were the parts I was scared of. AUDINEXA shipped them on day one. My CA called to ask what we changed.”',
    name: 'Sandeep Verma',
    title: 'Director, Verma Audiology · Pune',
  },
];

export default function Testimonials() {
  return (
    <section data-testid="testimonials-section" className="py-24 md:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <SectionHeading
          eyebrow="Why clinic owners stay"
          title="The reviews aren't from us. They're from the people running the floor."
          testid="testimonials-heading"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {QUOTES.map((q, i) => (
            <figure
              key={i}
              data-testid={`testimonial-${i}`}
              className="relative rounded-3xl bg-[#F8FAFC] border border-slate-200 p-7 md:p-8 hover:border-[#0F52BA]/40 transition-colors"
            >
              <div className="font-display text-7xl text-[#0F52BA]/20 leading-none -mt-1 mb-2 select-none">
                ❝
              </div>
              <blockquote className="font-body text-[15px] sm:text-base text-slate-800 leading-relaxed italic">
                {q.body}
              </blockquote>
              <figcaption className="mt-6 pt-5 border-t border-slate-200">
                <div className="font-display font-bold tracking-tight text-slate-900 text-[15px]">
                  {q.name}
                </div>
                <div className="font-body text-[12px] text-slate-500 mt-0.5">
                  {q.title}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
