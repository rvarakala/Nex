/**
 * Clinical & Referral Analytics (Phase 13.B — UC-A01 + UC-A02)
 * Two tabs, premium-gated. Uses existing analytics endpoints.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const COLORS = ['#4f46e5', '#059669', '#d97706', '#db2777', '#7c3aed', '#0284c7', '#dc2626'];

export default function ClinicalAnalyticsPage() {
  const [tab, setTab] = useState('diagnosis');
  const [dx, setDx] = useState(null);
  const [ref, setRef] = useState(null);
  const [days, setDays] = useState(180);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const [d, r] = await Promise.all([
        axios.get(`${API}/analytics/diagnosis?days=${days}`),
        axios.get(`${API}/analytics/referrals?days=${days}`),
      ]);
      setDx(d.data); setRef(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Failed to load analytics');
    }
  };
  useEffect(() => { load(); }, [days]);

  return (
    <div className="p-6 space-y-5" data-testid="clinical-analytics-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clinical & Referral Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Diagnosis patterns and referral attribution · <span className="text-indigo-700 font-semibold">UC-A01 · UC-A02</span></p>
        </div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} data-testid="analytics-window-select" className="text-xs px-2 py-1.5 border border-slate-300 rounded">
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
          <option value={365}>Last 1 year</option>
        </select>
      </div>

      <div className="border-b border-slate-200 flex gap-4">
        <button data-testid="tab-diagnosis" onClick={() => setTab('diagnosis')} className={`px-1 py-2 -mb-px text-sm font-semibold border-b-2 ${tab === 'diagnosis' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>Diagnosis (UC-A01)</button>
        <button data-testid="tab-referrals" onClick={() => setTab('referrals')} className={`px-1 py-2 -mb-px text-sm font-semibold border-b-2 ${tab === 'referrals' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>Referrals (UC-A02)</button>
      </div>

      {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}

      {tab === 'diagnosis' && dx && <DiagnosisView dx={dx} />}
      {tab === 'referrals' && ref && <ReferralsView r={ref} />}
    </div>
  );
}

const DiagnosisView = ({ dx }) => (
  <div className="space-y-5">
    <div className="grid grid-cols-4 gap-3">
      <Tile label="Unique Patients" v={dx.unique_diagnosed_patients} />
      <Tile label="Avg PTA Right" v={dx.avg_pta_right != null ? `${dx.avg_pta_right} dB` : '—'} />
      <Tile label="Avg PTA Left" v={dx.avg_pta_left != null ? `${dx.avg_pta_left} dB` : '—'} />
      <Tile label="Window" v={`${dx.window_days} days`} />
    </div>

    <div className="grid grid-cols-2 gap-4">
      <Card title="Severity distribution" testid="dx-severity-card">
        <BarList rows={dx.degrees || []} labelKey="label" valKey="count" />
      </Card>
      <Card title="Affected side" testid="dx-side-card">
        <BarList rows={dx.by_side || []} labelKey="label" valKey="count" />
      </Card>
      <Card title="Age distribution" testid="dx-age-card">
        <BarList rows={dx.age_distribution || []} labelKey="bucket" valKey="count" />
      </Card>
      <Card title="Gender distribution" testid="dx-gender-card">
        <BarList rows={dx.gender_distribution || []} labelKey="label" valKey="count" />
      </Card>
    </div>

    <Card title="Monthly diagnosis trend" testid="dx-monthly-card">
      <div className="space-y-1">
        {(dx.monthly_trend || []).map((m) => (
          <div key={m.month} className="flex items-center gap-3 text-xs">
            <span className="w-20 font-mono text-slate-600">{m.month}</span>
            <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, m.patients * 5)}%` }} />
            </div>
            <span className="w-24 text-right text-slate-700">{m.patients} patients</span>
            <span className="w-24 text-right text-slate-400">{m.sessions} sessions</span>
          </div>
        ))}
      </div>
    </Card>
  </div>
);

const ReferralsView = ({ r }) => (
  <div className="space-y-5">
    <div className="grid grid-cols-3 gap-3">
      <Tile label="Total Patients" v={r.total_patients} />
      <Tile label="Revenue Attributed" v={fmtINR(r.total_revenue_attributed)} />
      <Tile label="Avg Revenue / Patient" v={fmtINR(r.avg_revenue_per_patient)} />
    </div>

    <Card title="By Referral Source" testid="ref-sources-card">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-right">Patients</th>
            <th className="px-3 py-2 text-right">Conv %</th>
            <th className="px-3 py-2 text-right">Invoice Rev</th>
            <th className="px-3 py-2 text-right">HA Sale Rev</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Avg / Patient</th>
          </tr>
        </thead>
        <tbody>
          {r.by_source.map((s) => (
            <tr key={s.source} className="border-t border-slate-100">
              <td className="px-3 py-2 font-semibold">{s.source}</td>
              <td className="px-3 py-2 text-right">{s.patients}</td>
              <td className="px-3 py-2 text-right text-indigo-700">{s.conversion_pct}%</td>
              <td className="px-3 py-2 text-right text-xs">{fmtINR(s.invoice_revenue)}</td>
              <td className="px-3 py-2 text-right text-xs">{fmtINR(s.ha_sale_revenue)}</td>
              <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtINR(s.total_revenue)}</td>
              <td className="px-3 py-2 text-right text-xs">{fmtINR(s.avg_revenue_per_patient)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    <Card title={`Top Referring Doctors (${r.doctor_count} total)`} testid="ref-doctors-card">
      {r.by_referring_doctor.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6">No doctor-referred patients in this window.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Doctor</th>
              <th className="px-3 py-2 text-right">Patients</th>
              <th className="px-3 py-2 text-right">Conv %</th>
              <th className="px-3 py-2 text-right">Total Revenue</th>
            </tr>
          </thead>
          <tbody>
            {r.by_referring_doctor.map((d) => (
              <tr key={d.doctor_id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold">{d.doctor_name}</td>
                <td className="px-3 py-2 text-right">{d.patients}</td>
                <td className="px-3 py-2 text-right text-indigo-700">{d.conversion_pct}%</td>
                <td className="px-3 py-2 text-right font-bold text-emerald-700">{fmtINR(d.total_revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  </div>
);

const Tile = ({ label, v }) => (
  <div className="bg-white rounded-lg border border-slate-200 p-4">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
    <div className="text-2xl font-bold text-slate-900 mt-1">{v}</div>
  </div>
);

const Card = ({ title, children, testid }) => (
  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden" data-testid={testid}>
    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider">{title}</div>
    <div className="p-4">{children}</div>
  </div>
);

const BarList = ({ rows, labelKey, valKey }) => {
  const max = Math.max(...(rows.map((r) => r[valKey] || 0)), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={r[labelKey]} className="flex items-center gap-3 text-xs">
          <span className="w-32 text-slate-700 truncate" title={r[labelKey]}>{r[labelKey]}</span>
          <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
            <div className="h-full" style={{ width: `${(r[valKey] / max) * 100}%`, background: COLORS[i % COLORS.length] }} />
          </div>
          <span className="w-12 text-right font-semibold text-slate-900">{r[valKey]}</span>
        </div>
      ))}
    </div>
  );
};
