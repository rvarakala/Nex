/**
 * LatencySpeedometer — live API health widget on the Founder Dashboard.
 *
 * Polls /api/admin/v2/system/latency every 5s and renders:
 *   • Semicircle gauge for current p95 (60s window) with colour band
 *   • Tiles: p50 / p95 / p99 / rps / uptime
 *   • 10-row "slowest routes" leaderboard (5m window)
 *   • Status code distribution mini-bar
 *
 * Zero external deps — pure SVG + Tailwind.
 */
import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { Activity, Zap, TrendingUp, Loader2 } from 'lucide-react';
import { Card, Pill } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 5000;

// Speedometer band colours — matches the health-level thresholds on the server.
const HEALTH_TONE = {
  idle:     { label: 'Idle',     colour: '#94a3b8', pill: 'slate' },
  healthy:  { label: 'Healthy',  colour: '#10b981', pill: 'emerald' },
  warning:  { label: 'Warning',  colour: '#f59e0b', pill: 'amber' },
  critical: { label: 'Critical', colour: '#e11d48', pill: 'rose' },
};

// Cap gauge needle at 1000ms — everything above is "off the chart" red.
const GAUGE_MAX_MS = 1000;

export default function LatencySpeedometer() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const load = async () => {
    try {
      const r = await axios.get(`${API}/admin/v2/system/latency`);
      setD(r.data);
      setErr('');
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load latency stats');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  if (loading && !d) {
    return (
      <Card title="API Latency" subtitle="Live speedometer — sampling…" testid="latency-card">
        <div className="p-8 text-center text-slate-400 text-sm">
          <Loader2 className="inline-block animate-spin mr-2" size={14} /> Warming up…
        </div>
      </Card>
    );
  }
  if (err) {
    return (
      <Card title="API Latency" testid="latency-card">
        <div className="p-4 text-sm text-rose-700 bg-rose-50">{err}</div>
      </Card>
    );
  }

  const { window_60s: w60, window_5m: w5m, health, slowest_routes, status_distribution, uptime_seconds } = d;
  const tone = HEALTH_TONE[health] || HEALTH_TONE.idle;
  const totalReqs = Object.values(status_distribution).reduce((s, v) => s + v, 0);

  return (
    <Card
      title="API Latency · Live"
      subtitle="p95 over the last minute — auto-refresh every 5s"
      testid="latency-card"
      actions={<Pill tone={tone.pill} data-testid="latency-health-pill">{tone.label}</Pill>}
    >
      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="latency-widget">
        {/* Gauge */}
        <div className="flex flex-col items-center justify-center">
          <Gauge value={w60.p95} max={GAUGE_MAX_MS} colour={tone.colour} />
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-1">p95 · 60s</div>
        </div>

        {/* KPI tiles */}
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-2">
          <MiniTile icon={<Zap size={12} />}       label="p50 (60s)"  value={fmtMs(w60.p50)} testid="lat-p50" />
          <MiniTile icon={<Activity size={12} />}  label="p95 (60s)"  value={fmtMs(w60.p95)} testid="lat-p95" />
          <MiniTile icon={<TrendingUp size={12} />} label="p99 (60s)" value={fmtMs(w60.p99)} testid="lat-p99" />
          <MiniTile label="Requests /s (60s)" value={w60.rps || '0'} testid="lat-rps" />
          <MiniTile label="Total reqs (5m)"   value={w5m.count}      testid="lat-count5m" />
          <MiniTile label="Uptime"            value={fmtUptime(uptime_seconds)} testid="lat-uptime" />
        </div>
      </div>

      {/* Status distribution + slowest routes */}
      <div className="border-t border-slate-100 p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Status Codes · 5m</div>
          <StatusBar dist={status_distribution} total={totalReqs} />
          <div className="mt-3 grid grid-cols-4 gap-1 text-[10.5px]">
            <StatusChip label="2xx" count={status_distribution['2xx']} tone="text-emerald-700" />
            <StatusChip label="3xx" count={status_distribution['3xx']} tone="text-indigo-700" />
            <StatusChip label="4xx" count={status_distribution['4xx']} tone="text-amber-700" />
            <StatusChip label="5xx" count={status_distribution['5xx']} tone="text-rose-700" />
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Slowest Endpoints · 5m (avg)</div>
          {slowest_routes.length === 0 ? (
            <div className="text-xs text-slate-400 italic">No requests sampled yet.</div>
          ) : (
            <table className="w-full text-xs" data-testid="latency-slowest-table">
              <thead className="text-[9.5px] uppercase text-slate-500">
                <tr>
                  <th className="text-left py-1 pr-2">Endpoint</th>
                  <th className="text-right py-1 pr-2">Reqs</th>
                  <th className="text-right py-1 pr-2">Avg</th>
                  <th className="text-right py-1">Max</th>
                </tr>
              </thead>
              <tbody>
                {slowest_routes.slice(0, 8).map((r, i) => (
                  <tr key={`${r.method}-${r.path}-${i}`} className="border-t border-slate-100">
                    <td className="py-1 pr-2 font-mono truncate max-w-[240px]" title={`${r.method} ${r.path}`}>
                      <span className="text-slate-500 mr-1">{r.method}</span>{r.path}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-slate-600">{r.count}</td>
                    <td className={`py-1 pr-2 text-right tabular-nums font-semibold ${r.avg_ms > 500 ? 'text-rose-700' : r.avg_ms > 200 ? 'text-amber-700' : 'text-slate-700'}`}>{fmtMs(r.avg_ms)}</td>
                    <td className="py-1 text-right tabular-nums text-slate-500">{fmtMs(r.max_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- Small helpers ----------
function fmtMs(n) {
  if (n == null) return '—';
  if (n < 1) return `${(n * 1000).toFixed(0)}µs`;
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

function fmtUptime(s) {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------- Sub-components ----------
function Gauge({ value, max, colour }) {
  const clamped = Math.max(0, Math.min(value, max));
  const pct = clamped / max;                    // 0..1
  const angle = -90 + pct * 180;                // -90deg (left) to +90deg (right)
  const SIZE = 160;
  const RADIUS = 68;
  const CX = SIZE / 2;
  const CY = SIZE * 0.62;

  // Arc from -90 to +90 (semicircle) — split into 3 bands for visual cue.
  const bands = [
    { from: -90, to: -54, colour: '#10b981' },  // 0–200ms → green
    { from: -54, to: 0,   colour: '#f59e0b' },  // 200–500 → amber
    { from: 0,   to: 90,  colour: '#e11d48' },  // 500–1000 → red
  ];
  const arcPath = (fromDeg, toDeg, r) => {
    const rad = (deg) => (deg * Math.PI) / 180;
    const x1 = CX + r * Math.cos(rad(fromDeg));
    const y1 = CY + r * Math.sin(rad(fromDeg));
    const x2 = CX + r * Math.cos(rad(toDeg));
    const y2 = CY + r * Math.sin(rad(toDeg));
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  // Needle tip
  const needleRad = (angle * Math.PI) / 180;
  const nx = CX + (RADIUS - 6) * Math.cos(needleRad);
  const ny = CY + (RADIUS - 6) * Math.sin(needleRad);

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE * 0.72 }} data-testid="latency-gauge">
      <svg width={SIZE} height={SIZE * 0.72} viewBox={`0 0 ${SIZE} ${SIZE * 0.72}`}>
        {/* Bands */}
        {bands.map((b, i) => (
          <path key={i} d={arcPath(b.from, b.to, RADIUS)} fill="none" stroke={b.colour} strokeWidth={10} strokeLinecap="round" opacity={0.85} />
        ))}
        {/* Tick marks */}
        {[-90, -45, 0, 45, 90].map((tick) => {
          const rad = (tick * Math.PI) / 180;
          const inner = RADIUS - 14;
          const outer = RADIUS - 6;
          return (
            <line key={tick}
              x1={CX + inner * Math.cos(rad)} y1={CY + inner * Math.sin(rad)}
              x2={CX + outer * Math.cos(rad)} y2={CY + outer * Math.sin(rad)}
              stroke="#334155" strokeWidth={1.3} />
          );
        })}
        {/* Needle */}
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={colour} strokeWidth={3} strokeLinecap="round" style={{ transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }} />
        <circle cx={CX} cy={CY} r={5} fill={colour} />
      </svg>
      <div className="absolute inset-0 flex items-end justify-center pb-1">
        <div className="text-center">
          <div className="text-xl font-bold tabular-nums" style={{ color: colour }} data-testid="latency-p95-value">
            {fmtMs(value)}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniTile({ icon, label, value, testid }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5" data-testid={testid}>
      <div className="flex items-center gap-1 text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
        {icon}<span className="truncate">{label}</span>
      </div>
      <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums truncate">{value}</div>
    </div>
  );
}

function StatusBar({ dist, total }) {
  if (total === 0) return <div className="h-3 rounded bg-slate-100" />;
  const seg = (count, colour) => count > 0 && (
    <div style={{ width: `${(count / total) * 100}%`, background: colour }} className="h-3" />
  );
  return (
    <div className="flex overflow-hidden rounded h-3 bg-slate-100">
      {seg(dist['2xx'], '#10b981')}
      {seg(dist['3xx'], '#6366f1')}
      {seg(dist['4xx'], '#f59e0b')}
      {seg(dist['5xx'], '#e11d48')}
    </div>
  );
}

function StatusChip({ label, count, tone }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={`font-semibold ${tone}`}>{label}</span>
      <span className="text-slate-500 tabular-nums">{count}</span>
    </div>
  );
}
