/**
 * ClinicGroupTab — self-serve multi-clinic management for Head clinic owners.
 *
 * If the clinic isn't part of a group yet: shows a "Create Clinic Group"
 * CTA that promotes the current clinic to Head.
 *
 * Once a group exists (and viewer is Head):
 *   - Head card (this clinic)
 *   - Branch cards with stock summary (HAs in stock, low-stock accessories,
 *     patient count)
 *   - "+ Add Branch" opens a modal to spin up a new branch clinic
 *   - Each branch card has a "Deactivate" action (owner-only, confirm)
 *
 * If the viewer is a Branch (not Head), we show a read-only view of the
 * group — so branch owners know they're inside a chain, and can see the
 * head clinic's contact details.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Building2, Plus, Loader2, X, MapPin, Package, AlertTriangle, Users, Crown, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ClinicGroupTab() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, data: null, err: '' });
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, err: '' }));
    try {
      const r = await axios.get(`${API}/clinic-groups/mine`);
      setState({ loading: false, data: r.data, err: '' });
    } catch (e) {
      setState({ loading: false, data: null, err: e?.response?.data?.detail || 'Load failed' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createGroup = async () => {
    if (!groupName.trim()) return;
    setCreatingGroup(true);
    try {
      await axios.post(`${API}/clinic-groups`, { name: groupName.trim() });
      await load();
      setGroupName('');
    } catch (e) {
      setState((s) => ({ ...s, err: e?.response?.data?.detail || 'Create group failed' }));
    } finally {
      setCreatingGroup(false);
    }
  };

  if (state.loading) return <div className="p-8 text-slate-400 italic text-sm">Loading clinic group…</div>;

  const canManage = user && ['clinic_owner', 'super_admin', 'founder'].includes(user.role);
  const group = state.data?.group;
  const head = state.data?.head;
  const branches = state.data?.branches || [];
  const viewerIsHead = !!state.data?.viewer_is_head;

  // ── NO GROUP YET → onboarding CTA ────────────────────────────────
  if (!group) {
    return (
      <div className="max-w-3xl p-6" data-testid="clinic-group-tab">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-slate-900 mb-1">Clinic Group</h2>
          <p className="text-[13px] text-slate-600">
            Running more than one clinic? Turn this clinic into a <b>Head Clinic</b> and manage all your branches from one login.
          </p>
        </div>

        {!canManage ? (
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-[13px] text-amber-800" data-testid="clinic-group-need-owner">
            Only the clinic owner can create a group. Ask them to set this up.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Crown size={14} className="text-amber-500" />
                Become a Head Clinic
              </h3>
            </div>
            <div className="p-4 space-y-4">
              <ul className="space-y-2 text-[12.5px] text-slate-700">
                <li className="flex items-start gap-2"><ShieldCheck size={13} className="mt-0.5 text-emerald-600 flex-shrink-0" /> Add branch clinics — each with its own patients, staff, and invoices.</li>
                <li className="flex items-start gap-2"><ShieldCheck size={13} className="mt-0.5 text-emerald-600 flex-shrink-0" /> Move stock between clinics with delivery challans (GST-ready).</li>
                <li className="flex items-start gap-2"><ShieldCheck size={13} className="mt-0.5 text-emerald-600 flex-shrink-0" /> Branches can request stock from you — approve or route from another branch.</li>
                <li className="flex items-start gap-2"><ShieldCheck size={13} className="mt-0.5 text-emerald-600 flex-shrink-0" /> Switch between clinics from the top nav — one login for the whole chain.</li>
              </ul>
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <label className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider">Group name</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  data-testid="clinic-group-name-input"
                  placeholder="e.g. Sound Clinic Chain"
                  className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  type="button"
                  disabled={!groupName.trim() || creatingGroup}
                  onClick={createGroup}
                  data-testid="clinic-group-create-btn"
                  className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-40"
                >
                  {creatingGroup ? <Loader2 size={12} className="animate-spin" /> : <Crown size={12} />}
                  {creatingGroup ? 'Creating…' : 'Create clinic group'}
                </button>
                {state.err && <p className="text-[11.5px] text-rose-700 mt-1">{state.err}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── GROUP EXISTS → console ──────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="clinic-group-tab">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Clinic Group</div>
          <h2 className="text-lg font-bold text-slate-900" data-testid="clinic-group-name">{group.name}</h2>
          <p className="text-[11.5px] text-slate-500 mt-0.5">
            {branches.length + 1} clinic{branches.length + 1 === 1 ? '' : 's'} · You are {viewerIsHead ? <b className="text-indigo-700">Head</b> : 'a Branch'}
          </p>
        </div>
        {viewerIsHead && canManage && (
          <button
            type="button"
            onClick={() => setShowAddBranch(true)}
            data-testid="clinic-group-add-branch-btn"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm shadow-indigo-600/20"
          >
            <Plus size={13} /> Add Branch
          </button>
        )}
      </div>

      {showAddBranch && (
        <AddBranchModal
          onClose={() => setShowAddBranch(false)}
          onCreated={async () => { setShowAddBranch(false); await load(); }}
        />
      )}

      {/* Head card */}
      {head && (
        <ClinicCard
          clinic={head}
          isHead
          canDeactivate={false}
        />
      )}

      {/* Branch cards */}
      {branches.map((b) => (
        <ClinicCard
          key={b.clinic_id}
          clinic={b}
          isHead={false}
          canDeactivate={viewerIsHead && canManage}
          onDeactivate={async () => {
            if (!window.confirm(`Deactivate ${b.name}? Its data stays in the database but it will disappear from the switcher.`)) return;
            try {
              await axios.post(`${API}/clinic-groups/mine/branches/${b.clinic_id}/deactivate`);
              await load();
            } catch (e) {
              alert(e?.response?.data?.detail || 'Deactivate failed');
            }
          }}
        />
      ))}

      {branches.length === 0 && viewerIsHead && (
        <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-500 text-[13px]" data-testid="clinic-group-empty-branches">
          No branches yet. Click <b>Add Branch</b> to spin up your first location.
        </div>
      )}
    </div>
  );
}

// ─── Clinic card ──────────────────────────────────────────────────
function ClinicCard({ clinic, isHead, canDeactivate, onDeactivate }) {
  const stock = clinic.stock || {};
  return (
    <div
      className={`border rounded-lg p-4 ${isHead ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}
      data-testid={`clinic-card-${clinic.clinic_id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {isHead ? <Crown size={14} className="text-amber-500" /> : <Building2 size={14} className="text-slate-500" />}
            <h3 className="text-[14px] font-bold text-slate-900 truncate">{clinic.name}</h3>
            {isHead && <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-500 text-white px-1.5 py-0.5 rounded">Head</span>}
            {clinic.status === 'inactive' && <span className="text-[9px] font-bold uppercase tracking-wider bg-slate-400 text-white px-1.5 py-0.5 rounded">Inactive</span>}
          </div>
          <div className="text-[11.5px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1"><MapPin size={10} /> {[clinic.city, clinic.state].filter(Boolean).join(', ')}</span>
            {clinic.gstin && <span className="font-mono text-slate-400">GSTIN {clinic.gstin}</span>}
          </div>
        </div>
        {canDeactivate && (
          <button
            type="button"
            onClick={onDeactivate}
            data-testid={`clinic-card-deactivate-${clinic.clinic_id}`}
            className="text-[10.5px] text-slate-400 hover:text-rose-600 underline underline-offset-2"
          >Deactivate</button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <StockKPI icon={<Package size={12} />} label="HAs in stock" value={stock.ha_units} />
        <StockKPI icon={<AlertTriangle size={12} />} label="Low-stock SKUs" value={stock.low_stock_skus} tone={stock.low_stock_skus > 0 ? 'warn' : undefined} />
        <StockKPI icon={<Users size={12} />} label="Patients" value={stock.patients} />
      </div>
    </div>
  );
}

function StockKPI({ icon, label, value, tone }) {
  const toneCls = tone === 'warn' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-700 bg-slate-50 border-slate-200';
  return (
    <div className={`border rounded-md px-2 py-1.5 ${toneCls}`}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider opacity-75">{icon} {label}</div>
      <div className="text-sm font-bold mt-0.5">{value ?? 0}</div>
    </div>
  );
}

// ─── Add Branch Modal ─────────────────────────────────────────────
function AddBranchModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', city: '', state: '', phone: '', email: '', gstin: '', mrd_prefix: '',
    inherit_branding: true, inherit_services: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!form.name.trim() || !form.city.trim()) {
      setErr('Name and city are required'); return;
    }
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/clinic-groups/mine/branches`, form);
      onCreated?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (d?.message || 'Add branch failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 pb-24 md:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="add-branch-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-w-full max-h-[calc(100dvh-96px)] sm:max-h-[85vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Building2 size={16} className="text-indigo-600" /> Add Branch Clinic
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-500" data-testid="add-branch-close">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Branch name *" testid="add-branch-name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Sound Clinic — Mysore" />
            <Field label="City *" testid="add-branch-city" value={form.city} onChange={(v) => setForm({ ...form, city: v })} placeholder="Mysore" />
            <Field label="State" testid="add-branch-state" value={form.state} onChange={(v) => setForm({ ...form, state: v })} placeholder="Karnataka" />
            <Field label="Phone" testid="add-branch-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+91 …" />
            <Field label="Email" testid="add-branch-email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="mysore@yourclinic.com" />
            <Field label="GSTIN" testid="add-branch-gstin" value={form.gstin} onChange={(v) => setForm({ ...form, gstin: v })} placeholder="29ABCDE1234F1Z5" />
            <Field label="MRD prefix" testid="add-branch-mrd" value={form.mrd_prefix} onChange={(v) => setForm({ ...form, mrd_prefix: v })} placeholder="TSC-MYS" hint="Leave blank to inherit head's prefix" />
          </div>

          <div className="border border-slate-200 rounded-md p-3 bg-slate-50/50 space-y-2">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Inherit from head clinic</div>
            <ToggleRow
              label="Clinic branding (logo, letterhead, tagline)"
              checked={form.inherit_branding}
              onChange={(v) => setForm({ ...form, inherit_branding: v })}
              testid="add-branch-inherit-branding"
            />
            <ToggleRow
              label="Service catalog & pricing"
              checked={form.inherit_services}
              onChange={(v) => setForm({ ...form, inherit_services: v })}
              testid="add-branch-inherit-services"
            />
            <div className="text-[10.5px] text-slate-500 italic pl-6">
              Patients, staff, appointments and inventory stay separate — that&apos;s the whole point of a branch.
            </div>
          </div>

          {err && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}
        </div>
        <footer className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded" data-testid="add-branch-cancel">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            data-testid="add-branch-submit"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {busy ? 'Creating…' : 'Create branch'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, testid, hint }) {
  return (
    <label className="block">
      <div className="text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testid}
        className="w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {hint && <p className="text-[10px] text-slate-400 mt-0.5 italic">{hint}</p>}
    </label>
  );
}

function ToggleRow({ label, checked, onChange, testid }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testid}
        className="mt-0.5 accent-indigo-600"
      />
      <span className="text-[12.5px] text-slate-800">{label}</span>
    </label>
  );
}
