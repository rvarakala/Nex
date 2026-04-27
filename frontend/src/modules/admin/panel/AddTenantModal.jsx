/**
 * AddTenantModal — founder-side manual clinic creation.
 *
 * Submits to `POST /api/admin/v2/tenants` which returns an invite link.
 * Parent (`TenantsPage`) hands the response off to <InviteSuccessModal/>
 * so the founder gets a copyable URL + WhatsApp/email shortcuts.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { Building2, Plus, AlertTriangle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AddTenantModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    clinic_name: '', owner_name: '', owner_email: '',
    city: '', state: '', phone: '', tier: 'STANDARD', trial_days: 30,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.clinic_name.trim() || !form.owner_name.trim() || !form.owner_email.trim()) return;
    setBusy(true); setErr('');
    try {
      const r = await axios.post(`${API}/admin/v2/tenants`, {
        ...form,
        trial_days: parseInt(form.trial_days, 10) || 30,
      });
      onCreated(r.data);
    } catch (ex) {
      setErr(ex?.response?.data?.detail || ex?.message || 'Failed to create tenant');
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="add-tenant-modal"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-100 p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
            <Building2 size={18} />
          </span>
          <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Add tenant</h3>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">
          Onboard a clinic that didn&apos;t come through the website. We&apos;ll create the
          clinic and generate a secure invitation link the owner can use to set
          their own password.
        </p>

        <form onSubmit={submit} className="space-y-3" data-testid="add-tenant-form">
          <Field label="Clinic name *">
            <input value={form.clinic_name} onChange={set('clinic_name')} required
              data-testid="add-tenant-name"
              placeholder="Hearing Wellness Centre, Mumbai"
              className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner name *">
              <input value={form.owner_name} onChange={set('owner_name')} required
                data-testid="add-tenant-owner-name"
                placeholder="Dr. Aarti Mehta"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
            <Field label="Owner email *">
              <input type="email" value={form.owner_email} onChange={set('owner_email')} required
                data-testid="add-tenant-owner-email"
                placeholder="aarti@hearwell.com"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input value={form.city} onChange={set('city')}
                data-testid="add-tenant-city"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
            <Field label="State">
              <input value={form.state} onChange={set('state')}
                data-testid="add-tenant-state"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={set('phone')} placeholder="+91…"
                data-testid="add-tenant-phone"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tier">
              <select value={form.tier} onChange={set('tier')} data-testid="add-tenant-tier"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none">
                <option value="BASIC">Basic</option>
                <option value="STANDARD">Standard</option>
                <option value="PREMIUM">Premium</option>
              </select>
            </Field>
            <Field label="Trial days">
              <input type="number" min={0} max={180} value={form.trial_days} onChange={set('trial_days')}
                data-testid="add-tenant-trial-days"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
          </div>

          {err && (
            <div className="text-xs rounded bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              data-testid="add-tenant-submit"
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded inline-flex items-center gap-1">
              {busy ? 'Creating…' : <><Plus size={12} /> Create tenant &amp; invite</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
