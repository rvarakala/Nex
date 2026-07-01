import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const STATUS_STYLE = {
  active:   'bg-amber-100 text-amber-800',
  returned: 'bg-emerald-100 text-emerald-800',
  damaged:  'bg-rose-100 text-rose-800',
  converted_to_sale: 'bg-indigo-100 text-indigo-800',
};

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (l) => l.status === 'active' && l.expected_return_date && l.expected_return_date < today();


export default function LoanersPage() {
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [status, setStatus] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [me, setMe] = useState(null);

  useEffect(() => { (async () => {
    try { setMe((await axios.get(`${API}/auth/me`)).data?.user || null); } catch {/*noop*/}
  })(); }, []);

  const canWrite = useMemo(() => !!me && ['front_desk','audiologist','technician','clinic_owner','super_admin'].includes(me.role), [me]);

  const load = useCallback(async () => {
    const params = {};
    if (status) params.status = status;
    if (overdueOnly) params.overdue = true;
    const [r, k] = await Promise.all([
      axios.get(`${API}/ha/loaners`, { params }),
      axios.get(`${API}/ha/loaners-kpis`),
    ]);
    setRows(r.data); setKpis(k.data);
  }, [status, overdueOnly]);

  useEffect(() => { load(); }, [load]);

  const doReturn = async (l, damaged) => {
    const label = damaged ? 'DAMAGED' : 'returned clean';
    if (!window.confirm(`Mark loaner ${l.loaner_id} as ${label}? Serial will go to ${damaged ? 'DAMAGED' : 'IN_STOCK'}.`)) return;
    setBusy(l.loaner_id);
    try {
      await axios.post(`${API}/ha/loaners/${l.loaner_id}/return`, { damaged });
      load();
    } catch (e) { alert(e?.response?.data?.detail || 'Return failed'); }
    finally { setBusy(null); }
  };

  return (
    <div className="p-5" data-testid="ha-loaners-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Loaner Allocations</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Temporary HA units issued to patients while their own are in service. Serials move IN_STOCK → LOANER → IN_STOCK.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-slate-600 inline-flex items-center gap-1">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} data-testid="ha-loaner-overdue-only" />
            Overdue only
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ha-loaner-status-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">All</option>
            {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {canWrite && <button onClick={() => setCreating(true)} data-testid="ha-loaner-new" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm">+ Issue Loaner</button>}
        </div>
      </div>

      {kpis && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Kpi label="Active"   value={kpis.active}   color="bg-amber-50 text-amber-800 border-amber-200"      testid="ha-loaner-kpi-active" />
          <Kpi label="Overdue"  value={kpis.overdue}  color="bg-rose-50 text-rose-800 border-rose-200"          testid="ha-loaner-kpi-overdue" />
          <Kpi label="Returned" value={kpis.returned} color="bg-emerald-50 text-emerald-800 border-emerald-200" testid="ha-loaner-kpi-returned" />
          <Kpi label="Damaged"  value={kpis.damaged}  color="bg-rose-50 text-rose-800 border-rose-200"          testid="ha-loaner-kpi-damaged" />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Loaner</th>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-left">Serial</th>
              <th className="px-3 py-2 text-left">Issued</th>
              <th className="px-3 py-2 text-left">Expected Return</th>
              <th className="px-3 py-2 text-right">Deposit</th>
              <th className="px-3 py-2 text-left">Ticket</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-slate-400 italic text-xs">No loaners match.</td></tr>}
            {rows.map(l => {
              const od = isOverdue(l);
              return (
                <tr key={l.loaner_id} className={`border-t border-slate-100 hover:bg-slate-50/50 ${od ? 'bg-rose-50/30' : ''}`} data-testid={`ha-loaner-row-${l.loaner_id}`}>
                  <td className="px-3 py-2 font-mono text-[11px] font-bold text-indigo-700">{l.loaner_id}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-semibold">{l.patient_name || l.patient_id}</div>
                    {l.patient_mobile && <div className="text-[10px] text-slate-500">{l.patient_mobile}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{l.serial_no || l.serial_id}</td>
                  <td className="px-3 py-2 text-xs">{l.issued_on}</td>
                  <td className="px-3 py-2 text-xs">
                    {l.expected_return_date}
                    {od && <span className="ml-1 text-[9px] font-bold text-rose-600">OVERDUE</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{l.deposit_amount ? fmtINR(l.deposit_amount) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{l.service_ticket_no || '—'}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[l.status]}`}>{l.status.toUpperCase()}</span></td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && l.status === 'active' && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => doReturn(l, false)} disabled={busy === l.loaner_id} data-testid={`ha-loaner-return-${l.loaner_id}`} className="px-2 py-0.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded">Return</button>
                        <button onClick={() => doReturn(l, true)} disabled={busy === l.loaner_id} data-testid={`ha-loaner-damage-${l.loaner_id}`} className="px-2 py-0.5 text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded">Damaged</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && <NewLoanerModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </div>
  );
}


const Kpi = ({ label, value, color, testid }) => (
  <div data-testid={testid} className={`border rounded-md px-3 py-2 ${color}`}>
    <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
    <div className="text-lg font-bold tabular-nums">{value ?? 0}</div>
  </div>
);


function NewLoanerModal({ onClose, onCreated }) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [patient, setPatient] = useState('');
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [serials, setSerials] = useState([]);
  const [serialId, setSerialId] = useState('');
  const [ret, setRet] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); });
  const [deposit, setDeposit] = useState(1000);
  const [ticketNo, setTicketNo] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => {
    const b = await axios.get(`${API}/branches`);
    setBranches(b.data); if (b.data[0]) setBranch(b.data[0].branch_id);
  })(); }, []);

  useEffect(() => {
    if (!search || search.length < 2) { setPatients([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try { const r = await axios.get(`${API}/patients`, { params: { search, limit: 10 } });
        if (!cancelled) setPatients(Array.isArray(r.data) ? r.data : []);
      } catch { if (!cancelled) setPatients([]); }
    }, 200);
    return () => { cancelled = true; clearTimeout(h); };
  }, [search]);

  useEffect(() => {
    if (!branch) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/ha/serial-items`, { params: { state: 'IN_STOCK', branch_id: branch, limit: 100 } });
        setSerials(Array.isArray(r.data) ? r.data : []);
      } catch { setSerials([]); }
    })();
  }, [branch]);

  const submit = async () => {
    setErr('');
    if (!patient || !serialId || !ret) { setErr('Patient, serial, and return date are required'); return; }
    setSaving(true);
    try {
      const body = { branch_id: branch, patient_id: patient, serial_id: serialId, expected_return_date: ret, deposit_amount: Number(deposit || 0), notes };
      if (ticketNo) body.service_ticket_no = ticketNo;
      await axios.post(`${API}/ha/loaners`, body);
      onCreated();
    } catch (e) { setErr(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-loaner-modal">
        <h2 className="text-lg font-bold mb-3">Issue Loaner Unit</h2>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Patient *</span>
            {patient ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-sm">
                <span className="flex-1">{patients.find(p => p.patient_id === patient)?.name || patient}</span>
                <button onClick={() => { setPatient(''); setSearch(''); }} className="text-rose-500 text-xs">✕</button>
              </div>
            ) : (
              <>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / mobile…" data-testid="ha-loaner-patient-search" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                {patients.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-slate-200 rounded">
                    {patients.map(p => (
                      <button key={p.patient_id} onClick={() => setPatient(p.patient_id)} className="block w-full text-left text-xs px-2 py-1 hover:bg-indigo-50" data-testid={`ha-loaner-patient-pick-${p.patient_id}`}>
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
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-loaner-branch">
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">IN_STOCK Serial *</span>
          <select value={serialId} onChange={(e) => setSerialId(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-loaner-serial">
            <option value="">— pick a unit —</option>
            {serials.map(s => <option key={s.serial_id} value={s.serial_id}>{`${s.serial_no} · ${s.product_id}`}</option>)}
          </select>
          {serials.length === 0 && <div className="text-[10px] italic text-slate-400 mt-0.5">No IN_STOCK serials in this branch.</div>}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Expected Return *</span>
            <input type="date" value={ret} onChange={(e) => setRet(e.target.value)} data-testid="ha-loaner-return" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Deposit (₹)</span>
            <input type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} data-testid="ha-loaner-deposit" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Service Ticket</span>
            <input value={ticketNo} onChange={(e) => setTicketNo(e.target.value)} placeholder="JOB-2026-…" data-testid="ha-loaner-ticket" className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono" />
          </div>
        </div>

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="ha-loaner-notes" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="ha-loaner-submit" className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
            {saving ? 'Saving…' : 'Issue Loaner'}
          </button>
        </div>
      </div>
    </div>
  );
}
