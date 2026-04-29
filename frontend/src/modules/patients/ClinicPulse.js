import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmtINR0 = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

/**
 * Premium "Clinic Pulse" at-a-glance card for the Front Desk Dashboard.
 *
 * Pulls the 14-day collections trend and cross-references today's live KPIs to show:
 *   • Today's collections vs 7-day rolling average (with delta %)
 *   • Walk-ins + In-progress tokens
 *   • Inline mini-sparkline of the last 14 days
 *   • WoW delta pill (green/red)
 *
 * Props: kpis — the live KPI object from /api/dashboard/frontdesk
 */
export default function ClinicPulse({ kpis }) {
  const [trend, setTrend] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/closeouts/trend/collections?days=14`);
        if (alive) setTrend(r.data);
      } catch (e) {
        if (alive) setErr(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const { sparkPath, areaPath, todayVal, rolling7, vs7Pct, wow, trendUp } = useMemo(() => {
    const series = trend?.series || [];
    if (!series.length) return { sparkPath: '', areaPath: '', todayVal: 0, rolling7: 0, vs7Pct: null, wow: trend?.wow_delta_pct ?? null, trendUp: true };

    const W = 600, H = 44, P = 2;
    const maxVal = Math.max(1, ...series.map((s) => s.total));
    const parts = series.map((s, i) => {
      const x = P + (i * (W - 2 * P)) / Math.max(1, series.length - 1);
      const y = H - P - (s.total / maxVal) * (H - 2 * P);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    const area = `${parts} L${W - P},${H - P} L${P},${H - P} Z`;

    const today = series[series.length - 1]?.total || 0;
    const prior7 = series.slice(-8, -1); // up to 7 days before today
    const prior7Avg = prior7.length ? prior7.reduce((a, b) => a + (b.total || 0), 0) / prior7.length : 0;
    const pct = prior7Avg > 0 ? ((today - prior7Avg) / prior7Avg) * 100 : null;
    const wowPct = trend?.wow_delta_pct ?? null;
    const up = pct === null ? true : pct >= 0;

    return {
      sparkPath: parts,
      areaPath: area,
      todayVal: today,
      rolling7: prior7Avg,
      vs7Pct: pct,
      wow: wowPct,
      trendUp: up,
    };
  }, [trend]);

  const walkins = kpis?.walkins_today ?? 0;
  const inProgress = kpis?.in_progress ?? 0;
  const waiting = kpis?.waiting_now ?? 0;
  const appts = kpis?.appointments_today ?? 0;
  const pending = kpis?.pending_reports ?? 0;

  const stroke = trendUp ? '#34d399' : '#fb7185';
  const fillStop = trendUp ? '#34d399' : '#fb7185';

  return (
    <div
      data-testid="clinic-pulse"
      className="relative overflow-hidden rounded-xl border border-slate-800 shadow-lg bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4"
    >
      {/* grain overlay */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]"
           style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '6px 6px' }} />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <div className="text-[9px] uppercase tracking-[0.3em] text-slate-400 font-bold">
              Clinic Pulse · Live
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2" data-testid="pulse-today">
            <span className="text-3xl font-bold text-white tabular-nums">
              {fmtINR0(todayVal)}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">collected today</span>
          </div>
          {vs7Pct !== null && (
            <div className="text-[11px] text-slate-300 mt-0.5" data-testid="pulse-vs7">
              <span className={vs7Pct >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {vs7Pct >= 0 ? '▲' : '▼'} {Math.abs(vs7Pct).toFixed(1)}%
              </span>{' '}
              <span className="text-slate-400">vs 7-day avg ({fmtINR0(rolling7)})</span>
            </div>
          )}
        </div>

        {/* WoW pill */}
        {wow !== null && wow !== undefined && (
          <div
            data-testid="pulse-wow"
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border tabular-nums flex items-center gap-1 backdrop-blur ${
              wow >= 0
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                : 'bg-rose-500/10 text-rose-300 border-rose-500/40'
            }`}
          >
            <span>{wow >= 0 ? '↑' : '↓'}</span>
            <span>{Math.abs(wow).toFixed(1)}%</span>
            <span className="text-slate-400 font-normal ml-1">WoW</span>
          </div>
        )}
      </div>

      {/* Mini-sparkline */}
      <div className="relative mt-3">
        {err ? (
          <div className="text-[10px] text-slate-500 italic">Trend unavailable.</div>
        ) : sparkPath ? (
          <svg
            viewBox="0 0 600 44"
            preserveAspectRatio="none"
            className="w-full h-10"
            aria-label="14-day collections pulse"
            data-testid="pulse-sparkline"
          >
            <defs>
              <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fillStop} stopOpacity="0.35" />
                <stop offset="100%" stopColor={fillStop} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#pulseFill)" />
            <path d={sparkPath} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <div className="h-10 flex items-center text-[10px] text-slate-600 italic">Collecting data…</div>
        )}
      </div>

      {/* Live chiplets */}
      <div className="relative grid grid-cols-5 gap-2 mt-3" data-testid="pulse-chiplets">
        <Chip label="Walk-ins" value={walkins} accent="text-blue-300" />
        <Chip label="Appts" value={appts} accent="text-indigo-300" />
        <Chip label="Waiting" value={waiting} accent="text-amber-300" />
        <Chip label="Live" value={inProgress} accent="text-purple-300" dot={inProgress > 0} />
        <Chip label="Reports" value={pending} accent="text-rose-300" />
      </div>
    </div>
  );
}

const Chip = ({ label, value, accent, dot = false }) => (
  <div className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5">
    <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />}
      {label}
    </div>
    <div className={`text-lg font-bold tabular-nums ${accent}`}>{value}</div>
  </div>
);
