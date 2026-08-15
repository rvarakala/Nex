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
  Zap, Timer, ArrowDownRight, Repeat, MousePointer, CheckCircle2, Code2,
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
  const [cohorts, setCohorts] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, l, c] = await Promise.all([
        axios.get(`${API}/admin/marketing-traffic/overview`, { params: { days: range } }),
        axios.get(`${API}/admin/marketing-traffic/live`, { params: { minutes: 15 } }),
        axios.get(`${API}/admin/marketing-traffic/cohorts`, { params: { weeks: 8 } }),
      ]);
      setData(o.data || null);
      setLive(l.data || null);
      setCohorts(c.data || null);
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

          {/* Retention Cohorts */}
          <RetentionCohortGrid cohorts={cohorts} />

          {/* Install snippet */}
          <InstallSnippet snippetHtml={snippetHtml} snippetUrl={snippetUrl} />
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

function RetentionCohortGrid({ cohorts }) {
  const rows = cohorts?.cohorts || [];
  const weeks = cohorts?.weeks || 8;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4 mb-4">
        <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1 flex items-center gap-1">
          <Repeat size={11} /> Retention cohorts
        </div>
        <div className="text-[11.5px] text-slate-500 italic">
          Waiting for repeat visitors. Once the same visitor comes back a week later, they&apos;ll show up here.
        </div>
      </div>
    );
  }
  // Colour scale — 0% pale, 100% deep indigo. Skip W0 (always 100%).
  const cellStyle = (pct, off) => {
    if (off === 0) return { background: '#EEF2FF', color: '#3730A3' };
    const clamped = Math.max(0, Math.min(100, pct));
    // Interpolate from #F1F5F9 (slate-100) → #4F46E5 (indigo-600).
    const t = clamped / 100;
    const lerp = (a, b) => Math.round(a + (b - a) * t);
    const bg = `rgb(${lerp(241, 79)}, ${lerp(245, 70)}, ${lerp(249, 229)})`;
    const fg = t > 0.45 ? '#FFFFFF' : '#0F172A';
    return { background: bg, color: fg };
  };
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold flex items-center gap-1">
            <Repeat size={11} /> Retention cohorts — % of first-time visitors who came back
          </div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">
            Each row is a week&apos;s new visitors; each cell is that % that returned in week 1, 2, 3, …
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-widest text-slate-400 font-semibold">
              <th className="text-left px-2 py-1.5">Cohort</th>
              <th className="text-right px-2 py-1.5">Size</th>
              {Array.from({ length: weeks }).map((_, i) => (
                <th key={i} className="text-center px-1 py-1.5 tabular-nums">W{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.cohort_week} className="border-t border-slate-100">
                <td className="px-2 py-1 font-mono text-slate-700 whitespace-nowrap">{c.cohort_week}</td>
                <td className="px-2 py-1 text-right tabular-nums font-semibold text-slate-800">{c.size}</td>
                {Array.from({ length: weeks }).map((_, off) => {
                  const r = c.offsets?.[String(off)] || { pct: 0, visitors: 0 };
                  // Only paint cells within the cohort's possible horizon
                  // (older cohorts have more W columns filled).
                  return (
                    <td
                      key={off}
                      className="px-1 py-1 text-center tabular-nums text-[10.5px] font-semibold"
                      style={cellStyle(r.pct, off)}
                      title={`${r.visitors} returning visitors`}
                      data-testid={`mtraf-cohort-${c.cohort_week}-W${off}`}
                    >
                      {r.pct > 0 ? `${r.pct}%` : (off === 0 ? '100%' : '·')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10.5px] text-slate-500 mt-2">
        <b>How to read this:</b> If W1 for the <code className="bg-slate-100 rounded px-1">2026-W30</code> cohort is 44%, that means 44% of the visitors who first landed that week came back the next week.
        A healthy marketing site typically holds 15-25% at W1; anything below 10% signals a landing-page or content issue.
      </div>
    </div>
  );
}

function InstallSnippet({ snippetHtml, snippetUrl }) {
  const [copied, setCopied] = useState('');
  const doCopy = async (text, tag) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* noop */ }
  };
  const trackJs = `<!-- Get Demo button -->
<button onclick="window.audinexaTrack('demo_cta')">Get Demo</button>

<!-- Sign Up form (React) -->
<button onClick={() => {
  window.audinexaTrack('signup_cta', { plan: 'starter' });
  handleSignUp();
}}>Start free trial</button>

<!-- Webflow / Framer: add onclick attribute to the CTA element -->
onclick="window.audinexaTrack('pricing_cta')"`;

  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="text-[11px] uppercase tracking-widest text-indigo-700 font-bold mb-3 flex items-center gap-1">
        <Code2 size={12} /> Setup — 2 steps to go live
      </div>

      {/* Step 1 */}
      <div className="mb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-[12px] font-bold text-slate-800">
              <span className="inline-flex items-center justify-center w-5 h-5 bg-indigo-600 text-white text-[10px] font-bold rounded-full mr-1.5">1</span>
              Add the tracker to audinexa.com&apos;s <code className="bg-white border border-slate-200 rounded px-1 text-[10.5px]">&lt;head&gt;</code>
            </div>
            <div className="text-[11px] text-slate-600 mt-1 max-w-[70ch]">
              Cookie-less, ~2 KB, no external service. Fires on page load, SPA nav, and session close.
            </div>
          </div>
          <button
            onClick={() => doCopy(snippetHtml, 'script')}
            data-testid="mtraf-copy-snippet"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm shrink-0"
          ><Copy size={11} /> {copied === 'script' ? 'Copied!' : 'Copy'}</button>
        </div>
        <pre className="font-mono text-[11.5px] bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto whitespace-pre-wrap">
{snippetHtml}
        </pre>
      </div>

      {/* Step 2 */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-[12px] font-bold text-slate-800">
              <span className="inline-flex items-center justify-center w-5 h-5 bg-indigo-600 text-white text-[10px] font-bold rounded-full mr-1.5">2</span>
              Wire your Get Demo / Sign Up buttons for conversion tracking
              <span className="text-[10px] font-normal text-slate-500 ml-1">(optional but recommended)</span>
            </div>
            <div className="text-[11px] text-slate-600 mt-1 max-w-[70ch]">
              Every CTA click calls <code className="bg-white border border-slate-200 rounded px-1 text-[10.5px]">window.audinexaTrack(...)</code>.
              The event lands in <b>Custom events</b> above with visitor + campaign attribution — so you know which campaign converted best.
            </div>
          </div>
          <button
            onClick={() => doCopy(trackJs, 'cta')}
            data-testid="mtraf-copy-cta"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded shrink-0"
          ><Copy size={11} /> {copied === 'cta' ? 'Copied!' : 'Copy examples'}</button>
        </div>
        <pre className="font-mono text-[11.5px] bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto whitespace-pre-wrap">
{trackJs}
        </pre>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <TipCard icon={<MousePointer size={11} />} title="Any button">
            Add <code className="bg-slate-100 px-1 rounded">onclick=&quot;window.audinexaTrack(&apos;name&apos;)&quot;</code>
          </TipCard>
          <TipCard icon={<CheckCircle2 size={11} />} title="Attach data">
            2nd arg is a free-form object: <code className="bg-slate-100 px-1 rounded">audinexaTrack(&apos;signup&apos;, {'{'} plan: &apos;pro&apos; {'}'})</code>
          </TipCard>
          <TipCard icon={<Users size={11} />} title="Auto-attributed">
            Every event is auto-tagged with the visitor&apos;s UTM campaign, source and referrer — no extra work needed.
          </TipCard>
        </div>
      </div>

      <div className="text-[10.5px] text-slate-500 mt-3 pt-3 border-t border-indigo-200">
        Tracker source: <a href={snippetUrl} target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline">{snippetUrl}</a>
      </div>
    </div>
  );
}

function TipCard({ icon, title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded p-2 text-[11px] text-slate-700">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold flex items-center gap-1 mb-0.5">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

// Small util — kept as a fn so we don't recompute the snippet URL on
// every keystroke. Uses `useMemo` at the call site to stay stable.
