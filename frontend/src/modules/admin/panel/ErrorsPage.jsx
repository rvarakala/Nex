/**
 * Founder Panel — Errors page (self-hosted crash log).
 *
 * Reads `GET /api/admin/v2/errors` (founder + super_admin only). Shows two
 * panels:
 *  - Top-grouped fingerprints in the chosen window (so a single regression
 *    bursts visibly to the top of the page).
 *  - Recent rows table with kind/path/clinic/user filters.
 *
 * Drilling into a row hits `GET /api/admin/v2/errors/{log_id}` and shows
 * the full traceback / component stack in a side drawer.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertOctagon, RefreshCw, X, Filter } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL || ''}/api`;

const WINDOWS = [
  { mins: 60,           label: 'Last 1h' },
  { mins: 60 * 6,       label: 'Last 6h' },
  { mins: 60 * 24,      label: 'Last 24h' },
  { mins: 60 * 24 * 7,  label: 'Last 7d' },
  { mins: 60 * 24 * 30, label: 'Last 30d' },
];

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { hour12: false });
}

function KindPill({ kind }) {
  const cls = kind === 'frontend'
    ? 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200'
    : 'bg-rose-100 text-rose-800 border-rose-200';
  return (
    <span className={`inline-flex items-center px-1.5 py-[1px] rounded text-[9px] font-bold uppercase tracking-wide border ${cls}`}>
      {kind || '?'}
    </span>
  );
}

export default function ErrorsPage() {
  const [data, setData] = useState({ rows: [], groups: [], window_minutes: 60 * 24 });
  const [loading, setLoading] = useState(true);
  const [windowMins, setWindowMins] = useState(60 * 24);
  const [kindFilter, setKindFilter] = useState('');
  const [clinicFilter, setClinicFilter] = useState('');
  const [fingerprintFilter, setFingerprintFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = { since_minutes: windowMins };
      if (kindFilter) params.kind = kindFilter;
      if (clinicFilter) params.clinic_id = clinicFilter;
      if (fingerprintFilter) params.fingerprint = fingerprintFilter;
      const r = await axios.get(`${API}/admin/v2/errors`, { params });
      setData(r.data);
    } catch (err) {
      // Don't loop the crash reporter on its own page.
      // eslint-disable-next-line no-console
      console.error('errors page load failed:', err?.response?.data || err);
      setData({ rows: [], groups: [], window_minutes: windowMins });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [windowMins, kindFilter, clinicFilter, fingerprintFilter]);

  const openDrawer = async (row) => {
    setSelected(row);
    setSelectedDetail(null);
    try {
      const r = await axios.get(`${API}/admin/v2/errors/${row.log_id}`);
      setSelectedDetail(r.data);
    } catch {
      setSelectedDetail(row); // fall back to the list row
    }
  };

  const totals = useMemo(() => {
    const t = { rows: data.rows.length, frontend: 0, backend: 0, clinics: new Set() };
    data.rows.forEach((r) => {
      if (r.kind === 'frontend') t.frontend += 1;
      else if (r.kind === 'backend') t.backend += 1;
      if (r.clinic_id) t.clinics.add(r.clinic_id);
    });
    t.clinics = t.clinics.size;
    return t;
  }, [data.rows]);

  return (
    <div className="p-3 sm:p-6 max-w-[1400px] mx-auto" data-testid="admin-errors-page">
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <AlertOctagon size={20} className="text-rose-600" strokeWidth={2.2} />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Errors</h1>
          </div>
          <p className="text-xs text-slate-500 max-w-[640px] leading-snug">
            Self-hosted crash log. Backend 5xx and React crashes both land here. Records auto-purge after 30 days (configurable via <code className="px-1 bg-slate-100 rounded">ERROR_LOG_RETENTION_DAYS</code>).
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          data-testid="errors-refresh-btn"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded p-3 mb-4 flex flex-wrap gap-2 items-center text-xs">
        <Filter size={14} className="text-slate-400" />
        <select
          value={windowMins}
          onChange={(e) => setWindowMins(parseInt(e.target.value, 10))}
          data-testid="errors-window-select"
          className="px-2 py-1 border border-slate-300 rounded bg-white">
          {WINDOWS.map((w) => <option key={w.mins} value={w.mins}>{w.label}</option>)}
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          data-testid="errors-kind-select"
          className="px-2 py-1 border border-slate-300 rounded bg-white">
          <option value="">All kinds</option>
          <option value="backend">Backend 5xx</option>
          <option value="frontend">Frontend crashes</option>
        </select>
        <input
          type="text"
          value={clinicFilter}
          onChange={(e) => setClinicFilter(e.target.value)}
          placeholder="clinic_id…"
          data-testid="errors-clinic-input"
          className="px-2 py-1 border border-slate-300 rounded w-[180px]"
        />
        {fingerprintFilter && (
          <button
            onClick={() => setFingerprintFilter('')}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-rose-50 text-rose-700 border border-rose-200 rounded font-mono"
            title="Clear fingerprint filter"
            data-testid="errors-clear-fingerprint">
            fp:{fingerprintFilter} <X size={10} />
          </button>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          <span><b className="text-slate-700">{totals.rows}</b> total</span>
          <span><b className="text-rose-700">{totals.backend}</b> backend</span>
          <span><b className="text-fuchsia-700">{totals.frontend}</b> frontend</span>
          <span><b className="text-slate-700">{totals.clinics}</b> clinic{totals.clinics !== 1 && 's'}</span>
        </div>
      </div>

      {/* Top fingerprint groups */}
      {data.groups.length > 0 && (
        <div className="bg-white border border-slate-200 rounded mb-4">
          <div className="px-3 py-2 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Top patterns in this window
          </div>
          <div className="divide-y divide-slate-100">
            {data.groups.slice(0, 6).map((g) => (
              <button
                key={g.fingerprint}
                onClick={() => setFingerprintFilter(g.fingerprint)}
                data-testid={`errors-group-${g.fingerprint}`}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-3 text-xs">
                <span className="inline-flex items-center justify-center min-w-[2.5rem] h-6 px-2 rounded bg-rose-600 text-white font-bold text-[11px] tabular-nums">
                  ×{g.count}
                </span>
                <KindPill kind={g.kind} />
                <span className="font-mono text-rose-700 font-semibold whitespace-nowrap">{g.exception_type}</span>
                <span className="text-slate-700 truncate flex-1" title={g.message}>{g.message || '—'}</span>
                <span className="font-mono text-[10px] text-slate-500 truncate max-w-[200px]" title={g.path}>{g.path}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{g.clinics_affected} clinic{g.clinics_affected !== 1 && 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent rows */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Recent occurrences {data.rows.length > 0 && <span className="font-normal text-slate-400">({data.rows.length})</span>}
        </div>
        {loading && data.rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading…</div>
        ) : data.rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400" data-testid="errors-empty">
            No errors in this window. <span className="text-emerald-600 font-semibold">Great.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="errors-table">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide text-slate-600">When</th>
                  <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide text-slate-600">Kind</th>
                  <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide text-slate-600">Type</th>
                  <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide text-slate-600">Path</th>
                  <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide text-slate-600">Clinic</th>
                  <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide text-slate-600">User</th>
                  <th className="text-left px-3 py-2 font-bold text-[10px] uppercase tracking-wide text-slate-600">Message</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.log_id}
                    onClick={() => openDrawer(r)}
                    data-testid={`errors-row-${r.log_id}`}
                    className="border-b border-slate-100 last:border-0 cursor-pointer hover:bg-rose-50/50">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular-nums">{fmt(r.at)}</td>
                    <td className="px-3 py-2"><KindPill kind={r.kind} /></td>
                    <td className="px-3 py-2 font-mono text-rose-700 font-semibold whitespace-nowrap">{r.exception_type}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-700 max-w-[260px] truncate" title={r.path}>{r.path}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-700">{r.clinic_id || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-700">{r.user_id || <span className="text-slate-300">anon</span>}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[420px] truncate" title={r.message}>{r.message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex" data-testid="errors-drawer">
          <button onClick={() => { setSelected(null); setSelectedDetail(null); }} className="flex-1 bg-black/40" aria-label="Close" />
          <aside className="w-full max-w-2xl bg-white shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <KindPill kind={selected.kind} />
                  <span className="font-mono text-xs font-bold text-rose-700">{selected.exception_type}</span>
                  <span className="font-mono text-[10px] text-slate-400">fp:{selected.fingerprint}</span>
                </div>
                <div className="text-sm font-semibold text-slate-900 truncate" title={selected.message}>{selected.message || '—'}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {fmt(selected.at)} · <code className="text-slate-700">{selected.method} {selected.path}</code>
                  {selected.request_id && <> · req:{selected.request_id}</>}
                </div>
              </div>
              <button onClick={() => { setSelected(null); setSelectedDetail(null); }} className="text-slate-400 hover:text-slate-700" data-testid="errors-drawer-close">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 text-xs space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">Clinic</div><div className="font-mono">{selected.clinic_id || '—'}</div></div>
                <div><div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">User</div><div className="font-mono">{selected.user_id || 'anonymous'}</div></div>
                <div><div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">Client IP</div><div className="font-mono">{selected.client_ip || '—'}</div></div>
                <div><div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">Session</div><div className="font-mono break-all">{selected.session_id || '—'}</div></div>
              </div>
              {selected.user_agent && (
                <div><div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-0.5">User agent</div><div className="font-mono text-[11px] break-all">{selected.user_agent}</div></div>
              )}
              {(selectedDetail?.traceback || selected.traceback) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Traceback</div>
                  <pre className="bg-slate-900 text-rose-300 p-3 rounded font-mono text-[11px] whitespace-pre-wrap break-all overflow-auto max-h-[400px]">{selectedDetail?.traceback || selected.traceback}</pre>
                </div>
              )}
              {(selectedDetail?.component_stack || selected.component_stack) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Component stack</div>
                  <pre className="bg-slate-900 text-fuchsia-300 p-3 rounded font-mono text-[11px] whitespace-pre-wrap break-all overflow-auto max-h-[300px]">{selectedDetail?.component_stack || selected.component_stack}</pre>
                </div>
              )}
              {selected.extra && Object.keys(selected.extra).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Extra context</div>
                  <pre className="bg-slate-50 border border-slate-200 p-3 rounded font-mono text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(selected.extra, null, 2)}</pre>
                </div>
              )}
              {selected.query_string && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Query string</div>
                  <pre className="bg-slate-50 border border-slate-200 p-3 rounded font-mono text-[11px] whitespace-pre-wrap break-all">{selected.query_string}</pre>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
