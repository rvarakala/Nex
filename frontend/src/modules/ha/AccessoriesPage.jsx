/**
 * AccessoriesPage — Inventory → Accessories tab.
 *
 * Two flavours of accessory live under one screen:
 *   • Serialised (chargers, FM Roger receiver/transmitter, external mics) —
 *     tracked per physical unit, reuses the SerialItem lifecycle.
 *   • Non-serialised / batch (batteries, tips, tubes, domes, wax guards,
 *     RIC receivers by size × power) — tracked as qty per (SKU, branch,
 *     variant) via `accessory_stock` rows.
 *
 * The user's mental model (from the product ask):
 *   > "How can we express accessories … some carry serial numbers,
 *      some don't; and RIC receivers are categorised by power & size
 *      like 2M / 3P / 1S."
 *
 * We solve it with THREE sub-tabs on this page:
 *   1. Catalogue      — every accessory SKU (both serialised + batch)
 *   2. Batch Stock    — per-branch qty grid with +/- adjust buttons
 *   3. Serialised     — SerialItem list filtered to accessory form_factor
 */

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Package, Boxes, AlertTriangle, CheckCircle2, Search, X,
} from 'lucide-react';
import ModalShell from '../../components/ModalShell';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ---- Taxonomy: mirrors backend constants -------------------------------
const ACCESSORY_KINDS = [
  { value: 'charger',         label: 'Charger',           serial: true  },
  { value: 'fm_receiver',     label: 'FM Receiver (Roger)', serial: true  },
  { value: 'fm_transmitter',  label: 'FM Transmitter',    serial: true  },
  { value: 'external_mic',    label: 'External Mic',      serial: true  },
  { value: 'battery',         label: 'Battery',           serial: false },
  { value: 'tip',             label: 'Tip / Dome',        serial: false },
  { value: 'tube',            label: 'Tube',              serial: false },
  { value: 'pin',             label: 'Pin',               serial: false },
  { value: 'wire',            label: 'Wire',              serial: false },
  { value: 'coil',            label: 'Coil',              serial: false },
  { value: 'ear_mold',        label: 'Ear Mould',         serial: false },
  { value: 'ric_receiver',    label: 'RIC Receiver',      serial: false },
  { value: 'wax_guard',       label: 'Wax Guard',         serial: false },
  { value: 'other',           label: 'Other Accessory',   serial: false },
];
const CATEGORIES = [
  { value: 'consumable',  label: 'Consumable',  color: 'bg-amber-100 text-amber-800' },
  { value: 'addon',       label: 'Add-on',      color: 'bg-indigo-100 text-indigo-800' },
  { value: 'replaceable', label: 'Replaceable', color: 'bg-emerald-100 text-emerald-800' },
];

const kindLabel = (k) => ACCESSORY_KINDS.find((x) => x.value === k)?.label || k || '—';
const catBadge = (c) => CATEGORIES.find((x) => x.value === c);

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/* ============================================================
 *   MAIN PAGE
 * ============================================================ */
export default function AccessoriesPage() {
  const [tab, setTab] = useState('catalogue'); // catalogue | batch | serialised
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');

  useEffect(() => {
    axios.get(`${API}/branches`).then((r) => {
      const bs = Array.isArray(r.data) ? r.data : [];
      setBranches(bs);
      setSelectedBranch(bs[0]?.branch_id || '');
    }).catch(() => setBranches([]));
  }, []);

  return (
    <div className="p-5 space-y-4" data-testid="ha-accessories-page">
      <header>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Package size={20} className="text-indigo-600" />
          Accessories
        </h1>
        <p className="text-[11.5px] text-slate-500 mt-0.5">
          Chargers, FM systems, batteries, tips, tubes, coils, ear moulds, RIC receivers.
          Some carry serial numbers (chargers, FM units); others are tracked by quantity.
        </p>
      </header>

      {/* Sub-tab strip */}
      <div className="border-b border-slate-200 flex items-center gap-1">
        {[
          { id: 'catalogue',  label: 'Catalogue',      testid: 'acc-subtab-catalogue' },
          { id: 'batch',      label: 'Batch Stock',    testid: 'acc-subtab-batch' },
          { id: 'serialised', label: 'Serialised',     testid: 'acc-subtab-serialised' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={t.testid}
            className={`px-4 py-2 text-[12px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'catalogue'  && <CatalogueTab   branches={branches} />}
      {tab === 'batch'      && (
        <BatchStockTab
          branches={branches}
          selectedBranch={selectedBranch}
          setSelectedBranch={setSelectedBranch}
        />
      )}
      {tab === 'serialised' && <SerialisedTab branches={branches} />}
    </div>
  );
}

/* ============================================================
 *   TAB 1 — CATALOGUE
 * ============================================================ */
function CatalogueTab({ branches }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [presetKey, setPresetKey] = useState(null); // 'ric_receiver' | 'silicone_dome' | null

  const load = useCallback(async () => {
    // Every SKU with form_factor="accessory" (both serialised & batch).
    // Only active — soft-deleted rows stay in DB for history but don't clutter the UI.
    try {
      const r = await axios.get(`${API}/ha/products`, {
        params: { form_factor: 'accessory', active: true, ...(search ? { search } : {}) },
      });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch {
      setRows([]);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px] max-w-md relative">
          <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
          <input
            placeholder="Search brand or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="acc-catalogue-search"
            className="w-full bg-white border border-slate-300 rounded-md pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="acc-catalogue-preset-domes"
            onClick={() => setPresetKey('silicone_dome')}
            className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md"
          >⚡ Quick-add Domes (S·M·L·Power)</button>
          <button
            data-testid="acc-catalogue-preset-ric"
            onClick={() => setPresetKey('ric_receiver')}
            className="px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md"
          >⚡ Quick-add RIC Receivers</button>
          <button
            data-testid="acc-catalogue-new"
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm"
          >+ New Accessory</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Brand · Model</th>
              <th className="text-left px-3 py-2 font-semibold">Kind</th>
              <th className="text-left px-3 py-2 font-semibold">Category</th>
              <th className="text-left px-3 py-2 font-semibold">Tracking</th>
              <th className="text-left px-3 py-2 font-semibold">Variants</th>
              <th className="text-right px-3 py-2 font-semibold">MRP</th>
              <th className="text-right px-3 py-2 font-semibold">GST</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-400 italic text-sm">
                  No accessories yet. Click <b>+ New Accessory</b> above, or use the quick-add RIC Receivers preset.
                </td>
              </tr>
            )}
            {rows.map((p) => {
              const cat = catBadge(p.accessory_category);
              return (
                <tr key={p.product_id} data-testid={`acc-row-${p.product_id}`}
                    className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{p.brand}</div>
                    <div className="text-[11.5px] text-slate-500">{p.model}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700 text-[13px]">{kindLabel(p.accessory_kind)}</td>
                  <td className="px-3 py-2">
                    {cat && (
                      <span className={`inline-block text-[10.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${cat.color}`}>
                        {cat.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {p.is_serialised ? (
                      <span className="inline-flex items-center gap-1 text-indigo-700 font-semibold">
                        <Boxes size={11} /> Serialised
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-600 font-semibold">
                        <Package size={11} /> Batch qty
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-slate-600">
                    {(p.variant_labels || []).length === 0
                      ? <span className="italic text-slate-400">—</span>
                      : (p.variant_labels || []).join(' · ')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800">{fmtINR(p.mrp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.gst_rate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <NewAccessoryModal
          branches={branches}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
      {presetKey && (
        <PresetSeedModal
          presetKey={presetKey}
          branches={branches}
          onClose={() => setPresetKey(null)}
          onSaved={() => { setPresetKey(null); load(); }}
        />
      )}
    </div>
  );
}

/* ============================================================
 *   NEW ACCESSORY MODAL
 * ============================================================ */
function NewAccessoryModal({ branches, onClose, onSaved }) {
  const [f, setF] = useState({
    brand: '', model: '',
    accessory_kind: 'battery',
    accessory_category: 'consumable',
    is_serialised: false,
    mrp: '', gst_rate: 18, hsn: '9021',
    variant_labels: [],
    branch_ids: branches.map((b) => b.branch_id),
    reorder_level: 5,
  });
  const [variantInput, setVariantInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Kind change auto-toggles serialisation default
  const setKind = (kind) => {
    const defaults = ACCESSORY_KINDS.find((x) => x.value === kind);
    setF((prev) => ({
      ...prev,
      accessory_kind: kind,
      is_serialised: defaults ? defaults.serial : prev.is_serialised,
      // Sensible category defaults per kind (fully overridable)
      accessory_category:
        kind === 'battery' || kind === 'tip' || kind === 'wax_guard' || kind === 'tube'
          ? 'consumable'
          : ['charger', 'fm_receiver', 'fm_transmitter', 'external_mic'].includes(kind)
            ? 'addon'
            : 'replaceable',
    }));
  };

  const addVariant = () => {
    const v = variantInput.trim();
    if (!v) return;
    if (f.variant_labels.includes(v)) return;
    setF((prev) => ({ ...prev, variant_labels: [...prev.variant_labels, v] }));
    setVariantInput('');
  };
  const removeVariant = (v) =>
    setF((prev) => ({ ...prev, variant_labels: prev.variant_labels.filter((x) => x !== v) }));

  const save = async () => {
    setErr('');
    if (!f.brand.trim() || !f.model.trim()) {
      setErr('Brand and Model are required'); return;
    }
    if (f.branch_ids.length === 0) {
      setErr('Pick at least one branch (needed to init stock)'); return;
    }
    setSaving(true);
    try {
      // 1) Create the product SKU
      const payload = {
        brand: f.brand.trim(),
        model: f.model.trim(),
        form_factor: 'accessory',
        is_serialised: f.is_serialised,
        mrp: Number(f.mrp || 0),
        gst_rate: Number(f.gst_rate || 0),
        hsn: f.hsn || '9021',
        accessory_kind: f.accessory_kind,
        accessory_category: f.accessory_category,
        variant_labels: f.is_serialised ? [] : f.variant_labels,
      };
      const rp = await axios.post(`${API}/ha/products`, payload);
      const productId = rp.data?.product_id;
      // 2) Init stock rows (only meaningful for non-serialised batch items)
      if (!f.is_serialised && productId) {
        await axios.post(`${API}/ha/products/${productId}/init-accessory-stock`, {
          branch_ids: f.branch_ids,
          variants: f.variant_labels,
          reorder_level: Number(f.reorder_level || 0),
        });
      }
      onSaved();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="New Accessory" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {err && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={13} /> {err}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand *">
            <input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}
                   data-testid="acc-new-brand" className={inp} placeholder="Phonak" />
          </Field>
          <Field label="Model / Name *">
            <input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}
                   data-testid="acc-new-model" className={inp} placeholder="e.g., 312 Zinc-Air" />
          </Field>

          <Field label="Kind *">
            <select value={f.accessory_kind} onChange={(e) => setKind(e.target.value)}
                    data-testid="acc-new-kind" className={inp}>
              {ACCESSORY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Category *">
            <select value={f.accessory_category}
                    onChange={(e) => setF({ ...f, accessory_category: e.target.value })}
                    data-testid="acc-new-category" className={inp}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Field label="MRP (₹)">
            <input type="number" value={f.mrp} onChange={(e) => setF({ ...f, mrp: e.target.value })}
                   data-testid="acc-new-mrp" className={inp} />
          </Field>
          <Field label="GST %">
            <input type="number" value={f.gst_rate}
                   onChange={(e) => setF({ ...f, gst_rate: e.target.value })}
                   data-testid="acc-new-gst" className={inp} />
          </Field>
        </div>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.is_serialised}
              onChange={(e) => setF({ ...f, is_serialised: e.target.checked })}
              data-testid="acc-new-serialised"
            />
            <span className="text-sm font-semibold text-slate-700">
              This accessory carries a serial number
            </span>
          </label>
          <p className="text-[11px] text-slate-500 mt-1 ml-6">
            {f.is_serialised
              ? 'Track every physical unit (chargers, FM systems, external mics). You will add serial numbers later via the Serialised sub-tab.'
              : 'Track by total quantity per branch (batteries, tips, tubes, RIC receivers by size). Adjust stock in the Batch Stock sub-tab.'}
          </p>
        </div>

        {!f.is_serialised && (
          <>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                Variants (optional — e.g., 1M · 2M · 3M for RIC receivers)
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  value={variantInput}
                  onChange={(e) => setVariantInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVariant(); } }}
                  placeholder="Type a variant label and press Enter"
                  data-testid="acc-new-variant-input"
                  className={inp}
                />
                <button type="button" onClick={addVariant}
                        data-testid="acc-new-variant-add"
                        className="px-3 py-1.5 text-xs font-semibold bg-slate-200 hover:bg-slate-300 rounded">
                  Add
                </button>
              </div>
              {f.variant_labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {f.variant_labels.map((v) => (
                    <span key={v}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-100 text-indigo-800 rounded-full px-2 py-0.5">
                      {v}
                      <button type="button" onClick={() => removeVariant(v)}
                              className="hover:text-rose-600" aria-label={`Remove ${v}`}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-1 italic">
                Leave empty for single-SKU items like &ldquo;Rayovac 312&rdquo; batteries. Each variant gets
                its own stock row per branch.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Reorder alert level">
                <input type="number" value={f.reorder_level}
                       onChange={(e) => setF({ ...f, reorder_level: e.target.value })}
                       data-testid="acc-new-reorder" className={inp} />
              </Field>
              <Field label="HSN">
                <input value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })}
                       data-testid="acc-new-hsn" className={inp} />
              </Field>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                Init stock in these branches
              </div>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => {
                  const on = f.branch_ids.includes(b.branch_id);
                  return (
                    <button
                      type="button"
                      key={b.branch_id}
                      onClick={() =>
                        setF((prev) => ({
                          ...prev,
                          branch_ids: on
                            ? prev.branch_ids.filter((x) => x !== b.branch_id)
                            : [...prev.branch_ids, b.branch_id],
                        }))
                      }
                      className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                        on
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
                  data-testid="acc-new-save"
                  className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm">
            {saving ? 'Saving…' : 'Create Accessory'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ============================================================
 *   PRESET SEED MODAL — generic (RIC receivers, silicone domes, …)
 * ============================================================ */
const PRESET_CONFIG = {
  ric_receiver: {
    title: 'Quick-add RIC Receivers',
    default_model: 'RIC Receiver',
    variants: ['1M', '2M', '3M', '10P', '2P', '3P', '1S', '2S', '3S'],
    default_mrp: 4500,
    default_reorder: 2,
    accent: 'indigo',
    body_hint: 'Creates the SKU with 9 pre-loaded variants — one row per size × power. M = Moderate · P = Power · S = Standard.',
    brand_placeholder: 'Phonak / Signia / GN Resound',
    testid_prefix: 'acc-ric',
    submit_label: 'Create + Seed 9 variants',
  },
  silicone_dome: {
    title: 'Quick-add Silicone Domes',
    default_model: 'Silicone Dome',
    variants: ['S', 'M', 'L', 'Power'],
    default_mrp: 60,
    default_reorder: 20,
    accent: 'teal',
    body_hint: 'Creates the SKU with the 4 standard dome sizes — Small, Medium, Large, Power (closed).',
    brand_placeholder: 'Phonak / Signia / Widex / GN Resound',
    testid_prefix: 'acc-dome',
    submit_label: 'Create + Seed 4 sizes',
  },
};

function PresetSeedModal({ presetKey, branches, onClose, onSaved }) {
  const cfg = PRESET_CONFIG[presetKey] || PRESET_CONFIG.ric_receiver;
  const [f, setF] = useState({
    brand: '', model: cfg.default_model,
    mrp: cfg.default_mrp, gst_rate: 18, hsn: '9021',
    reorder_level: cfg.default_reorder,
    branch_ids: branches.map((b) => b.branch_id),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    if (!f.brand.trim()) { setErr('Brand is required'); return; }
    if (f.branch_ids.length === 0) { setErr('Pick at least one branch'); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/ha/products/preset-seed`, {
        preset_key: presetKey,
        brand: f.brand.trim(),
        model: f.model.trim() || cfg.default_model,
        mrp: Number(f.mrp || 0),
        gst_rate: Number(f.gst_rate || 0),
        hsn: f.hsn,
        reorder_level: Number(f.reorder_level || 0),
        branch_ids: f.branch_ids,
      });
      onSaved();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const banner =
    cfg.accent === 'teal'
      ? 'text-teal-800 bg-teal-50 border-teal-200'
      : 'text-indigo-700 bg-indigo-50 border-indigo-200';
  const btn =
    cfg.accent === 'teal'
      ? 'bg-teal-600 hover:bg-teal-700'
      : 'bg-indigo-600 hover:bg-indigo-700';
  const chipOn =
    cfg.accent === 'teal'
      ? 'bg-teal-600 text-white border-teal-600'
      : 'bg-indigo-600 text-white border-indigo-600';

  return (
    <ModalShell title={cfg.title} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4" data-testid={`${cfg.testid_prefix}-modal`}>
        <div className={`text-[12px] border rounded px-3 py-2 ${banner}`}>
          <b>One-tap setup.</b> {cfg.body_hint}
          <div className="mt-1 font-mono text-[11px]">{cfg.variants.join(' · ')}</div>
        </div>
        {err && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={13} /> {err}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand *">
            <input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}
                   data-testid={`${cfg.testid_prefix}-brand`}
                   placeholder={cfg.brand_placeholder}
                   className={inp} />
          </Field>
          <Field label="Model / Line">
            <input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}
                   data-testid={`${cfg.testid_prefix}-model`} className={inp} />
          </Field>
          <Field label="MRP (₹)">
            <input type="number" value={f.mrp} onChange={(e) => setF({ ...f, mrp: e.target.value })}
                   data-testid={`${cfg.testid_prefix}-mrp`} className={inp} />
          </Field>
          <Field label="Reorder alert">
            <input type="number" value={f.reorder_level}
                   onChange={(e) => setF({ ...f, reorder_level: e.target.value })}
                   data-testid={`${cfg.testid_prefix}-reorder`} className={inp} />
          </Field>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Seed stock rows in
          </div>
          <div className="flex flex-wrap gap-2">
            {branches.map((b) => {
              const on = f.branch_ids.includes(b.branch_id);
              return (
                <button
                  type="button"
                  key={b.branch_id}
                  onClick={() =>
                    setF((prev) => ({
                      ...prev,
                      branch_ids: on
                        ? prev.branch_ids.filter((x) => x !== b.branch_id)
                        : [...prev.branch_ids, b.branch_id],
                    }))
                  }
                  className={`text-[11.5px] px-2.5 py-1 rounded-full border ${
                    on ? chipOn : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
                  data-testid={`${cfg.testid_prefix}-save`}
                  className={`px-4 py-1.5 text-xs font-semibold text-white rounded shadow-sm disabled:bg-slate-300 ${btn}`}>
            {saving ? 'Seeding…' : cfg.submit_label}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ============================================================
 *   TAB 2 — BATCH STOCK
 * ============================================================ */
function BatchStockTab({ branches, selectedBranch, setSelectedBranch }) {
  const [data, setData] = useState({ kpis: { total_skus: 0, zero_stock: 0, low_stock: 0, ok_stock: 0 }, items: [] });
  const [lowOnly, setLowOnly] = useState(false);
  const [adjustSku, setAdjustSku] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranch) params.branch_id = selectedBranch;
      if (lowOnly) params.low_stock_only = true;
      const r = await axios.get(`${API}/ha/accessory-stock-hydrated`, { params });
      setData(r.data || { kpis: {}, items: [] });
    } catch {
      setData({ kpis: {}, items: [] });
    }
  }, [selectedBranch, lowOnly]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Total SKUs" value={data.kpis?.total_skus ?? 0} testid="acc-kpi-total" />
        <Kpi label="Zero stock"  value={data.kpis?.zero_stock ?? 0} tone="rose"    testid="acc-kpi-zero" />
        <Kpi label="Low stock"   value={data.kpis?.low_stock ?? 0} tone="amber"   testid="acc-kpi-low" />
        <Kpi label="In stock"    value={data.kpis?.ok_stock ?? 0} tone="emerald" testid="acc-kpi-ok" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          data-testid="acc-batch-branch"
          className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.branch_id} value={b.branch_id}>{b.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
            data-testid="acc-batch-lowonly"
          />
          Show only low/zero stock
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Item</th>
              <th className="text-left px-3 py-2 font-semibold">Variant</th>
              <th className="text-left px-3 py-2 font-semibold">Branch</th>
              <th className="text-right px-3 py-2 font-semibold">On Hand</th>
              <th className="text-right px-3 py-2 font-semibold">Reorder</th>
              <th className="text-left px-3 py-2 font-semibold">Status</th>
              <th className="text-right px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-400 italic text-sm">
                  No stock rows yet. Create an accessory in Catalogue and init stock, or use the RIC Receiver preset.
                </td>
              </tr>
            )}
            {data.items.map((row) => {
              const qty = Number(row.qty_on_hand || 0);
              const reorder = Number(row.reorder_level || 0);
              const isZero = qty === 0;
              const isLow = !isZero && qty <= reorder;
              const rowBg = isZero ? 'bg-rose-50/60' : isLow ? 'bg-amber-50/60' : '';
              return (
                <tr key={row.sku_id} data-testid={`acc-stock-row-${row.sku_id}`}
                    className={`border-t border-slate-100 hover:bg-slate-50 ${rowBg}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">
                      {row.product?.brand || '—'} <span className="text-slate-500 font-normal">·</span> {row.product?.model || ''}
                    </div>
                    <div className="text-[11px] text-slate-500">{kindLabel(row.product?.accessory_kind)}</div>
                  </td>
                  <td className="px-3 py-2 text-[13px] font-mono">
                    {row.variant || <span className="italic text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-700">{row.branch?.name || row.branch_id}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-bold ${isZero ? 'text-rose-700' : isLow ? 'text-amber-700' : 'text-slate-800'}`}>
                    {qty}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{reorder}</td>
                  <td className="px-3 py-2">
                    {isZero
                      ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700"><AlertTriangle size={11} /> OUT</span>
                      : isLow
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700"><AlertTriangle size={11} /> LOW</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 size={11} /> OK</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setAdjustSku(row)}
                      data-testid={`acc-adjust-${row.sku_id}`}
                      className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded"
                    >Adjust</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adjustSku && (
        <AdjustStockModal
          sku={adjustSku}
          onClose={() => setAdjustSku(null)}
          onSaved={() => { setAdjustSku(null); load(); }}
        />
      )}
    </div>
  );
}

/* ============================================================
 *   ADJUST STOCK MODAL
 * ============================================================ */
function AdjustStockModal({ sku, onClose, onSaved }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('stock_in');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const REASONS = [
    { value: 'stock_in',  label: 'Stock In (procurement)',  sign: 'add' },
    { value: 'stock_out', label: 'Stock Out (sale)',        sign: 'sub' },
    { value: 'damaged',   label: 'Damaged / Discard',       sign: 'sub' },
    { value: 'gifted',    label: 'Gifted / Sample',         sign: 'sub' },
    { value: 'returned',  label: 'Returned to Vendor',      sign: 'sub' },
    { value: 'adjustment', label: 'Manual Adjustment',      sign: 'either' },
  ];

  const currentReason = REASONS.find((r) => r.value === reason);
  const signHint =
    currentReason?.sign === 'add' ? '+' :
    currentReason?.sign === 'sub' ? '−' : '±';

  const save = async () => {
    setErr('');
    const n = Number(delta);
    if (!n || Number.isNaN(n)) { setErr('Enter a non-zero quantity'); return; }
    // Apply sign based on reason
    let signedDelta = n;
    if (currentReason?.sign === 'sub' && n > 0) signedDelta = -n;
    if (currentReason?.sign === 'add' && n < 0) signedDelta = Math.abs(n);
    const payload = { delta: signedDelta, reason: note ? `${currentReason?.label} — ${note}` : currentReason?.label || reason };
    setSaving(true);
    try {
      await axios.post(`${API}/ha/accessory-stock/${sku.sku_id}/adjust`, payload);
      onSaved();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Adjust failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Adjust Stock" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3" data-testid="acc-adjust-modal">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-[13px]">
          <div className="font-semibold text-slate-800">
            {sku.product?.brand} · {sku.product?.model}
          </div>
          <div className="text-[11.5px] text-slate-600 mt-0.5">
            Variant: <span className="font-mono">{sku.variant || '—'}</span> · Branch: {sku.branch?.name || sku.branch_id}
          </div>
          <div className="mt-2 text-[12px] text-slate-500">
            Current on-hand: <span className="font-bold text-slate-800 tabular-nums">{sku.qty_on_hand ?? 0}</span>
            <span className="mx-2">·</span>
            Reorder level: <span className="tabular-nums">{sku.reorder_level ?? 0}</span>
          </div>
        </div>

        {err && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={13} /> {err}
          </div>
        )}

        <Field label="Reason">
          <select value={reason} onChange={(e) => setReason(e.target.value)}
                  data-testid="acc-adjust-reason" className={inp}>
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>

        <Field label={`Quantity (${signHint})`}>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            data-testid="acc-adjust-qty"
            placeholder="e.g., 20"
            className={inp}
          />
        </Field>

        <Field label="Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="acc-adjust-note"
            placeholder="e.g., GRN-2026-04, patient ACS-…"
            className={inp}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !delta}
                  data-testid="acc-adjust-save"
                  className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm">
            {saving ? 'Saving…' : 'Apply Adjustment'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ============================================================
 *   TAB 3 — SERIALISED (chargers / FM / mics)
 * ============================================================ */
function SerialisedTab({ branches }) {
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      // 1) load accessory-catalogue products that ARE serialised
      const pr = await axios.get(`${API}/ha/products`, {
        params: { form_factor: 'accessory', is_serialised: true, active: true },
      });
      const prods = Array.isArray(pr.data) ? pr.data : [];
      setProducts(prods);
      const productIds = new Set(prods.map((p) => p.product_id));

      // 2) fetch serial items; then filter locally to those tied to accessory products
      const sr = await axios.get(`${API}/ha/serial-items`, {
        params: {
          ...(selectedBranch ? { branch_id: selectedBranch } : {}),
          ...(search ? { search } : {}),
          limit: 500,
        },
      });
      const rows = (Array.isArray(sr.data) ? sr.data : []).filter((r) => productIds.has(r.product_id));
      const pmap = Object.fromEntries(prods.map((p) => [p.product_id, p]));
      setItems(rows.map((r) => ({ ...r, product: pmap[r.product_id] })));
    } catch {
      setItems([]);
    }
  }, [selectedBranch, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <div className="flex-1 min-w-[220px] max-w-md relative">
          <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
          <input
            placeholder="Search serial number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="acc-serial-search"
            className="w-full bg-white border border-slate-300 rounded-md pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
          />
        </div>
        <select
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          data-testid="acc-serial-branch"
          className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.branch_id} value={b.branch_id}>{b.name}</option>
          ))}
        </select>
      </div>

      {products.length === 0 && (
        <div className="text-[12px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
          You have no serialised accessories in the catalogue yet. Add one from the <b>Catalogue</b> sub-tab
          (tick &ldquo;This accessory carries a serial number&rdquo;), then add individual units from the
          existing Catalogue &rarr; Product page.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Serial No.</th>
              <th className="text-left px-3 py-2 font-semibold">Item</th>
              <th className="text-left px-3 py-2 font-semibold">Kind</th>
              <th className="text-left px-3 py-2 font-semibold">State</th>
              <th className="text-left px-3 py-2 font-semibold">Pool</th>
              <th className="text-left px-3 py-2 font-semibold">Warranty Until</th>
              <th className="text-left px-3 py-2 font-semibold">GRN</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-400 italic text-sm">
                  No serialised accessory units on file. Add units via Catalogue → open a serialised product → Serial Numbers section.
                </td>
              </tr>
            )}
            {items.map((r) => (
              <tr key={r.serial_id} data-testid={`acc-serial-row-${r.serial_id}`}
                  className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-[12.5px] font-semibold text-slate-800">{r.serial_no}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{r.product?.brand}</div>
                  <div className="text-[11px] text-slate-500">{r.product?.model}</div>
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-700">{kindLabel(r.product?.accessory_kind)}</td>
                <td className="px-3 py-2">
                  <span className="inline-block text-[10.5px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 rounded px-2 py-0.5">
                    {r.state}
                  </span>
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{r.pool || '—'}</td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{r.warranty_end_date || '—'}</td>
                <td className="px-3 py-2 text-[12px] text-slate-500 font-mono">{r.grn_no || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
 *   Local UI helpers
 * ============================================================ */
const inp = 'w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-400';
const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">{label}</span>
    {children}
  </label>
);

const KPI_TONES = {
  slate:   'bg-slate-100 text-slate-700 border-slate-200',
  amber:   'bg-amber-50 text-amber-800 border-amber-200',
  rose:    'bg-rose-50 text-rose-800 border-rose-200',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};
const Kpi = ({ label, value, tone = 'slate', testid }) => (
  <div data-testid={testid} className={`border rounded-md px-3 py-2 ${KPI_TONES[tone]}`}>
    <div className="text-[10px] uppercase tracking-wider font-bold">{label}</div>
    <div className="text-lg font-black tabular-nums">{value}</div>
  </div>
);
