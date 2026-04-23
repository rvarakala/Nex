import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const STATUS_COLORS = {
  candidate: 'bg-slate-100 text-slate-700',
  appraised: 'bg-amber-100 text-amber-800',
  accepted:  'bg-blue-100 text-blue-800',
  applied:   'bg-emerald-100 text-emerald-800',
  rejected:  'bg-rose-100 text-rose-800',
};


export default function UpgradeFunnelPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [me, setMe] = useState(null);
  const [appraising, setAppraising] = useState(null);   // candidate obj
  const [activeTi, setActiveTi] = useState(null);       // trade-in selected for drawer
  const [yearsMin, setYearsMin] = useState(3);

  useEffect(() => { (async () => {
    try { setMe((await axios.get(`${API}/auth/me`)).data?.user || null); }
    catch (e) { console.warn('[UpgradeFunnel] /auth/me failed:', e?.message); }
  })(); }, []);

  const canWrite = useMemo(
    () => !!me && ['audiologist', 'clinic_owner', 'super_admin'].includes(me.role),
    [me],
  );

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await axios.get(`${API}/ha/upgrade-funnel`, { params: { years_min: yearsMin } });
      setData(r.data);
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed to load funnel'); }
  }, [yearsMin]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-5 space-y-5" data-testid="ha-upgrade-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Upgrade Funnel & Trade-in Engine</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Patients with aged hearing aids (≥ {yearsMin} years) flow left→right:
            candidate → appraised → accepted → applied. Applied trade-ins retire the old serial to stock-out.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-600">
            Min age
            <select value={yearsMin} onChange={(e) => setYearsMin(Number(e.target.value))}
                    data-testid="ha-upgrade-years-filter"
                    className="border border-slate-300 rounded px-2 py-0.5 text-xs">
              {[2, 3, 4, 5, 6].map(y => <option key={y} value={y}>{y} yrs</option>)}
            </select>
          </label>
          <button onClick={load} className="text-[11px] text-indigo-600 font-semibold hover:underline"
                  data-testid="ha-upgrade-refresh">↻ Refresh</button>
        </div>
      </div>

      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded" data-testid="ha-upgrade-err">{err}</div>}

      {/* ===== FUNNEL KPIs ===== */}
      {data && (
        <div className="grid grid-cols-5 gap-3" data-testid="ha-upgrade-kpis">
          <FunnelChip label="Candidates"  v={data.funnel.candidate}  accent="slate"    testid="ha-upgrade-kpi-candidate" />
          <FunnelChip label="Appraised"   v={data.funnel.appraised}  accent="amber"    testid="ha-upgrade-kpi-appraised" />
          <FunnelChip label="Accepted"    v={data.funnel.accepted}   accent="blue"     testid="ha-upgrade-kpi-accepted" />
          <FunnelChip label="Applied"     v={data.funnel.applied}    accent="emerald"  testid="ha-upgrade-kpi-applied" />
          <FunnelChip label="Rejected"    v={data.funnel.rejected}   accent="rose"     testid="ha-upgrade-kpi-rejected" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        {/* ===== CANDIDATES ===== */}
        <Card title="Upgrade Candidates" subtitle="Aged HA sales without an active trade-in" testid="ha-upgrade-candidates-card">
          {!data ? <Skel /> : data.candidates.length === 0 ? (
            <Empty label="No upgrade candidates right now." />
          ) : (
            <table className="w-full text-xs" data-testid="ha-upgrade-candidates-table">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left py-1">Patient</th>
                  <th className="text-left">Serial</th>
                  <th className="text-right">Age</th>
                  <th className="text-right">Orig. ₹</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.candidates.map(c => (
                  <tr key={`${c.patient_id}-${c.old_serial_id}`} className="border-t border-slate-100 hover:bg-slate-50/70"
                      data-testid={`ha-upgrade-cand-${c.patient_id}`}>
                    <td className="py-1 font-semibold">{c.patient_name || c.patient_id}</td>
                    <td className="font-mono text-[10px]">{c.old_serial_no || c.old_serial_id}</td>
                    <td className="text-right tabular-nums">{c.age_years}y</td>
                    <td className="text-right tabular-nums font-mono">{fmtINR(c.total)}</td>
                    <td className="text-right">
                      {canWrite && (
                        <button onClick={() => setAppraising(c)}
                                data-testid={`ha-upgrade-start-${c.patient_id}`}
                                className="px-2 py-0.5 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded">
                          Appraise →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* ===== TRADE-INS ===== */}
        <Card title="In-Flight Trade-ins" subtitle="Recent appraisals + accepted + applied + rejected" testid="ha-upgrade-tradeins-card">
          {!data ? <Skel /> : data.trade_ins.length === 0 ? (
            <Empty label="No trade-ins yet." />
          ) : (
            <table className="w-full text-xs" data-testid="ha-upgrade-tradeins-table">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left py-1">TI</th>
                  <th className="text-left">Patient</th>
                  <th className="text-left">Serial</th>
                  <th className="text-right">Credit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.trade_ins.map(ti => (
                  <tr key={ti.trade_in_id} onClick={() => setActiveTi(ti)}
                      className="border-t border-slate-100 cursor-pointer hover:bg-indigo-50/50"
                      data-testid={`ha-upgrade-ti-${ti.trade_in_id}`}>
                    <td className="py-1 font-mono text-[10px] font-bold text-indigo-700">{ti.trade_in_id}</td>
                    <td>{ti.patient_name || ti.patient_id}</td>
                    <td className="font-mono text-[10px]">{ti.old_serial_no || ti.old_serial_id?.slice(0, 10)}</td>
                    <td className="text-right tabular-nums font-mono">{fmtINR(ti.offered_credit)}</td>
                    <td>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_COLORS[ti.status]}`}>
                        {ti.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {appraising && (
        <AppraiseModal
          candidate={appraising}
          onClose={() => setAppraising(null)}
          onCreated={() => { setAppraising(null); load(); }}
        />
      )}

      {activeTi && (
        <TradeInDrawer
          ti={activeTi}
          canWrite={canWrite}
          onClose={() => setActiveTi(null)}
          onMutated={() => { setActiveTi(null); load(); }}
        />
      )}
    </div>
  );
}


/* ================= SHARED ================= */
const Card = ({ title, subtitle, children, testid }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm" data-testid={testid}>
    <div className="mb-2">
      <div className="text-sm font-bold text-slate-800">{title}</div>
      {subtitle && <div className="text-[10px] text-slate-500 uppercase tracking-wider">{subtitle}</div>}
    </div>
    {children}
  </div>
);

const FunnelChip = ({ label, v, accent, testid }) => {
  const colors = {
    slate:   'bg-slate-50 text-slate-800 border-slate-200',
    amber:   'bg-amber-50 text-amber-800 border-amber-200',
    blue:    'bg-blue-50 text-blue-800 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    rose:    'bg-rose-50 text-rose-800 border-rose-200',
  }[accent];
  return (
    <div data-testid={testid} className={`border rounded-md px-3 py-2 ${colors}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold tabular-nums">{v ?? 0}</div>
    </div>
  );
};

const Skel = () => <div className="h-24 rounded bg-slate-100 animate-pulse" />;
const Empty = ({ label = 'No data yet.' }) => (
  <div className="text-[11px] italic text-slate-400 py-6 text-center">{label}</div>
);


/* ================= APPRAISE MODAL ================= */
function AppraiseModal({ candidate, onClose, onCreated }) {
  const [condition, setCondition] = useState('good');
  const [appraisedValue, setAppraisedValue] = useState(
    Math.round((candidate.total || 50000) * 0.25),
  );
  const [offeredCredit, setOfferedCredit] = useState(
    Math.round((candidate.total || 50000) * 0.20),
  );
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setErr('');
    setSaving(true);
    try {
      await axios.post(`${API}/ha/trade-ins`, {
        branch_id: candidate.branch_id,
        patient_id: candidate.patient_id,
        old_serial_id: candidate.old_serial_id,
        condition,
        appraised_value: Number(appraisedValue || 0),
        offered_credit: Number(offeredCredit || 0),
        notes,
      });
      onCreated();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-xl w-full p-5"
           onClick={(e) => e.stopPropagation()} data-testid="ha-upgrade-appraise-modal">
        <h2 className="text-lg font-bold mb-1">Appraise Trade-in</h2>
        <div className="text-[11px] text-slate-500 mb-3">
          <b>{candidate.patient_name || candidate.patient_id}</b> · serial
          <span className="font-mono mx-1">{candidate.old_serial_no}</span>
          · {candidate.age_years}y old
        </div>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}
                    data-testid="ha-upgrade-appraise-condition"
                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Appraised Value (₹)</span>
            <input type="number" value={appraisedValue}
                   onChange={(e) => setAppraisedValue(e.target.value)}
                   data-testid="ha-upgrade-appraise-value"
                   className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
            <div className="text-[9px] text-slate-400 mt-0.5">internal estimate · not shown to patient</div>
          </div>
        </div>

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Offered Credit (₹) — shown to patient</span>
          <input type="number" value={offeredCredit}
                 onChange={(e) => setOfferedCredit(e.target.value)}
                 data-testid="ha-upgrade-appraise-credit"
                 className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-bold text-emerald-700" />
        </div>

        <div className="mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                    data-testid="ha-upgrade-appraise-notes"
                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="ha-upgrade-appraise-submit"
                  className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
            {saving ? 'Saving…' : 'Save Appraisal'}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ================= TRADE-IN DRAWER ================= */
function TradeInDrawer({ ti, canWrite, onClose, onMutated }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saleNo, setSaleNo] = useState('');

  const act = async (endpoint, body) => {
    if (!window.confirm(`Are you sure you want to ${endpoint} trade-in ${ti.trade_in_id}?`)) return;
    setErr(''); setBusy(true);
    try {
      await axios.post(`${API}/ha/trade-ins/${ti.trade_in_id}/${endpoint}`, body || {});
      onMutated();
    } catch (e) { setErr(e?.response?.data?.detail || `${endpoint} failed`); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full p-5"
           onClick={(e) => e.stopPropagation()} data-testid="ha-upgrade-ti-drawer">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-bold text-slate-800 font-mono">{ti.trade_in_id}</div>
            <div className="text-[10px] text-slate-500">
              {ti.patient_name || ti.patient_id} · {ti.old_brand} {ti.old_model} · {ti.age_years}y old
            </div>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${STATUS_COLORS[ti.status]}`}>
            {ti.status.toUpperCase()}
          </span>
        </div>

        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <dl className="text-[11px] grid grid-cols-2 gap-y-1 gap-x-3 mb-3 border-t border-slate-100 pt-3">
          <dt className="text-slate-500">Serial</dt><dd className="font-mono">{ti.old_serial_no || ti.old_serial_id}</dd>
          <dt className="text-slate-500">Condition</dt><dd className="capitalize">{ti.condition}</dd>
          <dt className="text-slate-500">Appraised</dt><dd className="font-mono">{fmtINR(ti.appraised_value)}</dd>
          <dt className="text-slate-500">Offered</dt><dd className="font-mono font-bold text-emerald-700">{fmtINR(ti.offered_credit)}</dd>
          {ti.linked_sale_no && <><dt className="text-slate-500">Applied to</dt><dd className="font-mono">{ti.linked_sale_no}</dd></>}
          {ti.notes && <><dt className="text-slate-500 col-span-2 italic">Notes: {ti.notes}</dt></>}
        </dl>

        {canWrite && ti.status === 'appraised' && (
          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button onClick={() => act('accept')} disabled={busy}
                    data-testid="ha-upgrade-ti-accept"
                    className="flex-1 px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded">
              Accept (patient hands over HA)
            </button>
            <button onClick={() => act('reject')} disabled={busy}
                    data-testid="ha-upgrade-ti-reject"
                    className="px-3 py-1.5 text-xs font-bold bg-rose-100 hover:bg-rose-200 text-rose-800 rounded">
              Reject
            </button>
          </div>
        )}

        {canWrite && ti.status === 'accepted' && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Link New Sale #</span>
              <input value={saleNo} onChange={(e) => setSaleNo(e.target.value)}
                     data-testid="ha-upgrade-ti-sale-input"
                     placeholder="SAL-2026-…"
                     className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => saleNo && act('apply', { sale_no: saleNo })}
                      disabled={busy || !saleNo}
                      data-testid="ha-upgrade-ti-apply"
                      className="flex-1 px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded">
                Apply → retire old HA
              </button>
              <button onClick={() => act('reject')} disabled={busy}
                      className="px-3 py-1.5 text-xs font-bold bg-rose-100 hover:bg-rose-200 text-rose-800 rounded">
                Reject
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Close</button>
        </div>
      </div>
    </div>
  );
}
