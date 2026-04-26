import React from 'react';
import { Shield } from 'lucide-react';

const COLUMNS = [
  { title: 'Product', links: [
    { label: 'Features',  href: '#features' },
    { label: 'Security',  href: '#security' },
    { label: 'Pricing',   href: '#pricing' },
    { label: 'FAQ',       href: '#faq' },
  ] },
  { title: 'Company', links: [
    { label: 'Contact',  href: 'mailto:hello@audinexa.com' },
    { label: 'Careers',  href: '#' },
    { label: 'Blog',     href: '#' },
  ] },
  { title: 'Legal & Trust', links: [
    { label: 'Privacy Policy',     href: '#' },
    { label: 'Terms of Service',   href: '#' },
    { label: 'DPDP Compliance',    href: '#' },
    { label: 'Security Whitepaper',href: '#' },
  ] },
];

export default function Footer() {
  return (
    <footer className="bg-[#0F172A] text-slate-300 pt-16 pb-12" data-testid="landing-footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] flex items-center justify-center shadow-md">
              <Shield size={18} className="text-white" strokeWidth={2.5} />
            </span>
            <span className="font-[Manrope,Inter,sans-serif] font-extrabold text-lg tracking-tight text-white">AUDINEXA</span>
          </div>
          <p className="mt-4 text-[13px] text-slate-400 leading-relaxed max-w-sm">
            The clinic software where even the platform cannot read your data. Built in India for audiology clinics worldwide.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-4">{col.title}</div>
            <ul className="space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-[13.5px] text-slate-300 hover:text-white transition">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-slate-500">
        <div>© {new Date().getFullYear()} AUDINEXA. ACS Labs · Mumbai, India.</div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> All systems operational
          </span>
        </div>
      </div>
    </footer>
  );
}
