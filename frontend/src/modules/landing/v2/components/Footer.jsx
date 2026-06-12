import React from 'react';
import { Shield } from 'lucide-react';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features',    href: '#features' },
      { label: 'How it works', href: '#how' },
      { label: 'Security',    href: '#security' },
      { label: 'FAQ',         href: '#faq' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Contact',  href: '/contact' },
      { label: 'Careers',  href: '#' },
      { label: 'Blog',     href: '#' },
    ],
  },
  {
    title: 'Legal & Trust',
    links: [
      { label: 'Privacy Policy',         href: '/privacy' },
      { label: 'Terms of Service',       href: '/terms' },
      { label: 'Refund & Cancellation',  href: '/refund' },
      { label: 'DPDPA Compliance',       href: '/privacy' },
    ],
  },
];

export default function Footer() {
  return (
    <footer
      data-testid="landing-footer"
      className="bg-slate-900 text-slate-300 pt-20 pb-12 border-t border-white/5"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 grid lg:grid-cols-[1.6fr_1fr_1fr_1fr] gap-10 md:gap-12">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-[#0F52BA] flex items-center justify-center shadow-md">
              <Shield size={18} className="text-white" strokeWidth={2.5} />
            </span>
            <span className="font-display tracking-supertight font-bold text-xl text-white">
              AUDINEXA
            </span>
          </div>
          <p className="font-body mt-5 text-[14px] text-slate-400 leading-relaxed max-w-sm">
            The clinic software where audiogram, billing, inventory and security
            live on the same screen. Built in India for audiology clinics
            worldwide.
          </p>

          <div className="mt-6 flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10.5px] font-bold tracking-[0.16em] uppercase text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              All systems operational
            </span>
          </div>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-5">
              {col.title}
            </div>
            <ul className="space-y-3">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="font-body text-[14px] text-slate-300 hover:text-white transition-colors"
                    data-testid={`footer-link-${l.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-12 mt-14 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-slate-500">
        <div>© {new Date().getFullYear()} AUDINEXA · ACS Labs · Mumbai, India.</div>
        <div className="flex items-center gap-5">
          <span className="font-body">DPDPA-aligned · India-resident · AES-256</span>
        </div>
      </div>
    </footer>
  );
}
