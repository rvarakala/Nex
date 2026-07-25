/**
 * ReferralDoctorsTab — Settings → Referral Doctors.
 *
 * Owners add and configure the list of referring doctors that send patients
 * to the clinic. For each doctor we track:
 *   • contact info (name / specialty / clinic / phone / email / notes)
 *   • payout config INDEPENDENTLY for Diagnostics and HA sales:
 *       – mode: none · percent · flat (₹)
 *       – value: 0-100 for percent, any non-negative ₹ for flat
 *
 * The list here is the same collection queried by the ReferringDoctorPicker
 * used inside Patient Registration / Appointment / HA Fitting forms — so any
 * doctor added here shows up in every dropdown automatically.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  UserPlus, Search, Edit3, Trash2, Save, X, Loader2, Stethoscope,
  Phone, Mail, Building, Percent, IndianRupee, Info,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EMPTY_FORM = {
  name: '',
  specialty: '',
  clinic: '',
  phone: '',
  email: '',
  notes: '',
  diag_cut_mode: 'none',
  diag_cut_value: 0,
  ha_cut_mode: 'none',
  ha_cut_value: 0,
};

// Convert `mode='none'` (UI convenience) to `null` for the backend.
const modeForApi = (m) => (m === 'none' || !m ? null : m);
const modeForUi  = (m) => (m ?? 'none');

const cutSummary = (mode, value) => {
  if (!mode || mode === 'none') return <span className="text-slate-400 italic">no payout</span>;
  if (mode === 'percent') return <span className="font-semibold text-slate-700">{value}%</span>;
  return <span className="font-semibold text-slate-700">₹{Number(value).toLocaleString('en-IN')} <span className="text-[10px] font-normal text-slate-500">flat</span></span>;
};

export default function ReferralDoctorsTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/referring-doctors`, { params: q ? { search: q } : {} });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not load doctors');
    } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // debounce search
    return () => clearTimeout(t);
  }, [q, load]);

  const openNew = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); };
  const openEdit = (d) => {
    setForm({
      name: d.name || '', specialty: d.specialty || '',
      clinic: d.clinic || '', phone: d.phone || '',
      email: d.email || '', notes: d.notes || '',
      diag_cut_mode: modeForUi(d.diag_cut_mode),
      diag_cut_value: d.diag_cut_value || 0,
      ha_cut_mode: modeForUi(d.ha_cut_mode),
      ha_cut_value: d.ha_cut_value || 0,
    });
    setEditingId(d.doctor_id);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.name.trim()) { alert('Doctor name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        diag_cut_mode: modeForApi(form.diag_cut_mode),
        diag_cut_value: Number(form.diag_cut_value) || 0,
        ha_cut_mode: modeForApi(form.ha_cut_mode),
        ha_cut_value: Number(form.ha_cut_value) || 0,
      };
      if (editingId) {
        await axios.put(`${API}/referring-doctors/${editingId}`, payload);
      } else {
        await axios.post(`${API}/referring-doctors`, payload);
      }
      closeForm();
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Save failed');
    } finally { setSaving(false); }
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.name}? Their historic referrals will still be linked to their doctor_id and appear in past reports.`)) return;
    try {
      await axios.delete(`${API}/referring-doctors/${d.doctor_id}`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Delete failed');
    }
  };

  return (
    <div className="p-6 max-w-6xl" data-testid="settings-referral-doctors">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Referral Doctors</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Add doctors who refer patients to your clinic. Configured payouts drive
            the numbers on the <span className="font-semibold">Referral Corner</span> dashboard.
          </p>
        </div>
        <button
          onClick={openNew}
          data-testid="ref-doc-add-btn"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold shadow-sm"
        >
          <UserPlus size={13} /> Add Referral Doctor
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3 max-w-sm">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, specialty, clinic, phone"
          data-testid="ref-doc-search"
          className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : err ? (
          <div className="p-8 text-center text-sm text-rose-600 font-semibold">{err}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Stethoscope size={26} className="mx-auto text-slate-300 mb-2" />
            <div className="text-sm font-semibold text-slate-700">No referral doctors yet</div>
            <div className="text-[11px] text-slate-500 mt-1">
              Click <b>+ Add Referral Doctor</b>, or a new name typed during patient registration
              is automatically added here.
            </div>
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="ref-doc-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2">Doctor</th>
                <th className="text-left px-3 py-2">Specialty</th>
                <th className="text-left px-3 py-2">Contact</th>
                <th className="text-left px-3 py-2">Diagnostics cut</th>
                <th className="text-left px-3 py-2">HA sales cut</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.doctor_id} className="hover:bg-slate-50/70" data-testid={`ref-doc-row-${d.doctor_id}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-900">{d.name}</div>
                    {d.clinic && (
                      <div className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Building size={9} /> {d.clinic}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{d.specialty || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="space-y-0.5">
                      {d.phone && <div className="flex items-center gap-1 text-slate-700"><Phone size={10} /> {d.phone}</div>}
                      {d.email && <div className="flex items-center gap-1 text-slate-500 text-[10px]"><Mail size={9} /> {d.email}</div>}
                      {!d.phone && !d.email && <span className="text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{cutSummary(d.diag_cut_mode, d.diag_cut_value)}</td>
                  <td className="px-3 py-2.5">{cutSummary(d.ha_cut_mode, d.ha_cut_value)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => openEdit(d)}
                      data-testid={`ref-doc-edit-${d.doctor_id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-semibold text-indigo-700 hover:bg-indigo-50 rounded mr-1"
                    >
                      <Edit3 size={11} /> Edit
                    </button>
                    <button
                      onClick={() => remove(d)}
                      data-testid={`ref-doc-delete-${d.doctor_id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-semibold text-rose-700 hover:bg-rose-50 rounded"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-3 text-[10.5px] text-slate-500 flex items-start gap-1.5">
          <Info size={11} className="mt-0.5 shrink-0" />
          <span>
            Doctors listed here appear in the &quot;Referring Doctor&quot; dropdown across
            patient registration, appointment booking, and HA fitting forms. Adding a new
            name during any of those flows auto-creates the doctor here — you can come back
            later to set their payout terms.
          </span>
        </div>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <ReferralDoctorFormModal
          form={form}
          set={set}
          editing={!!editingId}
          saving={saving}
          onCancel={closeForm}
          onSave={submit}
        />
      )}
    </div>
  );
}

// ─── Form modal ───────────────────────────────────────────────────────
function ReferralDoctorFormModal({ form, set, editing, saving, onCancel, onSave }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onClick={onCancel}
      data-testid="ref-doc-form-modal"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">
            {editing ? 'Edit Referral Doctor' : 'Add Referral Doctor'}
          </h3>
          <button onClick={onCancel} data-testid="ref-doc-form-close"
                  className="w-7 h-7 rounded hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <X size={15} />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Contact section */}
          <div>
            <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-slate-500 mb-2">Contact</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name*" value={form.name} onChange={(v) => set({ name: v })} testid="ref-doc-field-name" placeholder="Dr. John Doe" />
              <Field label="Specialty" value={form.specialty} onChange={(v) => set({ specialty: v })} testid="ref-doc-field-specialty" placeholder="ENT / GP / Paediatrics" />
              <Field label="Referring clinic" value={form.clinic} onChange={(v) => set({ clinic: v })} testid="ref-doc-field-clinic" placeholder="Apollo Hospital" />
              <Field label="Phone" value={form.phone} onChange={(v) => set({ phone: v })} testid="ref-doc-field-phone" placeholder="98765-43210" />
              <Field label="Email" value={form.email} onChange={(v) => set({ email: v })} testid="ref-doc-field-email" placeholder="doc@example.com" />
            </div>
            <div className="mt-3">
              <label className="text-[10px] font-bold tracking-wider uppercase text-slate-500">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
                data-testid="ref-doc-field-notes"
                rows={2}
                className="mt-1 w-full text-xs px-3 py-1.5 border border-slate-200 rounded focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                placeholder="e.g. Prefers WhatsApp for reports"
              />
            </div>
          </div>

          {/* Payout section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-slate-500">Referral payout</div>
              <div className="text-[10px] text-slate-400 italic">Configured per stream</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <CutFieldset
                title="Diagnostics"
                mode={form.diag_cut_mode}
                value={form.diag_cut_value}
                onMode={(m) => set({ diag_cut_mode: m })}
                onValue={(v) => set({ diag_cut_value: v })}
                testidBase="ref-doc-diag"
              />
              <CutFieldset
                title="Hearing Aid sales"
                mode={form.ha_cut_mode}
                value={form.ha_cut_value}
                onMode={(m) => set({ ha_cut_mode: m })}
                onValue={(v) => set({ ha_cut_value: v })}
                testidBase="ref-doc-ha"
              />
            </div>
            <div className="mt-2 text-[10.5px] text-slate-500 flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 shrink-0" />
              <span>
                <b>Percent</b> = cut of paid invoice revenue in the window. <b>Flat</b> = ₹ per referred patient with revenue in the window.
                Leave as <b>None</b> to accrue no payout for that stream.
              </span>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded"
          >Cancel</button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            data-testid="ref-doc-form-save"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {editing ? 'Update' : 'Add'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, testid, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="text-[10px] font-bold tracking-wider uppercase text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        placeholder={placeholder}
        className="mt-1 w-full text-xs px-3 py-1.5 border border-slate-200 rounded focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
      />
    </div>
  );
}

/** Cut mode toggle + value input. `mode='none'` disables the value input. */
function CutFieldset({ title, mode, value, onMode, onValue, testidBase }) {
  const disabled = mode === 'none';
  const isPercent = mode === 'percent';
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
      <div className="text-[11px] font-bold text-slate-800 mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-1 mb-2">
        {[
          { k: 'none',    label: 'None' },
          { k: 'percent', label: '%' },
          { k: 'flat',    label: '₹' },
        ].map((opt) => (
          <button
            key={opt.k}
            type="button"
            onClick={() => onMode(opt.k)}
            data-testid={`${testidBase}-mode-${opt.k}`}
            className={`text-[11px] font-semibold py-1.5 rounded border transition ${
              mode === opt.k
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className={`relative ${disabled ? 'opacity-50' : ''}`}>
        {isPercent
          ? <Percent size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          : <IndianRupee size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        }
        <input
          type="number"
          min="0"
          max={isPercent ? '100' : undefined}
          step={isPercent ? '0.1' : '1'}
          value={value}
          disabled={disabled}
          onChange={(e) => onValue(e.target.value)}
          data-testid={`${testidBase}-value`}
          className={`w-full text-xs py-1.5 border border-slate-200 rounded focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200 disabled:bg-slate-100 disabled:cursor-not-allowed ${isPercent ? 'pl-3 pr-8' : 'pl-8 pr-3'}`}
          placeholder={isPercent ? '15' : '2500'}
        />
      </div>
    </div>
  );
}
