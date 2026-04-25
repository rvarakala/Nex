/**
 * AddServiceInlineModal — quick-create a Service catalogue entry without
 * leaving the current page (e.g. while drafting an invoice or booking an
 * appointment). On successful save, calls onCreated(newService) so the host
 * page can refresh its catalog list and auto-select the new entry.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { API } from './billingUtils';

const CATEGORIES = ['Consultation', 'Audiology', 'Hearing Aid', 'Accessory', 'Service'];

const EMPTY = {
  name: '',
  code: '',
  category: 'Audiology',
  hsn_sac: '',
  price: 0,
  is_taxable: false,
  gst_rate: 0,
  gst_inclusive: true,
};

export default function AddServiceInlineModal({ open, onClose, onCreated, defaultName = '' }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, name: defaultName }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Reset whenever the modal is reopened so users start clean
  React.useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, name: defaultName });
      setErr(null);
    }
  }, [open, defaultName]);

  if (!open) return null;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim() || Number(form.price) < 0) {
      setErr('Name and a non-negative price are required');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await axios.post(`${API}/billing/services`, {
        ...form,
        name: form.name.trim(),
        code: (form.code || '').trim().toUpperCase() || null,
        hsn_sac: (form.hsn_sac || '').trim() || null,
        price: Number(form.price) || 0,
        gst_rate: form.is_taxable ? Number(form.gst_rate) || 0 : 0,
      });
      onCreated?.(r.data);
      onClose?.();
    } catch (e2) {
      setErr(e2?.response?.data?.detail || 'Save failed — try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="add-service-inline-modal"
    >
      <form
        onSubmit={submit}
        className="bg-white rounded-lg shadow-2xl w-[480px] max-w-full"
      >
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-white">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Add Service to Catalogue</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Saved permanently — available next time you bill or book.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-rose-600 text-lg leading-none" data-testid="add-svc-close">×</button>
        </div>

        {err && (
          <div className="mx-3 mt-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded px-2 py-1.5" data-testid="add-svc-error">
            {err}
          </div>
        )}

        <div className="p-3 space-y-2">
          <Field label="Service Name *">
            <input
              autoFocus
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="add-svc-name"
              placeholder="e.g. Tinnitus Retraining Therapy"
              className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-emerald-500"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Short Code">
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                data-testid="add-svc-code"
                placeholder="TRT"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono"
              />
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                data-testid="add-svc-category"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="HSN / SAC">
              <input
                type="text"
                value={form.hsn_sac}
                onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })}
                data-testid="add-svc-hsn"
                placeholder="999312"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono"
              />
            </Field>
            <Field label="Price (₹) *">
              <input
                type="number"
                min="0"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                data-testid="add-svc-price"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded tabular-nums text-right"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2 items-end">
            <Field label="Taxable?">
              <select
                value={form.is_taxable ? 'yes' : 'no'}
                onChange={(e) => setForm({ ...form, is_taxable: e.target.value === 'yes' })}
                data-testid="add-svc-taxable"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="no">No (Exempt)</option>
                <option value="yes">Yes</option>
              </select>
            </Field>
            <Field label="GST %">
              <input
                type="number"
                min="0"
                max="28"
                value={form.gst_rate}
                disabled={!form.is_taxable}
                onChange={(e) => setForm({ ...form, gst_rate: e.target.value })}
                data-testid="add-svc-gst"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded disabled:bg-slate-50 tabular-nums text-right"
              />
            </Field>
            <Field label="Price incl. GST?">
              <select
                value={form.gst_inclusive ? 'yes' : 'no'}
                disabled={!form.is_taxable}
                onChange={(e) => setForm({ ...form, gst_inclusive: e.target.value === 'yes' })}
                data-testid="add-svc-incl"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-50"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded" data-testid="add-svc-cancel">Cancel</button>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            data-testid="add-svc-save"
            className="px-4 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded shadow-sm"
          >
            {saving ? 'Saving…' : 'Save & Use'}
          </button>
        </div>
      </form>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <label className="block text-[9px] uppercase tracking-wider font-bold text-slate-500 mb-0.5">{label}</label>
    {children}
  </div>
);
