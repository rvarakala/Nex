import React, { useMemo } from 'react';

const fmtINR0 = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

// Thin inline SVG sparkline + WoW delta pill.
// Props: series=[{date, total}, ...]  (oldest → newest), wow_delta_pct, this_week_total, last_week_total
export default function CollectionsSparkline({ trend, compact = false }) {
  const { series = [], wow_delta_pct, this_week_total, last_week_total, days = 30 } = trend || {};

  const pathD = useMemo(() => {
    if (!series.length) return '';
    const maxVal = Math.max(1, ...series.map((s) => s.total));
    const W = 600, H = compact ? 40 : 56, P = 2;
    return series.map((s, i) => {
      const x = P + (i * (W - 2 * P)) / Math.max(1, series.length - 1);
      const y = H - P - (s.total / maxVal) * (H - 2 * P);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }, [series, compact]);

  const areaD = useMemo(() => {
    if (!series.length || !pathD) return '';
    const W = 600, H = compact ? 40 : 56, P = 2;
    return `${pathD} L${W - P},${H - P} L${P},${H - P} Z`;
  }, [pathD, series, compact]);

  if (!series.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-3 text-center text-[11px] text-slate-400 italic" data-testid="sparkline-empty">
        No trend data yet — keep collecting payments.
      </div>
    );
  }

  const up = wow_delta_pct !== null && wow_delta_pct !== undefined && wow_delta_pct >= 0;
  const hasWow = wow_delta_pct !== null && wow_delta_pct !== undefined;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm" data-testid="collections-sparkline">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div>
          <div className="text-[9px] uppercase tracking-[0.25em] text-slate-500 font-bold">
            Collections · last {days} days
          </div>
          <div className="text-base md:text-lg font-bold tabular-nums text-slate-800 mt-0.5">
            This week {fmtINR0(this_week_total)}
          </div>
        </div>
        {hasWow && (
          <div
            data-testid="sparkline-wow"
            className={`text-[10px] font-bold px-2 py-1 rounded-full border tabular-nums flex items-center gap-1 ${
              up ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                 : 'bg-rose-50 text-rose-700 border-rose-300'
            }`}>
            <span>{up ? '↑' : '↓'}</span>
            <span>{Math.abs(wow_delta_pct).toFixed(1)}%</span>
            <span className="text-slate-500 font-normal ml-1">vs last week</span>
          </div>
        )}
      </div>

      <svg
        viewBox="0 0 600 56"
        preserveAspectRatio="none"
        className="w-full h-12"
        aria-label="30-day collections sparkline"
        data-testid="sparkline-svg"
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up || !hasWow ? '#10b981' : '#f43f5e'} stopOpacity="0.28" />
            <stop offset="100%" stopColor={up || !hasWow ? '#10b981' : '#f43f5e'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#sparkFill)" />
        <path
          d={pathD}
          fill="none"
          stroke={up || !hasWow ? '#059669' : '#e11d48'}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Last-point dot */}
        {series.length > 0 && (() => {
          const maxVal = Math.max(1, ...series.map((s) => s.total));
          const W = 600, H = 56, P = 2;
          const last = series[series.length - 1];
          const x = W - P;
          const y = H - P - (last.total / maxVal) * (H - 2 * P);
          return <circle cx={x} cy={y} r="2.5" fill={up || !hasWow ? '#059669' : '#e11d48'} />;
        })()}
      </svg>

      {/* x-axis: first and last date labels */}
      <div className="flex justify-between text-[9px] text-slate-400 font-mono mt-0.5">
        <span>{series[0]?.date}</span>
        {series.length > 15 && <span>{series[Math.floor(series.length / 2)]?.date}</span>}
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}
