/**
 * CompedClinicsPage — early-adopter cohort tracker.
 *
 * Fetches /api/admin/v2/comped-clinics and renders:
 *   • 4 KPI tiles (total comped / active / expired / total months gifted)
 *   • Top reasons chip row
 *   • Sortable table with search + status filter + CSV download
 *
 * Every row links back to /admin/tenants/:id so the founder can drill in.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Gift, Download, Search, Loader2 } from 'lucide-react';
import { PageHeader, Card, KPITile, Pill, Empty, fmtDate, fmtInt } from './shared';
import Pagination, { DEFAULT_PAGE_SIZE, usePaginationSlice } from '../../../components/Pagination';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function CompedClinicsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');   // '' | 'active' | 'expired'
  const [sortBy, setSortBy] = useState('gift_trial_at');   // gift_trial_at | days_remaining | months
  const [page, setPage] = useState(1);

  const load = async () => {
    try {
      const r = await axios.get(`${API}/admin/v2/comped-clinics`);
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load comped clinics');
    }
  };
  useEffect(() => { load(); }, []);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const qq = q.trim().toLowerCase();
    let rows = data.rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!qq) return true;
      return [r.clinic_id, r.name, r.city, r.owner_email, r.gift_trial_reason, r.gifted_by]
        .some((v) => v && String(v).toLowerCase().includes(qq));
    });
    if (sortBy === 'gift_trial_at') {
      rows = [...rows].sort((a, b) => (b.gift_trial_at || '').localeCompare(a.gift_trial_at || ''));
    } else if (sortBy === 'days_remaining') {
      rows = [...rows].sort((a, b) => (a.days_remaining ?? 9999) - (b.days_remaining ?? 9999));
    } else if (sortBy === 'months') {
      rows = [...rows].sort((a, b) => (b.gift_trial_months || 0) - (a.gift_trial_months || 0));
    }
    return rows;
  }, [data, q, statusFilter, sortBy]);

  const paged = usePaginationSlice(filteredRows, page, DEFAULT_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, statusFilter, sortBy]);

  const downloadCsv = () => {
    if (!data) return;
    const header = ['clinic_id', 'name', 'city', 'owner_email', 'subscription_tier',
                    'gift_trial_at', 'gift_trial_months', 'gift_trial_reason',
                    'gifted_by', 'trial_ends_at', 'days_remaining', 'status'];
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v).replaceAll('"', '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const csv = [header.join(','), ...filteredRows.map((r) => header.map((k) => esc(r[k])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `comped-clinics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (err) {
    return (
      <div className="p-6">
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{err}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-6 flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 className="animate-spin" size={14} /> Loading comped clinics…
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="p-6 space-y-6" data-testid="comped-clinics-page">
      <PageHeader
        title="Comped Clinics"
        subtitle="Every clinic you have gifted free trial months to · early-adopter cohort tracker"
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPITile label="Total Comped" value={fmtInt(summary.total_comped)} tone="indigo" testid="kpi-comp-total" />
        <KPITile label="Active" value={fmtInt(summary.active)} tone="emerald" testid="kpi-comp-active" />
        <KPITile label="Expired" value={fmtInt(summary.expired)} tone="slate" testid="kpi-comp-expired" />
        <KPITile label="Total Months Gifted" value={fmtInt(summary.total_months_gifted)} tone="amber" testid="kpi-comp-months" />
      </div>

      {/* Top reasons chips */}
      {summary.top_reasons.length > 0 && (
        <Card title="Top reasons" subtitle="Group your early adopters by why you gave them a free trial">
          <div className="p-4 flex flex-wrap gap-2" data-testid="comp-top-reasons">
            {summary.top_reasons.map((r) => (
              <button
                key={r.reason}
                onClick={() => setQ(r.reason)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-full border border-indigo-100"
                title="Filter table by this reason"
              >
                <Gift size={11} /> {r.reason}
                <span className="text-[10px] font-bold ml-1">{r.count}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Table */}
      <Card
        title="Comped Clinics"
        subtitle={`Showing ${filteredRows.length} of ${data.rows.length}`}
        actions={
          <button
            onClick={downloadCsv}
            data-testid="comp-download-csv"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded"
          >
            <Download size={12} /> CSV
          </button>
        }
      >
        <div className="p-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <Search size={14} className="text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by clinic, city, reason, owner…"
              data-testid="comp-search"
              className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:border-indigo-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            data-testid="comp-status-filter"
            className="px-2 py-1 text-xs border border-slate-200 rounded"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            data-testid="comp-sort-by"
            className="px-2 py-1 text-xs border border-slate-200 rounded"
          >
            <option value="gift_trial_at">Sort: Recently gifted</option>
            <option value="days_remaining">Sort: Expiring soonest</option>
            <option value="months">Sort: Most months</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Clinic</th>
                <th className="px-4 py-2 text-left">Reason</th>
                <th className="px-4 py-2 text-center">Months</th>
                <th className="px-4 py-2 text-left">Gifted</th>
                <th className="px-4 py-2 text-left">Expires</th>
                <th className="px-4 py-2 text-right">Days left</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-left">By</th>
              </tr>
            </thead>
            <tbody data-testid="comp-table-body">
              {paged.map((r) => (
                <tr key={r.clinic_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`comp-row-${r.clinic_id}`}>
                  <td className="px-4 py-2">
                    <Link to={`/admin/tenants/${r.clinic_id}`} className="text-indigo-700 hover:underline font-semibold">
                      {r.name || r.clinic_id}
                    </Link>
                    {r.city && <div className="text-[10px] text-slate-500">{r.city}</div>}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.gift_trial_reason || '—'}</td>
                  <td className="px-4 py-2 text-center font-semibold text-slate-800">{r.gift_trial_months}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{fmtDate(r.gift_trial_at)}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{fmtDate(r.trial_ends_at)}</td>
                  <td className={`px-4 py-2 text-right text-xs font-semibold tabular-nums ${
                    r.days_remaining == null ? 'text-slate-400'
                      : r.days_remaining < 0 ? 'text-rose-700'
                      : r.days_remaining <= 7 ? 'text-amber-700'
                      : 'text-slate-700'
                  }`}>
                    {r.days_remaining == null ? '—' : r.days_remaining < 0 ? `${Math.abs(r.days_remaining)}d ago` : `${r.days_remaining}d`}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {r.status === 'active'
                      ? <Pill tone="emerald">Active</Pill>
                      : <Pill tone="slate">Expired</Pill>}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500 truncate max-w-[160px]" title={r.gifted_by || '—'}>{r.gifted_by || '—'}</td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr><td colSpan={8}>
                  <Empty>
                    {data.rows.length === 0
                      ? 'No comped clinics yet. Go to Tenants → 🎁 icon on a row to start.'
                      : 'No clinics match your filters.'}
                  </Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} setPage={setPage} total={filteredRows.length} testidPrefix="comp-pagination" />
      </Card>
    </div>
  );
}
