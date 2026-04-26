import React from 'react';
import {
  KeyRound, Users, Timer, Smartphone, ShieldAlert,
  ScrollText, DatabaseBackup, LifeBuoy, Building2, BadgeCheck,
} from 'lucide-react';
import SectionHeading from './SectionHeading';

// Bento-style grid — first card is wide, rest are 1-col on lg.
const ITEMS = [
  { icon: KeyRound,        title: 'Client-Controlled Master Key',     body: 'Each clinic sets their own encryption key during onboarding. Never visible to AUDINEXA staff.', span: 'lg:col-span-2' },
  { icon: Users,           title: 'Role-Based Staff Access',          body: 'Owner, audiologist, front desk, technician, accountant — each role sees only what they need.' },
  { icon: Timer,           title: 'Session Auto-Logout',              body: 'Idle terminals auto-lock after a role-based timeout. Patient data never sits exposed on a forgotten laptop.' },
  { icon: Smartphone,      title: 'Device & Login Alerts',            body: 'Owners are notified on every new sign-in. Approve, review, or revoke with one tap.' },
  { icon: ShieldAlert,     title: 'Failed-Login Protection',          body: 'Brute-force attempts are throttled and locked. We watch the front door so you don\'t have to.' },
  { icon: ScrollText,      title: 'Tamper-Evident Audit Logs',        body: 'Every sensitive action is logged immutably — who, what, when, from where.' },
  { icon: DatabaseBackup,  title: 'Encrypted Backups',                body: 'Daily snapshots stored encrypted. Restore requires your clinic key — no shortcut, even for us.' },
  { icon: LifeBuoy,        title: 'Secure Recovery Options',          body: 'Recovery codes, multi-admin approval, and time-locked emergency reset — without compromising the model.' },
  { icon: Building2,       title: 'Multi-Branch Controls',            body: 'Branch-level data isolation, central oversight. Open new locations without re-architecting.' },
  { icon: BadgeCheck,      title: 'Compliance-Ready Architecture',    body: 'Built with India\'s DPDP Act in mind, plus aligned to global healthcare privacy standards.' },
];

export default function SecurityShowcase() {
  return (
    <section id="security" className="py-24 md:py-32 bg-[#F8FAFC]" data-testid="landing-security">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          kicker="Security Showcase"
          title="Enterprise security, made simple for clinics"
          subtitle="Every layer your IT team would have demanded — already built in. No add-ons, no expensive consultants."
        />
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {ITEMS.map(({ icon: Icon, title, body, span }, i) => (
            <div
              key={title}
              className={`group relative rounded-2xl bg-white border border-slate-100 p-6 lg:p-7 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ${span || ''}`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#0B5FFF]/10 to-[#00C2A8]/10 flex items-center justify-center text-[#0B5FFF] group-hover:from-[#0B5FFF] group-hover:to-[#00C2A8] group-hover:text-white transition-colors">
                <Icon size={20} strokeWidth={2.2} />
              </div>
              <h3 className="mt-4 font-[Manrope,Inter,sans-serif] font-bold text-base text-[#111827]">{title}</h3>
              <p className="mt-1.5 text-[13px] text-[#475569] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
