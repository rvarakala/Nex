/** Premium-styled small helpers shared across admin panel pages. */
import React from 'react';

export const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
export const fmtInt = (n) => Number(n || 0).toLocaleString('en-IN');
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const PageHeader = ({ title, subtitle, children }) => (
  <div className="flex items-start justify-between mb-6">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {children && <div className="flex items-center gap-2">{children}</div>}
  </div>
);

export const Card = ({ title, subtitle, children, actions, testid, className = '' }) => (
  <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`} data-testid={testid}>
    {(title || subtitle || actions) && (
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          {title && <h3 className="text-sm font-bold text-slate-800">{title}</h3>}
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
    )}
    <div>{children}</div>
  </div>
);

export const KPITile = ({ label, value, delta, tone = 'slate', testid }) => {
  const tones = {
    slate: 'from-slate-50 to-white border-slate-200 text-slate-900',
    indigo: 'from-indigo-50 to-white border-indigo-200 text-indigo-900',
    emerald: 'from-emerald-50 to-white border-emerald-200 text-emerald-900',
    amber: 'from-amber-50 to-white border-amber-200 text-amber-900',
    rose: 'from-rose-50 to-white border-rose-200 text-rose-900',
    fuchsia: 'from-fuchsia-50 to-white border-fuchsia-200 text-fuchsia-900',
  };
  return (
    <div
      data-testid={testid}
      className={`rounded-xl p-4 bg-gradient-to-br border ${tones[tone]}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {delta != null && (
        <div className={`text-[11px] mt-1 ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs prev
        </div>
      )}
    </div>
  );
};

export const Pill = ({ tone, children }) => {
  const tones = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    slate: 'bg-slate-200 text-slate-700',
    fuchsia: 'bg-fuchsia-100 text-fuchsia-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${tones[tone] || tones.slate}`}>{children}</span>;
};

export const tierTone = (t) => (t === 'PREMIUM' ? 'fuchsia' : t === 'STANDARD' ? 'indigo' : 'slate');

export const Empty = ({ children }) => (
  <div className="px-5 py-8 text-center text-sm text-slate-500">{children}</div>
);
