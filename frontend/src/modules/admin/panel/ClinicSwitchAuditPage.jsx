/**
 * Clinic Switch Audit — chronological trail of every /auth/switch-clinic
 * call, shown in the super-admin panel for compliance & abuse detection.
 *
 * Filters by user (id or email), clinic (either side), and date.
 * Top-movers aggregate is shown in the header so it's obvious if a single
 * user is hopping tenants unusually often.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ArrowRight, Building2, Clock, Search } from 'lucide-react';
import { PageHeader, Card, Empty, fmtDateTime } from './shared';
import Pagination, { DEFAULT_PAGE_SIZE, usePaginationSlice } from '../../../components/Pagination';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ClinicSwitchAuditPage() {
  const [data, setData] = useState({ count: 0, rows: [], distinct_users: 0, top_movers: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState({ user_id: '', clinic_id: '', since: '' });
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const params = {};
      if (filters.user_id.trim()) params.user_id = filters.user_id.trim();
      if (filters.clinic_id.trim()) params.clinic_id = filters.clinic_id.trim();
      if (filters.since) params.since = new Date(filters.since).toISOString();
      const r = await axios.get(`${API}/admin/v2/clinic-switch-audit`, { params });
      setData(r.data || { count: 0, rows: [], distinct_users: 0, top_movers: [] });
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setPage(1); }, [data.rows.length]);

  const paged = usePaginationSlice(data.rows, page, DEFAULT_PAGE_SIZE);

  return (
    <div className="p-6 space-y-5" data-testid="admin-clinic-switch-audit-page">
      <PageHeader
        title="Clinic Switch Audit"
        subtitle="Every multi-clinic context-switch recorded for compliance"
      />

      <Card title="Filters" testid="csa-filters">
        <form
          onSubmit={(e) => { e.preventDefault(); load(); }}
          className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3"
        >
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">User ID</label>
            <input
              value={filters.user_id}
              onChange={(e) => setFilters((f) => ({ ...f, user_id: e.target.value }))}
              placeholder="USR-XXXXXXXX"
              data-testid="csa-filter-user"
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Clinic ID (from OR to)</label>
            <input
              value={filters.clinic_id}
              onChange={(e) => setFilters((f) => ({ ...f, clinic_id: e.target.value }))}
              placeholder="tenant-xyz"
              data-testid="csa-filter-clinic"
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Since</label>
            <input
              type="date"
              value={filters.since}
              onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
              data-testid="csa-filter-since"
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
            />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" data-testid="csa-apply-btn" className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded">
              <Search size={12} /> Apply
            </button>
            <button
              type="button"
              onClick={() => { setFilters({ user_id: '', clinic_id: '', since: '' }); setTimeout(load, 0); }}
              data-testid="csa-clear-btn"
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 border border-slate-300 rounded"
            >
              Clear
            </button>
          </div>
        </form>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile label="Switches" value={data.count} testid="csa-stat-switches" />
        <Tile label="Distinct users" value={data.distinct_users} testid="csa-stat-users" />
        <Tile label="Top mover" value={data.top_movers[0]?.user || '—'} subvalue={data.top_movers[0] ? `${data.top_movers[0].switch_count}×` : ''} testid="csa-stat-top" />
      </div>

      {err && <div className="p-3 text-xs text-rose-700 bg-rose-50 rounded border border-rose-200">{err}</div>}

      <Card title="Trail" subtitle={loading ? 'Loading…' : `${data.count} switch${data.count === 1 ? '' : 'es'} · newest first`} testid="csa-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">From → To</th>
                <th className="px-4 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.audit_id} className="border-t border-slate-100" data-testid={`csa-row-${r.audit_id}`}>
                  <td className="px-4 py-2 text-[11px] text-slate-500 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1"><Clock size={10} /> {fmtDateTime(r.at)}</span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-semibold text-slate-900 text-xs">{r.user_email}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{r.user_id} · {r.user_role}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded">
                        <Building2 size={10} />
                        <span className="font-semibold text-slate-800">{r.from_clinic_name || r.from_clinic_id}</span>
                      </span>
                      <ArrowRight size={12} className="text-indigo-600" />
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 rounded">
                        <Building2 size={10} className="text-indigo-700" />
                        <span className="font-semibold text-indigo-900">{r.to_clinic_name || r.to_clinic_id}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-[11px] text-slate-500 font-mono">{r.ip || '—'}</td>
                </tr>
              ))}
              {!loading && data.rows.length === 0 && (
                <tr><td colSpan={4}><Empty>No switches recorded yet. Sign in as a multi-clinic owner and switch to generate entries.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={data.rows.length} testidPrefix="csa-pagination" />
      </Card>

      {data.top_movers.length > 1 && (
        <Card title="Top movers" subtitle="Most frequent switchers in this query" testid="csa-top-movers">
          <div className="p-4 space-y-1">
            {data.top_movers.map((m) => (
              <div key={m.user} className="flex items-center justify-between text-xs" data-testid={`csa-mover-${m.user}`}>
                <span className="font-mono text-slate-700">{m.user}</span>
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-semibold">{m.switch_count} switches</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const Tile = ({ label, value, subvalue, testid }) => (
  <div data-testid={testid} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
    <div className="text-2xl font-bold text-slate-900 mt-1 truncate">{value}</div>
    {subvalue && <div className="text-[11px] text-slate-500 mt-0.5">{subvalue}</div>}
  </div>
);
