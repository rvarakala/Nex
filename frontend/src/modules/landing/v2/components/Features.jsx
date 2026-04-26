import React from 'react';
import {
  CalendarDays, ClipboardList, FileHeart, Activity, Receipt,
  Boxes, Wrench, MessageCircle, BarChart3, Building2,
} from 'lucide-react';
import SectionHeading from './SectionHeading';

const FEATURES = [
  { icon: CalendarDays,   title: 'Appointments & Scheduling',  body: 'Day, week, month and resource views. Drag to reschedule. Multi-clinic toggle.' },
  { icon: ClipboardList,  title: 'Front Desk Registration',     body: 'Fast intake, returning-patient lookup, queue tokens, and printable receipts.' },
  { icon: FileHeart,      title: 'Patient EMR',                 body: 'Single timeline of every visit, test, fitting, follow-up — searchable in seconds.' },
  { icon: Activity,       title: 'Audiology Test Workflow',     body: 'PTA, speech, tympanometry, OAE, ABR — guided flows with auto-saved drafts.' },
  { icon: Receipt,        title: 'Billing + GST Invoices',      body: 'Service catalogue, GSTIN-aware invoices, partial payments, and printable challans.' },
  { icon: Boxes,          title: 'Hearing Aid Inventory',       body: 'Serial-tracked stock, branch transfers, signed delivery challans, warranty tracking.' },
  { icon: Wrench,         title: 'Repairs & Service Tracking',  body: 'Tickets from intake to dispatch with technician hand-offs and warranty checks.' },
  { icon: MessageCircle,  title: 'WhatsApp / SMS Reminders',    body: 'Appointment confirmations, follow-ups, and report delivery — all from one inbox.' },
  { icon: BarChart3,      title: 'Reports Dashboard',           body: 'Daily collections, conversion funnels, audiologist productivity, and more.' },
  { icon: Building2,      title: 'Multi-Location Management',   body: 'Open more branches without re-installing software. Central oversight, local autonomy.' },
];

export default function Features() {
  return (
    <section id="features" className="py-24 md:py-32 bg-white" data-testid="landing-features">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          kicker="Product Features"
          title="Everything your clinic needs in one secure platform"
          subtitle="Stop stitching together five tools. AUDINEXA covers the full audiology workflow — front desk to fitting."
        />
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 lg:gap-5">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-xl bg-white border border-slate-100 p-5 hover:border-[#0B5FFF]/30 hover:bg-gradient-to-br hover:from-white hover:to-[#0B5FFF]/2 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="w-9 h-9 rounded-lg bg-[#0B5FFF]/8 text-[#0B5FFF] flex items-center justify-center group-hover:bg-[#0B5FFF] group-hover:text-white transition-colors">
                <Icon size={17} strokeWidth={2.25} />
              </div>
              <h3 className="mt-3.5 font-[Manrope,Inter,sans-serif] font-bold text-[14px] text-[#111827] leading-snug">{title}</h3>
              <p className="mt-1 text-[12px] text-[#475569] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
