/**
 * PrintTemplatesTab — landing screen for printable clinic stationery.
 *
 * First entry: Blank Audiogram. Designed as a grid so we can add Blank
 * Tympanogram, Blank Case History, Consent form etc. without re-layout.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Printer, Activity, ArrowRight, FileText } from 'lucide-react';
import SealPlacementCard from './SealPlacementCard';

const TEMPLATES = [
  {
    id: 'audiogram',
    title: 'Blank Audiogram (PTA)',
    blurb: 'A4 portrait · 2 charts (Right + Left) · standard symbols · hand-fillable. Print or save to PDF.',
    icon: Activity,
    to: '/settings/templates/audiogram',
    ready: true,
    badge: 'Ready',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    testid: 'tpl-card-audiogram',
  },
  // Future templates — surface them so the user knows what's coming.
  {
    id: 'tympanogram',
    title: 'Blank Tympanogram',
    blurb: 'Single-page tympanogram chart with Type A/B/C reference curves. Coming next.',
    icon: Activity,
    to: '#',
    ready: false,
    badge: 'Coming soon',
    badgeColor: 'bg-slate-100 text-slate-500 border-slate-200',
    testid: 'tpl-card-tympanogram',
  },
  {
    id: 'case-history',
    title: 'Blank Case History',
    blurb: 'One-page intake form: complaints · onset · medical history · noise exposure · habits.',
    icon: FileText,
    to: '#',
    ready: false,
    badge: 'Coming soon',
    badgeColor: 'bg-slate-100 text-slate-500 border-slate-200',
    testid: 'tpl-card-case-history',
  },
];

export default function PrintTemplatesTab() {
  return (
    <div className="p-6 max-w-5xl" data-testid="print-templates-tab">
      <div className="flex items-center gap-2 text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
        <Printer size={12} /> Print Templates
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mt-1">Print Templates</h2>
      <p className="text-sm text-slate-600 mt-1 max-w-2xl">
        Blank, hand-fillable forms with your clinic letterhead. Open one and use
        your browser&apos;s print dialog → <b>Save as PDF</b> or send to a printer.
      </p>

      <SealPlacementCard />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {TEMPLATES.map((t) => {
          const Icon = t.icon;
          const card = (
            <div
              data-testid={t.testid}
              className={`group h-full border rounded-xl p-5 transition ${
                t.ready
                  ? 'bg-white border-slate-200 hover:border-[#0F52BA] hover:shadow-md cursor-pointer'
                  : 'bg-slate-50 border-slate-200 opacity-90 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start justify-between">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    t.ready ? 'bg-[#0F52BA]/10 text-[#0F52BA]' : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  <Icon size={18} strokeWidth={2.2} />
                </div>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${t.badgeColor}`}
                >
                  {t.badge}
                </span>
              </div>

              <h3 className="font-bold text-slate-900 text-[15px] mt-4">{t.title}</h3>
              <p className="font-body text-[12.5px] text-slate-600 mt-1.5 leading-relaxed">
                {t.blurb}
              </p>

              {t.ready && (
                <div className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[#0F52BA] group-hover:gap-2 transition-all">
                  Open template <ArrowRight size={13} />
                </div>
              )}
            </div>
          );

          return t.ready ? (
            <Link key={t.id} to={t.to} className="block">
              {card}
            </Link>
          ) : (
            <div key={t.id}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
