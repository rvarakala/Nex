import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API, fmtINR } from './billingUtils';

const EMPTY = {
  code: '', name: '', category: 'Audiology', hsn_sac: '',
  price: 0, gst_rate: 0, gst_inclusive: true, is_taxable: false,
};
const CATEGORIES = ['Consultation', 'Audiology', 'Hearing Aid', 'Accessory'];

export default function ServiceCatalogPage() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);            // {service_id?, ...}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/billing/services`, { params: { active_only: false } });
      setServices(r.data || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      if (form.service_id) {
        await axios.put(`${API}/billing/services/${form.service_id}`, form);
      } else {
        await axios.post(`${API}/billing/services`, form);
      }
      setForm(null); load();
    } catch (e) { alert(e?.response?.data?.detail || 'Save failed'); }
  };

  const deactivate = async (s) => {
    if (!window.confirm(`Deactivate "${s.name}"?`)) return;
    try { await axios.delete(`${API}/billing/services/${s.service_id}`); load(); }
    catch (e) { alert(e?.message || 'Failed'); }
  };

  return (
    <div className="p-4 space-y-3" data-testid="service-catalog-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-slate-800">Service Catalogue</div>
          <div className="text-[11px] text-slate-500">Procedures, hearing aids, accessories. GST rate + HSN per item.</div>
        </div>
        <button onClick={() => setForm({ ...EMPTY })} data-testid="sc-add-btn"
          className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded shadow-sm">
          + Add Service
        </button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">Code</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Category</th>
              <th className="px-3 py-2 font-semibold">HSN/SAC</th>
              <th className="px-3 py-2 font-semibold text-right">Price</th>
              <th className="px-3 py-2 font-semibold text-right">GST</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400 italic">Loading…</td></tr>}
            {services.map((s) => (
              <tr key={s.service_id} data-testid={`sc-row-${s.service_id}`}
                  className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${!s.active ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 font-mono text-slate-700">{s.code || '—'}</td>
                <td className="px-3 py-2 font-semibold text-slate-800">{s.name}</td>
                <td className="px-3 py-2 text-slate-600">{s.category || '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-500">{s.hsn_sac || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtINR(s.price)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {s.is_taxable ? `${s.gst_rate}%${s.gst_inclusive ? ' incl' : ' excl'}` : <span className="text-[9px] italic">Exempt</span>}
                </td>
                <td className="px-3 py-2">
                  {s.active
                    ? <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">ACTIVE</span>
                    : <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">INACTIVE</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setForm({ ...s })} data-testid={`sc-edit-${s.service_id}`}
                    className="px-2 py-0.5 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded mr-1">Edit</button>
                  {s.active && (
                    <button onClick={() => deactivate(s)} data-testid={`sc-del-${s.service_id}`}
                      className="px-2 py-0.5 text-[10px] border border-rose-300 text-rose-600 hover:bg-rose-50 font-semibold rounded">Deactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
             onClick={(e) => { if (e.target === e.currentTarget) setForm(null); }}
             data-testid="sc-form-modal">
          <div className="bg-white rounded-lg shadow-2xl w-[460px] max-w-full">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-white">
              <h3 className="text-sm font-bold text-slate-800">{form.service_id ? 'Edit Service' : 'Add Service'}</h3>
              <button onClick={() => setForm(null)} className="text-slate-500 hover:text-red-600 text-lg">×</button>
            </div>
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Code"><input type="text" value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="sc-form-code" className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono" /></Field>
                <Field label="Category">
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="sc-form-category" className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Name *"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="sc-form-name" className="w-full px-2 py-1 text-xs border border-slate-300 rounded" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="HSN / SAC"><input type="text" value={form.hsn_sac || ''} onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })} data-testid="sc-form-hsn" className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono" /></Field>
                <Field label="Price (INR) *"><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} data-testid="sc-form-price" className="w-full px-2 py-1 text-xs border border-slate-300 rounded tabular-nums text-right" /></Field>
              </div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <Field label="Taxable?">
                  <select value={form.is_taxable ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, is_taxable: e.target.value === 'yes' })} data-testid="sc-form-taxable" className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white">
                    <option value="no">No (Exempt)</option><option value="yes">Yes</option>
                  </select>
                </Field>
                <Field label="GST %"><input type="number" value={form.gst_rate} disabled={!form.is_taxable} onChange={(e) => setForm({ ...form, gst_rate: Number(e.target.value) })} data-testid="sc-form-gst" className="w-full px-2 py-1 text-xs border border-slate-300 rounded disabled:bg-slate-50 tabular-nums text-right" /></Field>
                <Field label="Price includes GST?">
                  <select value={form.gst_inclusive ? 'yes' : 'no'} disabled={!form.is_taxable} onChange={(e) => setForm({ ...form, gst_inclusive: e.target.value === 'yes' })} data-testid="sc-form-incl" className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-50">
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </Field>
              </div>
            </div>
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setForm(null)} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
              <button onClick={save} disabled={!form.name || !form.price} data-testid="sc-form-save"
                className="px-4 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <label className="block text-[9px] uppercase tracking-wider font-bold text-slate-500 mb-0.5">{label}</label>
    {children}
  </div>
);
