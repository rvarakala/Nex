/*
 * Bulk Duplicate Sweep — Feb 2026
 *
 * One-screen tool for the clinic owner to spot every phone / name
 * collision in the patient master and merge them one-by-one using the
 * existing dry-run → confirm merge flow.
 *
 * Backend: GET  /api/patients/duplicates?key=phone_and_name|phone_only|name_only
 *          POST /api/patients/merge (dry_run + confirm)
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { RefreshCw, Search, Users, Phone, User, AlertTriangle, Check, ArrowRight, ExternalLink } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const KEY_META = {
  phone_and_name: { label: 'Phone + Name (strict)', hint: 'Only rows sharing BOTH the same 10-digit phone AND the same name.' },
  phone_only:     { label: 'Phone only',           hint: 'Rows sharing the same 10-digit phone (family shares one line is common — review carefully).' },
  name_only:      { label: 'Name only',            hint: 'Rows sharing the exact same normalised name.' },
};

const fmtDay = (d) => (!d ? '—' : new Date(d).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
}));

export default function DuplicatePatientsPage() {
  const [key, setKey] = useState('phone_and_name');
  const [data, setData] = useState({ group_count: 0, affected_patients: 0, groups: [] });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/patients/duplicates`, { params: { key, min_group: 2 } });
      setData(r.data || { group_count: 0, affected_patients: 0, groups: [] });
    } finally {
      setLoading(false);
    }
  }, [key]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return data.groups;
    const q = search.toLowerCase();
    return data.groups.filter((g) => {
      const k = g.key || {};
      if ((k.phone || '').toLowerCase().includes(q)) return true;
      if ((k.name  || '').toLowerCase().includes(q)) return true;
      return (g.patients || []).some((p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.mobile || '').toLowerCase().includes(q) ||
        (p.patient_id || '').toLowerCase().includes(q));
    });
  }, [data, search]);

  return (
    <div className="p-4 sm:p-6" data-testid="patients-duplicates-page">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
            <Users size={22} /> Duplicate Patient Sweep
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5 max-w-[52ch]">
            Every collision across the clinic on one screen. Merge inline — the older/higher-activity row wins the master.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-0.5 shadow-sm">
            {Object.keys(KEY_META).map((k) => (
              <button
                key={k}
                onClick={() => setKey(k)}
                data-testid={`dup-key-${k}`}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded ${
                  key === k ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >{KEY_META[k].label}</button>
            ))}
          </div>
          <button
            onClick={load}
            data-testid="dup-reload"
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
            title="Reload"
          ><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 mb-3">{KEY_META[key].hint}</div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Kpi label="Collision groups" value={data.group_count} testid="dup-kpi-groups" tone="rose" />
        <Kpi label="Affected patients" value={data.affected_patients} testid="dup-kpi-affected" tone="amber" />
        <Kpi label="Est. rows to merge" value={Math.max(0, data.affected_patients - data.group_count)} testid="dup-kpi-tomerge" tone="indigo" />
      </div>

      {/* Search */}
      <div className="relative mb-3 max-w-md">
        <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by phone, name or patient id…"
          data-testid="dup-search"
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      {/* Groups */}
      {loading && <div className="text-center text-slate-400 italic text-xs py-10">Scanning patient master…</div>}
      {!loading && filtered.length === 0 && (
        <div className="text-center text-slate-500 py-10 border border-dashed border-slate-300 rounded bg-white">
          <Check size={26} className="mx-auto text-emerald-500 mb-2" />
          <div className="text-sm font-semibold text-slate-700">All clean under this key.</div>
          <div className="text-[11px] mt-1">No {KEY_META[key].label.toLowerCase()} collisions found.</div>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((g, idx) => (
          <DuplicateGroupCard key={idx} group={g} onMerged={load} />
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, testid, tone }) {
  const toneCls = tone === 'rose'   ? 'bg-rose-50 border-rose-200 text-rose-800'
                : tone === 'amber'  ? 'bg-amber-50 border-amber-200 text-amber-800'
                : tone === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                : 'bg-white border-slate-200 text-slate-700';
  return (
    <div className={`rounded-md border px-3 py-2 ${toneCls}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function DuplicateGroupCard({ group, onMerged }) {
  const { key: k, patients, count } = group;
  const rank = (p) => {
    // Naive richness score — sessions > invoices > appointments > age of record.
    const c = p.counts || {};
    return (c.sessions || 0) * 100 + (c.invoices || 0) * 10 + (c.appointments || 0);
  };
  const sorted = useMemo(
    () => [...patients].sort((a, b) => rank(b) - rank(a)),
    [patients]
  );
  const [primaryId, setPrimaryId] = useState(sorted[0]?.patient_id);
  const [secondaryId, setSecondaryId] = useState(sorted[1]?.patient_id);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const dryRun = async () => {
    setErr(''); setBusy(true); setPreview(null);
    try {
      const r = await axios.post(`${API}/patients/merge`, {
        primary_patient_id: primaryId,
        secondary_patient_id: secondaryId,
        dry_run: true,
      });
      setPreview(r.data);
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    const msg = `Merge ${preview.secondary.name} → ${preview.primary.name}? This will move ${preview.total_rows_affected} rows and cannot be undone from this screen.`;
    if (!window.confirm(msg)) return;
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/patients/merge`, {
        primary_patient_id: primaryId,
        secondary_patient_id: secondaryId,
        dry_run: false,
      });
      onMerged?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Merge failed');
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-md p-3" data-testid={`dup-group-${primaryId}`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-[11px] font-semibold text-slate-700 flex items-center gap-2">
          {k.phone && <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5"><Phone size={10} /> {k.phone}</span>}
          {k.name  && <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5"><User size={10} /> {k.name}</span>}
          <span className="text-slate-400 font-normal">— {count} patients</span>
        </div>
        <div className="flex items-center gap-2">
          {!preview ? (
            <button
              onClick={dryRun}
              disabled={busy || !primaryId || !secondaryId || primaryId === secondaryId}
              data-testid={`dup-preview-${primaryId}`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded"
            ><ArrowRight size={11} /> Preview merge</button>
          ) : (
            <>
              <button
                onClick={() => setPreview(null)}
                className="text-[11px] text-slate-500 hover:text-slate-800"
              >Reset</button>
              <button
                onClick={confirm}
                disabled={busy}
                data-testid={`dup-confirm-${primaryId}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded"
              ><Check size={11} /> Merge — moves {preview.total_rows_affected} rows</button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead className="text-[9.5px] uppercase tracking-widest text-slate-500 font-semibold">
            <tr>
              <th className="text-left px-2 py-1.5 w-[38px]">Role</th>
              <th className="text-left px-2 py-1.5">Patient</th>
              <th className="text-left px-2 py-1.5">Mobile</th>
              <th className="text-left px-2 py-1.5">Created</th>
              <th className="text-right px-2 py-1.5">Sessions</th>
              <th className="text-right px-2 py-1.5">Invoices</th>
              <th className="text-right px-2 py-1.5">Appts</th>
              <th className="text-right px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const isPrimary   = p.patient_id === primaryId;
              const isSecondary = p.patient_id === secondaryId;
              const c = p.counts || {};
              return (
                <tr
                  key={p.patient_id}
                  data-testid={`dup-row-${p.patient_id}`}
                  className={`border-t border-slate-100 ${isPrimary ? 'bg-emerald-50/60' : isSecondary ? 'bg-amber-50/60' : ''}`}
                >
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 cursor-pointer">
                        <input
                          type="radio"
                          name={`primary-${sorted[0].patient_id}`}
                          checked={isPrimary}
                          onChange={() => {
                            setPrimaryId(p.patient_id);
                            if (secondaryId === p.patient_id) setSecondaryId(null);
                            setPreview(null);
                          }}
                          data-testid={`dup-set-primary-${p.patient_id}`}
                        /> Keep
                      </label>
                      <label className={`inline-flex items-center gap-1 text-[10px] font-semibold cursor-pointer ${isPrimary ? 'text-slate-300' : 'text-amber-800'}`}>
                        <input
                          type="radio"
                          name={`secondary-${sorted[0].patient_id}`}
                          checked={isSecondary}
                          disabled={isPrimary}
                          onChange={() => { setSecondaryId(p.patient_id); setPreview(null); }}
                          data-testid={`dup-set-secondary-${p.patient_id}`}
                        /> Merge in
                      </label>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold text-slate-800">{p.name || '—'}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {p.patient_id}{p.mrd ? ` · ${p.mrd}` : ''}{p.age ? ` · ${p.age} yrs` : ''}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-slate-700 tabular-nums">{p.mobile || '—'}</td>
                  <td className="px-2 py-1.5 text-slate-600 tabular-nums">{fmtDay(p.created_at)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.sessions || 0}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.invoices || 0}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.appointments || 0}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Link
                      to={`/patients/${p.patient_id}`}
                      target="_blank"
                      className="inline-flex items-center gap-0.5 text-[10.5px] text-indigo-700 hover:underline"
                    ><ExternalLink size={10} /> Open</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {preview && (
        <div className="mt-2 border border-emerald-200 bg-emerald-50 rounded p-2 text-[11.5px] text-emerald-900">
          <div className="font-semibold mb-1">
            Ready to merge <span className="font-mono">{preview.secondary.patient_id}</span> → <span className="font-mono">{preview.primary.patient_id}</span>
          </div>
          <div className="text-[10.5px] text-emerald-900/80">
            {preview.total_rows_affected === 0
              ? 'The secondary record has no linked history — this is a clean merge.'
              : `Will move ${preview.total_rows_affected} linked rows: ` +
                Object.entries(preview.preview || {})
                  .map(([coll, n]) => `${n} ${coll.replace(/_/g, ' ')}`).join(' · ')}
          </div>
        </div>
      )}

      {err && (
        <div className="mt-2 border border-rose-200 bg-rose-50 rounded p-2 text-[11.5px] text-rose-800 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5" /> {err}
        </div>
      )}
    </div>
  );
}
