import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const KIND_LABEL = {
  batteries: 'Batteries',
  domes: 'Domes',
  wax_guards: 'Wax-guards',
  other: 'Other',
};


export default function SubscriptionsPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [me, setMe] = useState(null);

  useEffect(() => { (async () => {
    try { setMe((await axios.get(`${API}/auth/me`)).data?.user || null); } catch {/*noop*/}
  })(); }, []);

  const canWrite = useMemo(() => !!me && ['front_desk','audiologist','clinic_owner','super_admin'].includes(me.role), [me]);

  const load = useCallback(async () => {
    const params = status ? { status } : {};
    const r = await axios.get(`${API}/ha/subscriptions`, { params });
    setRows(r.data);
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const deliver = async (s) => {
    setBusy(s.subscription_id);
    try {
      await axios.post(`${API}/ha/subscriptions/${s.subscription_id}/deliver`, {});
      load();
    } catch (e) { alert(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(null); }
  };

  const pause = async (s) => {
    setBusy(s.subscription_id);
    try {
      await axios.put(`${API}/ha/subscriptions/${s.subscription_id}`, { status: 'paused' });
      load();
    } finally { setBusy(null); }
  };

  const resume = async (s) => {
    setBusy(s.subscription_id);
    try {
      await axios.put(`${API}/ha/subscriptions/${s.subscription_id}`, { status: 'active' });
      load();
    } finally { setBusy(null); }
  };

  return (
    <div className="p-5" data-testid="ha-subs-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Consumable Subscriptions</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Per-patient re-order cadences for domes, wax-guards, batteries. Feeds the daily follow-up board.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ha-sub-status-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {canWrite && (
            <button onClick={() => setCreating(true)} data-testid="ha-sub-new" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm">+ Subscribe</button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-right">Cadence</th>
              <th className="px-3 py-2 text-left">Last</th>
              <th className="px-3 py-2 text-left">Next Due</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-400 italic text-xs">No subscriptions yet.</td></tr>}
            {rows.map(s => {
              const overdue = s.status === 'active' && s.next_due_date && s.next_due_date < today;
              return (
                <tr key={s.subscription_id} className={`border-t border-slate-100 ${overdue ? 'bg-rose-50/30' : ''}`} data-testid={`ha-sub-row-${s.subscription_id}`}>
                  <td className="px-3 py-2 text-xs">{s.patient_name || s.patient_id}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{s.item_label}</td>
                  <td className="px-3 py-2 text-[10px]"><span className="bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded font-bold">{KIND_LABEL[s.kind] || s.kind}</span></td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{s.cadence_days}d</td>
                  <td className="px-3 py-2 text-[11px] tabular-nums">{s.last_delivered_at || '—'}</td>
                  <td className="px-3 py-2 text-[11px] tabular-nums">
                    {s.next_due_date}
                    {overdue && <span className="ml-1 text-[9px] font-bold bg-rose-600 text-white px-1 py-0.5 rounded">OVERDUE</span>}
                  </td>
                  <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${s.status === 'active' ? 'bg-emerald-100 text-emerald-800' : s.status === 'paused' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'}`}>{s.status.toUpperCase()}</span></td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && s.status === 'active' && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => deliver(s)} disabled={busy === s.subscription_id} data-testid={`ha-sub-deliver-${s.subscription_id}`} className="px-2 py-0.5 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">Deliver</button>
                        <button onClick={() => pause(s)} disabled={busy === s.subscription_id} data-testid={`ha-sub-pause-${s.subscription_id}`} className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-800">Pause</button>
                      </div>
                    )}
                    {canWrite && s.status === 'paused' && (
                      <button onClick={() => resume(s)} disabled={busy === s.subscription_id} className="px-2 py-0.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded">Resume</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && <NewSubscriptionModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </div>
  );
}


function NewSubscriptionModal({ onClose, onCreated }) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [patient, setPatient] = useState('');
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('domes');
  const [item, setItem] = useState('');
  const [cadence, setCadence] = useState(45);
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

  const submit = async () => {
    setErr('');
    if (!patient) { setErr('Pick a patient'); return; }
    if (!item)    { setErr('Enter an item label'); return; }
    if (!cadence || cadence < 1) { setErr('Cadence days must be ≥ 1'); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/ha/subscriptions`, {
        branch_id: branch, patient_id: patient, kind, item_label: item, cadence_days: Number(cadence),
      });
      onCreated();
    } catch (e) { setErr(e?.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl max-w-xl w-full p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-sub-modal">
        <h2 className="text-lg font-bold mb-3">Subscribe Patient to Consumable</h2>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Patient *</span>
          {patient ? (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-sm">
              <span className="flex-1">{patients.find(p => p.patient_id === patient)?.name || patient}</span>
              <button onClick={() => { setPatient(''); setSearch(''); }} className="text-rose-500 text-xs">✕</button>
            </div>
          ) : (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / mobile / MRD…" data-testid="ha-sub-patient-search" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
              {patients.length > 0 && (
                <div className="mt-1 max-h-40 overflow-auto border border-slate-200 rounded">
                  {patients.map(p => (
                    <button key={p.patient_id} onClick={() => setPatient(p.patient_id)} className="block w-full text-left text-xs px-2 py-1 hover:bg-indigo-50" data-testid={`ha-sub-patient-pick-${p.patient_id}`}>
                      <span className="font-semibold">{p.name}</span> <span className="text-slate-500">({p.mobile || '—'})</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Branch</span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-sub-branch">
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-sub-kind">
              {Object.entries(KIND_LABEL).map(([k,l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Item label *</span>
            <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Signia Silk Dome M" data-testid="ha-sub-item" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Cadence (days) *</span>
            <input type="number" value={cadence} onChange={(e) => setCadence(e.target.value)} data-testid="ha-sub-cadence" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="ha-sub-save" className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
            {saving ? 'Saving…' : 'Subscribe'}
          </button>
        </div>
      </div>
    </div>
  );
}
