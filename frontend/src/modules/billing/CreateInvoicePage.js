import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';
import { API, fmtINR, PAYMENT_METHODS } from './billingUtils';
import AddServiceInlineModal from './AddServiceInlineModal';

// Compute totals client-side (mirrors backend logic) for live preview.
function resolveDiscount(line, gross) {
  const type = line.discount_type || 'flat';
  const raw = Number(line.discount_value || 0);
  if (type === 'percent') {
    const pct = Math.max(0, Math.min(100, raw));
    return Math.round(gross * pct) / 100 > 0 ? +(gross * pct / 100).toFixed(2) : 0;
  }
  return Math.max(0, Math.min(gross, +Number(raw || 0).toFixed(2)));
}

function computeLinePreview(line, service) {
  const qty = Number(line.quantity || 1);
  const unit = line.unit_price != null ? Number(line.unit_price) : Number(service?.price || 0);
  const isTaxable = line.is_taxable != null ? line.is_taxable : !!service?.is_taxable;
  const gstRate = line.gst_rate != null ? Number(line.gst_rate) : Number(service?.gst_rate || 0);
  const gstInclusive = service?.gst_inclusive !== false;

  const gross = qty * unit;
  const disc = resolveDiscount(line, gross);
  let taxable, tax;
  if (isTaxable && gstRate > 0 && gstInclusive) {
    const netGross = Math.max(0, gross - disc);
    taxable = +(netGross / (1 + gstRate / 100)).toFixed(2);
    tax = +(netGross - taxable).toFixed(2);
  } else if (isTaxable && gstRate > 0) {
    taxable = Math.max(0, gross - disc);
    tax = +(taxable * gstRate / 100).toFixed(2);
  } else {
    taxable = Math.max(0, gross - disc);
    tax = 0;
  }
  return { taxable, tax, total: +(taxable + tax).toFixed(2), gstRate, discountAmount: disc };
}

export default function CreateInvoicePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const preselectPatient = location.state?.patient || null;           // { patient_id, name, mobile, mrd }
  const preselectSession = location.state?.session_id || null;

  const [services, setServices] = useState([]);
  const [patient, setPatient] = useState(preselectPatient);
  const [patientQuery, setPatientQuery] = useState(preselectPatient?.name || '');
  const [patientResults, setPatientResults] = useState([]);
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [patientGstin, setPatientGstin] = useState('');
  const [payNow, setPayNow] = useState({ enabled: false, method: 'cash', amount: '', reference: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showAddSvc, setShowAddSvc] = useState(false);

  useEffect(() => {
    axios.get(`${API}/billing/services`).then((r) => setServices(r.data || [])).catch(() => {});
  }, []);

  // Patient search (debounced)
  useEffect(() => {
    if (patient && patientQuery === patient.name) return;
    if (!patientQuery || patientQuery.trim().length < 2) { setPatientResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: patientQuery, limit: 6 } });
        setPatientResults(r.data || []);
      } catch { setPatientResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [patientQuery, patient]);

  const svcMap = useMemo(() => Object.fromEntries(services.map((s) => [s.service_id, s])), [services]);

  // Pre-group services by category once per services change (avoids re-computing
  // `.filter(...)` five times on every render of the <select>).
  const SVC_CATEGORIES = ['Consultation', 'Audiology', 'Hearing Aid', 'Accessory'];
  const svcGroups = useMemo(() => {
    const known = SVC_CATEGORIES.map((cat) => ({ cat, items: services.filter((s) => s.category === cat) }))
      .filter(({ items }) => items.length > 0);
    const other = services.filter((s) => !SVC_CATEGORIES.includes(s.category));
    return { known, other };
  }, [services]);

  const addLine = (service_id) => {
    const svc = svcMap[service_id];
    if (!svc) return;
    setLines((ls) => [...ls, {
      key: Math.random().toString(36).slice(2),
      service_id,
      description: svc.name,
      quantity: 1,
      unit_price: svc.price,
      discount_type: 'flat',
      discount_value: 0,
      is_taxable: svc.is_taxable,
      gst_rate: svc.gst_rate,
    }]);
  };

  // Inline "Add Service" modal — service is already persisted by the modal,
  // we just merge it into local catalog state and immediately add it as a line.
  const handleServiceCreated = (svc) => {
    setServices((prev) => [...prev, svc]);
    setLines((ls) => [...ls, {
      key: Math.random().toString(36).slice(2),
      service_id: svc.service_id,
      description: svc.name,
      quantity: 1,
      unit_price: svc.price,
      discount_type: 'flat',
      discount_value: 0,
      is_taxable: svc.is_taxable,
      gst_rate: svc.gst_rate,
    }]);
  };

  const addCustomLine = () => {
    setLines((ls) => [...ls, {
      key: Math.random().toString(36).slice(2),
      service_id: null,
      description: '',
      quantity: 1,
      unit_price: 0,
      discount_type: 'flat',
      discount_value: 0,
      is_taxable: false,
      gst_rate: 0,
    }]);
  };

  const updateLine = (key, patch) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key));

  // Totals preview
  const totals = useMemo(() => {
    let subtotal = 0, tax = 0, discount = 0;
    for (const ln of lines) {
      const svc = ln.service_id ? svcMap[ln.service_id] : null;
      const { taxable, tax: t, discountAmount } = computeLinePreview(ln, svc);
      subtotal += taxable;
      tax += t;
      discount += discountAmount;
    }
    const grand = +(subtotal + tax).toFixed(2);
    const rounded = Math.round(grand);
    return {
      subtotal: +subtotal.toFixed(2),
      discount: +discount.toFixed(2),
      tax: +tax.toFixed(2),
      grand,
      rounded,
      round_off: +(rounded - grand).toFixed(2),
    };
  }, [lines, svcMap]);

  const valid = patient && lines.length > 0 && lines.every((l) => (l.description || '').trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setSaving(true); setError(null);
    try {
      const body = {
        patient_id: patient.patient_id,
        session_id: preselectSession,
        lines: lines.map((l) => ({
          service_id: l.service_id || null,
          description: l.service_id ? null : l.description,
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price),
          discount_type: l.discount_type || 'flat',
          discount_value: Number(l.discount_value) || 0,
          is_taxable: l.is_taxable,
          gst_rate: Number(l.gst_rate) || 0,
        })),
        notes: notes || null,
        patient_gstin: patientGstin || null,
        initial_payment: payNow.enabled && payNow.amount
          ? { method: payNow.method, amount: Number(payNow.amount), reference: payNow.reference || null }
          : null,
      };
      const r = await axios.post(`${API}/billing/invoices`, body);
      navigate(`/billing/invoice/${r.data.invoice_id}`);
    } catch (e) {
      const d = e?.response?.data?.detail;
      setError(typeof d === 'string' ? d : (e?.message || 'Failed to create invoice'));
    } finally { setSaving(false); }
  };

  return (
    <div className="p-4 grid grid-cols-[1fr_320px] gap-3" data-testid="create-invoice-page">
      {/* LEFT: form */}
      <div className="space-y-3">
        {/* Patient */}
        <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Patient</div>
          <div className="relative">
            <input
              type="text" value={patientQuery}
              onChange={(e) => { setPatientQuery(e.target.value); setPatient(null); }}
              placeholder="Search by name / mobile / MRD…"
              data-testid="ci-patient-search"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-emerald-500"
            />
            {patientResults.length > 0 && !patient && (
              <div className="absolute z-10 mt-0.5 w-full max-h-48 overflow-auto bg-white border border-slate-300 rounded shadow-lg">
                {patientResults.map((p) => (
                  <button key={p.patient_id} type="button"
                    data-testid={`ci-patient-${p.patient_id}`}
                    onClick={() => { setPatient(p); setPatientQuery(p.name); setPatientResults([]); }}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[10px] text-slate-500">{p.mrd || p.patient_id}{p.mobile ? ` · ${p.mobile}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {patient && (
            <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded p-2">
              <div><span className="text-slate-500">Name:</span> <b>{patient.name}</b></div>
              <div><span className="text-slate-500">MRD:</span> <b>{patient.mrd || patient.patient_id}</b></div>
              <div><span className="text-slate-500">Mobile:</span> {patient.mobile || '—'}</div>
              <div><span className="text-slate-500">State:</span> {patient.state || '—'}</div>
              <div className="col-span-2">
                <label className="text-[9px] uppercase font-semibold text-slate-500">Patient GSTIN (optional, B2B)</label>
                <input type="text" value={patientGstin} onChange={(e) => setPatientGstin(e.target.value.toUpperCase())}
                  data-testid="ci-patient-gstin"
                  placeholder="15-char GSTIN"
                  maxLength={15}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono" />
              </div>
            </div>
          )}
        </div>

        {/* Quick add services */}
        <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Add Service</div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setShowAddSvc(true)} data-testid="ci-new-service"
                className="text-[10px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded shadow-sm">
                + New service
              </button>
              <button onClick={addCustomLine} data-testid="ci-add-custom"
                className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded">+ Custom line</button>
            </div>
          </div>
          {services.length === 0 ? (
            <div
              data-testid="ci-no-services"
              className="text-xs bg-amber-50 border border-amber-200 rounded px-2.5 py-2 text-amber-800 flex items-center justify-between gap-2"
            >
              <span>
                <b>No services in your catalogue yet.</b> Click <b>+ New service</b> above to add your first one — it will be saved permanently and reused on every future invoice.
              </span>
            </div>
          ) : (
            <select
              onChange={(e) => {
                if (e.target.value === '__new__') { setShowAddSvc(true); e.target.value = ''; return; }
                if (e.target.value) { addLine(e.target.value); e.target.value = ''; }
              }}
              data-testid="ci-add-service"
              defaultValue=""
              className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
            >
              <option value="">— Pick a service from catalogue —</option>
              <option value="__new__" className="font-semibold text-emerald-700">+ Add new service to catalogue…</option>
              {svcGroups.known.map(({ cat, items }) => (
                <optgroup key={cat} label={cat}>
                  {items.map((s) => {
                    const label = `${s.name} — ₹${s.price}${s.is_taxable ? ` (+${s.gst_rate}% GST)` : ' (exempt)'}`;
                    return <option key={s.service_id} value={s.service_id}>{label}</option>;
                  })}
                </optgroup>
              ))}
              {svcGroups.other.length > 0 && (
                <optgroup label="Other">
                  {svcGroups.other.map((s) => {
                    const label = `${s.name} — ₹${s.price}${s.is_taxable ? ` (+${s.gst_rate}% GST)` : ' (exempt)'}`;
                    return <option key={s.service_id} value={s.service_id}>{label}</option>;
                  })}
                </optgroup>
              )}
            </select>
          )}
        </div>

        <AddServiceInlineModal
          open={showAddSvc}
          onClose={() => setShowAddSvc(false)}
          onCreated={handleServiceCreated}
        />

        {/* Lines */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
              <tr className="text-left">
                <th className="px-2 py-1.5 font-semibold">Description</th>
                <th className="px-2 py-1.5 font-semibold">HSN</th>
                <th className="px-2 py-1.5 font-semibold w-12">Qty</th>
                <th className="px-2 py-1.5 font-semibold w-24 text-right">Unit</th>
                <th className="px-2 py-1.5 font-semibold w-36 text-right">Discount</th>
                <th className="px-2 py-1.5 font-semibold w-16 text-right">GST%</th>
                <th className="px-2 py-1.5 font-semibold w-28 text-right">Total</th>
                <th className="px-2 py-1.5 w-6"></th>
              </tr>
            </thead>
            <tbody data-testid="ci-lines">
              {lines.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400 italic">No lines yet. Pick a service from the catalogue above.</td></tr>
              )}
              {lines.map((l) => {
                const svc = l.service_id ? svcMap[l.service_id] : null;
                const p = computeLinePreview(l, svc);
                return (
                  <tr key={l.key} data-testid={`ci-line-${l.key}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1">
                      <input type="text" value={l.description}
                        disabled={!!l.service_id}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        className="w-full px-1.5 py-1 text-xs border border-slate-200 rounded disabled:bg-slate-50" />
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-[10px] font-mono text-slate-500">{svc?.hsn_sac || '—'}</span>
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={l.quantity} min="0.01" step="0.5"
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                        className="w-full px-1 py-1 text-xs border border-slate-200 rounded text-right tabular-nums" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={l.unit_price} step="1"
                        onChange={(e) => updateLine(l.key, { unit_price: e.target.value })}
                        className="w-full px-1 py-1 text-xs border border-slate-200 rounded text-right tabular-nums" />
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input type="number" value={l.discount_value} step="1" min="0"
                          max={l.discount_type === 'percent' ? 100 : undefined}
                          onChange={(e) => updateLine(l.key, { discount_value: e.target.value })}
                          data-testid={`ci-discount-value-${l.key}`}
                          className="w-full px-1 py-1 text-xs border border-slate-200 rounded text-right tabular-nums" />
                        <button
                          type="button"
                          onClick={() => updateLine(l.key, { discount_type: l.discount_type === 'percent' ? 'flat' : 'percent' })}
                          data-testid={`ci-discount-toggle-${l.key}`}
                          title={l.discount_type === 'percent' ? 'Switch to ₹ flat' : 'Switch to %'}
                          className={`text-[10px] font-bold px-1.5 py-1 rounded border leading-none transition-colors ${
                            l.discount_type === 'percent'
                              ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                              : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                          }`}>
                          {l.discount_type === 'percent' ? '%' : '₹'}
                        </button>
                      </div>
                      {l.discount_type === 'percent' && Number(l.discount_value) > 0 && (
                        <div className="text-[9px] text-right text-slate-500 tabular-nums mt-0.5">
                          = {fmtINR(p.discountAmount)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-500">{l.is_taxable ? `${l.gst_rate}%` : 'Exempt'}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtINR(p.total)}</td>
                    <td className="px-2 py-1">
                      <button onClick={() => removeLine(l.key)} data-testid={`ci-remove-${l.key}`}
                        className="text-rose-500 hover:text-rose-700 text-sm leading-none">×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg border border-slate-200 p-3">
          <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-700 mb-1">Notes / Remarks</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="e.g., Payment plan, referral notes…"
            data-testid="ci-notes"
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded resize-y" />
        </div>
      </div>

      {/* RIGHT: totals + pay now + submit */}
      <div className="space-y-3">
        <div className="bg-white rounded-lg border-2 border-emerald-300 p-3 space-y-1 sticky top-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 mb-1">Summary</div>
          <Row label="Subtotal (taxable value)" value={fmtINR(totals.subtotal)} />
          {totals.discount > 0 && <Row label="Discount" value={`−${fmtINR(totals.discount)}`} />}
          {totals.tax > 0 && <Row label="GST total" value={fmtINR(totals.tax)} />}
          <Row label="Grand total" value={fmtINR(totals.grand)} strong />
          {totals.round_off !== 0 && <Row label="Round off" value={fmtINR(totals.round_off)} />}
          <div className="border-t border-emerald-200 pt-1.5 mt-1.5">
            <Row label="Payable" value={fmtINR(totals.rounded)} big />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Collect Payment Now?</div>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={payNow.enabled} data-testid="ci-paynow-toggle"
                onChange={(e) => setPayNow({ ...payNow, enabled: e.target.checked, amount: e.target.checked ? totals.rounded : '' })} />
              <span className="text-[10px] text-slate-600">Yes</span>
            </label>
          </div>
          {payNow.enabled && (
            <div className="space-y-1.5">
              <select value={payNow.method} onChange={(e) => setPayNow({ ...payNow, method: e.target.value })}
                data-testid="ci-paynow-method"
                className="w-full text-xs border border-slate-300 rounded px-2 py-1 bg-white">
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <input type="number" value={payNow.amount} placeholder="Amount"
                onChange={(e) => setPayNow({ ...payNow, amount: e.target.value })}
                data-testid="ci-paynow-amount"
                className="w-full text-xs border border-slate-300 rounded px-2 py-1 tabular-nums" />
              <input type="text" value={payNow.reference}
                onChange={(e) => setPayNow({ ...payNow, reference: e.target.value })}
                placeholder="Reference (UPI UTR / card last-4 / txn id)"
                data-testid="ci-paynow-ref"
                className="w-full text-xs border border-slate-300 rounded px-2 py-1 font-mono" />
            </div>
          )}
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-[11px] rounded px-2 py-1.5" data-testid="ci-error">
            {error}
          </div>
        )}

        <button onClick={submit} disabled={!valid || saving} data-testid="ci-submit"
          className="w-full py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded shadow-sm">
          {saving ? 'Creating invoice…' : 'Create Invoice'}
        </button>
      </div>
    </div>
  );
}

const Row = ({ label, value, strong, big }) => (
  <div className={`flex justify-between items-baseline ${big ? 'text-sm' : 'text-xs'}`}>
    <span className={`${big ? 'font-bold text-slate-700' : 'text-slate-600'}`}>{label}</span>
    <span className={`tabular-nums ${big ? 'text-xl font-bold text-emerald-700' : strong ? 'font-bold text-slate-800' : 'text-slate-800'}`}>
      {value}
    </span>
  </div>
);
