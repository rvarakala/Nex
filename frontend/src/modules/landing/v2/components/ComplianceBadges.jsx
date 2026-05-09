/**
 * ComplianceBadges — India-first B2B trust strip.
 *
 * Important: this is NOT decorative. We deliberately swap HIPAA (US-only) for
 * DPDPA (India), keep ISO 27001 as "aligned" (we follow the controls but are
 * not yet certified — being honest), and add Razorpay-secured + India-resident
 * + Daily-encrypted-backups + AES-256 to make the trust posture concrete.
 */
import React from 'react';
import {
  ShieldCheck, Building2, Lock, DatabaseBackup, ScrollText, KeyRound,
} from 'lucide-react';

const BADGES = [
  {
    icon: ShieldCheck,
    label: 'DPDPA-aligned',
    sub: 'India · 2023 Act',
  },
  {
    icon: ScrollText,
    label: 'ISO 27001-aligned',
    sub: 'Controls implemented',
  },
  {
    icon: Building2,
    label: 'India-resident',
    sub: 'Data on Indian servers',
  },
  {
    icon: KeyRound,
    label: 'AES-256 at rest',
    sub: 'DB + backups',
  },
  {
    icon: DatabaseBackup,
    label: 'Daily backups',
    sub: 'Tested restore drills',
  },
  {
    icon: Lock,
    label: 'Razorpay-secured',
    sub: 'PCI-DSS payments',
  },
];

export default function ComplianceBadges() {
  return (
    <section
      data-testid="compliance-badges"
      className="bg-white py-12 md:py-16 border-b border-slate-200/70"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="text-center mb-8">
          <div className="text-[10.5px] tracking-[0.22em] uppercase font-semibold text-slate-500">
            Trust posture · audit-ready from day one
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {BADGES.map(({ icon: Icon, label, sub }, i) => (
            <div
              key={label}
              data-testid={`compliance-badge-${i}`}
              className="group relative flex items-center gap-3 px-4 py-3.5 rounded-xl bg-[#F8FAFC] border border-slate-200 hover:border-[#0F52BA]/40 hover:bg-white hover:shadow-sm transition-all"
            >
              <div className="shrink-0 w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[#0F52BA] group-hover:bg-[#0F52BA] group-hover:text-white group-hover:border-[#0F52BA] transition-colors">
                <Icon size={16} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="font-display tracking-supertight font-bold text-[12.5px] text-slate-900 leading-tight">
                  {label}
                </div>
                <div className="font-body text-[10.5px] text-slate-500 leading-tight mt-0.5 truncate">
                  {sub}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-[11.5px] text-slate-500">
          <span>
            We don't claim certifications we don't have.
          </span>
          <a
            href="#security"
            className="text-[#0F52BA] font-semibold hover:underline underline-offset-4"
            data-testid="compliance-read-more"
          >
            Read the full architecture →
          </a>
        </div>
      </div>
    </section>
  );
}
