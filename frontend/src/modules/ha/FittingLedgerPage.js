import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import QuickHASaleModal from './QuickHASaleModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_STYLE = {
  active:    'bg-emerald-100 text-emerald-800',
  completed: 'bg-indigo-100 text-indigo-800',
  cancelled: 'bg-slate-200 text-slate-600 line-through',
};

const VISIT_KINDS = [
  { value: 'first_fit',   label: 'First Fit',   color: 'bg-emerald-100 text-emerald-800' },
  { value: 'follow_up',   label: 'Follow-up',   color: 'bg-blue-100 text-blue-800' },
  { value: 'adjustment',  label: 'Adjustment',  color: 'bg-amber-100 text-amber-800' },
  { value: 'aided_test',  label: 'Aided Test',  color: 'bg-purple-100 text-purple-800' },
  { value: 'remote_tune', label: 'Remote Tune', color: 'bg-pink-100 text-pink-800' },
];

export default function FittingLedgerPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [quickSale, setQuickSale] = useState(false);
  const [markPaidFor, setMarkPaidFor] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [me, setMe] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillPatient = searchParams.get('patient_id') || '';
  const auto = searchParams.get('auto') === '1';
  const quick = searchParams.get('quick') === '1';

  useEffect(() => { (async () => {
    try {
      const r = await axios.get(`${API}/auth/me`);
      setMe(r.data?.user || null);
    } catch {/*noop*/}
  })(); }, []);

  const canWrite = useMemo(() => {
    if (!me) return false;
    return ['audiologist', 'clinic_owner', 'super_admin'].includes(me.role);
  }, [me]);

  // M02 bridge: ?patient_id=X&auto=1 → open the create modal pre-filled.
  useEffect(() => {
    if (auto && prefillPatient && me && canWrite) {
      setCreating(true);
    }
  }, [auto, prefillPatient, me, canWrite]);

  // Dashboard "Add HA Sale" Quick Action sends ?quick=1 → open the unified
  // sale + fitting + invoice modal (also pre-fills patient if patient_id given).
  useEffect(() => {
    if (quick && me && canWrite) {
      setQuickSale(true);
      // Strip ?quick=1 from the URL so a back-nav doesn't re-open the modal.
      const next = new URLSearchParams(searchParams);
      next.delete('quick');
      setSearchParams(next, { replace: true });
    }
  }, [quick, me, canWrite, searchParams, setSearchParams]);

  const load = useCallback(async () => {
    const params = status ? { status } : {};
    const r = await axios.get(`${API}/ha/fittings`, { params });
    setRows(r.data);
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const [syncMsg, setSyncMsg] = useState(null);   // {kind:'ok'|'err', text}
  const [syncing, setSyncing] = useState(null);   // quick_sale_id currently syncing
  const syncInventory = async (qsId) => {
    if (!qsId || syncing) return;
    setSyncing(qsId); setSyncMsg(null);
    try {
      const r = await axios.post(`${API}/ha/quick-sales/${qsId}/sync-inventory`);
      const d = r.data || {};
      const created = (d.created_serial_ids || []).length;
      const skipped = (d.skipped || []).length;
      if (d.inventory_tracked && created > 0) {
        setSyncMsg({ kind: 'ok', text: `Inventory synced — ${created} serial${created === 1 ? '' : 's'} added & marked SOLD.` });
      } else if (d.inventory_tracked) {
        setSyncMsg({ kind: 'ok', text: 'Already in sync — no changes needed.' });
      } else {
        const reasons = (d.skipped || []).map((s) => `${s.serial_no}: ${s.reason}`).join(' · ');
        setSyncMsg({ kind: 'err', text: `${skipped} serial(s) couldn't be synced: ${reasons}` });
      }
      await load();
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || 'Sync failed.';
      setSyncMsg({ kind: 'err', text: typeof msg === 'string' ? msg : 'Sync failed.' });
    } finally {
      setSyncing(null);
      // Auto-clear toast after 6s
      setTimeout(() => setSyncMsg(null), 6000);
    }
  };

  return (
    <div className="p-5" data-testid="ha-fittings-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Fitting Ledger</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Clinical sessions for every hearing-aid fit. Programming history, aided audiograms, adaptation scores — all append-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ha-fit-status-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">All statuses</option>
            {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {canWrite && (
            <>
              {/* Primary action — "+ New Fitting" now opens the full
                  QuickHASaleModal because 95% of fittings happen at the
                  moment of sale. The old lightweight fitting-session
                  form is still available for post-sale adjustments via
                  the "+ Follow-up Fitting" outline button. */}
              <button onClick={() => setQuickSale(true)} data-testid="ha-fit-new"
                className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm">
                + New Fitting
              </button>
              <button onClick={() => setCreating(true)} data-testid="ha-fit-followup"
                className="px-3 py-1.5 text-xs font-semibold text-indigo-700 border border-indigo-300 hover:bg-indigo-50 rounded-md">
                + Follow-up Fitting
              </button>
            </>
          )}
        </div>
      </div>

      {syncMsg && (
        <div
          data-testid={syncMsg.kind === 'ok' ? 'sync-inv-ok' : 'sync-inv-err'}
          className={`mb-3 text-[12px] px-3 py-2 rounded border ${
            syncMsg.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
              : 'bg-amber-50 border-amber-300 text-amber-800'
          }`}
        >
          {syncMsg.text}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Fitting ID</th>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-left">Audiologist</th>
              <th className="px-3 py-2 text-left">Sale</th>
              <th className="px-3 py-2 text-right">Units</th>
              <th className="px-3 py-2 text-right">Visits</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Started</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-slate-400 italic text-xs">No fittings yet.</td></tr>}
            {rows.map(f => {
              const isQuickSale = f.source === 'quick_sale' || !!f.quick_sale_id;
              const balanceDue = Number(f.balance_due || 0);
              const totalAmt = Number(f.sale_total || 0);
              const showMarkPaid = isQuickSale && balanceDue > 0.5 && canWrite;
              const unmatched = Array.isArray(f.unmatched_serials) ? f.unmatched_serials : [];
              const showSyncInv = isQuickSale && unmatched.length > 0 && canWrite;
              return (
              <tr key={f.fitting_id} className="border-t border-slate-100 hover:bg-slate-50/50" data-testid={`ha-fit-row-${f.fitting_id}`}>
                <td className="px-3 py-2 font-mono text-[11px] font-bold">{f.fitting_id}</td>
                <td className="px-3 py-2">{f.patient_name || f.patient_id}</td>
                <td className="px-3 py-2 text-xs">{f.audiologist_name || '—'}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-indigo-700">{f.sale_no || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.serials?.length || 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.visits?.length || 0}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[11px]">
                  {totalAmt > 0 ? (
                    balanceDue > 0.5 ? (
                      <span className="text-rose-600 font-bold" data-testid={`ha-fit-balance-${f.fitting_id}`}>
                        ₹{balanceDue.toLocaleString('en-IN')}
                      </span>
                    ) : (
                      <span className="text-emerald-600 font-semibold">Paid</span>
                    )
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[f.status]}`}>{f.status.toUpperCase()}</span></td>
                <td className="px-3 py-2 text-[10px] text-slate-500">{f.first_fit_at ? new Date(f.first_fit_at).toLocaleDateString('en-IN') : ''}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {showSyncInv && (
                    <button
                      onClick={() => syncInventory(f.quick_sale_id)}
                      data-testid={`ha-fit-sync-inv-${f.fitting_id}`}
                      className="text-[10px] font-semibold bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded mr-1.5 inline-flex items-center gap-1"
                      title={`Back-fill ${unmatched.length} serial(s) into inventory: ${unmatched.join(', ')}`}
                    >
                      Sync inventory
                      <span className="bg-white/20 text-[9px] font-bold px-1 rounded">{unmatched.length}</span>
                    </button>
                  )}
                  {showMarkPaid && (
                    <button
                      onClick={() => setMarkPaidFor(f)}
                      data-testid={`ha-fit-mark-paid-${f.fitting_id}`}
                      className="text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded mr-1.5"
                      title="Record balance payment"
                    >
                      Mark balance paid
                    </button>
                  )}
                  <button onClick={() => setOpenId(f.fitting_id)} data-testid={`ha-fit-open-${f.fitting_id}`} className="text-[10px] text-indigo-600 font-semibold hover:underline">Open →</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && <NewFittingModal onClose={() => setCreating(false)} onCreated={(f) => { setCreating(false); load(); setOpenId(f.fitting_id); }} />}
      {quickSale && (
        <QuickHASaleModal
          prefillPatientId={prefillPatient || null}
          onClose={() => setQuickSale(false)}
          onCreated={(r) => {
            setQuickSale(false);
            load();
            // The new doc is now visible in the ledger — open its detail pane.
            if (r?.fitting_id) setOpenId(r.fitting_id);
          }}
        />
      )}
      {markPaidFor && (
        <MarkBalancePaidModal
          fitting={markPaidFor}
          onClose={() => setMarkPaidFor(null)}
          onSettled={() => { setMarkPaidFor(null); load(); }}
        />
      )}
      {openId && <FittingDetailDrawer fittingId={openId} onClose={() => setOpenId(null)} onChanged={load} canWrite={canWrite} />}
    </div>
  );
}


// ==================== NEW FITTING MODAL ====================

function NewFittingModal({ onClose, onCreated }) {
  const [patients, setPatients] = useState([]);
  const [branches, setBranches] = useState([]);
  const [patient, setPatient] = useState('');
  const [branch, setBranch] = useState('');
  const [candidates, setCandidates] = useState(null);
  const [saleNo, setSaleNo] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const b = await axios.get(`${API}/branches`);
      setBranches(b.data);
      if (b.data[0]) setBranch(b.data[0].branch_id);
    })();
  }, []);

  // Debounced patient search
  useEffect(() => {
    if (!search || search.length < 2) { setPatients([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search, limit: 10 } });
        if (!cancelled) setPatients(Array.isArray(r.data) ? r.data : []);
      } catch {
        if (!cancelled) setPatients([]);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(h); };
  }, [search]);

  // When patient picked → fetch open sales + last PTA
  useEffect(() => {
    if (!patient) { setCandidates(null); return; }
    (async () => {
      try {
        const r = await axios.get(`${API}/ha/fittings-candidates/${patient}`);
        setCandidates(r.data);
        if (r.data?.open_sales?.[0]) setSaleNo(r.data.open_sales[0].sale_no);
      } catch {
        setCandidates(null);
      }
    })();
  }, [patient]);

  const submit = async () => {
    setErr('');
    if (!patient) { setErr('Pick a patient'); return; }
    if (!branch)  { setErr('Pick a branch');  return; }
    setSaving(true);
    try {
      const body = { branch_id: branch, patient_id: patient, notes };
      if (saleNo) body.sale_no = saleNo;
      const r = await axios.post(`${API}/ha/fittings`, body);
      onCreated(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-fit-new-modal">
        <h2 className="text-lg font-bold mb-3">New Fitting Session</h2>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3" data-testid="ha-fit-err">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Patient *</span>
            {patient ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-sm">
                <span className="flex-1">{patients.find(p => p.patient_id === patient)?.name || candidates?.patient?.name || patient}</span>
                <button onClick={() => { setPatient(''); setSearch(''); setCandidates(null); setSaleNo(''); }} className="text-rose-500 text-xs">✕</button>
              </div>
            ) : (
              <>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / mobile / MRD…" data-testid="ha-fit-patient-search" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                {patients.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-slate-200 rounded">
                    {patients.map(p => (
                      <button key={p.patient_id} onClick={() => setPatient(p.patient_id)} className="block w-full text-left text-xs px-2 py-1 hover:bg-indigo-50" data-testid={`ha-fit-patient-pick-${p.patient_id}`}>
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
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-fit-branch">
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        {candidates && (
          <div className="mb-3 bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Attach to Sale</div>
            {candidates.open_sales?.length ? (
              <div className="space-y-1">
                {candidates.open_sales.map(s => (
                  <label key={s.sale_no} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white rounded px-1 py-0.5">
                    <input type="radio" checked={saleNo === s.sale_no} onChange={() => setSaleNo(s.sale_no)} data-testid={`ha-fit-sale-pick-${s.sale_no}`} />
                    <span className="font-mono font-bold text-indigo-700">{s.sale_no}</span>
                    <span className="text-slate-500">— {s.lines?.filter(l => l.serial_id).length || 0} units, ₹{Number(s.total).toLocaleString('en-IN')}</span>
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${s.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{s.status}</span>
                  </label>
                ))}
                <button onClick={() => setSaleNo('')} className="text-[10px] text-slate-500 hover:underline mt-1" data-testid="ha-fit-sale-clear">— Unlink sale (stand-alone fitting)</button>
              </div>
            ) : (
              <div className="text-[11px] italic text-slate-500">No open sales for this patient — will be a stand-alone fitting.</div>
            )}
            {candidates.last_pta && (
              <div className="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-500">
                Last PTA: <span className="font-mono">{candidates.last_pta.session_id}</span>
                {candidates.last_pta.right_ear_degree && <> · R: <span className="font-semibold text-slate-700">{candidates.last_pta.right_ear_degree}</span></>}
                {candidates.last_pta.left_ear_degree && <> · L: <span className="font-semibold text-slate-700">{candidates.last_pta.left_ear_degree}</span></>}
              </div>
            )}
          </div>
        )}

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="ha-fit-notes" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" placeholder="e.g. First fit plan, counseling notes" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="ha-fit-submit" className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
            {saving ? 'Creating…' : 'Create Fitting'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ==================== DETAIL DRAWER ====================

function FittingDetailDrawer({ fittingId, onClose, onChanged, canWrite }) {
  const [fit, setFit] = useState(null);
  const [tab, setTab] = useState('ledger');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await axios.get(`${API}/ha/fittings/${fittingId}`);
    setFit(r.data);
  }, [fittingId]);

  useEffect(() => { load(); }, [load]);

  const appendVisit = async (payload) => {
    setErr(''); setBusy(true);
    try {
      await axios.post(`${API}/ha/fittings/${fittingId}/visits`, payload);
      await load(); onChanged();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not add visit');
    } finally { setBusy(false); }
  };

  const setAided = async (payload) => {
    setErr(''); setBusy(true);
    try {
      await axios.put(`${API}/ha/fittings/${fittingId}/aided-audiogram`, payload);
      await load(); onChanged();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not save audiogram');
    } finally { setBusy(false); }
  };

  const complete = async () => {
    if (!window.confirm('Mark this fitting as completed? It can no longer be edited.')) return;
    setErr(''); setBusy(true);
    try {
      await axios.put(`${API}/ha/fittings/${fittingId}`, { status: 'completed' });
      await load(); onChanged();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not complete');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex" data-testid="ha-fit-drawer">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[640px] bg-white shadow-2xl overflow-auto">
        {!fit ? (
          <div className="p-6 text-slate-400 italic text-sm">Loading…</div>
        ) : (
          <>
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
              <div>
                <div className="font-mono text-[11px] font-bold text-indigo-700">{fit.fitting_id}</div>
                <div className="text-sm font-bold">{fit.patient_name || fit.patient_id}</div>
                <div className="text-[10px] text-slate-500">{fit.audiologist_name} · {fit.serials?.length || 0} unit(s){fit.sale_no ? ` · Sale ${fit.sale_no}` : ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[fit.status]}`}>{fit.status.toUpperCase()}</span>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
              </div>
            </div>

            <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-4">
              {[['ledger','Ledger'],['audiogram','Aided Audiogram'],['info','Info']].map(([k,l]) => (
                <button key={k} onClick={() => setTab(k)} data-testid={`ha-fit-tab-${k}`}
                  className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider border-b-2 ${tab === k ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  {l}
                </button>
              ))}
              <div className="ml-auto">
                {canWrite && fit.status === 'active' && (
                  <button onClick={complete} disabled={busy} data-testid="ha-fit-complete" className="px-2 py-1 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded mr-3 my-1.5">
                    Mark Completed
                  </button>
                )}
              </div>
            </div>

            {err && <div className="m-4 bg-rose-50 text-rose-700 text-xs p-2 rounded" data-testid="ha-fit-drawer-err">{err}</div>}

            {tab === 'ledger' && <LedgerTab fit={fit} canWrite={canWrite && fit.status === 'active'} onAppend={appendVisit} busy={busy} />}
            {tab === 'audiogram' && <AudiogramTab fit={fit} canWrite={canWrite && fit.status !== 'cancelled'} onSave={setAided} busy={busy} />}
            {tab === 'info' && <InfoTab fit={fit} />}
          </>
        )}
      </div>
    </div>
  );
}


function LedgerTab({ fit, canWrite, onAppend, busy }) {
  const [kind, setKind] = useState('follow_up');
  const [notes, setNotes] = useState('');
  const [wear, setWear] = useState('');
  const [comfort, setComfort] = useState('');
  const [adjs, setAdjs] = useState([]);

  const add = () => setAdjs(prev => [...prev, { _key: Math.random().toString(36).slice(2), ear: 'both', param: '', old: '', new: '' }]);
  const upd = (i, k, v) => setAdjs(prev => prev.map((a,idx) => idx === i ? { ...a, [k]: v } : a));
  const del = (i) => setAdjs(prev => prev.filter((_,idx) => idx !== i));

  const submit = () => {
    const payload = { kind, notes };
    if (wear !== '') payload.wear_hours_per_day = Number(wear);
    if (comfort !== '') payload.comfort_score = Number(comfort);
    payload.adjustments = adjs.filter(a => a.param);
    onAppend(payload);
    setKind('follow_up'); setNotes(''); setWear(''); setComfort(''); setAdjs([]);
  };

  return (
    <div className="p-5">
      {canWrite && (
        <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-4" data-testid="ha-fit-visit-form">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Log a visit</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs" data-testid="ha-fit-visit-kind">
              {VISIT_KINDS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <input placeholder="Wear hrs/day" type="number" step="0.5" value={wear} onChange={(e) => setWear(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs" data-testid="ha-fit-visit-wear" />
            <input placeholder="Comfort (1-5)" type="number" min="1" max="5" value={comfort} onChange={(e) => setComfort(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs" data-testid="ha-fit-visit-comfort" />
          </div>
          <textarea rows={2} placeholder="Visit notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-xs mb-2" data-testid="ha-fit-visit-notes" />

          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Programming adjustments ({adjs.length})</div>
          {adjs.map((a, i) => (
            <div key={a._key || `adj-${i}`} className="grid grid-cols-[80px_1fr_1fr_1fr_20px] gap-1 mb-1">
              <select value={a.ear} onChange={(e) => upd(i, 'ear', e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px]">
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="both">Both</option>
              </select>
              <input placeholder="param (gain_2k)" value={a.param} onChange={(e) => upd(i, 'param', e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px]" />
              <input placeholder="old" value={a.old} onChange={(e) => upd(i, 'old', e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px]" />
              <input placeholder="new" value={a.new} onChange={(e) => upd(i, 'new', e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px]" />
              <button onClick={() => del(i)} className="text-rose-500 text-xs">✕</button>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <button onClick={add} className="text-[10px] text-indigo-600 font-semibold hover:underline" data-testid="ha-fit-visit-adj-add">+ Add adjustment</button>
            <button onClick={submit} disabled={busy} data-testid="ha-fit-visit-save" className="ml-auto px-3 py-1 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
              {busy ? 'Saving…' : 'Log Visit'}
            </button>
          </div>
        </div>
      )}

      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Visit history ({fit.visits?.length || 0})</div>
      {(!fit.visits || fit.visits.length === 0) && <div className="text-xs italic text-slate-400">No visits logged yet.</div>}
      <ol className="space-y-2">
        {[...(fit.visits || [])].reverse().map(v => {
          const kindMeta = VISIT_KINDS.find(k => k.value === v.kind) || VISIT_KINDS[1];
          return (
            <li key={v.visit_id} className="border-l-2 border-indigo-400 pl-3 py-1" data-testid={`ha-fit-visit-${v.visit_id}`}>
              <div className="flex items-center gap-2 text-[11px]">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${kindMeta.color}`}>{kindMeta.label}</span>
                <span className="text-slate-500">{v.at ? new Date(v.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
                <span className="text-slate-400">· by {v.actor_name || v.actor_user_id}</span>
              </div>
              {v.notes && <div className="text-xs text-slate-700 mt-1">{v.notes}</div>}
              {(v.wear_hours_per_day != null || v.comfort_score != null) && (
                <div className="text-[10px] text-slate-500 mt-1">
                  {v.wear_hours_per_day != null && <>Wear: <b className="text-slate-700">{v.wear_hours_per_day}h/day</b> </>}
                  {v.comfort_score != null && <>Comfort: <b className="text-slate-700">{v.comfort_score}/5</b></>}
                </div>
              )}
              {v.adjustments?.length > 0 && (
                <ul className="text-[10px] text-slate-500 mt-1 ml-1">
                  {v.adjustments.map((a, i) => (
                    <li key={`${v.visit_id}-adj-${i}`}>· <span className="uppercase">[{a.ear}]</span> <b>{a.param}</b>: {a.old || '—'} → <b className="text-indigo-700">{a.new}</b></li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}


function AudiogramTab({ fit, canWrite, onSave, busy }) {
  const existing = fit.aided_audiogram || {};
  const initEar = (e) => ({
    hz_500: e?.hz_500 ?? '',
    hz_1000: e?.hz_1000 ?? '',
    hz_2000: e?.hz_2000 ?? '',
    hz_4000: e?.hz_4000 ?? '',
  });
  const [method, setMethod] = useState(existing.method || 'sound_field');
  const [right, setRight] = useState(initEar(existing.right));
  const [left, setLeft] = useState(initEar(existing.left));
  const [notes, setNotes] = useState(existing.notes || '');

  const toNum = (o) => Object.fromEntries(Object.entries(o).map(([k,v]) => [k, v === '' ? null : Number(v)]));

  const submit = () => {
    const payload = { method, right: toNum(right), left: toNum(left), notes };
    onSave(payload);
  };

  const cell = (side, state, set) => (freq) => (
    <input type="number" value={state[`hz_${freq}`]} disabled={!canWrite} onChange={(e) => set({ ...state, [`hz_${freq}`]: e.target.value })}
      data-testid={`ha-fit-aided-${side}-${freq}`}
      className="w-16 border border-slate-300 rounded px-1 py-0.5 text-xs text-center disabled:bg-slate-50" />
  );
  const R = cell('r', right, setRight);
  const L = cell('l', left, setLeft);

  return (
    <div className="p-5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Aided audiogram (sound-field)</div>

      <div className="flex items-center gap-2 mb-3">
        <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={!canWrite} data-testid="ha-fit-aided-method" className="border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50">
          <option value="sound_field">Sound field</option>
          <option value="insertion_gain">Insertion gain</option>
        </select>
        {existing.measured_at && <span className="text-[10px] text-slate-500">Last measured: {new Date(existing.measured_at).toLocaleDateString('en-IN')}</span>}
      </div>

      <table className="w-full text-xs border border-slate-200 rounded overflow-hidden mb-3">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">Ear</th>
            <th className="px-3 py-2">500 Hz</th>
            <th className="px-3 py-2">1 kHz</th>
            <th className="px-3 py-2">2 kHz</th>
            <th className="px-3 py-2">4 kHz</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-100">
            <td className="px-3 py-2 font-bold text-rose-600">Right</td>
            <td className="px-3 py-1 text-center">{R(500)}</td>
            <td className="px-3 py-1 text-center">{R(1000)}</td>
            <td className="px-3 py-1 text-center">{R(2000)}</td>
            <td className="px-3 py-1 text-center">{R(4000)}</td>
          </tr>
          <tr className="border-t border-slate-100">
            <td className="px-3 py-2 font-bold text-blue-600">Left</td>
            <td className="px-3 py-1 text-center">{L(500)}</td>
            <td className="px-3 py-1 text-center">{L(1000)}</td>
            <td className="px-3 py-1 text-center">{L(2000)}</td>
            <td className="px-3 py-1 text-center">{L(4000)}</td>
          </tr>
        </tbody>
      </table>

      <textarea rows={2} placeholder="Notes (transducer, booth, mask, …)" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite}
        className="w-full border border-slate-300 rounded px-2 py-1 text-xs mb-3 disabled:bg-slate-50" data-testid="ha-fit-aided-notes" />

      {canWrite && (
        <div className="flex justify-end">
          <button onClick={submit} disabled={busy} data-testid="ha-fit-aided-save" className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
            {busy ? 'Saving…' : 'Save Audiogram'}
          </button>
        </div>
      )}
    </div>
  );
}


function InfoTab({ fit }) {
  const row = (l, v) => (
    <div className="flex items-baseline justify-between py-1.5 border-b border-slate-100 text-xs">
      <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">{l}</span>
      <span className="font-mono text-slate-800">{v || '—'}</span>
    </div>
  );
  return (
    <div className="p-5" data-testid="ha-fit-info-tab">
      {row('Fitting ID', fit.fitting_id)}
      {row('Patient', `${fit.patient_name || ''} (${fit.patient_id})`)}
      {row('Audiologist', fit.audiologist_name || fit.audiologist_user_id)}
      {row('Branch', fit.branch_id)}
      {row('Sale', fit.sale_no)}
      {row('Quote', fit.quote_no)}
      {row('Serials', (fit.serials || []).map(s => `${s.serial_id}(${s.side})`).join(', '))}
      {row('First fit at', fit.first_fit_at && new Date(fit.first_fit_at).toLocaleString('en-IN'))}
      {row('Completed at', fit.completed_at && new Date(fit.completed_at).toLocaleString('en-IN'))}
      {row('Notes', fit.notes)}
    </div>
  );
}


// ==================== MARK BALANCE PAID MODAL ====================

const PAY_MODES = [
  { value: 'cash',          label: 'Cash' },
  { value: 'upi',           label: 'UPI' },
  { value: 'card',          label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque',        label: 'Cheque' },
];

function MarkBalancePaidModal({ fitting, onClose, onSettled }) {
  const balance = Number(fitting.balance_due || 0);
  const total = Number(fitting.sale_total || 0);
  const paid = Math.max(0, total - balance);

  const [amount, setAmount] = useState(balance.toFixed(2));
  const [mode, setMode] = useState('cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Enter a valid amount.'); return; }
    if (amt > balance + 0.5) { setErr(`Amount cannot exceed balance ₹${balance.toLocaleString('en-IN')}.`); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/ha/quick-sales/${fitting.quick_sale_id}/mark-paid`, {
        amount: amt,
        payment_mode: mode,
        payment_date: date,
        reference: reference || null,
        notes: notes || null,
      });
      onSettled && onSettled();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (e?.message || 'Save failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
         data-testid="mark-paid-modal">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-700 text-white px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold">Mark Balance Paid</h2>
            <p className="text-[11px] opacity-90">{fitting.patient_name} · {fitting.sale_no}</p>
          </div>
          <button onClick={onClose} className="text-white/90 hover:text-white text-2xl leading-none" aria-label="Close">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Snapshot */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-50 border border-slate-200 rounded p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Total</div>
              <div className="text-sm font-bold tabular-nums">₹{total.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
              <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-bold">Paid</div>
              <div className="text-sm font-bold text-emerald-700 tabular-nums">₹{paid.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-rose-50 border border-rose-200 rounded p-2">
              <div className="text-[10px] uppercase tracking-wide text-rose-700 font-bold">Balance</div>
              <div className="text-sm font-bold text-rose-700 tabular-nums" data-testid="mark-paid-balance">
                ₹{balance.toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded px-3 py-2" data-testid="mark-paid-err">{err}</div>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Amount paid <span className="text-rose-500">*</span></span>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                data-testid="mark-paid-amount"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:border-emerald-500" />
              <span className="block text-[10px] text-slate-400 mt-0.5">Defaults to full balance.</span>
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}
                data-testid="mark-paid-mode"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                {PAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Payment date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                data-testid="mark-paid-date"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Reference (optional)</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)}
                data-testid="mark-paid-ref"
                placeholder="UPI UTR / Receipt #"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </label>
          </div>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Notes</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              data-testid="mark-paid-notes"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded">
              Cancel
            </button>
            <button onClick={submit} disabled={busy}
              data-testid="mark-paid-submit"
              className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded shadow-md">
              {busy ? 'Saving…' : `Record ₹${parseFloat(amount || 0).toLocaleString('en-IN')}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
