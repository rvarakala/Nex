import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const PO_STATUS_STYLES = {
  draft:            'bg-slate-100 text-slate-600',
  approved:         'bg-amber-100 text-amber-800',
  ordered:          'bg-blue-100 text-blue-800',
  partial_received: 'bg-purple-100 text-purple-800',
  received:         'bg-emerald-100 text-emerald-800',
  closed:           'bg-slate-200 text-slate-700',
  cancelled:        'bg-rose-100 text-rose-800 line-through',
};

export default function ProcurementPage() {
  const [pos, setPos] = useState([]);
  const [open, setOpen] = useState(null);   // po_no
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const r = await axios.get(`${API}/ha/purchase-orders`);
    setPos(r.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-5" data-testid="ha-procurement-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Procurement</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Purchase orders → goods receipts. Posting a GRN auto-spawns serial items &amp; updates stock.</p>
        </div>
        <button
          data-testid="ha-po-new"
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm"
        >+ New PO</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">PO No</th>
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pos.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-slate-400 italic text-xs">No purchase orders yet.</td></tr>
            )}
            {pos.map(po => (
              <tr key={po.po_no} className="border-t border-slate-100 hover:bg-slate-50/50" data-testid={`ha-po-row-${po.po_no}`}>
                <td className="px-3 py-2 font-mono text-xs font-bold">{po.po_no}</td>
                <td className="px-3 py-2">{po.vendor_name || po.vendor_id}</td>
                <td className="px-3 py-2 text-right tabular-nums">{po.lines?.length || 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(po.total)}</td>
                <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PO_STATUS_STYLES[po.status] || 'bg-slate-100'}`}>{po.status.replace('_',' ').toUpperCase()}</span></td>
                <td className="px-3 py-2 text-[10px] text-slate-500">{po.created_at ? new Date(po.created_at).toLocaleDateString('en-IN') : ''}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setOpen(po.po_no)} data-testid={`ha-po-open-${po.po_no}`} className="text-[10px] text-indigo-600 font-semibold hover:underline">Open →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <CreatePOModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      {open && <PODetailDrawer poNo={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function CreatePOModal({ onClose, onCreated }) {
  const [branches, setBranches] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [branch, setBranch] = useState('');
  const [vendor, setVendor] = useState('');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState([{ _key: Math.random().toString(36).slice(2), product_id: '', qty: 1, unit_cost: 0, gst_rate: 18 }]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [b, v, p] = await Promise.all([
        axios.get(`${API}/branches`),
        axios.get(`${API}/vendors?active=true`),
        axios.get(`${API}/ha/products?active=true`),
      ]);
      setBranches(b.data);
      setVendors(v.data);
      setProducts(p.data);
      if (b.data[0]) setBranch(b.data[0].branch_id);
      if (v.data[0]) setVendor(v.data[0].vendor_id);
    })();
  }, []);

  const total = lines.reduce((a, l) => a + l.qty * l.unit_cost * (1 + l.gst_rate / 100), 0);

  const submit = async () => {
    setErr('');
    try {
      const body = {
        branch_id: branch,
        vendor_id: vendor,
        expected_date: expected || null,
        lines: lines.filter(l => l.product_id && l.qty > 0),
      };
      if (!body.lines.length) { setErr('Add at least one line'); return; }
      await axios.post(`${API}/ha/purchase-orders`, body);
      onCreated();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-po-new-modal">
        <h2 className="text-lg font-bold mb-4">New Purchase Order</h2>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <div className="grid grid-cols-3 gap-3 mb-4">
          <Field label="Branch *">
            <select value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="ha-po-branch" className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Vendor *">
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid="ha-po-vendor" className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
              {vendors.length === 0 && <option value="">— no vendors — create one first —</option>}
              {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Expected Date">
            <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </Field>
        </div>

        <div className="border border-slate-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left">Product</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Unit Cost</th>
                <th className="px-2 py-1 text-right">GST %</th>
                <th className="px-2 py-1 text-right">Line Total</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l._key || `PO-${i}`} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <select value={l.product_id} onChange={(e) => {
                      const copy = [...lines];
                      copy[i] = { ...copy[i], product_id: e.target.value };
                      const p = products.find(pp => pp.product_id === e.target.value);
                      if (p) { copy[i].unit_cost = p.cost; copy[i].gst_rate = p.gst_rate; }
                      setLines(copy);
                    }} data-testid={`ha-po-line-${i}-prod`} className="w-full border border-slate-300 rounded px-1 py-0.5 text-xs">
                      <option value="">—</option>
                      {products.map(p => <option key={p.product_id} value={p.product_id}>{p.brand} {p.model}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1 text-right"><input type="number" min={1} value={l.qty} onChange={(e) => { const c=[...lines]; c[i]={...c[i],qty:Number(e.target.value)}; setLines(c); }} data-testid={`ha-po-line-${i}-qty`} className="w-16 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></td>
                  <td className="px-2 py-1 text-right"><input type="number" value={l.unit_cost} onChange={(e) => { const c=[...lines]; c[i]={...c[i],unit_cost:Number(e.target.value)}; setLines(c); }} className="w-24 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></td>
                  <td className="px-2 py-1 text-right"><input type="number" value={l.gst_rate} onChange={(e) => { const c=[...lines]; c[i]={...c[i],gst_rate:Number(e.target.value)}; setLines(c); }} className="w-12 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></td>
                  <td className="px-2 py-1 text-right tabular-nums text-xs">{fmtINR(l.qty * l.unit_cost * (1 + l.gst_rate / 100))}</td>
                  <td className="px-2 py-1 text-right">
                    {lines.length > 1 && <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-rose-500 hover:text-rose-700 text-xs">×</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3">
          <button onClick={() => setLines([...lines, { _key: Math.random().toString(36).slice(2), product_id: '', qty: 1, unit_cost: 0, gst_rate: 18 }])} data-testid="ha-po-add-line" className="text-xs text-indigo-600 font-semibold hover:underline">+ Add line</button>
          <div className="text-sm"><span className="text-slate-500 mr-2">Total (incl GST):</span><span className="font-bold tabular-nums">{fmtINR(total)}</span></div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} data-testid="ha-po-save" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded">Create PO</button>
        </div>
      </div>
    </div>
  );
}

function PODetailDrawer({ poNo, onClose, onChanged }) {
  const [po, setPO] = useState(null);
  const [products, setProducts] = useState({});
  const [grnOpen, setGrnOpen] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [poData, prods] = await Promise.all([
      axios.get(`${API}/ha/purchase-orders/${poNo}`),
      axios.get(`${API}/ha/products`),
    ]);
    setPO(poData.data);
    setProducts(Object.fromEntries(prods.data.map(p => [p.product_id, p])));
  }, [poNo]);

  useEffect(() => { load(); }, [load]);

  const transition = async (to_status) => {
    setErr('');
    try {
      await axios.post(`${API}/ha/purchase-orders/${poNo}/status`, { to_status });
      await load();
      onChanged && onChanged();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Action failed');
    }
  };

  if (!po) return null;
  const NEXT_ACTIONS = {
    draft: [{ to: 'approved', label: 'Approve', style: 'bg-amber-500' }, { to: 'cancelled', label: 'Cancel', style: 'bg-slate-500' }],
    approved: [{ to: 'ordered', label: 'Mark Ordered', style: 'bg-blue-600' }, { to: 'cancelled', label: 'Cancel', style: 'bg-slate-500' }],
    ordered: [],
    partial_received: [{ to: 'closed', label: 'Close (waive remainder)', style: 'bg-slate-700' }],
    received: [{ to: 'closed', label: 'Close PO', style: 'bg-emerald-600' }],
    closed: [],
    cancelled: [],
  };
  const canReceive = ['approved', 'ordered', 'partial_received'].includes(po.status);

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="ha-po-detail-drawer">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-2xl bg-white shadow-2xl flex flex-col">
        <div className="border-b border-slate-200 p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Purchase Order</div>
            <div className="text-lg font-bold font-mono">{po.po_no}</div>
            <div className="text-[11px] text-slate-500">{po.vendor_name} · <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PO_STATUS_STYLES[po.status]}`}>{po.status.replace('_',' ').toUpperCase()}</span></div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 text-2xl leading-none" data-testid="ha-po-close">×</button>
        </div>

        {err && <div className="mx-4 mt-3 text-xs text-rose-700 bg-rose-50 rounded p-2">{err}</div>}

        <div className="p-4 space-y-3">
          <div className="bg-slate-50 rounded p-3 text-sm">
            <table className="w-full">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="text-left pb-1">Product</th><th className="text-right pb-1">Qty</th><th className="text-right pb-1">Unit</th><th className="text-right pb-1">GST</th><th className="text-right pb-1">Total</th></tr>
              </thead>
              <tbody>
                {po.lines.map((ln, i) => {
                  const p = products[ln.product_id];
                  return (
                    <tr key={`${ln.product_id || 'p'}-${i}`} className="border-t border-slate-200">
                      <td className="py-1">{p ? `${p.brand} ${p.model}` : ln.product_id}</td>
                      <td className="py-1 text-right tabular-nums">{ln.qty}</td>
                      <td className="py-1 text-right tabular-nums">{fmtINR(ln.unit_cost)}</td>
                      <td className="py-1 text-right tabular-nums">{ln.gst_rate}%</td>
                      <td className="py-1 text-right tabular-nums">{fmtINR(ln.qty * ln.unit_cost * (1 + ln.gst_rate / 100))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300 font-bold"><td colSpan={4} className="py-2 text-right">Total</td><td className="py-2 text-right tabular-nums">{fmtINR(po.total)}</td></tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(NEXT_ACTIONS[po.status] || []).map(a => (
              <button
                key={a.to}
                onClick={() => transition(a.to)}
                data-testid={`ha-po-trans-${a.to}`}
                className={`px-3 py-1.5 text-xs font-semibold text-white rounded ${a.style} hover:opacity-90`}
              >{a.label}</button>
            ))}
            {canReceive && (
              <button onClick={() => setGrnOpen(true)} data-testid="ha-po-receive" className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow">Receive Goods (GRN)</button>
            )}
          </div>
        </div>

        {grnOpen && <GRNModal po={po} products={products} onClose={() => setGrnOpen(false)} onSaved={() => { setGrnOpen(false); load(); onChanged && onChanged(); }} />}
      </aside>
    </div>
  );
}

function GRNModal({ po, products, onClose, onSaved }) {
  const [lines, setLines] = useState(
    po.lines.map(ln => {
      const p = products[ln.product_id] || {};
      return {
        product_id: ln.product_id,
        qty_received: ln.qty,
        serial_nos: p.is_serialised ? Array(ln.qty).fill('') : [],
        is_serialised: p.is_serialised,
        label: p ? `${p.brand} ${p.model}` : ln.product_id,
      };
    })
  );
  const [invRef, setInvRef] = useState('');
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    try {
      // Validate: serialised lines need exactly qty_received serials, all non-empty
      for (const ln of lines) {
        if (ln.is_serialised) {
          const clean = ln.serial_nos.filter(s => s.trim());
          if (clean.length !== ln.qty_received) {
            setErr(`Provide ${ln.qty_received} serial number(s) for ${ln.label}`);
            return;
          }
        }
      }
      const body = {
        po_no: po.po_no,
        vendor_invoice_ref: invRef || null,
        lines: lines.map(l => ({
          product_id: l.product_id,
          qty_received: l.qty_received,
          serial_nos: l.is_serialised ? l.serial_nos.map(s => s.trim()).filter(Boolean) : [],
        })),
      };
      await axios.post(`${API}/ha/grns`, body);
      onSaved();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'GRN submission failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-grn-modal">
        <h2 className="text-lg font-bold mb-1">Receive Goods — {po.po_no}</h2>
        <p className="text-[11px] text-slate-500 mb-3">Posting will spawn a serial item per scanned serial (IN_STOCK) and add to accessory stock. This action is logged.</p>

        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <label className="block mb-3">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Vendor Invoice Ref (optional)</span>
          <input value={invRef} onChange={(e) => setInvRef(e.target.value)} data-testid="ha-grn-inv-ref" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
        </label>

        <div className="space-y-4">
          {lines.map((ln, i) => (
            <div key={`${ln.product_id || 'grn'}-${i}`} className="border border-slate-200 rounded-md p-3" data-testid={`ha-grn-line-${i}`}>
              <div className="flex items-center justify-between mb-2">
                <div><span className="font-semibold">{ln.label}</span>{ln.is_serialised && <span className="text-[10px] ml-2 bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-semibold">SERIALISED</span>}</div>
                <div className="text-xs">Qty received: <input type="number" min={0} value={ln.qty_received} onChange={(e) => {
                  const copy = [...lines];
                  const q = Number(e.target.value);
                  copy[i] = { ...copy[i], qty_received: q };
                  if (copy[i].is_serialised) copy[i].serial_nos = Array(q).fill('').map((_, k) => copy[i].serial_nos[k] || '');
                  setLines(copy);
                }} data-testid={`ha-grn-line-${i}-qty`} className="ml-2 w-20 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></div>
              </div>
              {ln.is_serialised && ln.qty_received > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {ln.serial_nos.map((sn, j) => (
                    <input
                      key={`${ln.product_id || 'p'}-${i}-${j}`}
                      value={sn}
                      onChange={(e) => {
                        const copy = [...lines];
                        const sns = [...copy[i].serial_nos];
                        sns[j] = e.target.value;
                        copy[i] = { ...copy[i], serial_nos: sns };
                        setLines(copy);
                      }}
                      placeholder={`Serial #${j + 1}`}
                      data-testid={`ha-grn-line-${i}-serial-${j}`}
                      className="border border-slate-300 rounded px-2 py-1 text-xs font-mono"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} data-testid="ha-grn-save" className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow">Post GRN &amp; Receive Stock</button>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">{label}</span>
    {children}
  </label>
);
