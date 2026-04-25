import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { X, Search, Building2, Package, AlertCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PURPOSES = [
  { value: 'trial',          label: 'Patient trial' },
  { value: 'sale',           label: 'Confirmed sale' },
  { value: 'replenishment',  label: 'Stock replenishment' },
  { value: 'repair_loaner',  label: 'Repair loaner' },
  { value: 'other',          label: 'Other' },
];

/**
 * CreateTransferModal — pick a destination clinic, then multi-select IN_STOCK
 * serials from the source clinic. On save we POST a draft transfer; the user
 * can dispatch it from the list view.
 */
export default function CreateTransferModal({ onClose, onCreated }) {
  const [destinations, setDestinations] = useState([]);    // accessible clinics
  const [serials, setSerials] = useState([]);              // IN_STOCK at source
  const [products, setProducts] = useState({});            // product_id -> {brand, model}
  const [loading, setLoading] = useState(true);

  const [toClinic, setToClinic] = useState('');
  const [purpose, setPurpose] = useState('trial');
  const [selected, setSelected] = useState([]);            // serial_ids
  const [search, setSearch] = useState('');
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // ---- Load: accessible clinics + IN_STOCK serials at source ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [meRes, clinicsRes, serialsRes, prodsRes] = await Promise.all([
          axios.get(`${API}/auth/me`),
          axios.get(`${API}/auth/my-clinics`),
          axios.get(`${API}/ha/serial-items`, { params: { state: 'IN_STOCK', limit: 500 } }),
          axios.get(`${API}/ha/products`),
        ]);
        if (!alive) return;
        const myClinic = meRes.data?.clinic_id || meRes.data?.user?.clinic_id;
        const others = (clinicsRes.data?.clinics || []).filter((c) => c.clinic_id !== myClinic);
        setDestinations(others);
        if (others.length === 1) setToClinic(others[0].clinic_id);
        const serialsData = Array.isArray(serialsRes.data) ? serialsRes.data : (serialsRes.data?.items || []);
        setSerials(serialsData);
        setProducts(Object.fromEntries((prodsRes.data || []).map((p) => [p.product_id, p])));
      } catch (e) {
        setErr(e?.response?.data?.detail || 'Failed to load source data');
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const decoratedSerials = useMemo(() => {
    return serials.map((s) => {
      const p = products[s.product_id] || {};
      return { ...s, _product_label: `${p.brand || ''} ${p.model || ''}`.trim() };
    });
  }, [serials, products]);

  const filteredSerials = useMemo(() => {
    if (!search.trim()) return decoratedSerials;
    const q = search.toLowerCase();
    return decoratedSerials.filter((s) =>
      (s.serial_no || '').toLowerCase().includes(q) ||
      (s._product_label || '').toLowerCase().includes(q),
    );
  }, [decoratedSerials, search]);

  const toggle = (sid) =>
    setSelected((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]));

  const submit = async () => {
    setErr('');
    if (!toClinic) { setErr('Pick a destination clinic'); return; }
    if (selected.length === 0) { setErr('Select at least one serial'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/stock-transfers`, {
        to_clinic_id: toClinic,
        purpose,
        serial_ids: selected,
        courier_name: courier || null,
        tracking_no: tracking || null,
        notes: notes || null,
      });
      onCreated?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Create failed');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="transfer-create-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-w-full max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-white">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">New stock transfer</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Select destination clinic and serials to ship.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center justify-center"
            data-testid="transfer-create-close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loading ? (
            <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>
          ) : (
            <>
              {/* Destination */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1 mb-1.5">
                  <Building2 size={11} /> Destination clinic *
                </label>
                {destinations.length === 0 ? (
                  <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                    You only have access to one clinic. Inter-clinic transfers need at least two
                    clinics linked to your account — ask your owner to add you to another clinic.
                  </div>
                ) : (
                  <select
                    value={toClinic}
                    onChange={(e) => setToClinic(e.target.value)}
                    data-testid="transfer-create-dest"
                    className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 bg-white"
                  >
                    <option value="">— pick a clinic —</option>
                    {destinations.map((c) => (
                      <option key={c.clinic_id} value={c.clinic_id}>
                        {c.name} {c.city ? `· ${c.city}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Purpose */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 block">
                  Purpose
                </label>
                <div className="grid grid-cols-5 gap-1">
                  {PURPOSES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPurpose(p.value)}
                      data-testid={`transfer-purpose-${p.value}`}
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1.5 rounded border transition-colors ${
                        purpose === p.value
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Serials picker */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1">
                    <Package size={11} /> Items to ship *
                  </label>
                  <span className="text-[10px] text-slate-500">
                    {selected.length} selected · {decoratedSerials.length} available
                  </span>
                </div>
                <div className="relative mb-2">
                  <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by serial no. or product…"
                    data-testid="transfer-create-search"
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="border border-slate-200 rounded max-h-[260px] overflow-auto">
                  {filteredSerials.length === 0 ? (
                    <div className="text-[12px] text-slate-400 text-center py-6">No matching IN_STOCK items.</div>
                  ) : (
                    <ul>
                      {filteredSerials.map((s) => {
                        const checked = selected.includes(s.serial_id);
                        return (
                          <li
                            key={s.serial_id}
                            onClick={() => toggle(s.serial_id)}
                            data-testid={`transfer-serial-row-${s.serial_id}`}
                            className={`flex items-center gap-3 px-3 py-2 border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${
                              checked ? 'bg-indigo-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              readOnly
                              className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-semibold text-slate-800 truncate">
                                {s._product_label || s.product_id}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono truncate">
                                S/N {s.serial_no}
                              </div>
                            </div>
                            <span className="text-[9px] uppercase tracking-wider font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded flex-shrink-0">
                              IN STOCK
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* Courier + Tracking */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">
                    Courier
                  </label>
                  <input
                    type="text"
                    value={courier}
                    onChange={(e) => setCourier(e.target.value)}
                    placeholder="e.g. Bluedart"
                    data-testid="transfer-create-courier"
                    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">
                    Tracking no.
                  </label>
                  <input
                    type="text"
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                    placeholder="Optional"
                    data-testid="transfer-create-tracking"
                    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Patient Mr. Anil scheduled for trial on Friday"
                  data-testid="transfer-create-notes"
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {err && (
                <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[12px] px-3 py-2 rounded" data-testid="transfer-create-err">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <div>{err}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="text-[10px] text-slate-500">
            Tip: After creating, click <span className="font-bold">Dispatch</span> to assign challan no. and lock items.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 rounded"
              data-testid="transfer-create-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || loading || destinations.length === 0}
              data-testid="transfer-create-submit"
              className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
