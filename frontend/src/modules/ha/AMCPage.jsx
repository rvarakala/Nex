/**
 * AMC Management (Phase 13.A)
 * Two sub-views: Plans catalogue + Active contracts + Renewals due tile.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const StatusPill = ({ s }) => {
  const cls = {
    active: 'bg-emerald-100 text-emerald-700',
    expired: 'bg-rose-100 text-rose-700',
    cancelled: 'bg-slate-200 text-slate-700',
    renewed: 'bg-indigo-100 text-indigo-700',
  }[s] || 'bg-slate-100 text-slate-700';
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${cls}`}>{s}</span>;
};

export default function AMCPage() {
  const [tab, setTab] = useState('contracts');
  const [plans, setPlans] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [renewals, setRenewals] = useState(null);
  const [stats, setStats] = useState(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const [p, c, r, s] = await Promise.all([
        axios.get(`${API}/ha/amc/plans?include_inactive=true`),
        axios.get(`${API}/ha/amc/contracts`),
        axios.get(`${API}/ha/amc/renewals-due?days=45`),
        axios.get(`${API}/ha/amc/stats`),
      ]);
      setPlans(p.data || []);
      setContracts(c.data || []);
      setRenewals(r.data || null);
      setStats(s.data || null);
    } catch (e) {
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Failed to load AMC data');
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-6" data-testid="amc-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AMC Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Annual Maintenance Contracts for sold hearing aids · <span className="text-indigo-700 font-semibold">UC-CM05</span></p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'plans' && (
            <button data-testid="amc-new-plan-btn" onClick={() => setShowPlanForm(true)} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow">+ New Plan</button>
          )}
          {tab === 'contracts' && (
            <button data-testid="amc-new-contract-btn" onClick={() => setShowContractForm(true)} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow">+ Sell AMC</button>
          )}
        </div>
      </div>

      {/* Stat tiles */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          <StatTile label="Active" v={stats.active} tone="emerald" />
          <StatTile label="Expired" v={stats.expired} tone="rose" />
          <StatTile label="Renewed" v={stats.renewed} tone="indigo" />
          <StatTile label="Revenue" v={fmtINR(stats.total_revenue)} tone="amber" />
        </div>
      )}

      {/* Renewal alert */}
      {renewals && (renewals.count_expired > 0 || renewals.count_soon > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between" data-testid="amc-renewal-alert">
          <div>
            <div className="text-sm font-bold text-amber-900">Renewal Attention</div>
            <div className="text-xs text-amber-700 mt-0.5">
              {renewals.count_expired} expired · {renewals.count_soon} expiring within {renewals.window_days} days
            </div>
          </div>
          <button onClick={() => setTab('contracts')} className="text-xs font-semibold text-amber-900 underline">Review →</button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-4">
        <TabBtn active={tab === 'contracts'} onClick={() => setTab('contracts')} testid="amc-tab-contracts">Contracts ({contracts.length})</TabBtn>
        <TabBtn active={tab === 'plans'} onClick={() => setTab('plans')} testid="amc-tab-plans">Plans ({plans.length})</TabBtn>
      </div>

      {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}

      {tab === 'plans' && <PlansList plans={plans} onRefresh={load} />}
      {tab === 'contracts' && <ContractsList contracts={contracts} onRefresh={load} />}

      {showPlanForm && <PlanForm onClose={() => setShowPlanForm(false)} onSaved={() => { setShowPlanForm(false); load(); }} />}
      {showContractForm && <ContractForm plans={plans.filter((p) => p.active)} onClose={() => setShowContractForm(false)} onSaved={() => { setShowContractForm(false); load(); }} />}
    </div>
  );
}

const StatTile = ({ label, v, tone }) => (
  <div className={`rounded-lg p-4 bg-${tone}-50 border border-${tone}-200`}>
    <div className={`text-[10px] font-semibold uppercase tracking-wider text-${tone}-700`}>{label}</div>
    <div className={`text-2xl font-bold text-${tone}-900 mt-1`}>{v}</div>
  </div>
);

const TabBtn = ({ active, onClick, testid, children }) => (
  <button
    data-testid={testid}
    onClick={onClick}
    className={`px-1 py-2 -mb-px text-sm font-semibold border-b-2 ${active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
  >
    {children}
  </button>
);

const PlansList = ({ plans, onRefresh }) => {
  if (!plans.length) return <div className="text-center text-sm text-slate-500 py-10">No AMC plans yet. Create one to start selling.</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="amc-plans-grid">
      {plans.map((p) => (
        <div key={p.plan_id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{p.tier_label || 'AMC'}</div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">{p.name}</div>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{p.active ? 'Active' : 'Inactive'}</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-indigo-700">{fmtINR(p.price)}</div>
          <div className="text-[11px] text-slate-500">for {p.duration_months} months · GST {p.gst_rate}%</div>
          <ul className="mt-4 space-y-1 text-[12px] text-slate-700">
            <li>• {p.included_services} free service visits</li>
            {p.covers_accidental_damage && <li>• Accidental damage cover</li>}
            {p.includes_battery_packs > 0 && <li>• {p.includes_battery_packs} battery packs</li>}
          </ul>
          {p.description && <p className="mt-3 text-[11px] text-slate-500 italic">{p.description}</p>}
        </div>
      ))}
    </div>
  );
};

const ContractsList = ({ contracts, onRefresh }) => {
  if (!contracts.length) return <div className="text-center text-sm text-slate-500 py-10">No AMC contracts yet.</div>;
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-sm" data-testid="amc-contracts-table">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left">Contract</th>
            <th className="px-4 py-2 text-left">Patient</th>
            <th className="px-4 py-2 text-left">Plan</th>
            <th className="px-4 py-2 text-left">Serial</th>
            <th className="px-4 py-2 text-left">Start</th>
            <th className="px-4 py-2 text-left">Expiry</th>
            <th className="px-4 py-2 text-right">Services</th>
            <th className="px-4 py-2 text-right">Paid</th>
            <th className="px-4 py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.contract_no} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-2 font-mono text-xs text-indigo-700">{c.contract_no}</td>
              <td className="px-4 py-2">{c.patient_name || c.patient_id}</td>
              <td className="px-4 py-2 text-xs">{c.plan_snapshot?.name}</td>
              <td className="px-4 py-2 text-xs font-mono text-slate-600">{c.serial_no || '—'}</td>
              <td className="px-4 py-2 text-xs">{fmtDate(c.amc_start_date)}</td>
              <td className="px-4 py-2 text-xs">{fmtDate(c.amc_expiry_date)}</td>
              <td className="px-4 py-2 text-right text-xs">{c.services_used}/{c.plan_snapshot?.included_services || 0}</td>
              <td className="px-4 py-2 text-right text-xs font-semibold">{fmtINR(c.price_paid)}</td>
              <td className="px-4 py-2 text-center"><StatusPill s={c.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const PlanForm = ({ onClose, onSaved }) => {
  const [f, setF] = useState({
    name: '', tier_label: 'Gold', duration_months: 12, price: '',
    gst_rate: 18, included_services: 4, covers_accidental_damage: false,
    includes_battery_packs: 0, description: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/ha/amc/plans`, { ...f, price: parseFloat(f.price), duration_months: parseInt(f.duration_months), included_services: parseInt(f.included_services), includes_battery_packs: parseInt(f.includes_battery_packs) });
      onSaved();
    } catch (e) {
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-3" data-testid="amc-plan-form">
        <h2 className="text-lg font-bold text-slate-900">New AMC Plan</h2>
        <Input label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} required testid="amc-plan-name" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Tier label" value={f.tier_label} onChange={(v) => setF({ ...f, tier_label: v })} />
          <Input label="Duration (months)" type="number" value={f.duration_months} onChange={(v) => setF({ ...f, duration_months: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Price (₹)" type="number" value={f.price} onChange={(v) => setF({ ...f, price: v })} required testid="amc-plan-price" />
          <Input label="GST rate %" type="number" value={f.gst_rate} onChange={(v) => setF({ ...f, gst_rate: parseFloat(v) })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Included services" type="number" value={f.included_services} onChange={(v) => setF({ ...f, included_services: v })} />
          <Input label="Battery packs" type="number" value={f.includes_battery_packs} onChange={(v) => setF({ ...f, includes_battery_packs: v })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.covers_accidental_damage} onChange={(e) => setF({ ...f, covers_accidental_damage: e.target.checked })} />
          <span>Covers accidental damage</span>
        </label>
        <Input label="Description" value={f.description} onChange={(v) => setF({ ...f, description: v })} />
        {err && <div className="text-xs text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800">Cancel</button>
          <button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow disabled:opacity-50" data-testid="amc-plan-save">{busy ? 'Saving…' : 'Save Plan'}</button>
        </div>
      </form>
    </div>
  );
};

const Input = ({ label, value, onChange, type = 'text', required, testid }) => (
  <label className="block">
    <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">{label}{required && <span className="text-rose-600"> *</span>}</span>
    <input
      data-testid={testid}
      type={type} value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="mt-0.5 w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
    />
  </label>
);

const ContractForm = ({ plans, onClose, onSaved }) => {
  const [patientQ, setPatientQ] = useState('');
  const [results, setResults] = useState([]);
  const [sel, setSel] = useState(null);
  const [planId, setPlanId] = useState(plans[0]?.plan_id || '');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [priceOverride, setPriceOverride] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (patientQ.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients?q=${encodeURIComponent(patientQ)}&limit=8`);
        setResults(r.data || []);
      } catch { /* */ }
    }, 300);
    return () => clearTimeout(t);
  }, [patientQ]);

  const submit = async (e) => {
    e.preventDefault();
    if (!sel || !planId) { setErr('Pick a patient and a plan'); return; }
    setBusy(true); setErr('');
    try {
      const body = { patient_id: sel.patient_id, plan_id: planId, amc_start_date: start, notes };
      if (priceOverride) body.price_override = parseFloat(priceOverride);
      await axios.post(`${API}/ha/amc/contracts`, body);
      onSaved();
    } catch (e) {
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-3" data-testid="amc-contract-form">
        <h2 className="text-lg font-bold text-slate-900">Sell AMC</h2>
        {!sel ? (
          <div>
            <Input label="Search patient" value={patientQ} onChange={setPatientQ} testid="amc-contract-patient-search" />
            <div className="mt-2 space-y-1 max-h-40 overflow-auto">
              {results.map((p) => (
                <button type="button" key={p.patient_id} onClick={() => setSel(p)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 rounded">
                  <span className="font-semibold">{p.name}</span> · {p.mobile || p.mrd}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-indigo-50 border border-indigo-200 rounded p-2 text-xs flex items-center justify-between">
            <span><b>{sel.name}</b> · {sel.mrd}</span>
            <button type="button" onClick={() => setSel(null)} className="text-indigo-600 underline">change</button>
          </div>
        )}

        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Plan *</span>
          <select data-testid="amc-contract-plan-select" value={planId} onChange={(e) => setPlanId(e.target.value)} required className="mt-0.5 w-full px-2 py-1.5 text-sm border border-slate-300 rounded">
            {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{`${p.name} — ${fmtINR(p.price)}`}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" value={start} onChange={setStart} />
          <Input label="Price override (₹)" type="number" value={priceOverride} onChange={setPriceOverride} />
        </div>
        <Input label="Notes" value={notes} onChange={setNotes} />
        {err && <div className="text-xs text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600">Cancel</button>
          <button disabled={busy || !sel} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50" data-testid="amc-contract-save">{busy ? 'Creating…' : 'Create Contract'}</button>
        </div>
      </form>
    </div>
  );
};
