import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import QuickHASaleModal from './QuickHASaleModal';
import { CustomHAOrderModal } from './CustomHAOrdersPage';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const STATUS_STYLE = {
  active:    'bg-emerald-100 text-emerald-800',
  extended:  'bg-amber-100 text-amber-800',
  converted: 'bg-indigo-100 text-indigo-800',
  returned:  'bg-slate-200 text-slate-700',
  lost:      'bg-rose-100 text-rose-800',
};

const isOverdue = (t) => {
  if (!['active', 'extended'].includes(t.status)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return t.return_date && t.return_date < today;
};
const daysUntil = (ymd) => {
  if (!ymd) return null;
  const d = Math.round((new Date(ymd) - new Date().setHours(0,0,0,0)) / (24 * 3600 * 1000));
  return d;
};


export default function TrialsPage() {
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [status, setStatus] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openNo, setOpenNo] = useState(null);
  const [me, setMe] = useState(null);

  useEffect(() => { (async () => {
    try {
      const r = await axios.get(`${API}/auth/me`);
      setMe(r.data?.user || null);
    } catch (e) { console.warn('[TrialsPage] /auth/me failed:', e?.message); }
  })(); }, []);

  const canCreate = useMemo(() => !!me && ['front_desk','audiologist','clinic_owner','super_admin'].includes(me.role), [me]);
  const canMutate = useMemo(() => !!me && ['audiologist','clinic_owner','super_admin'].includes(me.role), [me]);

  const load = useCallback(async () => {
    const params = {};
    if (status) params.status = status;
    if (overdueOnly) params.overdue = true;
    const [r, k] = await Promise.all([
      axios.get(`${API}/ha/trials`, { params }),
      axios.get(`${API}/ha/trials-kpis`),
    ]);
    setRows(r.data);
    setKpis(k.data);
  }, [status, overdueOnly]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-5" data-testid="ha-trials-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Trials</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Take-home loans of physical units. Convert to Sale when the patient decides.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-slate-600 inline-flex items-center gap-1">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} data-testid="ha-trial-overdue-only" />
            Overdue only
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ha-trial-status-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">All statuses</option>
            {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {canCreate && (
            <button onClick={() => setCreating(true)} data-testid="ha-trial-new" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm">+ Issue Trial</button>
          )}
        </div>
      </div>

      {kpis && (
        <div className="grid grid-cols-5 gap-3 mb-4">
          <Kpi label="Active"    value={kpis.active}    color="bg-emerald-50 text-emerald-800 border-emerald-200" testid="ha-trial-kpi-active" />
          <Kpi label="Overdue"   value={kpis.overdue}   color="bg-rose-50 text-rose-800 border-rose-200"       testid="ha-trial-kpi-overdue" />
          <Kpi label="Converted" value={kpis.converted} color="bg-indigo-50 text-indigo-800 border-indigo-200" testid="ha-trial-kpi-converted" />
          <Kpi label="Returned"  value={kpis.returned}  color="bg-slate-50 text-slate-700 border-slate-200"    testid="ha-trial-kpi-returned" />
          <Kpi label="Lost"      value={kpis.lost}      color="bg-rose-50 text-rose-800 border-rose-200"       testid="ha-trial-kpi-lost" />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Trial No</th>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-right">Units</th>
              <th className="px-3 py-2 text-left">Start</th>
              <th className="px-3 py-2 text-left">Expected Return</th>
              <th className="px-3 py-2 text-right">Deposit</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-400 italic text-xs">No trials match.</td></tr>}
            {rows.map(t => {
              const overdue = isOverdue(t);
              const d = daysUntil(t.return_date);
              return (
                <tr key={t.trial_no} className={`border-t border-slate-100 hover:bg-slate-50/50 ${overdue ? 'bg-rose-50/30' : ''}`} data-testid={`ha-trial-row-${t.trial_no}`}>
                  <td className="px-3 py-2 font-mono text-[11px] font-bold text-indigo-700">{t.trial_no}</td>
                  <td className="px-3 py-2">{t.patient_name || t.patient_id}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.serials?.length || 0}</td>
                  <td className="px-3 py-2 text-xs">{t.start_date}</td>
                  <td className="px-3 py-2 text-xs">
                    {t.return_date}
                    {d != null && ['active','extended'].includes(t.status) && (
                      <span className={`ml-1 text-[9px] font-bold ${overdue ? 'text-rose-600' : d <= 2 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {overdue ? `(${-d}d OVERDUE)` : `(${d}d)`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{t.deposit_amount ? fmtINR(t.deposit_amount) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>{t.status.toUpperCase()}</span>
                    {overdue && <span className="ml-1 text-[9px] font-bold bg-rose-600 text-white px-1 py-0.5 rounded">OVERDUE</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setOpenNo(t.trial_no)} data-testid={`ha-trial-open-${t.trial_no}`} className="text-[10px] text-indigo-600 font-semibold hover:underline">Open →</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && <NewTrialModal onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); load(); setOpenNo(t.trial_no); }} />}
      {openNo && <TrialDetailDrawer trialNo={openNo} onClose={() => setOpenNo(null)} onChanged={load} canMutate={canMutate} />}
    </div>
  );
}


const Kpi = ({ label, value, color, testid }) => (
  <div data-testid={testid} className={`border rounded-md px-3 py-2 ${color}`}>
    <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
    <div className="text-lg font-bold tabular-nums">{value ?? 0}</div>
  </div>
);


// ==================== NEW TRIAL MODAL ====================

function NewTrialModal({ onClose, onCreated }) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [patients, setPatients] = useState([]);
  const [patient, setPatient] = useState('');
  const [search, setSearch] = useState('');
  const [serialList, setSerialList] = useState([]);
  const [picks, setPicks] = useState([]); // [{serial_id, side}]
  const [serialSearch, setSerialSearch] = useState('');
  const [returnDate, setReturnDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [deposit, setDeposit] = useState(0);
  const [accessories, setAccessories] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const b = await axios.get(`${API}/branches`);
      setBranches(b.data);
      if (b.data[0]) setBranch(b.data[0].branch_id);
    })();
  }, []);

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

  // Fetch demo-pool serials for this branch first; saleable is a secondary tab.
  const [stockSource, setStockSource] = useState('demo'); // 'demo' | 'saleable'
  useEffect(() => {
    if (!branch) return;
    (async () => {
      try {
        if (stockSource === 'demo') {
          // Demo-stock endpoint returns all demo serials (both IN_STOCK & TRIAL_OUT).
          const r = await axios.get(`${API}/ha/demo-stock`, { params: { branch_id: branch } });
          // Only IN_STOCK demo units are eligible for a new trial.
          setSerialList((Array.isArray(r.data) ? r.data : []).filter(s => s.state === 'IN_STOCK'));
        } else {
          const r = await axios.get(`${API}/ha/serial-items`, { params: { state: 'IN_STOCK', branch_id: branch, limit: 200 } });
          // Exclude demo pool — those are handled by the 'demo' source.
          setSerialList((Array.isArray(r.data) ? r.data : []).filter(s => (s.pool || 'saleable') !== 'demo'));
        }
        // Clear any picks when source changes — serial_ids are not comparable.
        setPicks([]);
      } catch { setSerialList([]); }
    })();
  }, [branch, stockSource]);

  const filteredSerials = useMemo(() => {
    if (!serialSearch) return serialList.slice(0, 30);
    const q = serialSearch.toLowerCase();
    return serialList.filter(s =>
      s.serial_no?.toLowerCase().includes(q) ||
      s.product_id?.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [serialList, serialSearch]);

  const toggleSerial = (sid) => {
    setPicks(prev => prev.find(p => p.serial_id === sid)
      ? prev.filter(p => p.serial_id !== sid)
      : [...prev, { serial_id: sid, side: 'single' }]);
  };
  const setSide = (sid, side) => {
    setPicks(prev => prev.map(p => p.serial_id === sid ? { ...p, side } : p));
  };

  const submit = async () => {
    setErr('');
    if (!patient) { setErr('Pick a patient'); return; }
    if (!branch)  { setErr('Pick a branch'); return; }
    if (!picks.length) { setErr('Pick at least one serial'); return; }
    if (!returnDate) { setErr('Enter return date'); return; }
    if (stockSource === 'saleable' && !(notes && notes.trim())) {
      setErr('External unit selected — please describe the source in Notes (e.g. loaner from Phonak rep, colleague branch, etc.).');
      return;
    }
    setSaving(true);
    try {
      const body = {
        branch_id: branch,
        patient_id: patient,
        serials: picks,
        return_date: returnDate,
        deposit_amount: Number(deposit || 0),
        accessories_given: accessories ? accessories.split(',').map(s => s.trim()).filter(Boolean) : [],
        notes,
      };
      const r = await axios.post(`${API}/ha/trials`, body);
      onCreated(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-trial-new-modal">
        <h2 className="text-lg font-bold mb-3">Issue New Trial</h2>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3" data-testid="ha-trial-err">{err}</div>}

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
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / mobile / MRD…" data-testid="ha-trial-patient-search" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                {patients.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-slate-200 rounded">
                    {patients.map(p => (
                      <button key={p.patient_id} onClick={() => setPatient(p.patient_id)} className="block w-full text-left text-xs px-2 py-1 hover:bg-indigo-50" data-testid={`ha-trial-patient-pick-${p.patient_id}`}>
                        <span className="font-semibold">{p.name}</span> <span className="text-slate-500">({p.mobile || '—'})</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Branch *</span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-trial-branch">
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold" data-testid="ha-trial-pick-label">
              {stockSource === 'demo'
                ? `Pick DEMO serials * (${picks.length} selected)`
                : `Pick EXTERNAL / saleable serials * (${picks.length} selected)`}
            </span>
            <div className="flex items-center gap-1 text-[10px] font-semibold">
              <button
                type="button"
                onClick={() => setStockSource('demo')}
                data-testid="ha-trial-src-demo"
                className={`px-2 py-0.5 rounded border ${stockSource === 'demo' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600 border-slate-300'}`}
              >Demo Stock</button>
              <button
                type="button"
                onClick={() => setStockSource('saleable')}
                data-testid="ha-trial-src-saleable"
                className={`px-2 py-0.5 rounded border ${stockSource === 'saleable' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-300'}`}
                title="Use a non-demo unit — will require a source note below."
              >External unit</button>
            </div>
          </div>
          <input value={serialSearch} onChange={(e) => setSerialSearch(e.target.value)} placeholder="Filter serial no / product…" className="w-full border border-slate-300 rounded px-2 py-1 text-xs mb-1" data-testid="ha-trial-serial-search" />
          <div className="max-h-48 overflow-auto border border-slate-200 rounded">
            {filteredSerials.length === 0 && (
              <div className="px-2 py-2 text-[11px] italic text-slate-500" data-testid="ha-trial-no-serials">
                {stockSource === 'demo'
                  ? 'No DEMO units available in this branch. Switch to "External unit" and describe the source in Notes below.'
                  : 'No saleable IN_STOCK serials in this branch.'}
              </div>
            )}
            {filteredSerials.map(s => {
              const picked = picks.find(p => p.serial_id === s.serial_id);
              return (
                <div key={s.serial_id} className={`flex items-center gap-2 px-2 py-1 text-[11px] border-b border-slate-100 ${picked ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={!!picked} onChange={() => toggleSerial(s.serial_id)} data-testid={`ha-trial-pick-${s.serial_id}`} />
                  <span className="font-mono font-bold flex-1">{s.serial_no}</span>
                  <span className="text-slate-500 text-[10px]">{s.product_id}</span>
                  <span className={`text-[9px] px-1 rounded ${s.pool === 'demo' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{s.pool || 'saleable'}</span>
                  {picked && (
                    <select value={picked.side} onChange={(e) => setSide(s.serial_id, e.target.value)} className="text-[10px] border border-slate-300 rounded" data-testid={`ha-trial-side-${s.serial_id}`}>
                      <option value="single">Single</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="pair">Pair</option>
                      <option value="kit">Kit</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          {stockSource === 'saleable' && picks.length > 0 && (
            <div className="mt-1 text-[10px] bg-amber-50 border border-amber-200 text-amber-800 rounded px-2 py-1" data-testid="ha-trial-external-warn">
              ⚠ External unit — source note is required in the <b>Notes</b> field below before issuing this trial.
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Return Date *</span>
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} data-testid="ha-trial-return-date" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Deposit (₹)</span>
            <input type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} data-testid="ha-trial-deposit" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Accessories given</span>
            <input value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder="comma separated" data-testid="ha-trial-accessories" className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
          </div>
        </div>

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="ha-trial-notes" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="Trial plan, expectations, counselling notes" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="ha-trial-submit" className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
            {saving ? 'Saving…' : 'Issue Trial'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ==================== DETAIL DRAWER ====================

function TrialDetailDrawer({ trialNo, onClose, onChanged, canMutate }) {
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(null); // 'extend' | null
  const [extendDate, setExtendDate] = useState('');
  // Convert → Sale now opens the full QuickHASaleModal so the audiologist
  // can pick a FRESH unit from Saleable Stock (never sell the demo unit).
  // After the sale saves, we call `mark-converted` to close the trial and
  // send the demo unit back to Demo Stock (pool=demo · state=IN_STOCK).
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertPrefill, setConvertPrefill] = useState({ patient_id: null, brand: '', model: '' });
  // Trial → Custom HA (bespoke IIC/CIC/ITC/ITE). Opens the Custom HA
  // modal with the trial's patient prefilled + `from_trial_no` so the
  // backend closes the trial as CONVERTED and auto-attaches the
  // patient's audiogram from their latest hearing test.
  const [customHAOpen, setCustomHAOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await axios.get(`${API}/ha/trials/${trialNo}`);
    setT(r.data);
  }, [trialNo]);

  useEffect(() => { load(); }, [load]);

  const doReturn = async () => {
    if (!window.confirm('Mark this trial as returned? Serials will go back to IN_STOCK.')) return;
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/ha/trials/${trialNo}/return`, {});
      await load(); onChanged();
    } catch (e) { setErr(e?.response?.data?.detail || 'Return failed'); }
    finally { setBusy(false); }
  };

  const doLost = async () => {
    if (!window.confirm('Mark this trial as LOST? Serials will move to DAMAGED state and the clinic absorbs the loss.')) return;
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/ha/trials/${trialNo}/lost`);
      await load(); onChanged();
    } catch (e) { setErr(e?.response?.data?.detail || 'Lost failed'); }
    finally { setBusy(false); }
  };

  const doExtend = async () => {
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/ha/trials/${trialNo}/extend`, { return_date: extendDate });
      await load(); onChanged();
      setMode(null); setExtendDate('');
    } catch (e) { setErr(e?.response?.data?.detail || 'Extend failed'); }
    finally { setBusy(false); }
  };

  const doConvertOpen = async () => {
    // Hydrate brand + model from the demo unit's product so the sale
    // modal opens pre-filled — audiologist just enters serials from
    // Saleable Stock + pricing and hits Save.
    setBusy(true); setErr('');
    let brand = '', model = '';
    try {
      const firstSid = (t?.serials || [])[0]?.serial_id;
      if (firstSid) {
        // Fetch by serial_id directly (the list search endpoint filters
        // by serial_no, not serial_id, so it silently returned zero rows).
        const rSi = await axios.get(`${API}/ha/serial-items/${firstSid}`);
        const pid = rSi.data?.product_id;
        if (pid) {
          const rProd = await axios.get(`${API}/ha/products/${pid}`);
          brand = rProd.data?.brand || '';
          model = rProd.data?.model || '';
        }
      }
    } catch { /* prefill is best-effort — user can type manually */ }
    setConvertPrefill({ patient_id: t?.patient_id || null, brand, model });
    setConvertOpen(true);
    setBusy(false);
  };

  // Fired once the sale is created via QuickHASaleModal.
  // Marks the trial as CONVERTED and returns the demo serial(s) to Demo Stock.
  const onSaleCreated = async (sale) => {
    try {
      await axios.post(`${API}/ha/trials/${trialNo}/mark-converted`, {
        sale_no: sale?.sale_no || null,
        sale_id: sale?.sale_id || null,
        note: 'Converted via QuickHASaleModal from trial drawer',
      });
      setConvertOpen(false);
      await load();
      onChanged();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Trial close failed');
    }
  };

  const overdue = t && isOverdue(t);

  return (
    <div className="fixed inset-0 z-40 flex" data-testid="ha-trial-drawer">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[640px] bg-white shadow-2xl overflow-auto">
        {!t ? <div className="p-6 text-slate-400 italic text-sm">Loading…</div> : (
          <>
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
              <div>
                <div className="font-mono text-[11px] font-bold text-indigo-700">{t.trial_no}</div>
                <div className="text-sm font-bold">{t.patient_name || t.patient_id}</div>
                <div className="text-[10px] text-slate-500">{t.audiologist_name || ''} · {t.serials?.length || 0} unit(s)</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>{t.status.toUpperCase()}</span>
                {overdue && <span className="text-[9px] font-bold bg-rose-600 text-white px-1 py-0.5 rounded">OVERDUE</span>}
                <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
              </div>
            </div>

            {err && <div className="m-4 bg-rose-50 text-rose-700 text-xs p-2 rounded" data-testid="ha-trial-drawer-err">{err}</div>}

            <div className="p-5 space-y-3 text-xs">
              <Row label="Start / Expected Return" v={`${t.start_date} → ${t.return_date}`} />
              {t.actual_return_date && <Row label="Actual Return" v={t.actual_return_date} />}
              <Row label="Deposit" v={t.deposit_amount ? fmtINR(t.deposit_amount) : '—'} />
              <Row label="Accessories" v={(t.accessories_given || []).join(', ') || '—'} />
              <Row label="Converted Sale" v={t.converted_sale_no || '—'} />
              <Row label="Notes" v={t.notes || '—'} />

              <div className="pt-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Serials on trial</div>
                <ul className="text-[11px] space-y-0.5 font-mono">
                  {t.serials.map(s => <li key={s.serial_id}>· {s.serial_id} <span className="text-slate-500">({s.side})</span></li>)}
                </ul>
              </div>

              {canMutate && ['active','extended'].includes(t.status) && (
                <div className="pt-4 border-t border-slate-200 space-y-2" data-testid="ha-trial-actions">
                  {mode === 'extend' ? (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-2">
                      <span className="text-[10px] font-semibold text-amber-800">New return date:</span>
                      <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} data-testid="ha-trial-extend-date" className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
                      <button onClick={doExtend} disabled={busy || !extendDate} data-testid="ha-trial-extend-save" className="px-2 py-0.5 text-[10px] font-bold bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded">Save</button>
                      <button onClick={() => { setMode(null); setExtendDate(''); }} className="text-[10px] text-slate-500">Cancel</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-5 gap-2">
                      <button onClick={() => setMode('extend')} data-testid="ha-trial-extend-btn" className="px-2 py-1.5 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded">Extend</button>
                      <button onClick={doReturn} disabled={busy} data-testid="ha-trial-return-btn" className="px-2 py-1.5 text-[11px] font-bold bg-slate-600 hover:bg-slate-700 text-white rounded">Return</button>
                      <button onClick={doConvertOpen} disabled={busy} data-testid="ha-trial-convert-btn" className="px-2 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded">To Sale</button>
                      <button
                        onClick={() => setCustomHAOpen(true)}
                        disabled={busy}
                        data-testid="ha-trial-to-custom-ha-btn"
                        className="px-2 py-1.5 text-[11px] font-bold bg-violet-600 hover:bg-violet-700 text-white rounded"
                      >To Custom HA</button>
                      <button onClick={doLost} disabled={busy} data-testid="ha-trial-lost-btn" className="px-2 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded">Lost</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {convertOpen && (
        <QuickHASaleModal
          onClose={() => setConvertOpen(false)}
          onCreated={onSaleCreated}
          prefillPatientId={convertPrefill.patient_id}
          prefillBrand={convertPrefill.brand}
          prefillModel={convertPrefill.model}
        />
      )}
      {customHAOpen && (
        <CustomHAOrderModal
          onClose={() => setCustomHAOpen(false)}
          onSaved={async () => {
            setCustomHAOpen(false);
            await load();
            onChanged();
          }}
          prefillPatientId={t?.patient_id || null}
          fromTrialNo={trialNo}
          defaultTarget="vendor"
        />
      )}
    </div>
  );
}

const Row = ({ label, v }) => (
  <div className="flex items-baseline justify-between py-1 border-b border-slate-100">
    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">{label}</span>
    <span className="font-mono text-slate-800">{v}</span>
  </div>
);
