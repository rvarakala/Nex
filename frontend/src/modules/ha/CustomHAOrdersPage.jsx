/*
 * Custom HA Orders — Feb 2026
 *
 * Bespoke IIC / CIC / ITC / ITE ordering workflow. Same "book + auto-invoice
 * + status ribbon" pattern as Ear Moulds, but with per-ear specs and a
 * dual-target delivery choice (external vendor OR another branch).
 *
 * The `CustomHAOrderModal` is exported separately so Procurement and
 * Stock Transfers pages can trigger the same form with a preset target.
 *
 * Backend: /api/ha/custom-ha-orders (POST · GET · PATCH /{id}/status)
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Plus, Ear, Search, Calendar, Package, RefreshCw, Building2, Truck } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_ORDER = ['impression_pending', 'sent_to_vendor', 'dispatched', 'arrived', 'delivered', 'cancelled'];
const STATUS_META = {
  impression_pending: { label: 'Impression Pending', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  sent_to_vendor:     { label: 'Sent to Vendor',     tone: 'bg-amber-100 text-amber-800 border-amber-300' },
  dispatched:         { label: 'Dispatched',         tone: 'bg-sky-100 text-sky-800 border-sky-300' },
  arrived:            { label: 'Arrived',            tone: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  delivered:          { label: 'Delivered',          tone: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  cancelled:          { label: 'Cancelled',          tone: 'bg-rose-100 text-rose-800 border-rose-300' },
};
const SIDE_LABEL = { left: 'Left', right: 'Right', both: 'Both' };
const SHELL_OPTIONS = ['IIC', 'CIC', 'ITC', 'ITE'];
const RECEIVER_OPTIONS = ['M', 'P', 'HP', 'SP', 'UP'];
const FEATURE_OPTIONS = [
  { key: 'telecoil',     label: 'Telecoil' },
  { key: 'push_button',  label: 'Push button' },
  { key: 'directional',  label: 'Directional mic' },
  { key: 'rechargeable', label: 'Rechargeable' },
  { key: 'wireless',     label: 'Wireless' },
  { key: 'volume_ctrl',  label: 'Volume control' },
];

const fmtDay = (d) => (!d ? '—' : new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function CustomHAOrdersPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBook, setShowBook] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/ha/custom-ha-orders`, {
        params: statusFilter ? { status: statusFilter } : {},
      });
      setRows(r.data || []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      (r.patient_name || '').toLowerCase().includes(q) ||
      (r.order_no || '').toLowerCase().includes(q) ||
      (r.vendor_name || r.target_branch_name || '').toLowerCase().includes(q) ||
      (r.brand || '').toLowerCase().includes(q) ||
      (r.model || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const kpis = useMemo(() => {
    const c = { total: rows.length, sentVendor: 0, arrived: 0, dueBalance: 0 };
    rows.forEach((r) => {
      if (r.status === 'sent_to_vendor') c.sentVendor++;
      if (r.status === 'arrived') c.arrived++;
      c.dueBalance += Number(r.balance_due || 0);
    });
    return c;
  }, [rows]);

  return (
    <div className="p-4 sm:p-6" data-testid="ha-custom-ha-page">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
            <Ear size={22} /> Custom Hearing Aids
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Bespoke IIC / CIC / ITC / ITE orders — per-patient with vendor or branch delivery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBook(true)}
            data-testid="ha-cha-book-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm"
          >
            <Plus size={13} /> New Custom HA Order
          </button>
          <button
            onClick={load}
            title="Reload"
            data-testid="ha-cha-reload"
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Kpi label="Open Orders" value={kpis.total} testid="ha-cha-kpi-open" />
        <Kpi label="Sent to Vendor" value={kpis.sentVendor} testid="ha-cha-kpi-sent" tone="amber" />
        <Kpi label="Arrived — ready to collect" value={kpis.arrived} testid="ha-cha-kpi-arrived" tone="indigo" />
        <Kpi label="Total Balance Due" value={fmtMoney(kpis.dueBalance)} testid="ha-cha-kpi-due" tone="rose" />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient, order #, vendor, brand…"
            data-testid="ha-cha-search"
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {['', ...STATUS_ORDER].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              data-testid={`ha-cha-filter-${s || 'all'}`}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded border ${
                statusFilter === s
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {s ? STATUS_META[s].label : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
            <tr>
              <th className="text-left px-3 py-2">Order #</th>
              <th className="text-left px-3 py-2">Patient</th>
              <th className="text-left px-3 py-2">Shell / Side</th>
              <th className="text-left px-3 py-2">Brand / Model</th>
              <th className="text-left px-3 py-2">Specs (L / R)</th>
              <th className="text-left px-3 py-2">Delivery Target</th>
              <th className="text-left px-3 py-2">Expected</th>
              <th className="text-right px-3 py-2">Advance / Balance</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="text-center py-8 text-slate-400 italic text-xs">Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-10 text-slate-400 italic text-sm">
                  {search || statusFilter ? 'No orders match this filter.' : 'No custom HA orders yet. Click New Custom HA Order to create one.'}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.order_id} data-testid={`ha-cha-row-${r.order_id}`} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-mono text-[11px] font-semibold text-slate-800">{r.order_no}</td>
                <td className="px-3 py-2">
                  <Link
                    to={`/patients/${r.patient_id}?tab=payments`}
                    className="text-indigo-700 hover:underline font-semibold"
                  >
                    {r.patient_name || '—'}
                  </Link>
                  {r.patient_mobile && <div className="text-[10.5px] text-slate-500">{r.patient_mobile}</div>}
                </td>
                <td className="px-3 py-2 text-[12px]">
                  <div className="font-semibold">{r.shell_type}</div>
                  <div className="text-[10.5px] text-slate-500">{SIDE_LABEL[r.side] || r.side}</div>
                </td>
                <td className="px-3 py-2 text-[12px]">
                  {r.brand || r.model ? (
                    <>
                      <div className="font-semibold">{r.brand || '—'}</div>
                      <div className="text-[10.5px] text-slate-500">{r.model || ''}</div>
                    </>
                  ) : <span className="text-slate-400 italic">—</span>}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-600">
                  {(r.side === 'left' || r.side === 'both') && (
                    <div>L: {[r.vent_size_left, r.shell_colour_left, r.receiver_power_left].filter(Boolean).join(' · ') || <span className="text-slate-400">—</span>}</div>
                  )}
                  {(r.side === 'right' || r.side === 'both') && (
                    <div>R: {[r.vent_size_right, r.shell_colour_right, r.receiver_power_right].filter(Boolean).join(' · ') || <span className="text-slate-400">—</span>}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-[12px]">
                  <div className="inline-flex items-center gap-1">
                    {r.delivery_target === 'vendor' ? <Truck size={11} /> : <Building2 size={11} />}
                    <span>{r.vendor_name || r.target_branch_name || '—'}</span>
                  </div>
                  <div className="text-[10px] uppercase text-slate-400 tracking-widest">{r.delivery_target}</div>
                </td>
                <td className="px-3 py-2 text-[12px] tabular-nums">{fmtDay(r.expected_delivery_date)}</td>
                <td className="px-3 py-2 text-right text-[12px] tabular-nums">
                  <div className="text-emerald-700 font-semibold">{fmtMoney(r.advance_amount)}</div>
                  <div className={Number(r.balance_due) > 0 ? 'text-rose-700 font-semibold' : 'text-slate-400'}>
                    Bal: {fmtMoney(r.balance_due)}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusPicker order={r} onChanged={load} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {r.invoice_id && (
                    <Link
                      to={`/billing/invoice/${r.invoice_id}`}
                      data-testid={`ha-cha-invoice-link-${r.order_id}`}
                      className="text-[11px] font-semibold text-indigo-700 hover:underline"
                    >
                      Invoice →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showBook && (
        <CustomHAOrderModal onClose={() => setShowBook(false)} onSaved={() => { setShowBook(false); load(); }} />
      )}
    </div>
  );
}

function Kpi({ label, value, testid, tone }) {
  const toneCls = tone === 'rose'   ? 'bg-rose-50 border-rose-200 text-rose-800'
                : tone === 'amber'  ? 'bg-amber-50 border-amber-200 text-amber-800'
                : tone === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                : 'bg-white border-slate-200 text-slate-700';
  return (
    <div className={`rounded-md border px-3 py-2 ${toneCls}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function StatusPicker({ order, onChanged }) {
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[order.status] || STATUS_META.impression_pending;
  const options = STATUS_ORDER.filter((s) => s !== order.status);

  const change = async (nextStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      await axios.patch(`${API}/ha/custom-ha-orders/${order.order_id}/status`, { status: nextStatus });
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-block">
      <details className="inline-block">
        <summary
          data-testid={`ha-cha-status-${order.order_id}`}
          className={`cursor-pointer list-none inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${meta.tone}`}
        >
          {meta.label}
        </summary>
        <div className="absolute mt-1 bg-white border border-slate-200 rounded shadow-lg z-10 min-w-[160px] py-1">
          {options.map((s) => (
            <button
              key={s}
              onClick={() => change(s)}
              disabled={busy}
              data-testid={`ha-cha-status-set-${order.order_id}-${s}`}
              className="w-full text-left px-2.5 py-1 text-[11px] hover:bg-slate-50"
            >
              → {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ============================================================
 *   CUSTOM HA ORDER MODAL — reusable
 *   `defaultTarget` = 'vendor' | 'branch' pre-selects the tab so
 *   procurement + transfer entry points feel native.
 * ============================================================ */
export function CustomHAOrderModal({ onClose, onSaved, defaultTarget = 'vendor' }) {
  const [patientQ, setPatientQ] = useState('');
  const [patientOpts, setPatientOpts] = useState([]);
  const [patient, setPatient] = useState(null);

  const [side, setSide] = useState('both');
  const [shellType, setShellType] = useState('CIC');
  const [ventL, setVentL] = useState('');
  const [ventR, setVentR] = useState('');
  const [shellColL, setShellColL] = useState('');
  const [shellColR, setShellColR] = useState('');
  const [faceL, setFaceL] = useState('');
  const [faceR, setFaceR] = useState('');
  const [recvL, setRecvL] = useState('');
  const [recvR, setRecvR] = useState('');

  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [warranty, setWarranty] = useState(24);
  const [features, setFeatures] = useState([]);

  const [deliveryTarget, setDeliveryTarget] = useState(defaultTarget);
  const [vendors, setVendors] = useState([]);
  const [branches, setBranches] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [expected, setExpected] = useState('');

  const [total, setTotal] = useState('');
  const [advance, setAdvance] = useState('');
  const [mode, setMode] = useState('cash');
  const [gst, setGst] = useState(18);
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Load vendors + branches for the delivery target dropdowns.
  useEffect(() => {
    (async () => {
      try {
        const [v, b] = await Promise.all([
          axios.get(`${API}/vendors?active=true`).catch(() => ({ data: [] })),
          axios.get(`${API}/branches`).catch(() => ({ data: [] })),
        ]);
        setVendors(v.data || []);
        setBranches(b.data || []);
      } catch { /* noop */ }
    })();
  }, []);

  // Patient search — debounced.
  useEffect(() => {
    if (!patientQ.trim() || patient) { setPatientOpts([]); return; }
    const h = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, {
          params: { search: patientQ, limit: 8 },
        });
        const items = Array.isArray(r.data) ? r.data : (r.data?.items || []);
        setPatientOpts(items);
      } catch { /* noop */ }
    }, 250);
    return () => clearTimeout(h);
  }, [patientQ, patient]);

  const balance = Math.max(0, Number(total || 0) - Number(advance || 0));
  const paymentStatus = Number(advance || 0) <= 0 ? 'unpaid'
    : Number(advance || 0) >= Number(total || 0) ? 'paid' : 'partial';

  const toggleFeature = (key) => {
    setFeatures((f) => (f.includes(key) ? f.filter((x) => x !== key) : [...f, key]));
  };

  const submit = async () => {
    setErr('');
    if (!patient) { setErr('Pick a patient'); return; }
    if (!shellType) { setErr('Pick a shell type'); return; }
    if (!total || Number(total) <= 0) { setErr('Enter the total amount'); return; }
    if (Number(advance || 0) > Number(total)) { setErr('Advance cannot exceed the total'); return; }
    if (deliveryTarget === 'vendor' && !vendorId) { setErr('Pick a vendor'); return; }
    if (deliveryTarget === 'branch' && !targetBranchId) { setErr('Pick a target branch'); return; }

    setBusy(true);
    try {
      await axios.post(`${API}/ha/custom-ha-orders`, {
        patient_id: patient.patient_id,
        side,
        shell_type: shellType,
        vent_size_left: side === 'right' ? null : (ventL || null),
        vent_size_right: side === 'left' ? null : (ventR || null),
        shell_colour_left: side === 'right' ? null : (shellColL || null),
        shell_colour_right: side === 'left' ? null : (shellColR || null),
        faceplate_colour_left: side === 'right' ? null : (faceL || null),
        faceplate_colour_right: side === 'left' ? null : (faceR || null),
        receiver_power_left: side === 'right' ? null : (recvL || null),
        receiver_power_right: side === 'left' ? null : (recvR || null),
        brand: brand || null,
        model: model || null,
        warranty_months: Number(warranty || 24),
        features,
        delivery_target: deliveryTarget,
        vendor_id: deliveryTarget === 'vendor' ? vendorId : null,
        target_branch_id: deliveryTarget === 'branch' ? targetBranchId : null,
        expected_delivery_date: expected || null,
        total_amount: Number(total),
        advance_amount: Number(advance || 0),
        payment_mode: mode,
        gst_rate: Number(gst || 0),
        notes: notes || null,
      });
      onSaved?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Booking failed');
      setBusy(false);
    }
  };

  const showLeft  = side === 'left' || side === 'both';
  const showRight = side === 'right' || side === 'both';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center p-4 overflow-y-auto"
      data-testid="ha-cha-book-modal"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-6">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Ear size={16} className="text-indigo-600" />
            <h2 className="text-base font-bold text-slate-800">New Custom HA Order</h2>
          </div>
          <button
            onClick={onClose}
            data-testid="ha-cha-book-close"
            className="text-slate-400 hover:text-slate-800 text-lg leading-none"
          >×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Patient */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Patient *</label>
            {patient ? (
              <div
                data-testid="ha-cha-book-patient"
                className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded px-3 py-2"
              >
                <div>
                  <div className="text-[13px] font-semibold text-slate-800">{patient.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{patient.patient_id}{patient.mobile ? ` · ${patient.mobile}` : ''}</div>
                </div>
                <button
                  onClick={() => { setPatient(null); setPatientQ(''); }}
                  className="text-[11px] text-slate-500 hover:text-slate-800"
                >Change</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={patientQ}
                  onChange={(e) => setPatientQ(e.target.value)}
                  placeholder="Type patient name, phone or MRD…"
                  data-testid="ha-cha-book-patient-search"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
                />
                {patientOpts.length > 0 && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded shadow-lg z-10 max-h-56 overflow-y-auto">
                    {patientOpts.map((p) => (
                      <button
                        key={p.patient_id}
                        onClick={() => { setPatient(p); setPatientOpts([]); }}
                        data-testid={`ha-cha-book-patient-opt-${p.patient_id}`}
                        className="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50"
                      >
                        <div className="font-semibold text-slate-800">{p.name}</div>
                        <div className="text-[10.5px] text-slate-500">
                          {p.mobile || '—'} · <span className="font-mono">{p.patient_id}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Shell type + Side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Shell type *</label>
              <div className="flex gap-1">
                {SHELL_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setShellType(s)}
                    data-testid={`ha-cha-shell-${s}`}
                    className={`flex-1 text-[11px] font-semibold py-1.5 rounded border ${
                      shellType === s
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Side *</label>
              <div className="flex gap-1">
                {['left', 'right', 'both'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSide(s)}
                    data-testid={`ha-cha-side-${s}`}
                    className={`flex-1 text-[11px] font-semibold py-1.5 rounded border ${
                      side === s
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >{SIDE_LABEL[s]}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Per-ear spec grid */}
          <div className="rounded border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-3 bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              <div className="px-3 py-2">Spec</div>
              <div className="px-3 py-2">Left</div>
              <div className="px-3 py-2">Right</div>
            </div>
            <EarRow label="Vent size" leftShown={showLeft} rightShown={showRight}
              leftVal={ventL} onLeft={setVentL} rightVal={ventR} onRight={setVentR}
              placeholder="e.g. 1.5mm / IROS" testidPrefix="ha-cha-vent" />
            <EarRow label="Shell colour" leftShown={showLeft} rightShown={showRight}
              leftVal={shellColL} onLeft={setShellColL} rightVal={shellColR} onRight={setShellColR}
              placeholder="Skin / Brown / Clear" testidPrefix="ha-cha-shell-colour" />
            <EarRow label="Faceplate colour" leftShown={showLeft} rightShown={showRight}
              leftVal={faceL} onLeft={setFaceL} rightVal={faceR} onRight={setFaceR}
              placeholder="Same / Black / Beige" testidPrefix="ha-cha-face" />
            <EarSelectRow label="Receiver power" leftShown={showLeft} rightShown={showRight}
              leftVal={recvL} onLeft={setRecvL} rightVal={recvR} onRight={setRecvR}
              options={RECEIVER_OPTIONS} testidPrefix="ha-cha-recv" />
          </div>

          {/* Brand / Model / Warranty */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Brand</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Phonak / Signia / Starkey"
                data-testid="ha-cha-brand"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Model</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. Virto B90 / Insio 7AX"
                data-testid="ha-cha-model"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Warranty (months)</label>
              <input
                type="number"
                min="0"
                value={warranty}
                onChange={(e) => setWarranty(e.target.value)}
                data-testid="ha-cha-warranty"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
          </div>

          {/* Features */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Features</label>
            <div className="flex flex-wrap gap-1.5">
              {FEATURE_OPTIONS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleFeature(f.key)}
                  data-testid={`ha-cha-feature-${f.key}`}
                  className={`text-[11px] px-2.5 py-1 rounded border ${
                    features.includes(f.key)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >{f.label}</button>
              ))}
            </div>
          </div>

          {/* Delivery target */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Delivery target *</label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setDeliveryTarget('vendor')}
                  data-testid="ha-cha-target-vendor"
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded border ${
                    deliveryTarget === 'vendor'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                ><Truck size={12} /> Vendor (Purchase Order)</button>
                <button
                  type="button"
                  onClick={() => setDeliveryTarget('branch')}
                  data-testid="ha-cha-target-branch"
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded border ${
                    deliveryTarget === 'branch'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                ><Building2 size={12} /> Another Branch (Request)</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {deliveryTarget === 'vendor' ? (
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Vendor *</label>
                  <select
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    data-testid="ha-cha-vendor-id"
                    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
                  >
                    <option value="">— pick vendor —</option>
                    {vendors.map((v) => (
                      <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>
                    ))}
                  </select>
                  {vendors.length === 0 && (
                    <div className="text-[10.5px] text-amber-700 mt-1">No vendors yet — add one in Procurement → Vendors master.</div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Target branch *</label>
                  <select
                    value={targetBranchId}
                    onChange={(e) => setTargetBranchId(e.target.value)}
                    data-testid="ha-cha-target-branch-id"
                    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
                  >
                    <option value="">— pick branch —</option>
                    {branches.map((b) => (
                      <option key={b.branch_id} value={b.branch_id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block flex items-center gap-1">
                  <Calendar size={11} /> Expected on
                </label>
                <input
                  type="date"
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  data-testid="ha-cha-expected"
                  className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
                />
              </div>
            </div>
          </div>

          {/* Money block */}
          <div className="grid grid-cols-4 gap-3 p-3 bg-slate-50 border border-slate-200 rounded">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Total (₹) *</label>
              <input
                type="number"
                min="0"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                data-testid="ha-cha-total"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Advance (₹)</label>
              <input
                type="number"
                min="0"
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
                data-testid="ha-cha-advance"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                data-testid="ha-cha-mode"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">GST %</label>
              <input
                type="number"
                min="0"
                value={gst}
                onChange={(e) => setGst(e.target.value)}
                data-testid="ha-cha-gst"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <div className="col-span-4 flex flex-wrap justify-between gap-2 text-[11.5px] pt-1 border-t border-slate-200">
              <span>Balance due <b className={balance > 0 ? 'text-rose-700' : 'text-slate-500'}>{fmtMoney(balance)}</b></span>
              <span className={`font-semibold ${paymentStatus === 'paid' ? 'text-emerald-700' : paymentStatus === 'partial' ? 'text-amber-800' : 'text-rose-700'}`}>
                Invoice → {paymentStatus.toUpperCase()}
              </span>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1 block">Notes / audiogram / attach details</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Audiogram summary, special requests, PDF/scan link, etc."
              data-testid="ha-cha-notes"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
            />
          </div>

          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded"
          >Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !patient || !total}
            data-testid="ha-cha-submit"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm"
          >
            <Package size={12} /> {busy ? 'Booking…' : 'Book & Generate Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Reusable per-ear input rows. Grays out the ear that isn't selected. */
function EarRow({ label, leftShown, rightShown, leftVal, onLeft, rightVal, onRight, placeholder, testidPrefix }) {
  return (
    <div className="grid grid-cols-3 border-t border-slate-100">
      <div className="px-3 py-2 text-[11.5px] font-semibold text-slate-600">{label}</div>
      <div className="px-3 py-1.5">
        <input
          value={leftVal}
          onChange={(e) => onLeft(e.target.value)}
          disabled={!leftShown}
          placeholder={leftShown ? placeholder : '—'}
          data-testid={`${testidPrefix}-left`}
          className={`w-full px-2 py-1 text-xs border rounded ${leftShown ? 'border-slate-300' : 'border-slate-200 bg-slate-50 text-slate-300'}`}
        />
      </div>
      <div className="px-3 py-1.5">
        <input
          value={rightVal}
          onChange={(e) => onRight(e.target.value)}
          disabled={!rightShown}
          placeholder={rightShown ? placeholder : '—'}
          data-testid={`${testidPrefix}-right`}
          className={`w-full px-2 py-1 text-xs border rounded ${rightShown ? 'border-slate-300' : 'border-slate-200 bg-slate-50 text-slate-300'}`}
        />
      </div>
    </div>
  );
}

function EarSelectRow({ label, leftShown, rightShown, leftVal, onLeft, rightVal, onRight, options, testidPrefix }) {
  const cell = (val, on, shown, side) => (
    <div className="px-3 py-1.5">
      <select
        value={val}
        onChange={(e) => on(e.target.value)}
        disabled={!shown}
        data-testid={`${testidPrefix}-${side}`}
        className={`w-full px-2 py-1 text-xs border rounded ${shown ? 'border-slate-300' : 'border-slate-200 bg-slate-50 text-slate-300'}`}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
  return (
    <div className="grid grid-cols-3 border-t border-slate-100">
      <div className="px-3 py-2 text-[11.5px] font-semibold text-slate-600">{label}</div>
      {cell(leftVal, onLeft, leftShown, 'left')}
      {cell(rightVal, onRight, rightShown, 'right')}
    </div>
  );
}
