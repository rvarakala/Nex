/**
 * Features — tight 5×2 grid of compact icon-tile cards with sub-titles.
 * Matches reference: "Everything Your Clinic Needs in One Secure Platform".
 * 10 items, 5 columns on lg+, 2 columns on mobile, 3 on sm.
 * Bottom: blue "Explore All Features →" CTA button.
 */
import React from 'react';
import {
  CalendarDays, Stethoscope, Activity, Receipt, Boxes,
  Wrench, Bell, BarChart3, Building2, Users2, ArrowRight,
} from 'lucide-react';

const FEATURES = [
  { icon: CalendarDays, title: 'Appointments',         body: 'Smart scheduling & calendar management' },
  { icon: Stethoscope,  title: 'Patient EMR',          body: 'Complete patient records & history' },
  { icon: Activity,     title: 'Audiology Tests',      body: 'Audiogram, tympanometry & test workflows' },
  { icon: Receipt,      title: 'Billing & Invoices',   body: 'GST invoicing, payments & settlements' },
  { icon: Boxes,        title: 'Inventory',            body: 'Hearing aids, stock & accessories' },
  { icon: Wrench,       title: 'Repairs & Service',    body: 'Track repairs, service & collection' },
  { icon: Bell,         title: 'Reminders',            body: 'WhatsApp / SMS automations' },
  { icon: BarChart3,    title: 'Reports & Analytics',  body: 'Powerful reports & business insights' },
  { icon: Building2,    title: 'Multi-Branch',         body: 'Manage multiple clinics from one place' },
  { icon: Users2,       title: 'Staff Management',     body: 'Roles, permissions & activity tracking' },
];

export default function Features({ onBookDemo }) {
  return (
    <section id="features" className="py-20 md:py-24 bg-white" data-testid="landing-features">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-center font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#0F172A] text-3xl sm:text-4xl lg:text-[40px] leading-tight">
          Everything Your Clinic Needs in <br className="hidden sm:block" />
          <span className="text-[#0B5FFF]">One Secure Platform</span>
        </h2>

        <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-xl bg-white border border-slate-200 px-4 py-5 hover:border-[#0B5FFF]/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className="w-9 h-9 rounded-lg bg-[#0B5FFF]/8 text-[#0B5FFF] flex items-center justify-center group-hover:bg-[#0B5FFF] group-hover:text-white transition-colors">
                <Icon size={17} strokeWidth={2.25} />
              </div>
              <h3 className="mt-3 font-[Manrope,Inter,sans-serif] font-bold text-[14px] text-[#111827] leading-snug">{title}</h3>
              <p className="mt-1 text-[11.5px] text-[#64748B] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <button
            onClick={onBookDemo}
            data-testid="features-explore-cta"
            className="inline-flex items-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] text-white px-7 py-3.5 rounded-xl font-semibold shadow-md shadow-[#0B5FFF]/25 hover:shadow-lg hover:shadow-[#0B5FFF]/35 transition-all"
          >
            Explore All Features <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
