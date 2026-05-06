/* Revenue Dashboard — accounts/revenue + recent-payments backed.
 *
 * Range buttons: Daily / Weekly / Monthly / Quarterly / Half-Yearly / Yearly /
 * Custom (with from-to pickers). Cards: total, payment count, unique patients,
 * invoice count. Charts: line of daily timeseries, breakdown tables for method
 * / referring doctor / test.
 */
import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { Calendar, IndianRupee, Users, FileText, RefreshCw, Stethoscope, UserSquare2 } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart,
} from 'recharts';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const RANGES = [
  { key: 'daily',       label: 'Today' },
  { key: 'weekly',      label: 'Last 7 days' },
  { key: 'monthly',     label: 'Last 30 days' },
  { key: 'quarterly',   label: 'Last 90 days' },
  { key: 'half_yearly', label: 'Last 6 months' },
  { key: 'yearly',      label: 'Last year' },
  { key: 'custom',      label: 'Custom range' },
];

const fmtINR = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function AccountsRevenuePage() {
  const [range, setRange] = useState('monthly');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const params = { range };
      if (range === 'custom') {
        if (!from || !to) { setError('Pick a from and to date'); setLoading(false); return; }
        params.from = from; params.to = to;
      }
      const [r1, r2] = await Promise.all([
        axios.get(`${API}/accounts/revenue`, { params }),
        axios.get(`${API}/accounts/recent-payments`, { params: { limit: 30 } }),
      ]);
      setData(r1.data);
      setRecent(r2.data || []);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (range !== 'custom' || (from && to)) load(); /* eslint-disable-next-line */ }, [range]);

  const chartData = useMemo(() => (data?.timeseries || []).map(d => ({
    label: d.date.slice(5),  // MM-DD
    amount: d.amount,
    count: d.count,
  })), [data]);

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen" data-testid="accounts-revenue-page">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <IndianRupee size={24} className="text-emerald-600" /> Revenue Dashboard
          </h1>
          <p className="text-xs text-slate-500 mt-1">Accounts overview · payments aggregated by date, doctor, test &amp; method</p>
        </div>
        <button
          data-testid="accounts-refresh"
          onClick={load}
          className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </header>

      {/* Range selector */}
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-slate-200">
        <div className="flex flex-wrap gap-2">
          {RANGES.map(r => (
            <button
              key={r.key}
              data-testid={`range-${r.key}`}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all ${
                range === r.key
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-0.5">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 text-xs border border-slate-300 rounded" data-testid="range-from" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-0.5">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 text-xs border border-slate-300 rounded" data-testid="range-to" />
            </div>
            <button onClick={load} className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded" data-testid="range-apply">Apply</button>
          </div>
        )}
        {data && (
          <div className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5">
            <Calendar size={11} /> {data.from} → {data.to}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800" data-testid="accounts-error">{error}</div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total revenue" value={fmtINR(data?.total)} tone="emerald" testid="kpi-total" loading={loading} />
        <KPI label="Payments" value={data?.payment_count ?? '—'} tone="indigo" testid="kpi-payments" loading={loading} />
        <KPI label="Unique paying patients" value={data?.unique_patients ?? '—'} tone="fuchsia" testid="kpi-patients" loading={loading} />
        <KPI label="Invoices" value={data?.invoice_count ?? '—'} tone="amber" testid="kpi-invoices" loading={loading} />
      </div>

      {/* Timeseries chart */}
      <div className="bg-white rounded-2xl shadow-sm p-5 border border-slate-200" data-testid="revenue-chart">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Daily revenue</h2>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{(chartData || []).length} days</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v, n) => n === 'amount' ? fmtINR(v) : v} />
            <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fill="url(#colorRev)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown tables row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BreakdownCard
          title="By referring doctor"
          icon={UserSquare2}
          rows={(data?.by_referring_doctor || []).slice(0, 8)}
          getKey={(r) => r.name}
          getLabel={(r) => r.name}
          testid="breakdown-doctor"
        />
        <BreakdownCard
          title="By test"
          icon={Stethoscope}
          rows={(data?.by_test || []).slice(0, 8)}
          getKey={(r) => r.test}
          getLabel={(r) => r.test}
          testid="breakdown-test"
        />
        <BreakdownCard
          title="By payment method"
          icon={IndianRupee}
          rows={Object.entries(data?.by_method || {}).map(([k, v]) => ({ name: k, amount: v, count: 0 }))}
          getKey={(r) => r.name}
          getLabel={(r) => r.name.toUpperCase()}
          showCount={false}
          testid="breakdown-method"
        />
      </div>

      {/* Recent payments */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200" data-testid="recent-payments">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <FileText size={14} className="text-slate-500" />
          <h2 className="text-sm font-bold text-slate-900">Recent payments</h2>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-auto">{recent.length} most recent</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Method</th>
                <th className="px-4 py-2 text-left">Reference</th>
                <th className="px-4 py-2 text-left">Tests</th>
                <th className="px-4 py-2 text-left">Ref. Dr</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400 italic">No payments in window</td></tr>}
              {recent.map(p => (
                <tr key={p.payment_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`payment-row-${p.payment_id}`}>
                  <td className="px-4 py-2 font-mono text-[11px]">{(p.paid_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-2 uppercase">{p.method}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">{p.reference || '—'}</td>
                  <td className="px-4 py-2">{(p.tests || []).join(' + ') || '—'}</td>
                  <td className="px-4 py-2">{p.referring_doctor_name || <span className="text-slate-400">walk-in</span>}</td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">{fmtINR(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const TONES = {
  emerald: 'from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-900',
  indigo:  'from-indigo-50  to-indigo-100  border-indigo-200  text-indigo-900',
  fuchsia: 'from-fuchsia-50 to-fuchsia-100 border-fuchsia-200 text-fuchsia-900',
  amber:   'from-amber-50   to-amber-100   border-amber-200   text-amber-900',
};

function KPI({ label, value, tone = 'emerald', testid, loading }) {
  return (
    <div data-testid={testid} className={`rounded-xl p-4 bg-gradient-to-br border min-w-0 overflow-hidden ${TONES[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70 truncate">{label}</div>
      <div className="text-2xl font-bold mt-1 truncate" title={String(value)}>{loading ? '…' : value}</div>
    </div>
  );
}

function BreakdownCard({ title, icon: Icon, rows, getKey, getLabel, showCount = true, testid }) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) || 1;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200" data-testid={testid}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon size={14} className="text-slate-500" />
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>
      <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
        {rows.length === 0 && <div className="text-center text-slate-400 italic text-xs py-6">No data</div>}
        {rows.map((r) => {
          const pct = (r.amount / total) * 100;
          return (
            <div key={getKey(r)} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 truncate flex-1">{getLabel(r)}</span>
                <span className="font-mono tabular-nums text-slate-900 ml-2">{fmtINR(r.amount)}</span>
                {showCount && <span className="text-[10px] text-slate-500 ml-2 flex-shrink-0">×{r.count}</span>}
              </div>
              <div className="h-1.5 bg-slate-100 rounded overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
