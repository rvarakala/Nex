/**
 * Patients List — directory of every patient in the clinic.
 *
 * Uses the cursor-paginated `/api/patients?cursor=` endpoint (50/page).
 * First load shows a `<ListSkeleton/>`; subsequent pages show the
 * `<LoadMoreButton/>` spinner. Search is debounced at 250ms and
 * resets pagination.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Search, UserPlus, Users, Download, Clock, X } from 'lucide-react';
import { ListSkeleton, LoadMoreButton } from '../../components/ListSkeleton';
import EmailWeeklyCsvToggle from '../../components/EmailWeeklyCsvToggle';

const API = process.env.REACT_APP_BACKEND_URL + '/api';
const PAGE_SIZE = 50;
// Threshold used for the "recall" filter. Patients registered longer
// than this many days ago (with no attempt to prove they've been back
// — the backend has no last-visit field yet) surface as "may need
// follow-up". This matches the intent of the Dashboard's Recall
// Reminders chip and Quick Action "Send Recall" without requiring a
// new backend endpoint.
const RECALL_DAYS = 180;

export default function PatientsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isRecallFilter = searchParams.get('filter') === 'recall';

  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);   // initial fetch (skeleton)
  const [loadingMore, setLoadingMore] = useState(false); // "Load more" spinner
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);

  // Fetch a page. `reset=true` discards the current list (first load /
  // search change); `reset=false` appends (Load more).
  const fetchPage = useCallback(async (reset, useCursor) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('cursor', useCursor || '');
      if (q.trim()) params.set('search', q.trim());
      const r = await axios.get(`${API}/patients?${params.toString()}`);
      const body = r.data || {};
      const newRows = Array.isArray(body) ? body : (body.items || []);
      setRows((prev) => reset ? newRows : [...prev, ...newRows]);
      setCursor(body.next_cursor || '');
      setHasMore(!!body.has_more);
    } catch {
      if (reset) setRows([]);
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, [q]);

  // Initial + search-triggered reload (debounced).
  useEffect(() => {
    const t = setTimeout(() => fetchPage(true, ''), 250);
    return () => clearTimeout(t);
  }, [fetchPage]);

  // Recall filter — client-side. We apply it on top of the paginated
  // rows so paging + search + recall all layer cleanly. Sort recall
  // rows oldest-registered first so front desk works the highest-risk
  // patients first.
  const displayRows = useMemo(() => {
    if (!isRecallFilter) return rows;
    const cutoff = Date.now() - RECALL_DAYS * 24 * 3600 * 1000;
    return rows
      .filter((p) => {
        const ts = new Date(p.created_at || p.updated_at || 0).getTime();
        return Number.isFinite(ts) && ts > 0 && ts <= cutoff;
      })
      .sort((a, b) => {
        const ta = new Date(a.created_at || 0).getTime();
        const tb = new Date(b.created_at || 0).getTime();
        return ta - tb;
      });
  }, [rows, isRecallFilter]);

  const clearRecall = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('filter');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
  };
  const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();

  const exportCsv = useCallback(() => {
    // Browser <a download> picks up the auth cookie automatically and
    // hits the streaming endpoint with the current `search` filter.
    const params = new URLSearchParams();
    if (q.trim()) params.set('search', q.trim());
    const url = `${API}/patients/export.csv${params.toString() ? '?' + params : ''}`;
    const a = document.createElement('a');
    a.href = url; a.rel = 'noopener'; a.target = '_self';
    document.body.appendChild(a); a.click(); a.remove();
  }, [q]);

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="patients-list-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users size={20} className="text-indigo-600" /> Patients
          </h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            All registered patients · {rows.length}{hasMore ? '+' : ''} {rows.length === 1 ? 'record' : 'records'} loaded
          </p>
        </div>
        <Link
          to="/patients?new=1"
          data-testid="patients-list-new"
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm shadow-indigo-600/20">
          <UserPlus size={13} /> Add Patient
        </Link>
        <button
          type="button"
          onClick={exportCsv}
          disabled={loading || rows.length === 0}
          data-testid="patients-export-csv"
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-lg font-semibold">
          <Download size={13} /> Export CSV
        </button>
        <EmailWeeklyCsvToggle kind="patients" />
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isRecallFilter && (
          <div
            className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-[12px]"
            data-testid="patients-recall-banner"
          >
            <Clock size={14} className="shrink-0" />
            <span className="font-semibold">Recall filter active —</span>
            <span className="opacity-90">
              showing patients registered over {RECALL_DAYS} days ago (oldest first).
              These may need a follow-up call.
              {' · '}
              {displayRows.length} of {rows.length} loaded rows match.
            </span>
            <button
              type="button"
              onClick={clearRecall}
              data-testid="patients-recall-clear"
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 hover:text-amber-950 bg-amber-100 hover:bg-amber-200 rounded px-2 py-0.5"
            >
              <X size={11} /> Clear
            </button>
          </div>
        )}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <Search size={14} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, mobile, MRD…"
            data-testid="patients-list-search"
            className="flex-1 text-sm outline-none bg-transparent placeholder:text-slate-400"
          />
        </div>

        {loading ? (
          <div className="p-4">
            <ListSkeleton rows={8} cols={5} />
          </div>
        ) : displayRows.length === 0 ? (
          <div className="px-4 py-12 text-center italic text-slate-400">
            {isRecallFilter
              ? 'No patients past the recall threshold in the loaded pages. Load more to expand the check.'
              : (q ? 'No matches.' : 'No patients yet — register your first one.')}
          </div>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2.5">Patient</th>
                    <th className="text-left px-4 py-2.5">MRD</th>
                    <th className="text-left px-4 py-2.5">Mobile</th>
                    <th className="text-left px-4 py-2.5">Age / Gender</th>
                    <th className="text-left px-4 py-2.5">Registered</th>
                    <th className="text-right px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((p) => (
                    <tr key={p.patient_id} className="border-t border-slate-100 hover:bg-indigo-50/30 transition" data-testid={`patient-row-${p.patient_id}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                            {initials(p.name)}
                          </span>
                          <Link to={`/patients/${p.patient_id}`} className="font-semibold text-slate-900 hover:text-indigo-700">
                            {p.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 font-mono text-[11px]">{p.mrd || p.patient_id}</td>
                      <td className="px-4 py-2.5 text-slate-600">{p.mobile || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{p.age ? `${p.age} y` : '—'} · {p.gender || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{fmtDate(p.created_at || p.updated_at)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          to={`/patients/${p.patient_id}`}
                          data-testid={`patient-view-${p.patient_id}`}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold">
                          View Profile →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <LoadMoreButton
              hasMore={hasMore}
              loading={loadingMore}
              onClick={() => fetchPage(false, cursor)}
            />
          </>
        )}
      </div>
    </div>
  );
}
