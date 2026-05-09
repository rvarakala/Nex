import React from 'react';
import {
  KeyRound, Users, Timer, Smartphone, ShieldAlert,
  ScrollText, DatabaseBackup, LifeBuoy, Building2, BadgeCheck,
} from 'lucide-react';
import SectionHeading from './SectionHeading';

/**
 * SecurityShowcase — Swiss Brutalist data-heavy section. High contrast,
 * monochrome with sapphire-blue accents. Calls out the security primitives
 * that win the trust conversation in B2B healthcare.
 */
const ITEMS = [
  {
    icon: KeyRound,
    title: 'Encrypted at rest',
    body: 'AES-256 across the database, file storage, and every daily backup snapshot. Keys rotated on schedule.',
    big: true,
  },
  {
    icon: Building2,
    title: 'India-resident',
    body: 'Hosted on Indian infrastructure. DPDPA-aligned data residency, audit-ready.',
  },
  {
    icon: Users,
    title: 'Role-based access',
    body: 'Owner, audiologist, front desk, accounts — each role sees only what they need.',
  },
  {
    icon: ScrollText,
    title: 'Tamper-proof audit log',
    body: 'Every login, edit, export and impersonation — signed and immutable.',
  },
  {
    icon: ShieldAlert,
    title: 'Brute-force protected',
    body: 'Failed logins throttled, IPs blocked, owners alerted in real time.',
  },
  {
    icon: Timer,
    title: 'Auto-logout idle sessions',
    body: 'Patient data never sits exposed on a forgotten reception laptop.',
  },
  {
    icon: Smartphone,
    title: 'Device & login alerts',
    body: 'Owners notified on every new sign-in. Approve, review, or revoke in one tap.',
  },
  {
    icon: DatabaseBackup,
    title: 'Tested daily backups',
    body: 'Daily encrypted snapshots + a documented restore drill that runs every quarter.',
  },
  {
    icon: LifeBuoy,
    title: 'Recovery without compromise',
    body: 'Recovery codes, multi-admin approval, time-locked emergency reset — without back-doors.',
  },
  {
    icon: BadgeCheck,
    title: 'Compliance-ready',
    body: 'Built for India\'s DPDP Act and aligned to global healthcare privacy standards.',
  },
];

export default function SecurityShowcase() {
  return (
    <section
      id="security"
      data-testid="landing-security"
      className="py-24 md:py-32 bg-slate-900 text-white relative overflow-hidden"
    >
      {/* Glow accents */}
      <div
        aria-hidden="true"
        className="absolute -top-40 -right-40 w-[36rem] h-[36rem] rounded-full bg-[#0F52BA]/25 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 -left-40 w-[28rem] h-[28rem] rounded-full bg-emerald-500/10 blur-[100px]"
      />

      <div className="relative max-w-7xl mx-auto px-6 md:px-12">
        <div className="max-w-3xl mb-12 md:mb-16">
          <div className="text-xs tracking-[0.22em] uppercase font-semibold text-emerald-300 mb-4">
            <span className="inline-flex items-center gap-2">
              <span className="h-px w-8 bg-emerald-400" /> Security architecture
            </span>
          </div>
          <h2 className="font-display tracking-supertight font-bold text-white text-3xl sm:text-4xl lg:text-5xl leading-[1.05]">
            The trust layer your IT team would have demanded —{' '}
            <span className="text-emerald-300">already built in.</span>
          </h2>
          <p className="font-body text-base sm:text-lg text-slate-300 leading-relaxed mt-5 max-w-2xl">
            No add-ons. No expensive consultants. Every primitive a modern
            healthcare SaaS owes its customers — shipped on day one.
          </p>
        </div>

        {/* Bento grid: 1 large feature card + 9 compact tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ITEMS.map(({ icon: Icon, title, body, big }, i) => (
            <div
              key={title}
              data-testid={`security-tile-${i}`}
              className={`group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 transition-all duration-300 hover:border-emerald-400/40 hover:bg-white/[0.07] ${
                big ? 'lg:col-span-2 lg:row-span-1 lg:p-8' : ''
              }`}
            >
              <div
                className={`inline-flex items-center justify-center rounded-xl bg-[#0F52BA]/15 text-[#7EB1FF] ${
                  big ? 'w-12 h-12' : 'w-10 h-10'
                }`}
              >
                <Icon size={big ? 22 : 18} strokeWidth={2.2} />
              </div>
              <h3
                className={`font-display tracking-supertight font-bold text-white mt-4 ${
                  big ? 'text-2xl' : 'text-base'
                }`}
              >
                {title}
              </h3>
              <p
                className={`font-body text-slate-300 leading-relaxed mt-2 ${
                  big ? 'text-[15px] max-w-md' : 'text-[13px]'
                }`}
              >
                {body}
              </p>
            </div>
          ))}
        </div>

        {/* Bottom rail — proof line */}
        <div className="mt-12 md:mt-14 flex flex-wrap items-center justify-between gap-6 border-t border-white/10 pt-8">
          <div className="font-body text-[13px] text-slate-400 max-w-md">
            We commit to a quarterly external security review and publish a
            <span className="text-white font-semibold"> public status page</span> —
            because trust is something you earn in writing.
          </div>
          <div className="flex flex-wrap gap-2">
            {['DPDPA', 'AES-256', 'Audit log', 'India-resident', 'TLS 1.3'].map((b) => (
              <span
                key={b}
                className="px-3 py-1.5 rounded-full bg-white/5 border border-white/15 text-[11px] font-bold tracking-[0.16em] uppercase text-emerald-300"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
