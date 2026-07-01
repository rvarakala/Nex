import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const STATUS_STYLE = {
  draft:     'bg-slate-100 text-slate-600',
  sent:      'bg-blue-100 text-blue-800',
  accepted:  'bg-emerald-100 text-emerald-800',
  rejected:  'bg-rose-100 text-rose-700',
  expired:   'bg-amber-100 text-amber-800',
  cancelled: 'bg-slate-200 text-slate-600 line-through',
  converted: 'bg-indigo-100 text-indigo-800',
};

export default function QuotationStudioPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    const params = status ? { status } : {};
    const r = await axios.get(`${API}/ha/quotations`, { params });
    setRows(r.data);
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-5" data-testid="ha-quotations-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Quotation Studio</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Build priced proposals. Convert to a Sale to reserve physical units.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="ha-quote-status-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">All statuses</option>
            {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setCreating(true)} data-testid="ha-quote-new" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm">+ New Quote</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Quote No</th>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Pair</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-400 italic text-xs">No quotations yet.</td></tr>}
            {rows.map(q => (
              <tr key={q.quote_no} className="border-t border-slate-100 hover:bg-slate-50/50" data-testid={`ha-quote-row-${q.quote_no}`}>
                <td className="px-3 py-2 font-mono text-xs font-bold">{q.quote_no}</td>
                <td className="px-3 py-2">{q.patient_name || q.patient_id}</td>
                <td className="px-3 py-2 text-right tabular-nums">{q.lines?.length || 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtINR(q.total)}</td>
                <td className="px-3 py-2">{q.is_pair && <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-bold">L+R</span>}</td>
                <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[q.status]}`}>{q.status.toUpperCase()}</span></td>
                <td className="px-3 py-2 text-[10px] text-slate-500">{q.created_at ? new Date(q.created_at).toLocaleDateString('en-IN') : ''}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setOpen(q.quote_no)} data-testid={`ha-quote-open-${q.quote_no}`} className="text-[10px] text-indigo-600 font-semibold hover:underline">Open →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <NewQuoteModal onClose={() => setCreating(false)} onCreated={(q) => { setCreating(false); load(); setOpen(q.quote_no); }} />}
      {open && <QuoteDetailDrawer quoteNo={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function NewQuoteModal({ onClose, onCreated }) {
  const [patients, setPatients] = useState([]);
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [patient, setPatient] = useState('');
  const [branch, setBranch] = useState('');
  const [isPair, setIsPair] = useState(false);
  const [lines, setLines] = useState([{ _key: Math.random().toString(36).slice(2), product_id: '', side: 'single', qty: 1, unit_price: 0, discount_pct: 0, gst_rate: 18 }]);
  const [patientSearch, setPatientSearch] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [b, p] = await Promise.all([
        axios.get(`${API}/branches`),
        axios.get(`${API}/ha/products?active=true`),
      ]);
      setBranches(b.data); setProducts(p.data);
      if (b.data[0]) setBranch(b.data[0].branch_id);
    })();
  }, []);

  useEffect(() => {
    if (!patientSearch || patientSearch.length < 2) { setPatients([]); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: patientSearch, limit: 10 } });
        if (!cancelled) setPatients(Array.isArray(r.data) ? r.data : []);
      } catch (err) {
        if (!cancelled) {
          setPatients([]);
          // eslint-disable-next-line no-console
          console.warn('patient search failed', err?.response?.status, err?.response?.data);
        }
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(h); };
  }, [patientSearch]);

  const productById = useMemo(() => Object.fromEntries(products.map(p => [p.product_id, p])), [products]);

  const lineNet = (l) => l.qty * l.unit_price * (1 - l.discount_pct / 100) * (1 + l.gst_rate / 100);
  const total = lines.reduce((a, l) => a + lineNet(l), 0);

  const belowFloor = (l) => {
    const p = productById[l.product_id];
    if (!p || !p.min_sell_price) return false;
    const net = l.unit_price * (1 - l.discount_pct / 100);
    return net < p.min_sell_price;
  };

  const submit = async () => {
    setErr('');
    try {
      const cleanLines = lines
        .filter(l => l.product_id && l.qty > 0)
        .map(l => ({ ...l }));
      if (!cleanLines.length) { setErr('Add at least one line'); return; }
      if (!patient) { setErr('Select a patient'); return; }
      const body = { branch_id: branch, patient_id: patient, is_pair: isPair, lines: cleanLines };
      const r = await axios.post(`${API}/ha/quotations`, body);
      onCreated(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()} data-testid="ha-quote-new-modal">
        <h2 className="text-lg font-bold mb-3">New Quotation</h2>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Patient *</span>
            {patient ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-sm">
                <span className="flex-1">{patients.find(p => p.patient_id === patient)?.name || patient}</span>
                <button onClick={() => { setPatient(''); setPatientSearch(''); }} className="text-rose-500 text-xs">✕</button>
              </div>
            ) : (
              <>
                <input value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient by name / mobile…" data-testid="ha-quote-patient-search" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                {patients.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-slate-200 rounded">
                    {patients.map(p => (
                      <button key={p.patient_id} onClick={() => setPatient(p.patient_id)} className="block w-full text-left text-xs px-2 py-1 hover:bg-indigo-50" data-testid={`ha-quote-patient-pick-${p.patient_id}`}>
                        <span className="font-semibold">{p.name}</span> <span className="text-slate-500">({p.mobile || '—'})</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Branch</span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" data-testid="ha-quote-branch">
              {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={isPair} onChange={(e) => {
            const next = e.target.checked;
            setIsPair(next);
            // Auto-shape lines so the backend pair validator (exactly one
            // LEFT qty=1 + one RIGHT qty=1) is satisfied without making the
            // clinic owner figure out the rule.
            if (next) {
              setLines(prev => {
                const base = prev[0] || { _key: Math.random().toString(36).slice(2), product_id: '', qty: 1, unit_price: 0, discount_pct: 0, gst_rate: 18 };
                const left  = { ...base, _key: `${Math.random().toString(36).slice(2)}-L`, side: 'left',  qty: 1 };
                const right = { ...base, _key: `${Math.random().toString(36).slice(2)}-R`, side: 'right', qty: 1 };
                return [left, right];
              });
            } else {
              // Collapse back to a single line keyed off the existing first row.
              setLines(prev => {
                const first = prev[0] || { _key: Math.random().toString(36).slice(2), product_id: '', qty: 1, unit_price: 0, discount_pct: 0, gst_rate: 18 };
                return [{ ...first, _key: Math.random().toString(36).slice(2), side: 'single', qty: 1 }];
              });
            }
          }} data-testid="ha-quote-is-pair" />
          <span className="font-semibold">Binaural (L+R pair)</span> <span className="text-[11px] text-slate-500">— auto-creates one LEFT &amp; one RIGHT line</span>
        </label>

        <div className="border border-slate-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left">Product</th>
                <th className="px-2 py-1 text-left">Side</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Unit ₹</th>
                <th className="px-2 py-1 text-right">Disc %</th>
                <th className="px-2 py-1 text-right">GST %</th>
                <th className="px-2 py-1 text-right">Line Total</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById[l.product_id];
                const under = belowFloor(l);
                return (
                  <tr key={l._key || `L${i}`} className={`border-t border-slate-100 ${under ? 'bg-rose-50' : ''}`}>
                    <td className="px-2 py-1">
                      <select value={l.product_id} onChange={(e) => {
                        const copy = [...lines]; copy[i] = { ...copy[i], product_id: e.target.value };
                        const pr = productById[e.target.value]; if (pr) { copy[i].unit_price = pr.mrp || 0; copy[i].gst_rate = pr.gst_rate; }
                        setLines(copy);
                      }} data-testid={`ha-quote-line-${i}-prod`} className="w-full border border-slate-300 rounded px-1 py-0.5 text-xs">
                        <option value="">—</option>
                        {products.map(pp => <option key={pp.product_id} value={pp.product_id}>{`${pp.brand} ${pp.model}`}</option>)}
                      </select>
                      {under && p && <div className="text-[10px] text-rose-600 mt-0.5">⚠ below floor ({fmtINR(p.min_sell_price)})</div>}
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.side} onChange={(e) => { const c=[...lines]; c[i]={...c[i],side:e.target.value}; setLines(c); }} data-testid={`ha-quote-line-${i}-side`} className="border border-slate-300 rounded px-1 py-0.5 text-xs">
                        <option value="single">single</option>
                        <option value="left">left</option>
                        <option value="right">right</option>
                        <option value="both">both</option>
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right"><input type="number" min={1} value={l.qty} onChange={(e) => { const c=[...lines]; c[i]={...c[i],qty:Number(e.target.value)}; setLines(c); }} data-testid={`ha-quote-line-${i}-qty`} className="w-14 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></td>
                    <td className="px-2 py-1 text-right"><input type="number" value={l.unit_price} onChange={(e) => { const c=[...lines]; c[i]={...c[i],unit_price:Number(e.target.value)}; setLines(c); }} data-testid={`ha-quote-line-${i}-price`} className="w-24 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></td>
                    <td className="px-2 py-1 text-right"><input type="number" value={l.discount_pct} onChange={(e) => { const c=[...lines]; c[i]={...c[i],discount_pct:Number(e.target.value)}; setLines(c); }} className="w-14 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></td>
                    <td className="px-2 py-1 text-right"><input type="number" value={l.gst_rate} onChange={(e) => { const c=[...lines]; c[i]={...c[i],gst_rate:Number(e.target.value)}; setLines(c); }} className="w-14 border border-slate-300 rounded px-1 py-0.5 text-right text-xs" /></td>
                    <td className="px-2 py-1 text-right tabular-nums text-xs">{fmtINR(lineNet(l))}</td>
                    <td className="px-2 py-1 text-right">{lines.length > 1 && <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-rose-500 text-xs">×</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3">
          <button onClick={() => setLines([...lines, { _key: Math.random().toString(36).slice(2), product_id: '', side: 'single', qty: 1, unit_price: 0, discount_pct: 0, gst_rate: 18 }])} data-testid="ha-quote-add-line" className="text-xs text-indigo-600 font-semibold hover:underline">+ Add line</button>
          <div className="text-sm"><span className="text-slate-500 mr-2">Total (incl GST):</span><span className="font-bold text-lg tabular-nums">{fmtINR(total)}</span></div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} data-testid="ha-quote-save" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded">Create Quotation</button>
        </div>
      </div>
    </div>
  );
}

function QuoteDetailDrawer({ quoteNo, onClose, onChanged }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(null);
  const [serials, setSerials] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [approvalUser, setApprovalUser] = useState('');
  const [availableTradeIns, setAvailableTradeIns] = useState([]);
  const [tradeInId, setTradeInId] = useState('');
  const [err, setErr] = useState('');
  const [converting, setConverting] = useState(false);

  const load = useCallback(async () => {
    const [qd, si] = await Promise.all([
      axios.get(`${API}/ha/quotations/${quoteNo}`),
      axios.get(`${API}/ha/serial-items`, { params: { state: 'IN_STOCK' } }),
    ]);
    setQ(qd.data);
    setSerials(si.data);
    // Fetch accepted+unlinked trade-ins for this patient
    try {
      const r = await axios.get(`${API}/ha/trade-ins/available-for-patient/${qd.data.patient_id}`);
      setAvailableTradeIns(r.data || []);
    } catch { setAvailableTradeIns([]); }
  }, [quoteNo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Load clinic_owner / super_admin users for the approver picker
    axios.get(`${API}/users`).then(r => setUsers(r.data.filter(u => ['clinic_owner', 'super_admin'].includes(u.role))));
  }, []);

  if (!q) return null;
  const below = q.margin_analysis?.below_floor_line_indexes || [];
  const canConvert = ['draft', 'sent', 'accepted'].includes(q.status);

  const transition = async (to) => {
    try {
      await axios.post(`${API}/ha/quotations/${quoteNo}/status`, { to_status: to });
      await load();
      onChanged && onChanged();
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
  };

  const convert = async () => {
    setErr('');
    try {
      // Check that every serialised line has an assignment
      for (let i = 0; i < q.lines.length; i++) {
        const p = q.margin_analysis.products[q.lines[i].product_id];
        const lineProduct = await axios.get(`${API}/ha/products/${q.lines[i].product_id}`).then(r => r.data);
        if (lineProduct.is_serialised && !assignments[i]) {
          setErr(`Line ${i + 1}: pick an IN_STOCK serial for ${p.brand} ${p.model}`);
          return;
        }
      }
      const body = { quote_no: quoteNo, serial_assignments: assignments };
      if (below.length && approvalUser) body.margin_approval_user_id = approvalUser;
      if (tradeInId) body.trade_in_id = tradeInId;
      const r = await axios.post(`${API}/ha/sales`, body);
      const saleNo = r.data.sale_no;
      const tradeMsg = r.data.trade_in_credit ? ` Trade-in credit ₹${r.data.trade_in_credit} applied.` : '';
      setConverting(false);
      setTradeInId('');
      const goInvoice = window.confirm(
        `Sale ${saleNo} created — serial(s) RESERVED.${tradeMsg}\n\nGenerate the invoice now? (Make/model/serial/tier are pre-filled — you'll land on the printable invoice page.)`
      );
      if (goInvoice) {
        // One-click: server generates the invoice atomically (including
        // GST split + ha_sales back-link), then we navigate to the detail
        // page so the clinic owner can hit Print immediately.
        try {
          const ai = await axios.post(`${API}/ha/sales/${encodeURIComponent(saleNo)}/auto-invoice`);
          const invoiceId = ai.data?.invoice_id;
          if (invoiceId) {
            navigate(`/billing/invoice/${invoiceId}`);
            return;
          }
          // Fallback: legacy prefill route if the auto-invoice response is
          // somehow missing the id.
          navigate(`/billing/invoices/new?from_sale=${encodeURIComponent(saleNo)}`);
          return;
        } catch (autoErr) {
          // Surface the real backend reason; fall back to the manual create
          // form so the clinic owner can still proceed.
          const det = autoErr?.response?.data?.detail;
          setErr(typeof det === 'string' ? det : (det ? JSON.stringify(det) : 'Auto-invoice failed — opening manual form'));
          navigate(`/billing/invoices/new?from_sale=${encodeURIComponent(saleNo)}`);
          return;
        }
      }
      await load();
      onChanged && onChanged();
    } catch (e) {
      const det = e?.response?.data?.detail;
      if (typeof det === 'object' && det?.error === 'margin_approval_required') {
        setErr('This quote has line(s) below the min-sell floor. Pick an approver (clinic_owner / super_admin) and retry.');
      } else {
        setErr(typeof det === 'string' ? det : JSON.stringify(det) || 'Convert failed');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="ha-quote-detail-drawer">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-3xl bg-white shadow-2xl flex flex-col">
        <div className="border-b border-slate-200 p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Quotation</div>
            <div className="text-lg font-bold font-mono">{q.quote_no}</div>
            <div className="text-[11px] text-slate-500">{q.patient_name} · <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[q.status]}`}>{q.status.toUpperCase()}</span>{q.is_pair && <span className="ml-1 text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-bold">L+R PAIR</span>}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 text-2xl leading-none" data-testid="ha-quote-close">×</button>
        </div>

        {err && <div className="mx-4 mt-3 text-xs text-rose-700 bg-rose-50 rounded p-2">{err}</div>}

        <div className="p-4 space-y-3">
          <div className="bg-slate-50 rounded p-3">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left pb-1">Line</th><th className="text-left pb-1">Product</th><th className="pb-1">Side</th>
                  <th className="text-right pb-1">Qty</th><th className="text-right pb-1">Unit</th><th className="text-right pb-1">Disc</th><th className="text-right pb-1">Net</th>
                  {converting && <th className="text-left pb-1">Assign Serial</th>}
                </tr>
              </thead>
              <tbody>
                {q.lines.map((l, i) => {
                  const p = q.margin_analysis.products[l.product_id];
                  const under = below.includes(i);
                  const eligible = serials.filter(s => s.product_id === l.product_id);
                  return (
                    <tr key={`${l.product_id || 'p'}-${l.side || 's'}-${i}`} className={`border-t border-slate-200 ${under ? 'bg-rose-50' : ''}`} data-testid={`ha-quote-detail-line-${i}`}>
                      <td className="py-1 text-xs">{i + 1}</td>
                      <td className="py-1">{p ? `${p.brand} ${p.model}` : l.product_id}{under && <span className="ml-1 text-[10px] text-rose-700">⚠ below floor</span>}</td>
                      <td className="py-1 text-xs uppercase">{l.side}</td>
                      <td className="py-1 text-right">{l.qty}</td>
                      <td className="py-1 text-right tabular-nums">{fmtINR(l.unit_price)}</td>
                      <td className="py-1 text-right tabular-nums">{l.discount_pct}%</td>
                      <td className="py-1 text-right tabular-nums">{fmtINR(l.qty * l.unit_price * (1 - l.discount_pct / 100) * (1 + l.gst_rate / 100))}</td>
                      {converting && (
                        <td className="py-1">
                          <select value={assignments[i] || ''} onChange={(e) => setAssignments({ ...assignments, [i]: e.target.value })} data-testid={`ha-quote-assign-${i}`} className="border border-slate-300 rounded px-1 py-0.5 text-xs">
                            <option value="">— pick IN_STOCK unit —</option>
                            {eligible.map(s => <option key={s.serial_id} value={s.serial_id}>{s.serial_no}</option>)}
                          </select>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300 font-bold">
                  <td colSpan={6} className="py-2 text-right">Total</td>
                  <td className="py-2 text-right tabular-nums">{fmtINR(q.total)}</td>
                  {converting && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {!converting && (
            <div className="flex gap-2 flex-wrap">
              {q.status === 'draft' && <button onClick={() => transition('sent')} data-testid="ha-quote-send" className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded">Mark Sent</button>}
              {q.status === 'sent' && <button onClick={() => transition('accepted')} data-testid="ha-quote-accept" className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded">Mark Accepted</button>}
              {q.status === 'sent' && <button onClick={() => transition('rejected')} className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded">Mark Rejected</button>}
              {canConvert && <button onClick={() => setConverting(true)} data-testid="ha-quote-convert-start" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow">Convert → Sale</button>}
              {q.status !== 'cancelled' && q.status !== 'converted' && <button onClick={() => transition('cancelled')} className="px-3 py-1.5 text-xs font-semibold bg-slate-500 hover:bg-slate-600 text-white rounded">Cancel</button>}
              {q.converted_sale_no && (
                <>
                  <div className="text-xs text-slate-600 ml-auto">Converted to sale <span className="font-mono font-bold">{q.converted_sale_no}</span></div>
                  <button
                    onClick={() => navigate(`/billing/invoices/new?from_sale=${encodeURIComponent(q.converted_sale_no)}`)}
                    data-testid="ha-quote-go-invoice"
                    className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow">
                    Generate Invoice
                  </button>
                </>
              )}
            </div>
          )}

          {converting && (
            <div className="border border-indigo-200 bg-indigo-50 rounded p-3" data-testid="ha-quote-convert-panel">
              <div className="text-sm font-semibold text-indigo-800 mb-2">Convert to Sale</div>
              {below.length > 0 && (
                <div className="bg-rose-100 border border-rose-300 rounded p-2 text-xs text-rose-800 mb-3">
                  ⚠ <b>Margin floor alert:</b> {below.length} line(s) priced below min_sell_price. Pick a clinic-owner / super-admin approver:
                  <select value={approvalUser} onChange={(e) => setApprovalUser(e.target.value)} data-testid="ha-quote-approver" className="ml-2 border border-slate-300 rounded px-1 py-0.5 text-xs">
                    <option value="">—</option>
                    {users.map(u => <option key={u.user_id} value={u.user_id}>{`${u.name} (${u.role})`}</option>)}
                  </select>
                </div>
              )}
              {availableTradeIns.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-300 rounded p-2 text-xs text-emerald-900 mb-3" data-testid="ha-quote-tradein-picker">
                  🔄 <b>Trade-in credit available:</b> this patient has {availableTradeIns.length} accepted trade-in{availableTradeIns.length > 1 ? 's' : ''} ready to apply.
                  <select value={tradeInId} onChange={(e) => setTradeInId(e.target.value)} data-testid="ha-quote-tradein-select" className="ml-2 border border-emerald-400 rounded px-1 py-0.5 text-xs bg-white">
                    <option value="">— none (skip) —</option>
                    {availableTradeIns.map(ti => (
                      <option key={ti.trade_in_id} value={ti.trade_in_id}>
                        {ti.trade_in_id} · ₹{Number(ti.offered_credit).toLocaleString('en-IN')} credit · {ti.old_brand || ''} {ti.old_model || ''}
                      </option>
                    ))}
                  </select>
                  {tradeInId && (
                    <div className="text-[10px] text-emerald-800 mt-1">
                      Credit will be deducted from this sale's total. Old serial retires to stock-out on mark-paid.
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={convert} data-testid="ha-quote-convert-confirm" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow">Create Sale &amp; Reserve Units</button>
                <button onClick={() => { setConverting(false); setErr(''); setTradeInId(''); }} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
