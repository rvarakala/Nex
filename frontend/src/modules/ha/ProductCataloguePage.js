import React, { useEffect, useState } from 'react';
import axios from 'axios';
import ModalShell from '../../components/ModalShell';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const FORM_FACTORS = ['RIC', 'BTE', 'ITE', 'ITC', 'CIC', 'IIC', 'accessory'];
const TECH_TIERS = ['essential', 'standard', 'advanced', 'premium'];
const SERIAL_POOLS = ['saleable', 'demo', 'loaner', 'refurbished'];

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function ProductCataloguePage() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [formFactor, setFormFactor] = useState('');
  const [showForm, setShowForm] = useState(null); // null | 'new' | product_id

  const load = async () => {
    const params = {};
    if (search) params.search = search;
    if (formFactor) params.form_factor = formFactor;
    const r = await axios.get(`${API}/ha/products`, { params });
    setRows(r.data);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [search, formFactor]);

  return (
    <div className="p-5" data-testid="ha-products-page">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Product Catalogue</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Brand / model master. Inventory lives per branch on SerialItem & AccessoryStock.</p>
        </div>
        <button
          data-testid="ha-product-new"
          onClick={() => setShowForm('new')}
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm"
        >+ New Product</button>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          placeholder="Search brand / model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="ha-products-search"
          className="flex-1 max-w-md bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm"
        />
        <select
          value={formFactor}
          onChange={(e) => setFormFactor(e.target.value)}
          data-testid="ha-products-form-factor-filter"
          className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm"
        >
          <option value="">All form factors</option>
          {FORM_FACTORS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Brand</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Form</th>
              <th className="px-3 py-2 text-left">Tier</th>
              <th className="px-3 py-2 text-right">MRP</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">Min Sell</th>
              <th className="px-3 py-2 text-right">Wty (m)</th>
              <th className="px-3 py-2 text-center">Serialised</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-8 text-center text-slate-400 italic text-xs">No products yet. Click + New Product to add your first SKU.</td></tr>
            )}
            {rows.map(p => (
              <tr key={p.product_id} className={`border-t border-slate-100 ${!p.active ? 'opacity-50' : ''}`} data-testid={`ha-product-row-${p.product_id}`}>
                <td className="px-3 py-2 font-semibold">{p.brand}</td>
                <td className="px-3 py-2">{p.model}</td>
                <td className="px-3 py-2 text-xs"><span className="bg-slate-100 rounded px-1.5 py-0.5">{p.form_factor}</span></td>
                <td className="px-3 py-2 text-xs capitalize">{p.tech_tier || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(p.mrp)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtINR(p.cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtINR(p.min_sell_price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.warranty_months}</td>
                <td className="px-3 py-2 text-center">{p.is_serialised ? '✓' : '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setShowForm(p.product_id)}
                    data-testid={`ha-product-edit-${p.product_id}`}
                    className="text-[10px] text-indigo-600 font-semibold hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ProductForm
          productId={showForm === 'new' ? null : showForm}
          onClose={() => setShowForm(null)}
          onSaved={() => { setShowForm(null); load(); }}
        />
      )}
    </div>
  );
}

function ProductForm({ productId, onClose, onSaved }) {
  const [f, setF] = useState({
    brand: '', model: '', form_factor: 'RIC', tech_tier: '',
    warranty_months: 24, mrp: 0, cost: 0, min_sell_price: 0,
    hsn: '9021', gst_rate: 18, is_serialised: true, connectivity: [],
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState([]);
  const [existingSerials, setExistingSerials] = useState([]);
  const [newSerials, setNewSerials] = useState([]); // [{serial_no, branch_id, pool, warranty_end_date, grn_no}]

  useEffect(() => {
    axios.get(`${API}/branches`).then((r) => setBranches(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!productId) return;
    axios.get(`${API}/ha/products/${productId}`).then(r => setF(r.data));
    axios.get(`${API}/ha/products/${productId}/serials`)
      .then((r) => setExistingSerials(r.data || []))
      .catch(() => setExistingSerials([]));
  }, [productId]);

  const defaultBranchId = branches[0]?.branch_id || '';

  const addSerialRow = () => {
    setNewSerials((s) => [
      ...s,
      { _k: Math.random().toString(36).slice(2),
        serial_no: '', branch_id: defaultBranchId, pool: 'saleable',
        warranty_end_date: '', grn_no: '' },
    ]);
  };
  const updateSerialRow = (k, patch) => {
    setNewSerials((s) => s.map((r) => (r._k === k ? { ...r, ...patch } : r)));
  };
  const removeSerialRow = (k) => {
    setNewSerials((s) => s.filter((r) => r._k !== k));
  };

  const save = async () => {
    setErr(''); setSaving(true);
    try {
      const body = { ...f, tech_tier: f.tech_tier || null };
      let pid = productId;
      if (productId) {
        await axios.put(`${API}/ha/products/${productId}`, body);
      } else {
        const r = await axios.post(`${API}/ha/products`, body);
        pid = r.data?.product_id;
      }
      // Upload any serials the user typed in (only for serialised products).
      const cleanSerials = newSerials
        .filter((r) => r.serial_no.trim())
        .map((r) => ({
          serial_no: r.serial_no.trim(),
          branch_id: r.branch_id || defaultBranchId,
          pool: r.pool,
          warranty_end_date: r.warranty_end_date || null,
          grn_no: r.grn_no || null,
        }));
      if (f.is_serialised && pid && cleanSerials.length > 0) {
        await axios.post(`${API}/ha/products/${pid}/serials`, cleanSerials);
      }
      onSaved();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : JSON.stringify(d) || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      cardClassName="max-w-2xl w-full p-5 max-h-[92vh] overflow-auto"
      testid="ha-product-form-modal"
    >
      <h2 className="text-lg font-bold mb-4">{productId ? 'Edit Product' : 'New Product'}</h2>
      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Brand *"><input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} data-testid="ha-pf-brand" className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="Model *"><input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} data-testid="ha-pf-model" className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="Form Factor">
          <select value={f.form_factor} onChange={(e) => setF({ ...f, form_factor: e.target.value })} data-testid="ha-pf-formfactor" className="w-full border border-slate-300 rounded px-2 py-1">
            {FORM_FACTORS.map(ff => <option key={ff} value={ff}>{ff}</option>)}
          </select>
        </Field>
        <Field label="Tech Tier">
          <select value={f.tech_tier || ''} onChange={(e) => setF({ ...f, tech_tier: e.target.value })} data-testid="ha-pf-tier" className="w-full border border-slate-300 rounded px-2 py-1">
            <option value="">—</option>
            {TECH_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="MRP (₹)"><input type="number" value={f.mrp} onChange={(e) => setF({ ...f, mrp: Number(e.target.value) })} data-testid="ha-pf-mrp" className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="Cost (₹)"><input type="number" value={f.cost} onChange={(e) => setF({ ...f, cost: Number(e.target.value) })} data-testid="ha-pf-cost" className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="Min Sell Price (₹)"><input type="number" value={f.min_sell_price} onChange={(e) => setF({ ...f, min_sell_price: Number(e.target.value) })} data-testid="ha-pf-min" className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="Warranty (months)"><input type="number" value={f.warranty_months} onChange={(e) => setF({ ...f, warranty_months: Number(e.target.value) })} data-testid="ha-pf-wty" className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="HSN"><input value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="GST %"><input type="number" value={f.gst_rate} onChange={(e) => setF({ ...f, gst_rate: Number(e.target.value) })} className="w-full border border-slate-300 rounded px-2 py-1" /></Field>
        <Field label="Serialised?" className="col-span-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.is_serialised} onChange={(e) => setF({ ...f, is_serialised: e.target.checked })} data-testid="ha-pf-serialised" />
            <span>Track each physical unit by serial number (uncheck for accessories / batteries)</span>
          </label>
        </Field>
      </div>

      {/* ====== Serial Numbers inline editor ====== */}
      {f.is_serialised && (
        <div className="mt-5 border-t border-slate-200 pt-4" data-testid="ha-pf-serials-section">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs font-bold text-slate-800">Serial Numbers</div>
              <div className="text-[10px] text-slate-500">
                Add physical units as they arrive (manufacturer sticker = serial no). Each row is tracked in Inventory Board.
              </div>
            </div>
            <button
              type="button"
              onClick={addSerialRow}
              data-testid="ha-pf-serial-add"
              className="text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded"
            >+ Add Serial</button>
          </div>

          {existingSerials.length > 0 && (
            <div className="mb-2 bg-slate-50 border border-slate-200 rounded p-2 text-[11px]">
              <div className="font-semibold text-slate-600 mb-1">Existing units on file ({existingSerials.length}):</div>
              <div className="flex flex-wrap gap-1">
                {existingSerials.slice(0, 20).map((s) => (
                  <span key={s.serial_id} className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded px-1.5 py-0.5 font-mono" data-testid={`ha-pf-existing-${s.serial_id}`}>
                    {s.serial_no}
                    <span className={`text-[9px] px-1 rounded ${s.pool === 'demo' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                      {s.pool}
                    </span>
                    <span className={`text-[9px] px-1 rounded ${s.state === 'IN_STOCK' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {s.state}
                    </span>
                  </span>
                ))}
                {existingSerials.length > 20 && <span className="text-slate-500">+{existingSerials.length - 20} more</span>}
              </div>
            </div>
          )}

          {newSerials.length === 0 ? (
            <div className="text-[11px] italic text-slate-400 py-2">
              No new serials queued. Click <b>+ Add Serial</b> to register physical units.
            </div>
          ) : (
            <div className="space-y-1.5">
              {newSerials.map((r, i) => (
                <div key={r._k} className="grid grid-cols-[1.3fr_1.3fr_0.9fr_1fr_0.9fr_auto] gap-1.5 items-center text-xs" data-testid={`ha-pf-serial-row-${i}`}>
                  <input
                    placeholder="Serial No *"
                    value={r.serial_no}
                    onChange={(e) => updateSerialRow(r._k, { serial_no: e.target.value })}
                    data-testid={`ha-pf-serial-no-${i}`}
                    className="border border-slate-300 rounded px-2 py-1 font-mono"
                  />
                  <select
                    value={r.branch_id}
                    onChange={(e) => updateSerialRow(r._k, { branch_id: e.target.value })}
                    data-testid={`ha-pf-serial-branch-${i}`}
                    className="border border-slate-300 rounded px-1 py-1"
                  >
                    {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
                  </select>
                  <select
                    value={r.pool}
                    onChange={(e) => updateSerialRow(r._k, { pool: e.target.value })}
                    data-testid={`ha-pf-serial-pool-${i}`}
                    className="border border-slate-300 rounded px-1 py-1 capitalize"
                    title="Demo = trial-only unit, saleable = sellable"
                  >
                    {SERIAL_POOLS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input
                    type="date"
                    placeholder="Warranty end"
                    value={r.warranty_end_date}
                    onChange={(e) => updateSerialRow(r._k, { warranty_end_date: e.target.value })}
                    className="border border-slate-300 rounded px-1 py-1"
                  />
                  <input
                    placeholder="GRN #"
                    value={r.grn_no}
                    onChange={(e) => updateSerialRow(r._k, { grn_no: e.target.value })}
                    className="border border-slate-300 rounded px-2 py-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeSerialRow(r._k)}
                    data-testid={`ha-pf-serial-remove-${i}`}
                    className="text-rose-500 font-bold text-lg leading-none px-1"
                    title="Remove row"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-slate-200">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
        <button
          onClick={save}
          disabled={saving}
          data-testid="ha-pf-save"
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded"
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </ModalShell>
  );
}

const Field = ({ label, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">{label}</span>
    {children}
  </label>
);
