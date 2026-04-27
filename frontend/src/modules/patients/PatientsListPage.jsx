/**
 * Patients List — directory of every patient in the clinic.
 * Currently the codebase only exposes patients via search; this page
 * fixes that by giving owners + front-desk a paginated, filterable table
 * with a click-through into the new Patient Profile page.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Search, UserPlus, Users } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export default function PatientsListPage() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // GET /api/patients supports `search=` + `limit=` and is tenant-scoped.
      const url = q.trim()
        ? `${API}/patients?search=${encodeURIComponent(q.trim())}&limit=200`
        : `${API}/patients?limit=200`;
      const r = await axios.get(url);
      setRows(Array.isArray(r.data) ? r.data : (r.data?.items || []));
    } catch {
      setRows([]);
    } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
  };

  const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();

  const totalCount = useMemo(() => rows.length, [rows]);

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="patients-list-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users size={20} className="text-indigo-600" /> Patients
          </h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">All registered patients · {totalCount} {totalCount === 1 ? 'record' : 'records'}</p>
        </div>
        <Link
          to="/frontdesk/new"
          data-testid="patients-list-new"
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm shadow-indigo-600/20">
          <UserPlus size={13} /> Add Patient
        </Link>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center italic text-slate-400">Loading patients…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center italic text-slate-400">{q ? 'No matches.' : 'No patients yet — register your first one.'}</td></tr>
              ) : (
                rows.map((p) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
