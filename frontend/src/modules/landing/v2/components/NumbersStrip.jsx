/**
 * NumbersStrip — live, honest social-proof numbers fetched from
 * /api/public/landing-stats. We deliberately don't fake huge numbers —
 * showing real, modest beta numbers with a "Live count" badge is more
 * credible to a B2B audiology owner than "120,000+ Patients Managed".
 */
import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

const STATS = [
  { key: 'clinics_onboarded',     label: 'Clinics onboarded',     suffix: '+' },
  { key: 'patients_managed',      label: 'Patients managed',      suffix: '+' },
  { key: 'hearing_aids_tracked',  label: 'Hearing aids tracked',  suffix: '+' },
  { key: 'data_sovereign_pct',    label: 'Data sovereign',        suffix: '%' },
];

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export default function NumbersStrip() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    axios
      .get(`${API}/api/public/landing-stats`)
      .then((r) => setStats(r.data))
      .catch(() => setStats({})); // soft-fail
  }, []);

  return (
    <section
      data-testid="numbers-strip"
      className="relative bg-[#FDFDFD] border-y border-slate-200/70"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-8 md:py-10">
        <div className="flex items-center justify-between flex-wrap gap-y-4 gap-x-8">
          {/* Live badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10.5px] font-bold tracking-[0.18em] uppercase text-emerald-700">
            <Activity size={12} />
            <span>Live count</span>
            <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>

          {/* Numbers row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-10 flex-1 md:max-w-4xl">
            {STATS.map((s) => {
              const v = stats?.[s.key];
              return (
                <div key={s.key} data-testid={`numbers-${s.key}`} className="text-left">
                  <div className="font-display tracking-supertight font-bold text-slate-900 text-3xl sm:text-4xl leading-none">
                    {fmt(v)}
                    <span className="text-[#0F52BA]">{s.suffix}</span>
                  </div>
                  <div className="font-body text-[12px] text-slate-500 mt-1.5 leading-tight">
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Honesty footer */}
        <div className="mt-6 flex items-center justify-between flex-wrap gap-3 pt-5 border-t border-slate-100">
          <div className="font-body text-[11.5px] text-slate-500">
            Numbers update every page load · pulled from production database ·
            <span className="text-slate-700 font-semibold"> never inflated.</span>
          </div>
          <div className="text-[11px] font-medium text-slate-500">
            Early-access beta · onboarding 1 new clinic per week.
          </div>
        </div>
      </div>
    </section>
  );
}
