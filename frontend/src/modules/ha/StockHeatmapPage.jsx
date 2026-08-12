/*
 * Stock Heatmap — Feb 2026 (Multi-Clinic Phase 2)
 *
 * Head-clinic-owner-only view: a live matrix showing how many IN_STOCK
 * serials of each HA product sit at each branch. Cells are colour-coded
 * on a 3-stop scale (empty → sparse → healthy) so imbalances jump out
 * at a glance. From here the owner can trigger a rebalancing transfer
 * without hunting through per-branch inventory boards.
 *
 * Backend: GET /api/clinic-groups/mine/stock-heatmap
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Flame, Building2, ArrowRightLeft, RefreshCw } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Colour ramp: empty=slate, 1-2=amber, 3-5=lime, 6+=emerald. Tuned so
// a busy clinic with lots of stock looks reassuring, and thin cells
// visibly demand attention.
function cellTone(n) {
  if (!n)         return 'bg-slate-50 text-slate-300';
  if (n <= 2)     return 'bg-rose-50 text-rose-800 font-bold ring-1 ring-rose-200';
  if (n <= 5)     return 'bg-amber-50 text-amber-800 font-semibold';
  return 'bg-emerald-50 text-emerald-800 font-semibold';
}

export default function StockHeatmapPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showLowOnly, setShowLowOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await axios.get(`${API}/clinic-groups/mine/stock-heatmap`);
      setData(r.data);
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Failed to load heatmap');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    let out = data.rows;
    const q = search.trim().toLowerCase();
    if (q) out = out.filter(r => (r.label || '').toLowerCase().includes(q));
    if (showLowOnly) {
      // "Low" = any cell has ≤ 2 stock but total > 0 (so we hide totally-
      // depleted rows, which are usually stale catalogue entries).
      out = out.filter(r => Object.values(r.cells).some(v => v > 0 && v <= 2));
    }
    return out;
  }, [data, search, showLowOnly]);

  if (loading) {
    return <div className="p-8 text-center text-slate-400 italic">Loading heatmap…</div>;
  }
  if (err) {
    return (
      <div className="p-8" data-testid="ha-heatmap-error">
        <div className="max-w-lg mx-auto text-center bg-rose-50 border border-rose-200 rounded-lg p-6">
          <Flame className="mx-auto mb-2 text-rose-500" size={22} />
          <div className="text-sm font-semibold text-rose-800">Heatmap unavailable</div>
          <div className="text-[12px] text-rose-600 mt-1">{err}</div>
          <div className="text-[11px] text-slate-500 italic mt-2">
            This view is only available to the owner of a head clinic in a multi-clinic group.
          </div>
        </div>
      </div>
    );
  }
  if (!data || data.branches.length <= 1) {
    return (
      <div className="p-8 text-center" data-testid="ha-heatmap-empty">
        <Building2 className="mx-auto text-slate-300 mb-2" size={30} />
        <div className="text-sm font-semibold text-slate-700">No branches to compare yet</div>
        <div className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">
          Add branches under <Link className="text-indigo-700 underline" to="/settings/clinics">Settings → Multi-Clinic Group</Link> to see this live stock-balance view.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6" data-testid="ha-heatmap-page">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Stock Heatmap</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Live IN_STOCK counts across every branch in your group. Sparse cells (rose) need attention — rebalance via <Link className="text-indigo-700 underline" to="/ha/transfers">Transfers</Link>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by brand or model…"
            data-testid="ha-heatmap-search"
            className="px-3 py-1.5 text-xs border border-slate-300 rounded w-56 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            onClick={() => setShowLowOnly(v => !v)}
            data-testid="ha-heatmap-low-only"
            className={`px-3 py-1.5 text-[11px] font-semibold rounded border ${
              showLowOnly
                ? 'bg-rose-600 text-white border-rose-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >Show low stock only</button>
          <button
            onClick={load}
            data-testid="ha-heatmap-reload"
            title="Reload"
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* KPI band */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Kpi label="Branches" value={data.branches.length} testid="ha-heatmap-kpi-branches" />
        <Kpi label="Distinct Products" value={data.rows.length} testid="ha-heatmap-kpi-products" />
        <Kpi label="Grand Total Units" value={data.grand_total} testid="ha-heatmap-kpi-total" />
        <Kpi
          label="Low-Stock Alerts"
          value={data.rows.reduce((n, r) => n + Object.values(r.cells).filter(v => v > 0 && v <= 2).length, 0)}
          testid="ha-heatmap-kpi-lows"
          tone="rose"
        />
      </div>

      {/* Matrix */}
      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 font-semibold min-w-[220px]">Product</th>
              {data.branches.map(b => (
                <th key={b.clinic_id} className="text-center px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 font-semibold min-w-[100px]">
                  <div>{b.name}</div>
                  {b.is_head && (
                    <div className="text-[9px] font-normal text-indigo-600 mt-0.5">HEAD</div>
                  )}
                  {!b.is_head && b.city && (
                    <div className="text-[9px] font-normal text-slate-400 mt-0.5">{b.city}</div>
                  )}
                </th>
              ))}
              <th className="text-center px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={data.branches.length + 2} className="text-center py-10 text-slate-400 italic text-sm">
                  {search || showLowOnly ? 'No rows match this filter.' : 'No IN_STOCK units across any branch yet.'}
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.product_id} className="border-t border-slate-100 hover:bg-slate-50/40" data-testid={`ha-heatmap-row-${r.product_id}`}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{r.label}</div>
                  <div className="text-[10px] text-slate-500 flex gap-2 mt-0.5">
                    {r.form_factor && <span className="uppercase tracking-wider">{r.form_factor}</span>}
                    {r.tech_tier && <span className="capitalize">{r.tech_tier}</span>}
                  </div>
                </td>
                {data.branches.map(b => {
                  const v = r.cells[b.clinic_id] || 0;
                  return (
                    <td
                      key={b.clinic_id}
                      className={`text-center tabular-nums text-[13px] ${cellTone(v)}`}
                      data-testid={`ha-heatmap-cell-${r.product_id}-${b.clinic_id}`}
                    >
                      <div className="px-3 py-2">{v}</div>
                    </td>
                  );
                })}
                <td className="text-center tabular-nums font-bold text-slate-800 border-l border-slate-100">
                  <div className="px-3 py-2">{r.total}</div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t-2 border-slate-300">
            <tr>
              <td className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Branch total</td>
              {data.branches.map(b => (
                <td key={b.clinic_id} className="px-3 py-2 text-center tabular-nums font-bold text-slate-800">
                  {data.branch_totals[b.clinic_id] || 0}
                </td>
              ))}
              <td className="px-3 py-2 text-center tabular-nums font-bold text-slate-800">
                {data.grand_total}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
        <LegendSwatch tone="bg-slate-50" label="Empty" />
        <LegendSwatch tone="bg-rose-50 ring-1 ring-rose-200" label="≤ 2 (low)" />
        <LegendSwatch tone="bg-amber-50" label="3–5" />
        <LegendSwatch tone="bg-emerald-50" label="6+" />
        <div className="ml-auto">
          <Link
            to="/ha/transfers"
            className="inline-flex items-center gap-1 text-indigo-700 font-semibold hover:underline"
          >
            <ArrowRightLeft size={11} /> Open Transfers
          </Link>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, testid, tone }) {
  const cls = tone === 'rose'
    ? 'bg-rose-50 border-rose-200 text-rose-800'
    : 'bg-white border-slate-200 text-slate-700';
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function LegendSwatch({ tone, label }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-block w-4 h-4 rounded ${tone}`} />
      <span>{label}</span>
    </div>
  );
}
