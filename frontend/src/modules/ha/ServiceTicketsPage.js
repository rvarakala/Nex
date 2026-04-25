import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import AudinexaPipelineDrawer from '../repair/AudinexaPipelineDrawer';
import Pagination, { DEFAULT_PAGE_SIZE, usePaginationSlice } from '../../components/Pagination';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const STATUS_STYLE = {
  // Legacy
  open:        'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved:    'bg-emerald-100 text-emerald-800',
  closed:      'bg-slate-200 text-slate-600',
  cancelled:   'bg-rose-100 text-rose-800',
  // AUDINEXA
  RECEIVED:             'bg-slate-100 text-slate-800',
  INSPECTED:            'bg-blue-100 text-blue-800',
  AWAITING_DISPATCH:    'bg-amber-100 text-amber-800',
  DISPATCHED:           'bg-orange-100 text-orange-800',
  IN_TRANSIT:           'bg-orange-100 text-orange-800',
  DELIVERED_TO_COMPANY: 'bg-indigo-100 text-indigo-800',
  ESTIMATE_PENDING:     'bg-amber-200 text-amber-900',
  CLIENT_APPROVED:      'bg-emerald-100 text-emerald-800',
  CLIENT_REJECTED:      'bg-rose-100 text-rose-800',
  REPAIR_IN_PROGRESS:   'bg-indigo-100 text-indigo-800',
  RETURN_SHIPPED:       'bg-orange-100 text-orange-800',
  READY_FOR_PICKUP:     'bg-emerald-100 text-emerald-800',
  DELIVERED_TO_CLIENT:  'bg-emerald-200 text-emerald-900 font-bold',
  CLOSED:               'bg-slate-200 text-slate-600',
  CANCELLED:            'bg-rose-100 text-rose-800',
};

const KIND_LABEL = {
  repair: 'Repair',
  cleaning: 'Cleaning',
  reprogramming: 'Reprogramming',
  warranty_claim: 'Warranty Claim',
  other: 'Other',
};


export default function ServiceTicketsPage() {
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [openNo, setOpenNo] = useState(null);
  const [me, setMe] = useState(null);
  const [page, setPage] = useState(1);
  // Client-side filters (search across ticket_no/patient/mobile/complaint/serial; kind + technician dropdowns)
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');

  // Distinct technician + kind options derived from the currently-loaded rows
  const techOptions = useMemo(() => {
    const m = new Map();
    rows.forEach(r => { if (r.technician_user_id && r.technician_name) m.set(r.technician_user_id, r.technician_name); });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(t => {
      if (kindFilter && t.kind !== kindFilter) return false;
      if (techFilter && t.technician_user_id !== techFilter) return false;
      if (!q) return true;
      const hay = [
        t.ticket_no, t.patient_name, t.patient_mobile, t.patient_id,
        t.complaint, t.serial_no, t.diagnosis, t.resolution_notes,
        t.technician_name,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, kindFilter, techFilter]);

  const pagedRows = usePaginationSlice(filteredRows, page, DEFAULT_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [status, search, kindFilter, techFilter, rows.length]);

  useEffect(() => { (async () => {
    try { setMe((await axios.get(`${API}/auth/me`)).data?.user || null); } catch {/*noop*/}
  })(); }, []);

  const canCreate = useMemo(() => !!me && ['front_desk','audiologist','technician','clinic_owner','super_admin'].includes(me.role), [me]);
  const canMutate = useMemo(() => !!me && ['technician','audiologist','clinic_owner','super_admin'].includes(me.role), [me]);

  const load = useCallback(async () => {
    const params = status ? { status } : {};
    const [r, k] = await Promise.all([
      axios.get(`${API}/ha/service-tickets`, { params }),
      axios.get(`${API}/ha/service-tickets-kpis`),
    ]);
    setRows(r.data); setKpis(k.data);
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const clearFilters = () => { setSearch(''); setKindFilter(''); setTechFilter(''); setStatus(''); };
  const hasActiveFilters = !!(search || kindFilter || techFilter || status);

  return (
    <div className="p-5" data-testid="ha-tix-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Service Tickets</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Repairs, cleaning, reprogramming, warranty claims — full ticket lifecycle with serial state tracking.</p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && <button onClick={() => setCreating(true)} data-testid="ha-tix-new" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm">+ New Ticket</button>}
        </div>
      </div>

      {kpis && (
        <div className="grid grid-cols-5 gap-3 mb-4">
          <Kpi label="Open"        value={kpis.open}              color="bg-amber-50 text-amber-800 border-amber-200"     testid="ha-tix-kpi-open" />
          <Kpi label="In Progress" value={kpis.in_progress}       color="bg-blue-50 text-blue-800 border-blue-200"         testid="ha-tix-kpi-progress" />
          <Kpi label="Resolved"    value={kpis.resolved}          color="bg-emerald-50 text-emerald-800 border-emerald-200" testid="ha-tix-kpi-resolved" />
          <Kpi label="Closed"      value={kpis.closed}            color="bg-slate-50 text-slate-700 border-slate-200"     testid="ha-tix-kpi-closed" />
          <Kpi label="Warranty"    value={kpis.warranty_covered}  color="bg-indigo-50 text-indigo-800 border-indigo-200"   testid="ha-tix-kpi-warranty" />
        </div>
      )}

      {/* Search & Filter Bar — minimal, sticky-feeling toolbar */}
      <div className="bg-white border border-slate-200 rounded-md p-3 mb-3 flex items-center gap-2 flex-wrap" data-testid="ha-tix-filter-bar">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket #, patient, mobile, serial, complaint…"
            data-testid="ha-tix-search"
            className="w-full pl-7 pr-7 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {search && (
            <button onClick={() => setSearch('')} data-testid="ha-tix-search-clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs">✕</button>
          )}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ha-tix-status-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} data-testid="ha-tix-kind-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">All kinds</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} data-testid="ha-tix-tech-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">All technicians</option>
          {techOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {hasActiveFilters && (
          <button onClick={clearFilters} data-testid="ha-tix-clear-filters" className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1.5">Clear filters</button>
        )}
        <span className="text-[11px] text-slate-500 ml-auto" data-testid="ha-tix-result-count">
          Showing <b className="text-slate-800">{filteredRows.length}</b>{filteredRows.length !== rows.length && <> of <b className="text-slate-800">{rows.length}</b></>}
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Ticket No</th>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-left">Serial</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Complaint</th>
              <th className="px-3 py-2 text-left">Technician</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-slate-400 italic text-xs" data-testid="ha-tix-empty">
                  {rows.length === 0 ? 'No tickets yet.' : 'No tickets match your filters.'}
                </td>
              </tr>
            )}
            {pagedRows.map(t => (
              <tr key={t.ticket_no} className="border-t border-slate-100 hover:bg-slate-50/50" data-testid={`ha-tix-row-${t.ticket_no}`}>
                <td className="px-3 py-2 font-mono text-[11px] font-bold text-indigo-700">{t.ticket_no}</td>
                <td className="px-3 py-2 text-xs">
                  <div className="font-semibold">{t.patient_name || t.patient_id}</div>
                  {t.patient_mobile && <div className="text-[10px] text-slate-500">{t.patient_mobile}</div>}
                </td>
                <td className="px-3 py-2 text-[11px] font-mono">{t.serial_no || '—'}</td>
                <td className="px-3 py-2 text-[10px]">{KIND_LABEL[t.kind] || t.kind} {t.warranty_covered && <span className="ml-1 bg-indigo-100 text-indigo-800 px-1 rounded text-[9px]">W</span>}</td>
                <td className="px-3 py-2 text-xs max-w-[280px] truncate" title={t.complaint}>{t.complaint}</td>
                <td className="px-3 py-2 text-[11px]">{t.technician_name || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">{t.cost_to_patient ? fmtINR(t.cost_to_patient) : '—'}</td>
                <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>{t.status.toUpperCase()}</span></td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setOpenNo(t.ticket_no)} data-testid={`ha-tix-open-${t.ticket_no}`} className="text-[10px] text-indigo-600 font-semibold hover:underline">Open →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} total={filteredRows.length} testidPrefix="ha-tix-pagination" />
      </div>

      {creating && <NewTicketModal onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); load(); setOpenNo(t.ticket_no); }} />}
      {openNo && <AudinexaPipelineDrawer ticketNo={openNo} onClose={() => setOpenNo(null)} onChanged={load} />}
    </div>
  );
}


const Kpi = ({ label, value, color, testid }) => (
  <div data-testid={testid} className={`border rounded-md px-3 py-2 ${color}`}>
    <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
    <div className="text-lg font-bold tabular-nums">{value ?? 0}</div>
  </div>
);


function NewTicketModal({ onClose, onCreated }) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [patient, setPatient] = useState('');
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [serials, setSerials] = useState([]);
  const [serialId, setSerialId] = useState('');
  const [kind, setKind] = useState('repair');
  const [complaint, setComplaint] = useState('');
  const [warranty, setWarranty] = useState(false);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => {
    const b = await axios.get(`${API}/branches`);
    setBranches(b.data);
    if (b.data[0]) setBranch(b.data[0].branch_id);
  })(); }, []);

  useEffect(() => {
    if (!search || search.length < 2) { setPatients([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search, limit: 10 } });
        if (!cancelled) setPatients(Array.isArray(r.data) ? r.data : []);
      } catch { if (!cancelled) setPatients([]); }
    }, 200);
    return () => { cancelled = true; clearTimeout(h); };
  }, [search]);

  // When patient picked, fetch their serials
  useEffect(() => {
    if (!patient) { setSerials([]); return; }
    (async () => {
      try {
        const r = await axios.get(`${API}/ha/serial-items`, { params: { current_patient_id: patient, limit: 50 } });
        setSerials(Array.isArray(r.data) ? r.data : []);
      } catch { setSerials([]); }
    })();
  }, [patient]);

  const submit = async () => {
    setErr('');
    if (!patient) { setErr('Pick a patient'); return; }
    if (!complaint || complaint.length < 5) { setErr('Complaint must be ≥ 5 chars'); return; }
    setSaving(true);
    try {
      const body = { branch_id: branch, patient_id: patient, kind, complaint, warranty_covered: warranty };
      if (serialId) body.serial_id = serialId;
      const r = await axios.post(`${API}/ha/service-tickets`, body);
      onCreated(r.data);
    } catch (e) { setErr(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-tix-modal">
        <h2 className="text-lg font-bold mb-3">New Service Ticket</h2>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Patient *</span>
            {patient ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-sm">
                <span className="flex-1">{patients.find(p => p.patient_id === patient)?.name || patient}</span>
                <button onClick={() => { setPatient(''); setSearch(''); setSerialId(''); }} className="text-rose-500 text-xs">✕</button>
              </div>
            ) : (
              <>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / mobile / MRD…" data-testid="ha-tix-patient-search" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                {patients.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-slate-200 rounded">
                    {patients.map(p => (
                      <button key={p.patient_id} onClick={() => setPatient(p.patient_id)} className="block w-full text-left text-xs px-2 py-1 hover:bg-indigo-50" data-testid={`ha-tix-patient-pick-${p.patient_id}`}>
                        <span className="font-semibold">{p.name}</span> <span className="text-slate-500">({p.mobile || '—'})</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Branch</span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-tix-branch">
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        {patient && (
          <div className="mb-3">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Unit being serviced</span>
            <select value={serialId} onChange={(e) => setSerialId(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-tix-serial">
              <option value="">— (no specific unit / lost unit)</option>
              {serials.map(s => <option key={s.serial_id} value={s.serial_id}>{s.serial_no} · {s.state}</option>)}
            </select>
            {serials.length === 0 && <div className="text-[10px] italic text-slate-400 mt-0.5">No HA units found for this patient.</div>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-tix-kind">
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="text-xs inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} data-testid="ha-tix-warranty" />
              Warranty covered
            </label>
          </div>
        </div>

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Complaint *</span>
          <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={3} placeholder="Describe the problem in detail…" data-testid="ha-tix-complaint" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="ha-tix-submit" className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
            {saving ? 'Saving…' : 'Create Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}


function TicketDetailDrawer({ ticketNo, onClose, onChanged, canMutate }) {
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(null);
  const [diag, setDiag] = useState('');
  const [res, setRes] = useState('');
  const [cost, setCost] = useState(0);
  const [warranty, setWarranty] = useState(false);

  const load = useCallback(async () => {
    const r = await axios.get(`${API}/ha/service-tickets/${ticketNo}`);
    setT(r.data);
    setDiag(r.data.diagnosis || '');
    setWarranty(!!r.data.warranty_covered);
  }, [ticketNo]);

  useEffect(() => { load(); }, [load]);

  const moveStatus = async (newStatus) => {
    setBusy(true); setErr('');
    try {
      await axios.put(`${API}/ha/service-tickets/${ticketNo}`, { status: newStatus });
      await load(); onChanged();
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  const saveDiag = async () => {
    setBusy(true); setErr('');
    try {
      await axios.put(`${API}/ha/service-tickets/${ticketNo}`, { diagnosis: diag, warranty_covered: warranty });
      await load(); onChanged();
      setMode(null);
    } catch (e) { setErr(e?.response?.data?.detail || 'Save failed'); }
    finally { setBusy(false); }
  };

  const doResolve = async () => {
    if (!res || res.length < 5) { setErr('Resolution notes ≥ 5 chars'); return; }
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/ha/service-tickets/${ticketNo}/resolve`, {
        resolution_notes: res, cost_to_patient: Number(cost || 0), warranty_covered: warranty,
      });
      await load(); onChanged();
      setMode(null);
    } catch (e) { setErr(e?.response?.data?.detail || 'Resolve failed'); }
    finally { setBusy(false); }
  };

  const doClose = async () => {
    if (!window.confirm('Close this ticket? It cannot be reopened.')) return;
    setBusy(true);
    try { await axios.post(`${API}/ha/service-tickets/${ticketNo}/close`); await load(); onChanged(); }
    catch (e) { setErr(e?.response?.data?.detail || 'Close failed'); }
    finally { setBusy(false); }
  };

  const doCancel = async () => {
    if (!window.confirm('Cancel this ticket? The attached serial (if any) will be marked DAMAGED.')) return;
    setBusy(true);
    try { await axios.post(`${API}/ha/service-tickets/${ticketNo}/cancel`); await load(); onChanged(); }
    catch (e) { setErr(e?.response?.data?.detail || 'Cancel failed'); }
    finally { setBusy(false); }
  };

  if (!t) return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[600px] bg-white p-6 text-slate-400 italic text-sm">Loading…</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex" data-testid="ha-tix-drawer">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[600px] bg-white shadow-2xl overflow-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] font-bold text-indigo-700">{t.ticket_no}</div>
            <div className="text-sm font-bold">{t.patient_name || t.patient_id}</div>
            <div className="text-[10px] text-slate-500">{KIND_LABEL[t.kind]} · {t.serial_no || 'no serial'}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>{t.status.toUpperCase()}</span>
            {t.warranty_covered && <span className="text-[9px] bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded font-bold">WARRANTY</span>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
          </div>
        </div>

        {err && <div className="m-4 bg-rose-50 text-rose-700 text-xs p-2 rounded" data-testid="ha-tix-drawer-err">{err}</div>}

        <div className="p-5 space-y-3 text-xs">
          <Row label="Complaint" v={t.complaint} />
          <Row label="Technician" v={t.technician_name || '—'} />
          <Row label="Diagnosis" v={t.diagnosis || '—'} />
          <Row label="Resolution" v={t.resolution_notes || '—'} />
          <Row label="Cost to patient" v={t.cost_to_patient ? fmtINR(t.cost_to_patient) : '—'} />
          <Row label="Loaner serial" v={t.loaner_serial_id || '—'} />
          <Row label="Resolved at" v={t.resolved_at ? new Date(t.resolved_at).toLocaleString('en-IN') : '—'} />
          <Row label="Closed at" v={t.closed_at ? new Date(t.closed_at).toLocaleString('en-IN') : '—'} />

          {canMutate && t.status === 'open' && (
            <div className="pt-4 border-t border-slate-200 grid grid-cols-2 gap-2" data-testid="ha-tix-actions">
              <button onClick={() => moveStatus('in_progress')} disabled={busy} data-testid="ha-tix-start" className="px-3 py-1.5 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded">Start Work</button>
              <button onClick={doCancel} disabled={busy} data-testid="ha-tix-cancel" className="px-3 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded">Cancel (Damaged)</button>
            </div>
          )}

          {canMutate && t.status === 'in_progress' && (
            <div className="pt-4 border-t border-slate-200 space-y-2" data-testid="ha-tix-actions">
              {mode === 'diag' ? (
                <div className="bg-blue-50 border border-blue-200 rounded p-2">
                  <textarea value={diag} onChange={(e) => setDiag(e.target.value)} rows={2} placeholder="Diagnosis" data-testid="ha-tix-diag-input" className="w-full border border-slate-300 rounded px-2 py-1 text-xs mb-1" />
                  <label className="text-[10px] inline-flex items-center gap-1"><input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} /> Warranty covered</label>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setMode(null)} className="text-[10px] text-slate-500">Cancel</button>
                    <button onClick={saveDiag} disabled={busy} data-testid="ha-tix-diag-save" className="px-2 py-0.5 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded">Save</button>
                  </div>
                </div>
              ) : mode === 'resolve' ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
                  <textarea value={res} onChange={(e) => setRes(e.target.value)} rows={2} placeholder="What did you do to fix it?" data-testid="ha-tix-res-input" className="w-full border border-slate-300 rounded px-2 py-1 text-xs mb-1" />
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-[10px]">Cost to patient: ₹<input type="number" value={cost} onChange={(e) => setCost(e.target.value)} data-testid="ha-tix-cost-input" className="ml-1 w-20 border border-slate-300 rounded px-1 py-0.5 text-[11px]" /></label>
                    <label className="text-[10px] inline-flex items-center gap-1"><input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} data-testid="ha-tix-warranty-cb" /> Warranty</label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setMode(null)} className="text-[10px] text-slate-500">Cancel</button>
                    <button onClick={doResolve} disabled={busy} data-testid="ha-tix-resolve-save" className="px-2 py-0.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded">Resolve</button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => setMode('diag')} data-testid="ha-tix-diag-btn" className="px-2 py-1.5 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded">Set Diagnosis</button>
                  <button onClick={() => setMode('resolve')} data-testid="ha-tix-resolve-btn" className="px-2 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded">Resolve</button>
                  <button onClick={doCancel} disabled={busy} className="px-2 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded">Cancel</button>
                </div>
              )}
            </div>
          )}

          {canMutate && t.status === 'resolved' && (
            <div className="pt-4 border-t border-slate-200">
              <button onClick={doClose} disabled={busy} data-testid="ha-tix-close-btn" className="w-full px-3 py-2 text-xs font-bold bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded">Close Ticket</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, v }) => (
  <div className="flex items-baseline justify-between py-1 border-b border-slate-100">
    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold w-32">{label}</span>
    <span className="text-slate-800 flex-1 text-right break-words">{v}</span>
  </div>
);
