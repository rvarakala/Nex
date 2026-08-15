/**
 * Shared modal for adding a new hearing-aid serial into either the
 * SALEABLE or DEMO pool. Handles the Vendor vs Borrowed source split.
 *
 * Used by:
 *   - SaleableStockPage → "+ Add to Saleable Pool"
 *   - DemoStockPage      → "+ Add Demo Unit"
 *
 * Props:
 *   pool:      'saleable' | 'demo'  (drives label, colour, POST payload)
 *   onClose:   ()  => void
 *   onDone:    ()  => void  (fires after successful save)
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Truck } from 'lucide-react';
import ModalShell from '../../components/ModalShell';
import HASpecPicker from '../../components/HASpecPicker';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AddSerialModal({ pool = 'saleable', onClose, onDone }) {
  const isDemo = pool === 'demo';
  const accent = isDemo ? 'purple' : 'indigo';
  const heading = isDemo ? 'Add Demo Unit' : 'Add to Saleable Pool';
  const help = isDemo
    ? 'Flag a fresh unit straight into the demo pool. Never sold — used only for patient trials.'
    : 'Add a unit to the pool that can be dispensed to a patient.';
  const testidPrefix = isDemo ? 'ha-demoadd' : 'ha-saleable-add';

  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [productId, setProductId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [warrantyEnd, setWarrantyEnd] = useState('');
  const [sourceKind, setSourceKind] = useState('vendor');
  const [grnNo, setGrnNo] = useState('');
  const [borrowedFrom, setBorrowedFrom] = useState('');
  const [borrowReason, setBorrowReason] = useState('');
  const [spec, setSpec] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // Derive device family from the picked product's form_factor so
  // the picker shows the right power/length dropdowns without asking
  // the audiologist to re-pick the type.
  const pickedProduct = useMemo(
    () => products.find((p) => p.product_id === productId),
    [products, productId],
  );
  const deviceType = String(pickedProduct?.form_factor || '').toUpperCase();

  useEffect(() => {
    axios.get(`${API}/ha/products`).then((r) => setProducts(r.data || [])).catch(() => {});
    axios.get(`${API}/branches`).then((r) => {
      const list = r.data || [];
      setBranches(list);
      if (list[0]?.branch_id) setBranchId(list[0].branch_id);
    }).catch(() => {});
  }, []);

  const save = async () => {
    setErr('');
    if (!productId) { setErr('Pick a product from the catalogue'); return; }
    if (!serialNo.trim()) { setErr('Serial number is required'); return; }
    if (sourceKind === 'borrowed' && !borrowedFrom.trim()) {
      setErr('Borrowed units need a "Borrowed from" (source clinic)');
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/ha/products/${productId}/serials`, [{
        serial_no: serialNo.trim(),
        branch_id: branchId,
        pool,        // 'saleable' | 'demo'
        warranty_end_date: warrantyEnd || null,
        grn_no: sourceKind === 'vendor' ? (grnNo.trim() || null) : null,
        source_kind: sourceKind,
        borrowed_from: sourceKind === 'borrowed' ? borrowedFrom.trim() : null,
        borrow_reason: sourceKind === 'borrowed' ? (borrowReason.trim() || null) : null,
        // Device spec captured at intake — colour + power + wire/tube
        // length. Downstream flows (trial, fitting, invoice, PO
        // reconciliation) read this off the serial_item so we never
        // ask the audiologist to re-enter what's already known.
        spec: spec && Object.keys(spec).length ? spec : null,
      }]);
      onDone();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (Array.isArray(d) ? d[0]?.msg : 'Save failed'));
    } finally { setSaving(false); }
  };

  const btnPrimary = isDemo
    ? 'bg-purple-600 hover:bg-purple-700'
    : 'bg-indigo-600 hover:bg-indigo-700';
  const toggleActive = isDemo
    ? 'bg-purple-600 text-white border-purple-600'
    : 'bg-indigo-600 text-white border-indigo-600';
  const iconColor = isDemo ? 'text-purple-600' : 'text-indigo-600';

  return (
    <ModalShell onClose={onClose} cardClassName="max-w-lg w-full p-5" testid={`${testidPrefix}-modal`}>
      <h2 className="text-base font-bold mb-1 flex items-center gap-2">
        <Truck size={16} className={iconColor} /> {heading}
      </h2>
      <p className="text-[11px] text-slate-500 mb-3">{help}</p>

      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Product *</label>
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        data-testid={`${testidPrefix}-product`}
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-3"
      >
        <option value="">— pick a catalogue SKU —</option>
        {products.map((p) => (
          <option key={p.product_id} value={p.product_id}>
            {p.brand} · {p.model} ({p.form_factor})
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Serial No. *</label>
          <input
            value={serialNo}
            onChange={(e) => setSerialNo(e.target.value)}
            data-testid={`${testidPrefix}-serial`}
            placeholder="Manufacturer sticker"
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Branch</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          >
            {branches.map((b) => (
              <option key={b.branch_id} value={b.branch_id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Source</label>
        <div className="flex gap-2">
          {[['vendor', 'Vendor PO'], ['borrowed', 'Borrowed from another clinic']].map(([k, lab]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSourceKind(k)}
              data-testid={`${testidPrefix}-source-${k}`}
              className={`flex-1 px-3 py-1.5 text-[12px] font-semibold rounded border ${
                sourceKind === k ? toggleActive : 'bg-white text-slate-700 border-slate-300'
              }`}
            >{lab}</button>
          ))}
        </div>
      </div>

      {sourceKind === 'vendor' ? (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">GRN No.</label>
            <input
              value={grnNo}
              onChange={(e) => setGrnNo(e.target.value)}
              data-testid={`${testidPrefix}-grn`}
              placeholder="Optional"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Warranty end</label>
            <input
              type="date"
              value={warrantyEnd}
              onChange={(e) => setWarrantyEnd(e.target.value)}
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      ) : (
        <div className="mb-3 space-y-2 p-3 rounded border border-rose-200 bg-rose-50">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Borrowed from *</label>
            <input
              value={borrowedFrom}
              onChange={(e) => setBorrowedFrom(e.target.value)}
              data-testid={`${testidPrefix}-borrowed-from`}
              placeholder="e.g., ABC Speech & Hearing"
              className="w-full border border-rose-300 rounded px-2 py-1.5 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Reason (recommended)</label>
            <textarea
              value={borrowReason}
              onChange={(e) => setBorrowReason(e.target.value)}
              data-testid={`${testidPrefix}-borrow-reason`}
              placeholder="Why did we borrow this unit? (patient trial urgent, out of stock, etc.)"
              rows={2}
              className="w-full border border-rose-300 rounded px-2 py-1.5 text-sm bg-white"
            />
          </div>
        </div>
      )}

      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-2">{err}</div>}

      {/* Device spec — colour + power + wire/tube length. Fields shown
          adapt to the picked product's form factor. */}
      {productId && (
        <div className="mb-3 p-3 rounded border border-slate-200 bg-slate-50">
          <HASpecPicker
            deviceType={deviceType}
            side="R"                /* single-unit intake — side is
                                       recorded at fitting time */
            value={spec}
            onChange={setSpec}
            testIdPrefix={`${testidPrefix}-spec`}
            title="Device specification (at intake)"
            compact
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={saving}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
        <button
          onClick={save}
          disabled={saving}
          data-testid={`${testidPrefix}-save`}
          className={`px-4 py-1.5 text-xs font-semibold text-white rounded disabled:opacity-50 ${btnPrimary}`}
        >{saving ? 'Saving…' : (isDemo ? 'Add to Demo Pool' : 'Add to pool')}</button>
      </div>
    </ModalShell>
  );
}
