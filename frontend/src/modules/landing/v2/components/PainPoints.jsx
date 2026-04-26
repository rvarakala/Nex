import React from 'react';
import { FileSpreadsheet, KeySquare, FileX2, MonitorDown, HardDriveDownload, EyeOff, UserX, ArrowRight } from 'lucide-react';

const PAINS = [
  { icon: FileSpreadsheet,  label: 'Excel sheets nobody backs up' },
  { icon: KeySquare,        label: 'Shared logins / passwords' },
  { icon: FileX2,           label: 'Paper files lost in cabinets' },
  { icon: MonitorDown,      label: 'Local PC crashes wipe records' },
  { icon: HardDriveDownload,label: 'Backups that nobody tested' },
  { icon: EyeOff,           label: 'No audit logs of who saw what' },
  { icon: UserX,            label: 'Staff misuse going untraced' },
];

export default function PainPoints() {
  return (
    <section className="relative py-24 md:py-32 bg-[#0F172A] overflow-hidden" data-testid="landing-pain">
      {/* Subtle dotted overlay */}
      <div aria-hidden className="absolute inset-0 opacity-[0.04] [background-image:radial-gradient(rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-300">
            The hidden risk
          </span>
          <h2 className="mt-4 font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-white text-3xl sm:text-4xl lg:text-5xl leading-tight">
            Still storing sensitive patient data in unsafe systems?
          </h2>
          <p className="mt-4 text-slate-300 text-base sm:text-lg leading-relaxed">
            Every clinic we've spoken to runs on at least three of these. Each one is a breach waiting to happen.
          </p>
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {PAINS.map(({ icon: Icon, label }) => (
            <div key={label} className="bg-white/5 border border-white/10 backdrop-blur-sm rounded-xl px-4 py-4 flex items-center gap-3 hover:bg-white/8 transition">
              <span className="w-9 h-9 shrink-0 rounded-lg bg-rose-500/15 text-rose-300 flex items-center justify-center">
                <Icon size={17} strokeWidth={2.2} />
              </span>
              <span className="text-[13px] text-slate-200 font-medium">{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-12 max-w-2xl mx-auto bg-gradient-to-r from-[#0B5FFF]/15 to-[#00C2A8]/15 border border-white/15 rounded-2xl px-6 py-5 flex items-center gap-4 text-center sm:text-left">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] flex items-center justify-center text-white shadow-lg">
            <ArrowRight size={18} strokeWidth={2.5} />
          </div>
          <p className="text-slate-100 text-sm sm:text-base font-medium">
            <span className="text-white font-semibold">AUDINEXA replaces all of this</span> with modern, encrypted, cloud workflows your team will actually use.
          </p>
        </div>
      </div>
    </section>
  );
}
