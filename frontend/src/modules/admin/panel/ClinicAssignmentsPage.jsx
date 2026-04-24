/**
 * Clinic Assignments — super-admin UI for the Multi-Clinic Brand Wrapper.
 *
 * Lets founders / super_admins:
 *   • see every clinic_owner (and other tenant users) with their primary +
 *     additional clinic grants (total, tier, city).
 *   • link a user to another clinic they can sign into.
 *   • unlink an extra clinic from a user.
 *
 * The `link` / `unlink` mutations reuse the existing
 * POST /api/auth/link-clinic and /api/auth/unlink-clinic endpoints —
 * this page is a UI layer over the already-shipped primitives.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link2, Plus, Search, X, Building2, Download } from 'lucide-react';
import { PageHeader, Card, Pill, Empty, tierTone, fmtDate } from './shared';
import Pagination, { DEFAULT_PAGE_SIZE, usePaginationSlice } from '../../../components/Pagination';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ClinicAssignmentsPage() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [linkFor, setLinkFor] = useState(null); // user row to open link-modal for
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);

  const exportCSV = async () => {
    setExporting(true); setErr('');
    try {
      const r = await axios.get(`${API}/admin/v2/clinic-assignments/export.csv`, {
        params: q ? { q } : {},
        responseType: 'blob',
      });
      const blob = new Blob([r.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dispo = r.headers['content-disposition'] || '';
      const m = /filename="([^"]+)"/i.exec(dispo);
      a.download = m ? m[1] : `clinic-assignments-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/admin/v2/clinic-assignments`, {
        params: q ? { q } : {},
      });
      setRows(r.data?.rows || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setPage(1); }, [rows.length]);

  const stats = useMemo(() => {
    const multi = rows.filter((r) => r.total_clinics > 1).length;
    const assignments = rows.reduce((a, r) => a + r.total_clinics, 0);
    return { users: rows.length, multi, assignments };
  }, [rows]);

  const paged = usePaginationSlice(rows, page, DEFAULT_PAGE_SIZE);

  const unlink = async (user_id, clinic_id) => {
    if (!window.confirm('Revoke this clinic from the user? Active sessions on that clinic will be invalidated.')) return;
    await axios.post(`${API}/auth/unlink-clinic`, { user_id, clinic_id });
    load();
  };

  return (
    <div className="p-6 space-y-5" data-testid="admin-clinic-assignments-page">
      <PageHeader
        title="Clinic Assignments"
        subtitle="Multi-clinic brand wrapper · which users can sign into which clinics"
      >
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email…"
              data-testid="ca-search-input"
              className="pl-7 pr-3 py-1.5 text-xs border border-slate-300 rounded w-64"
            />
          </div>
          <button type="submit" data-testid="ca-search-btn" className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded">
            Search
          </button>
          <button
            type="button"
            onClick={exportCSV}
            disabled={exporting || rows.length === 0}
            data-testid="ca-export-csv-btn"
            title={rows.length === 0 ? 'No rows to export' : 'Download current list as CSV (one row per assignment)'}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 border border-emerald-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={12} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </form>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile label="Users" value={stats.users} tone="slate" testid="ca-stat-users" />
        <StatTile label="Multi-clinic owners" value={stats.multi} tone="fuchsia" testid="ca-stat-multi" />
        <StatTile label="Total clinic assignments" value={stats.assignments} tone="indigo" testid="ca-stat-assignments" />
      </div>

      {err && <div className="p-3 text-xs text-rose-700 bg-rose-50 rounded border border-rose-200">{err}</div>}

      <Card title="Users" subtitle={loading ? 'Loading…' : `${rows.length} tenant user${rows.length === 1 ? '' : 's'}`} testid="ca-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Primary clinic</th>
                <th className="px-4 py-2 text-left">Additional clinics</th>
                <th className="px-4 py-2 text-center">Total</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((u) => (
                <tr key={u.user_id} className="border-t border-slate-100 align-top" data-testid={`ca-row-${u.user_id}`}>
                  <td className="px-4 py-2">
                    <div className="font-semibold text-slate-900">{u.name || '—'}</div>
                    <div className="text-[11px] text-slate-500">{u.email}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Since {fmtDate(u.created_at)}</div>
                  </td>
                  <td className="px-4 py-2">
                    <Pill tone="indigo">{u.role}</Pill>
                    {!u.active && <span className="block mt-1"><Pill tone="slate">Disabled</Pill></span>}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <ClinicChip c={u.primary_clinic} id={u.primary_clinic_id} primary />
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {(u.additional_clinics || []).length === 0 ? (
                      <span className="text-[11px] text-slate-400 italic">No additional clinics</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.additional_clinics.map((c) => (
                          <div
                            key={c.clinic_id}
                            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-indigo-50 border border-indigo-200 rounded"
                            data-testid={`ca-extra-${u.user_id}-${c.clinic_id}`}
                          >
                            <Building2 size={10} className="text-indigo-600" />
                            <span className="font-semibold text-indigo-800">{c.name}</span>
                            {c.subscription_tier && <Pill tone={tierTone(c.subscription_tier)}>{c.subscription_tier}</Pill>}
                            <button
                              onClick={() => unlink(u.user_id, c.clinic_id)}
                              data-testid={`ca-unlink-${u.user_id}-${c.clinic_id}`}
                              title="Revoke"
                              className="ml-1 p-0.5 text-rose-600 hover:bg-rose-100 rounded"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-flex items-center justify-center rounded-full w-6 h-6 text-[11px] font-bold ${
                      u.total_clinics > 1 ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {u.total_clinics}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setLinkFor(u)}
                      data-testid={`ca-link-btn-${u.user_id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 border border-indigo-200 rounded"
                    >
                      <Plus size={10} /> Link clinic
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6}><Empty>No users match.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={rows.length} testidPrefix="ca-pagination" />
      </Card>

      {linkFor && (
        <LinkClinicModal
          user={linkFor}
          onClose={() => setLinkFor(null)}
          onLinked={() => { setLinkFor(null); load(); }}
        />
      )}
    </div>
  );
}

const StatTile = ({ label, value, tone, testid }) => {
  const tones = {
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
    fuchsia: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900',
  };
  return (
    <div data-testid={testid} className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
};

const ClinicChip = ({ c, id, primary }) => {
  if (!c) return <span className="text-slate-400 italic">{id || '—'}</span>;
  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${primary ? 'bg-slate-50 border-slate-300' : 'bg-indigo-50 border-indigo-200'}`}>
      <Building2 size={10} className={primary ? 'text-slate-600' : 'text-indigo-600'} />
      <span className="font-semibold text-slate-800">{c.name}</span>
      {c.city && <span className="text-[10px] text-slate-500">· {c.city}</span>}
      {c.subscription_tier && <Pill tone={tierTone(c.subscription_tier)}>{c.subscription_tier}</Pill>}
      {primary && <Pill tone="slate">Primary</Pill>}
    </div>
  );
};

// ---- Link-clinic modal ---------------------------------------------------

function LinkClinicModal({ user, onClose, onLinked }) {
  const [clinics, setClinics] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    axios.get(`${API}/admin/v2/clinics-directory`)
      .then((r) => setClinics(r.data || []))
      .catch(() => setClinics([]));
  }, []);

  // Exclude the clinics the user already has access to.
  const excluded = new Set([user.primary_clinic_id, ...(user.additional_clinic_ids || [])]);
  const filtered = clinics
    .filter((c) => c.clinic_id !== 'audinexa-platform' && !excluded.has(c.clinic_id))
    .filter((c) => !q || (c.name || '').toLowerCase().includes(q.toLowerCase()) || (c.city || '').toLowerCase().includes(q.toLowerCase()));

  const link = async (clinic_id) => {
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/auth/link-clinic`, { user_id: user.user_id, clinic_id });
      onLinked();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Link failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="ca-link-modal"
    >
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Link2 size={14} /> Link clinic</h3>
            <p className="text-[11px] text-slate-500">Grant <span className="font-semibold">{user.email}</span> access to another clinic</p>
          </div>
          <button onClick={onClose} data-testid="ca-link-close" className="p-1 text-slate-500 hover:text-slate-900"><X size={16} /></button>
        </div>

        <div className="p-4">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clinic by name or city…"
            data-testid="ca-link-search"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded mb-3"
          />
          {err && <div className="mb-3 p-2 text-xs text-rose-700 bg-rose-50 rounded border border-rose-200">{err}</div>}

          <div className="max-h-72 overflow-auto border border-slate-200 rounded">
            {filtered.length === 0 ? (
              <Empty>No eligible clinics{q ? ' match your search' : ''}.</Empty>
            ) : (
              filtered.slice(0, 50).map((c) => (
                <button
                  key={c.clinic_id}
                  onClick={() => link(c.clinic_id)}
                  disabled={busy}
                  data-testid={`ca-link-option-${c.clinic_id}`}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50 border-b border-slate-100 disabled:opacity-50"
                >
                  <Building2 size={12} className="text-indigo-600" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {[c.city, c.state].filter(Boolean).join(', ')}
                      {c.subscription_tier && ` · ${c.subscription_tier}`}
                      {c.active === false && ' · (inactive)'}
                    </div>
                  </div>
                  <Link2 size={12} className="text-slate-400" />
                </button>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded" data-testid="ca-link-cancel">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Surface an alias so nav imports can use either name.
export { ClinicAssignmentsPage };
