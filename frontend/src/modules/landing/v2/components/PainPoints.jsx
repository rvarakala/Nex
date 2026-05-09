import React from 'react';
import SectionHeading from './SectionHeading';
import {
  PenTool, FileSpreadsheet, Boxes, ShieldCheck,
  ArrowRight, X, Check,
} from 'lucide-react';

/**
 * PainPoints — speaks the truth every audiology owner already knows:
 * 1. Audiograms / tympanograms are STILL plotted manually (paper or a 3rd-party app)
 * 2. Billing happens in a different software / Excel
 * 3. Inventory + HA-serial tracking lives in yet another place
 * 4. And the silent worry behind all of it: "Where does my data actually live?"
 */

const PAINS = [
  {
    icon: PenTool,
    label: 'Manual audiograms',
    today:    'You plot the audiogram on paper, then re-draw it in a 3rd-party charting app. Tympanogram printouts get stapled into the file.',
    audinexa: 'Plot PTA + tymp inside AUDINEXA — the chart auto-saves to the patient record and prints with your clinic header.',
    accent: '#E11D48',
  },
  {
    icon: FileSpreadsheet,
    label: 'Billing in Excel',
    today:    'After the test, the front desk types the same patient details into a billing sheet or a separate invoicing software. GST split done by hand.',
    audinexa: 'One click from the test screen → GST-ready invoice with CGST/SGST/IGST auto-split. Print or share via WhatsApp instantly.',
    accent: '#0F52BA',
  },
  {
    icon: Boxes,
    label: 'Inventory in spreadsheets',
    today:    'Hearing-aid serials, trial loaners, AMC contracts — tracked in a different spreadsheet that nobody updates on time.',
    audinexa: 'Every fitting auto-decrements stock. Side-aware (L / R / both) serial register with AMC + warranty timers built in.',
    accent: '#0F766E',
  },
];

export default function PainPoints() {
  return (
    <section
      data-testid="pain-section"
      className="py-24 md:py-32 bg-[#F8FAFC]"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <SectionHeading
          eyebrow="The everyday clinic stack"
          title="Three different apps. Three different sheets. Zero peace of mind."
          lede="Modern audiology clinics still juggle paper audiograms, Excel for billing, and a separate spreadsheet for HA inventory. Every silo costs a few minutes a patient — and every silo is a place your data can leak from."
          testid="pain-heading"
          align="left"
        />

        {/* Three pain cards (today vs AUDINEXA) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {PAINS.map((p, i) => {
            const Icon = p.icon;
            return (
              <article
                key={p.label}
                data-testid={`pain-card-${i}`}
                className="group bg-white rounded-2xl border border-slate-200 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:-translate-y-1 hover:shadow-lg hover:border-slate-300 transition-all duration-300 overflow-hidden flex flex-col"
              >
                {/* Header */}
                <div className="p-6 md:p-7 border-b border-slate-100">
                  <div
                    className="inline-flex items-center justify-center w-11 h-11 rounded-xl"
                    style={{ backgroundColor: `${p.accent}12`, color: p.accent }}
                  >
                    <Icon size={20} strokeWidth={2.2} />
                  </div>
                  <h3 className="font-display tracking-supertight font-bold text-slate-900 text-xl mt-4">
                    {p.label}
                  </h3>
                </div>

                {/* Today */}
                <div className="px-6 md:px-7 py-5 bg-rose-50/40 border-b border-slate-100">
                  <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.18em] uppercase text-rose-700">
                    <X size={12} strokeWidth={2.6} /> Today
                  </div>
                  <p className="font-body text-[14px] text-slate-700 leading-relaxed mt-2">
                    {p.today}
                  </p>
                </div>

                {/* AUDINEXA */}
                <div className="px-6 md:px-7 py-5 flex-1 bg-white">
                  <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.18em] uppercase text-emerald-700">
                    <Check size={12} strokeWidth={2.6} /> With AUDINEXA
                  </div>
                  <p className="font-body text-[14px] text-slate-800 leading-relaxed mt-2">
                    {p.audinexa}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        {/* The trust band — the silent question every clinic asks */}
        <div
          data-testid="pain-trust-band"
          className="mt-12 md:mt-14 relative overflow-hidden rounded-3xl bg-slate-900 text-white p-8 md:p-12"
        >
          <div
            aria-hidden="true"
            className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-[#0F52BA]/30 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="absolute -left-32 -bottom-40 w-[28rem] h-[28rem] rounded-full bg-emerald-500/10 blur-3xl"
          />

          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-semibold tracking-[0.16em] uppercase text-emerald-300">
                <ShieldCheck size={12} /> The unspoken question
              </div>
              <h3 className="font-display tracking-supertight font-bold text-3xl md:text-4xl leading-tight mt-5">
                "Three apps means three places my patient data could leak from."
              </h3>
              <p className="font-body text-[15px] md:text-base text-slate-300 leading-relaxed mt-5 max-w-2xl">
                That's the question every clinic owner asks before signing up for
                <em> any</em> software. AUDINEXA was built so you can answer it
                with confidence — to your patients, to a regulator, and to
                yourself.
              </p>
            </div>

            <ul className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { t: 'India-resident',     s: 'All data on Indian servers. DPDPA-aligned.' },
                { t: 'Encrypted at rest',  s: 'AES-256 across DB + daily backups.' },
                { t: 'Role-based access',  s: 'Audiologist / front desk / accounts — only what they need.' },
                { t: 'Tamper-proof log',   s: 'Every login + edit + export, signed and timestamped.' },
              ].map((x) => (
                <li
                  key={x.t}
                  className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-[12px] font-bold text-emerald-300">
                    <Check size={13} strokeWidth={2.6} /> {x.t}
                  </div>
                  <div className="text-[12.5px] text-slate-300 mt-1 leading-snug">{x.s}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mt-8 flex items-center justify-between flex-wrap gap-4">
            <span className="text-[12.5px] text-slate-400">
              Read the full security architecture →{' '}
              <a href="#security" className="text-emerald-300 hover:text-emerald-200 underline-offset-4 underline">
                Security showcase
              </a>
            </span>
            <a
              href="#features"
              className="group inline-flex items-center gap-2 text-[13px] font-semibold text-white"
              data-testid="pain-trust-explore"
            >
              See the unified workspace
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
