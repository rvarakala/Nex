/*
 * Marketing Traffic — Founder-only analytics for audinexa.com.
 *
 * Endpoints:
 *   GET /api/admin/marketing-traffic/overview?days=<N>
 *   GET /api/admin/marketing-traffic/live?minutes=<N>
 *   GET /api/track.js                    (install snippet)
 *   POST /api/track                      (public beacon)
 *
 * Design notes:
 *  · Kept single-page so the founder sees "visitors today", "campaign
 *    breakdown" and "who's live right now" without tab-hopping.
 *  · No external chart library — a hand-rolled SVG sparkline keeps
 *    the page snappy and avoids a chart-lib bundle bump.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import {
  Activity, Users, Eye, MousePointerClick, Megaphone, Globe2, Copy, RefreshCw,
  Zap, Timer, ArrowDownRight,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DEFAULT_SNIPPET_URL = () => {
  // audinexa.com in production, preview URL in dev — either way the same
  // script serves the same tracker.
  const backend = process.env.REACT_APP_BACKEND_URL || '';
  return `${backend.replace(/\/$/, '')}/api/track.js`;
};

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtSec = (s) => {
  s = Number(s || 0);
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
};
const fmtDay = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const RANGE_OPTIONS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export default function MarketingTrafficPage() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, l] = await Promise.all([
        axios.get(`${API}/admin/marketing-traffic/overview`, { params: { days: range } }),
        axios.get(`${API}/admin/marketing-traffic/live`, { params: { minutes: 15 } }),
      ]);
      setData(o.data || null);
      setLive(l.data || null);
    } finally {
      setLoading(false);
    }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  // Auto-refresh the live tile every 30s — the rest of the page updates
  // when the operator hits reload.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await axios.get(`${API}/admin/marketing-traffic/live`, { params: { minutes: 15 } });
        setLive(r.data);
      } catch { /* noop */ }
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const t = data?.totals || {};
  const snippetUrl = useMemo(() => DEFAULT_SNIPPET_URL(), []);
  const snippetHtml = `<script src="${snippetUrl}" defer></script>`;

  return (
    <div className="p-4 sm:p-6" data-testid="admin-marketing-traffic-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
            <Megaphone size={22} /> Marketing Traffic
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5 max-w-[60ch]">
            Every visitor + campaign hit on <b>audinexa.com</b>. Cookie-less, GDPR-friendly, in your own DB.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded shadow-sm p-0.5">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.days}
                onClick={() => setRange(r.days)}
                data-testid={`mtraf-range-${r.days}`}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded ${
                  range === r.days ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >{r.label}</button>
            ))}
          </div>
          <button
            onClick={load}
            data-testid="mtraf-reload"
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
            title="Reload"
          ><RefreshCw size={14} /></button>
        </div>
      </div>

      {loading && !data && (
        <div className="text-center text-slate-400 italic text-xs py-16">Loading traffic data…</div>
      )}

      {data && (
        <>
          {/* Live pulse — always visible at the top so founder can watch
              campaigns spike in real-time. */}
          <div className="rounded-md bg-gradient-to-br from-indigo-600 to-violet-600 text-white p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-300"></div>
                <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-300 animate-ping"></div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest opacity-80">Live · last 15 min</div>
                <div className="text-2xl font-bold" data-testid="mtraf-live-visitors">
                  {live?.visitors_online || 0} <span className="text-sm font-normal opacity-80">visitors online</span>
                </div>
                <div className="text-[11px] opacity-80">
                  {live?.active_sessions || 0} active sessions · watching {live?.live_paths?.length || 0} pages
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-w-[60%]">
              {(live?.live_paths || []).slice(0, 5).map((p) => (
                <span key={p.path} className="text-[10.5px] bg-white/20 rounded px-2 py-0.5 font-mono">
                  {p.path} · {p.sessions}
                </span>
              ))}
            </div>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Kpi label="Unique visitors"     icon={<Users size={12} />}      value={fmt(t.unique_visitors)}  testid="mtraf-kpi-visitors" />
            <Kpi label="Sessions"            icon={<Activity size={12} />}   value={fmt(t.unique_sessions)}  testid="mtraf-kpi-sessions" />
            <Kpi label="Page views"          icon={<Eye size={12} />}        value={fmt(t.page_views)}       testid="mtraf-kpi-pageviews" />
            <Kpi label="Demo clicks / events" icon={<MousePointerClick size={12} />} value={fmt(t.custom_events)} testid="mtraf-kpi-events" tone="emerald" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <Kpi label="Pages / session"     icon={<Zap size={12} />}        value={t.avg_pages_per_session || 0} testid="mtraf-kpi-ppsess" tone="indigo" />
            <Kpi label="Avg session length"  icon={<Timer size={12} />}      value={fmtSec(t.avg_session_seconds)} testid="mtraf-kpi-avgsec" tone="indigo" />
            <Kpi label="Bounce rate"         icon={<ArrowDownRight size={12} />} value={`${t.bounce_rate_pct || 0}%`} testid="mtraf-kpi-bounce" tone="rose" />
          </div>

          {/* Daily sparkline */}
          <div className="bg-white border border-slate-200 rounded-md p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">Daily traffic — last {range} day{range > 1 ? 's' : ''}</div>
              <div className="flex items-center gap-3 text-[10.5px] text-slate-500">
                <span className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm bg-indigo-500"></i> Page views</span>
                <span className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm bg-emerald-500"></i> Unique visitors</span>
              </div>
            </div>
            <TrafficSparkline data={data.daily || []} />
          </div>

          {/* Campaigns + Referrers */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            <div className="bg-white border border-slate-200 rounded-md p-3 lg:col-span-2">
              <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Campaigns (by sessions)</div>
              <table className="w-full text-[12px]">
                <thead className="text-[9.5px] uppercase tracking-widest text-slate-400 font-semibold">
                  <tr>
                    <th className="text-left px-2 py-1.5">Campaign</th>
                    <th className="text-left px-2 py-1.5">Source</th>
                    <th className="text-left px-2 py-1.5">Medium</th>
                    <th className="text-right px-2 py-1.5">Visitors</th>
                    <th className="text-right px-2 py-1.5">Sessions</th>
                    <th className="text-right px-2 py-1.5">Page views</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.campaigns || []).map((c, i) => (
                    <tr key={i} className="border-t border-slate-100" data-testid={`mtraf-campaign-${c.campaign}`}>
                      <td className="px-2 py-1.5 font-semibold text-slate-800">{c.campaign}</td>
                      <td className="px-2 py-1.5 text-slate-600">{c.source || <span className="text-slate-400">—</span>}</td>
                      <td className="px-2 py-1.5 text-slate-600">{c.medium || <span className="text-slate-400">—</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.visitors)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(c.sessions)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.page_views)}</td>
                    </tr>
                  ))}
                  {(data.campaigns || []).length === 0 && (
                    <tr><td colSpan={6} className="text-center text-slate-400 italic text-[11px] py-6">No traffic yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-slate-200 rounded-md p-3">
              <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Top referrers</div>
              {(data.top_referrers || []).length === 0 && (
                <div className="text-[11px] text-slate-400 italic py-3">No referrers yet.</div>
              )}
              {(data.top_referrers || []).map((r) => (
                <div key={r.referrer} className="flex items-center justify-between border-t border-slate-100 py-1.5 text-[12px] first:border-t-0">
                  <div className="truncate text-slate-700"><Globe2 size={10} className="inline mr-1 text-slate-400" />{r.referrer}</div>
                  <div className="tabular-nums font-semibold">{fmt(r.sessions)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Landings + Events */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
            <div className="bg-white border border-slate-200 rounded-md p-3">
              <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Top landing pages</div>
              {(data.top_landings || []).map((r) => (
                <div key={r.path} className="flex items-center justify-between border-t border-slate-100 py-1.5 text-[12px] first:border-t-0">
                  <div className="truncate font-mono text-slate-700">{r.path}</div>
                  <div className="tabular-nums font-semibold">{fmt(r.sessions)}</div>
                </div>
              ))}
              {(data.top_landings || []).length === 0 && (
                <div className="text-[11px] text-slate-400 italic py-3">No landing data yet.</div>
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-md p-3">
              <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Custom events</div>
              {(data.top_events || []).map((r) => (
                <div key={r.event_name} className="flex items-center justify-between border-t border-slate-100 py-1.5 text-[12px] first:border-t-0">
                  <div className="text-slate-700"><MousePointerClick size={10} className="inline mr-1 text-emerald-600" />{r.event_name}</div>
                  <div className="tabular-nums font-semibold">{fmt(r.hits)}  <span className="text-slate-400 font-normal">({fmt(r.visitors)} vis.)</span></div>
                </div>
              ))}
              {(data.top_events || []).length === 0 && (
                <div className="text-[11px] text-slate-400 italic py-3">
                  No custom events yet. Call <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">window.audinexaTrack(&apos;demo_cta&apos;)</code> from your CTA button.
                </div>
              )}
            </div>
          </div>

          {/* Install snippet */}
          <InstallSnippet snippetHtml={snippetHtml} />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, testid, icon, tone }) {
  const toneCls = tone === 'rose'    ? 'bg-rose-50 border-rose-200 text-rose-800'
                : tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : tone === 'indigo'  ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                : 'bg-white border-slate-200 text-slate-700';
  return (
    <div className={`rounded-md border px-3 py-2 ${toneCls}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80 flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

// Small SVG sparkline. Handles single-day case (draws a single bar).
function TrafficSparkline({ data }) {
  if (!data.length) {
    return <div className="text-center text-slate-400 italic text-[11px] py-8">Waiting for pageview events…</div>;
  }
  const W = 900, H = 160, PAD_L = 40, PAD_R = 12, PAD_T = 10, PAD_B = 22;
  const iw = W - PAD_L - PAD_R;
  const ih = H - PAD_T - PAD_B;
  const maxY = Math.max(1, ...data.map((d) => Math.max(d.page_views, d.unique_visitors)));
  const step = data.length > 1 ? iw / (data.length - 1) : iw;
  const yFor = (v) => PAD_T + ih - (v / maxY) * ih;
  const xFor = (i) => PAD_L + (data.length > 1 ? i * step : iw / 2);
  const path = (key) => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d[key])}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} data-testid="mtraf-sparkline">
      {/* Y grid — 4 lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
        <line key={i} x1={PAD_L} x2={W - PAD_R}
              y1={PAD_T + ih * (1 - r)} y2={PAD_T + ih * (1 - r)}
              stroke="#E5E7EB" strokeDasharray="2 3" />
      ))}
      {/* Y labels — 0 and max */}
      <text x={PAD_L - 6} y={PAD_T + ih + 4} textAnchor="end" fontSize="10" fill="#94A3B8">0</text>
      <text x={PAD_L - 6} y={PAD_T + 8} textAnchor="end" fontSize="10" fill="#94A3B8">{maxY}</text>

      {/* Page views (indigo area + line) */}
      <path
        d={`${path('page_views')} L ${xFor(data.length - 1)} ${PAD_T + ih} L ${xFor(0)} ${PAD_T + ih} Z`}
        fill="#818CF8" opacity="0.18"
      />
      <path d={path('page_views')} fill="none" stroke="#4F46E5" strokeWidth="2" />
      {/* Unique visitors (emerald line only) */}
      <path d={path('unique_visitors')} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="4 3" />

      {/* Dots + tooltips (native <title>) */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xFor(i)} cy={yFor(d.page_views)} r="3" fill="#4F46E5">
            <title>{d.date} · {d.page_views} PV · {d.unique_visitors} visitors</title>
          </circle>
        </g>
      ))}

      {/* X labels — first / mid / last (avoid crowding) */}
      {[0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
        <text key={i} x={xFor(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="#64748B">
          {fmtDay(data[i]?.date)}
        </text>
      ))}
    </svg>
  );
}

function InstallSnippet({ snippetHtml }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippetHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-indigo-700 font-bold">Install on audinexa.com</div>
          <div className="text-[12px] text-slate-700 max-w-[70ch] mt-1">
            Add this single line into the <code className="bg-white border border-slate-200 rounded px-1">&lt;head&gt;</code> of every marketing page. The tracker is cookie-less, ~2 KB, and fires on load, SPA nav, and every UTM&apos;d landing.
          </div>
        </div>
        <button
          onClick={doCopy}
          data-testid="mtraf-copy-snippet"
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm"
        ><Copy size={11} /> {copied ? 'Copied!' : 'Copy'}</button>
      </div>
      <pre className="font-mono text-[11.5px] bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto whitespace-pre-wrap">
{snippetHtml}
      </pre>
      <div className="text-[10.5px] text-slate-500 mt-2">
        For custom conversion events (e.g. Get Demo click), call:{' '}
        <code className="bg-white border border-slate-200 rounded px-1 py-0.5 text-[10px]">window.audinexaTrack(&apos;demo_cta&apos;)</code>
      </div>
    </div>
  );
}

// Small util — kept as a fn so we don't recompute the snippet URL on
// every keystroke. Uses `useMemo` at the call site to stay stable.
