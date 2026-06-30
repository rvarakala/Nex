/**
 * DiagnosticsAnalyticsTab — second tab under Reports & Analytics.
 *
 * Surfaces diagnostic-test telemetry that's NOT in the existing
 * "Core Business Analytics" view:
 *   • Total tests + breakdown by test type (PTA / OAE / BERA / etc.)
 *   • Age × gender pivot
 *   • Recommendations breakdown (HA Trial / ENT consult / Follow-up / etc.)
 *   • Referral pathways — for marketing planning ("which channels drive
 *     diagnostic walk-ins?")
 *
 * Backend endpoints reused (no new endpoints — the existing
 * /api/analytics/diagnosis was extended in-place to include
 * tests_performed + recommendations_breakdown):
 *   GET /api/analytics/diagnosis?days=N
 *   GET /api/analytics/referrals?days=N
 *
 * NOTE: degree/type of hearing loss breakdowns were intentionally skipped
 * per product call — most existing seed data doesn't have structured
 * audiogram-derived classifications, so the chart would mostly read
 * "Unknown".
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Activity, Users, Stethoscope, MapPin, RefreshCw, AlertCircle, BarChart3,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ACCENT_PALETTE = ['#4F46E5', '#059669', '#D97706', '#DB2777', '#0EA5E9', '#7C3AED', '#16A34A', '#EA580C'];

export default function DiagnosticsAnalyticsTab() {
  const [days, setDays] = useState(180);
  const [diag, setDiag] = useState(null);
  const [refData, setRefData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [a, b] = await Promise.all([
        axios.get(`${API}/analytics/diagnosis`, { params: { days } }),
        axios.get(`${API}/analytics/referrals`, { params: { days } }),
      ]);
      setDiag(a.data);
      setRefData(b.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Could not load diagnostics analytics');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [days]);

  const totalTests = useMemo(
    () => (diag?.tests_performed || []).reduce((s, r) => s + (r.count || 0), 0),
    [diag],
  );
  const maxTestCount = useMemo(
    () => Math.max(1, ...(diag?.tests_performed || []).map((r) => r.count || 0)),
    [diag],
  );
  const maxRecCount = useMemo(
    () => Math.max(1, ...(diag?.recommendations_breakdown || []).map((r) => r.count || 0)),
    [diag],
  );
  const maxAgeCount = useMemo(
    () => Math.max(1, ...(diag?.age_distribution || []).map((r) => r.count || 0)),
    [diag],
  );
  const maxRefCount = useMemo(
    () => Math.max(1, ...(refData?.by_source || []).map((r) => r.patients || 0)),
    [refData],
  );

  return (
    <div className="space-y-5" data-testid="diagnostics-analytics-tab">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-600">
            Window
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              data-testid="diag-window-select"
              className="border border-slate-300 rounded px-1.5 py-1 text-xs font-semibold bg-white"
            >
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 12 months</option>
            </select>
          </label>
        </div>
        <button
          onClick={load}
          disabled={loading}
          data-testid="diag-refresh"
          className="text-[11px] text-indigo-600 font-semibold hover:underline inline-flex items-center gap-1"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && (
        <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded flex items-center gap-1.5" data-testid="diag-err">
          <AlertCircle size={12} /> {err}
        </div>
      )}

      {/* Top-line KPI strip */}
      <div className="grid grid-cols-4 gap-3" data-testid="diag-kpis">
        <Kpi label="Total tests run" value={totalTests} icon={Activity} accent="indigo" testid="diag-kpi-tests" />
        <Kpi label="Patients tested" value={diag?.unique_diagnosed_patients} icon={Users} accent="emerald" testid="diag-kpi-patients" />
        <Kpi label="Recommendations made" value={(diag?.recommendations_breakdown || []).reduce((s, r) => s + r.count, 0)} icon={Stethoscope} accent="violet" testid="diag-kpi-recs" />
        <Kpi label="Inbound channels" value={(refData?.by_source || []).length} icon={MapPin} accent="amber" testid="diag-kpi-channels" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Tests by type — horizontal bars */}
        <Card title="Tests performed — by type" subtitle="One session can include multiple tests; counts include all" testid="diag-tests-card">
          <BarList
            rows={diag?.tests_performed}
            max={maxTestCount}
            emptyLabel="No completed tests in this window."
            testid="diag-tests-list"
          />
        </Card>

        {/* Recommendations breakdown */}
        <Card title="Clinical recommendations" subtitle="What audiologists advised after the test" testid="diag-recs-card">
          <BarList
            rows={diag?.recommendations_breakdown}
            max={maxRecCount}
            emptyLabel="No recommendations recorded in this window."
            testid="diag-recs-list"
          />
        </Card>

        {/* Age distribution */}
        <Card title="Age distribution" subtitle="Patients diagnosed" testid="diag-age-card">
          <BarList
            rows={(diag?.age_distribution || []).map((r) => ({ name: r.bucket, count: r.count }))}
            max={maxAgeCount}
            emptyLabel="No age data available."
            testid="diag-age-list"
          />
        </Card>

        {/* Gender distribution */}
        <Card title="Gender split" subtitle="Patients diagnosed" testid="diag-gender-card">
          <GenderRing rows={diag?.gender_distribution} />
        </Card>

        {/* Referral pathways — for marketing planning */}
        <Card
          title="Referral pathways"
          subtitle="Where new patients came from · plan marketing investment around the top sources"
          testid="diag-pathways-card"
          className="xl:col-span-2"
        >
          {(refData?.by_source || []).length === 0 ? (
            <Empty label="No registrations in this window." />
          ) : (
            <table className="w-full text-xs" data-testid="diag-pathways-table">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="py-1.5">Pathway</th>
                  <th className="py-1.5 text-right">Patients</th>
                  <th className="py-1.5 text-right">Conversion</th>
                  <th className="py-1.5 text-right">Total revenue</th>
                  <th className="py-1.5">Share</th>
                </tr>
              </thead>
              <tbody>
                {(refData?.by_source || []).map((s, idx) => (
                  <tr key={s.source} className="border-b border-slate-100" data-testid={`diag-pathway-row-${s.source}`}>
                    <td className="py-2 font-semibold text-slate-800">{s.source}</td>
                    <td className="py-2 text-right tabular-nums">{s.patients}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-700 font-semibold">
                      {s.conversion_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums font-mono">
                      ₹{Number(s.total_revenue || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 w-1/3">
                      <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.round(100 * s.patients / maxRefCount))}%`,
                            background: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

// -- Sub-components --
const Kpi = ({ label, value, icon: Icon, accent = 'indigo', testid }) => (
  <div
    data-testid={testid}
    className={`bg-white border border-${accent}-100 rounded-xl p-3 shadow-sm`}
  >
    <div className="flex items-center justify-between mb-1">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <Icon size={12} className={`text-${accent}-500`} />
    </div>
    <div className={`text-2xl font-extrabold text-${accent}-700 tabular-nums`}>
      {value ?? '—'}
    </div>
  </div>
);

const Card = ({ title, subtitle, children, testid, className = '' }) => (
  <div className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm ${className}`} data-testid={testid}>
    <div className="mb-3">
      <h3 className="font-bold text-slate-800 text-[13px] flex items-center gap-1.5">
        <BarChart3 size={12} className="text-indigo-500" /> {title}
      </h3>
      {subtitle && <p className="text-[10.5px] text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const BarList = ({ rows, max, emptyLabel, testid }) => {
  if (!rows || rows.length === 0) return <Empty label={emptyLabel} />;
  return (
    <ul className="space-y-2" data-testid={testid}>
      {rows.map((r, idx) => (
        <li key={r.name} className="flex items-center gap-3">
          <span className="text-[11px] font-semibold text-slate-700 w-44 truncate" title={r.name}>{r.name}</span>
          <div className="flex-1 bg-slate-100 rounded-full h-2 relative overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(4, Math.round(100 * r.count / max))}%`,
                background: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
              }}
            />
          </div>
          <span className="text-[11px] tabular-nums font-bold text-slate-700 w-10 text-right">{r.count}</span>
        </li>
      ))}
    </ul>
  );
};

const GenderRing = ({ rows }) => {
  if (!rows || rows.length === 0) return <Empty label="No gender data available." />;
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-2" data-testid="diag-gender-rows">
      {rows.map((r, idx) => {
        const pct = total ? (100 * r.count / total) : 0;
        return (
          <div key={r.label} className="flex items-center gap-3">
            <span className="text-[11px] font-semibold text-slate-700 w-20">{r.label}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: ACCENT_PALETTE[idx % ACCENT_PALETTE.length] }}
              />
            </div>
            <span className="text-[11px] tabular-nums font-bold text-slate-700 w-12 text-right">
              {r.count} · {pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
};

const Empty = ({ label }) => (
  <div className="text-[11px] italic text-slate-400 py-3 text-center">{label}</div>
);
