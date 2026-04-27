import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API, fmtINR, fmtDate, fmtDateTime, PAYMENT_METHODS, StatusPill } from './billingUtils';
import { useAuth } from '../../AuthContext';
import ErrorToast, { describeError } from '../../components/ErrorToast';

export default function InvoiceDetailPage() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { user, clinic } = useAuth();
  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/billing/invoices/${invoiceId}`);
      setInv(r.data);
    } finally { setLoading(false); }
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  const whatsappShare = () => {
    if (!inv?.patient_mobile) { alert('Patient has no mobile number on record.'); return; }
    const digits = (inv.patient_mobile || '').replace(/\D/g, '');
    const mobile = digits.length === 10 ? `91${digits}` : digits;
    const msg =
      `*${clinic?.name || 'ACS Audiology'}*%0A` +
      `Invoice: ${inv.invoice_no}%0A` +
      `Patient: ${inv.patient_name}%0A` +
      `Amount: ₹${inv.rounded_total}%0A` +
      `Paid: ₹${inv.paid_total}%0A` +
      (inv.due_total > 0 ? `Balance due: ₹${inv.due_total}%0A` : `Fully paid.%0A`) +
      `Thank you!`;
    window.open(`https://wa.me/${mobile}?text=${msg}`, '_blank');
  };

  const [actionErr, setActionErr] = useState(null);
  const cancelInvoice = async () => {
    const reason = window.prompt('Reason for cancellation:');
    if (!reason) return;
    setActionErr(null);
    try {
      const r = await axios.post(`${API}/billing/invoices/${inv.invoice_id}/cancel`, { reason });
      setInv(r.data);
    } catch (e) {
      setActionErr(describeError(e, 'Failed to cancel invoice'));
    }
  };

  if (loading) return <div className="p-8 text-center text-sm text-slate-400 italic">Loading invoice…</div>;
  if (!inv) return <div className="p-8 text-center text-sm text-rose-500">Invoice not found.</div>;

  // Hide Discount column entirely when no line has a discount.
  const hasDiscount = (inv.lines || []).some((l) => Number(l.discount_amount) > 0);
  const colSpanBase = hasDiscount ? 8 : 7;

  return (
    <div className="p-3 md:p-4 space-y-3" data-testid={`invoice-detail-${inv.invoice_id}`}>
      {/* Action errors (cancel / etc.) */}
      {actionErr && <ErrorToast err={actionErr} testid="inv-action-err" />}
      {/* Non-print toolbar */}
      <div className="bg-white rounded-lg border border-slate-200 p-2 flex items-center gap-2 flex-wrap print:hidden">
        <Link to="/billing" className="text-xs text-slate-600 hover:text-emerald-700">← Back</Link>
        <div className="flex-1" />
        <button onClick={() => window.print()} data-testid="inv-print-a4"
          className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded">Print A4</button>
        <button onClick={() => printThermal(inv, clinic)} data-testid="inv-print-thermal"
          className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-700 text-white font-semibold rounded">Thermal Receipt</button>
        <button onClick={whatsappShare} data-testid="inv-whatsapp"
          className="px-3 py-1 text-xs bg-[#25D366] hover:bg-[#1ebe5a] text-white font-semibold rounded">WhatsApp</button>
        {inv.status !== 'cancelled' && inv.due_total > 0.01 && (
          <button onClick={() => setPayOpen(true)} data-testid="inv-add-payment"
            className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded">+ Collect Payment</button>
        )}
        {inv.status === 'paid' && (
          <button
            onClick={() => {
              const followUp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
              navigate('/frontdesk/appointments', {
                state: {
                  bookForPatient: { patient_id: inv.patient_id, name: inv.patient_name },
                  suggestedDate: followUp.toISOString(),
                },
              });
            }}
            data-testid="inv-book-next"
            title="Schedule a follow-up appointment for this patient"
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded shadow-sm">
            📅 Book Next Appointment
          </button>
        )}
        {inv.status !== 'cancelled' && (user?.role === 'super_admin' || user?.role === 'accounts') && (
          <button onClick={cancelInvoice} data-testid="inv-cancel"
            className="px-3 py-1 text-xs border border-rose-300 text-rose-600 hover:bg-rose-50 font-semibold rounded">Cancel Invoice</button>
        )}
      </div>

      {/* A4 printable sheet */}
      <div id="a4-invoice" className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm max-w-[820px] mx-auto print:shadow-none print:border-0 print:rounded-none print:max-w-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3 mb-4">
          <div>
            <div className="text-2xl font-bold text-slate-800">{clinic?.name || 'ACS Audiology Clinic'}</div>
            <div className="text-[11px] text-slate-600 leading-tight">
              {clinic?.address && <div>{clinic.address}</div>}
              {(clinic?.city || clinic?.state) && <div>{[clinic?.city, clinic?.state, clinic?.pincode].filter(Boolean).join(', ')}</div>}
              {clinic?.phone && <div>Phone: {clinic.phone}</div>}
              {clinic?.email && <div>Email: {clinic.email}</div>}
              {clinic?.gstin && <div className="font-mono">GSTIN: {clinic.gstin}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider font-bold text-slate-500">Tax Invoice</div>
            <div className="text-lg font-bold text-slate-800 font-mono">{inv.invoice_no}</div>
            <div className="text-[11px] text-slate-600 mt-0.5">Date: {fmtDate(inv.invoice_date)}</div>
            <div className="print:hidden mt-1"><StatusPill status={inv.status} /></div>
          </div>
        </div>

        {/* Bill To */}
        <div className="grid grid-cols-2 gap-4 text-[12px] mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-0.5">Bill To</div>
            <div className="font-bold text-slate-800">{inv.patient_name}</div>
            {inv.mrd && <div className="text-slate-600">MRD: <span className="font-mono">{inv.mrd}</span></div>}
            {inv.patient_mobile && <div className="text-slate-600">Mobile: {inv.patient_mobile}</div>}
            {inv.patient_address && <div className="text-slate-600">{inv.patient_address}</div>}
            {inv.patient_gstin && <div className="text-slate-600 font-mono">GSTIN: {inv.patient_gstin}</div>}
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-0.5">Payment Summary</div>
            <div className="grid grid-cols-[auto_auto] gap-x-3 justify-end text-[11px]">
              <span className="text-slate-600">Total:</span>
              <span className="font-semibold tabular-nums">{fmtINR(inv.rounded_total)}</span>
              <span className="text-slate-600">Paid:</span>
              <span className="font-semibold tabular-nums text-emerald-700">{fmtINR(inv.paid_total)}</span>
              <span className="text-slate-600">Due:</span>
              <span className={`font-bold tabular-nums ${inv.due_total > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{fmtINR(inv.due_total)}</span>
            </div>
          </div>
        </div>

        {/* Lines */}
        <table className="w-full text-[11px] border border-slate-300 mb-3">
          <thead className="bg-slate-50 border-b border-slate-300 text-[10px] uppercase text-slate-600">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">#</th>
              <th className="px-2 py-1.5 text-left font-semibold">Description</th>
              <th className="px-2 py-1.5 text-left font-semibold">HSN/SAC</th>
              <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
              <th className="px-2 py-1.5 text-right font-semibold">Rate</th>
              {hasDiscount && <th className="px-2 py-1.5 text-right font-semibold">Discount</th>}
              <th className="px-2 py-1.5 text-right font-semibold">Taxable</th>
              <th className="px-2 py-1.5 text-right font-semibold">GST</th>
              <th className="px-2 py-1.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={l.line_id} className="border-b border-slate-200 last:border-0">
                <td className="px-2 py-1 text-slate-600">{i + 1}</td>
                <td className="px-2 py-1 font-medium">{l.description}</td>
                <td className="px-2 py-1 font-mono text-slate-500">{l.hsn_sac || '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.quantity}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtINR(l.unit_price)}</td>
                {hasDiscount && (
                  <td className="px-2 py-1 text-right tabular-nums" data-testid={`inv-line-discount-${l.line_id}`}>
                    {Number(l.discount_amount) > 0 ? (
                      l.discount_type === 'percent' && Number(l.discount_value) > 0 ? (
                        <>
                          <div>{(+l.discount_value).toFixed(Number(l.discount_value) % 1 ? 2 : 0)}%</div>
                          <div className="text-[9px] text-slate-500">({fmtINR(l.discount_amount)})</div>
                        </>
                      ) : (
                        fmtINR(l.discount_amount)
                      )
                    ) : '—'}
                  </td>
                )}
                <td className="px-2 py-1 text-right tabular-nums">{fmtINR(l.taxable_value)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                  {l.is_taxable ? (
                    <>
                      <div>{l.gst_rate}%</div>
                      <div className="text-[9px]">
                        {l.igst_amount > 0 ? `IGST ${fmtINR(l.igst_amount)}` : `CGST+SGST ${fmtINR(l.cgst_amount + l.sgst_amount)}`}
                      </div>
                    </>
                  ) : <span className="text-[9px] italic">Exempt</span>}
                </td>
                <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmtINR(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-400 bg-slate-50">
            <tr><Td colSpan={colSpanBase} className="text-right">Subtotal (taxable value)</Td><Td right>{fmtINR(inv.subtotal)}</Td></tr>
            {inv.cgst_total > 0 && <tr><Td colSpan={colSpanBase} className="text-right">CGST</Td><Td right>{fmtINR(inv.cgst_total)}</Td></tr>}
            {inv.sgst_total > 0 && <tr><Td colSpan={colSpanBase} className="text-right">SGST</Td><Td right>{fmtINR(inv.sgst_total)}</Td></tr>}
            {inv.igst_total > 0 && <tr><Td colSpan={colSpanBase} className="text-right">IGST</Td><Td right>{fmtINR(inv.igst_total)}</Td></tr>}
            {inv.round_off !== 0 && <tr><Td colSpan={colSpanBase} className="text-right">Round off</Td><Td right>{fmtINR(inv.round_off)}</Td></tr>}
            <tr className="bg-slate-100 border-t border-slate-300">
              <Td colSpan={colSpanBase} className="text-right font-bold text-sm text-slate-800">GRAND TOTAL</Td>
              <Td right className="font-bold text-sm">{fmtINR(inv.rounded_total)}</Td>
            </tr>
          </tfoot>
        </table>

        {/* Payments */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Payments Received</div>
          {(!inv.payments || inv.payments.length === 0) ? (
            <div className="text-[11px] italic text-slate-400 border border-dashed border-slate-200 rounded p-2 text-center">
              No payments yet.
            </div>
          ) : (
            <table className="w-full text-[11px] border border-slate-200" data-testid="inv-payments-table">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1 text-left">Date</th>
                  <th className="px-2 py-1 text-left">Method</th>
                  <th className="px-2 py-1 text-left">Reference</th>
                  <th className="px-2 py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.payment_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1 text-slate-600">{fmtDateTime(p.paid_at)}</td>
                    <td className="px-2 py-1 capitalize font-semibold text-slate-700">{p.method.replace('_', ' ')}</td>
                    <td className="px-2 py-1 font-mono text-slate-600">{p.reference || '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmtINR(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {inv.notes && (
          <div className="text-[11px] text-slate-600 border-t border-slate-200 pt-2">
            <b>Notes:</b> {inv.notes}
          </div>
        )}
        {inv.status === 'cancelled' && inv.cancelled_reason && (
          <div className="mt-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
            <b>CANCELLED:</b> {inv.cancelled_reason} ({fmtDateTime(inv.cancelled_at)})
          </div>
        )}

        <div className="mt-6 flex justify-between text-[10px] text-slate-400 italic border-t border-slate-200 pt-2">
          <div>This is a system-generated tax invoice.</div>
          <div>Generated at {fmtDateTime(inv.created_at)}</div>
        </div>
      </div>

      {payOpen && (
        <PaymentDialog
          invoice={inv}
          onClose={() => setPayOpen(false)}
          onSaved={(updated) => { setInv(updated); setPayOpen(false); }}
        />
      )}
    </div>
  );
}

const Td = ({ children, right, colSpan, className = '' }) => (
  <td colSpan={colSpan} className={`px-2 py-1 ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>
);

// ---------- PAYMENT DIALOG ----------
const PaymentDialog = ({ invoice, onClose, onSaved }) => {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(invoice.due_total);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!amount || Number(amount) <= 0) return;
    setBusy(true); setErr(null);
    try {
      const r = await axios.post(`${API}/billing/invoices/${invoice.invoice_id}/payments`, {
        method, amount: Number(amount), reference: reference || null,
      });
      onSaved(r.data);
    } catch (e) {
      setErr(describeError(e, 'Payment failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
         data-testid="payment-dialog">
      <div className="bg-white rounded-lg shadow-2xl w-[420px] max-w-full">
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-white">
          <h3 className="text-sm font-bold text-slate-800">Collect Payment</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-red-600 text-lg">×</button>
        </div>
        <div className="p-4 space-y-2.5">
          <div className="bg-slate-50 border border-slate-200 rounded p-2 text-[11px] text-slate-700">
            <div><b>{invoice.patient_name}</b> · {invoice.invoice_no}</div>
            <div>Total: <b>{fmtINR(invoice.rounded_total)}</b> · Paid: <b className="text-emerald-700">{fmtINR(invoice.paid_total)}</b> · Due: <b className="text-rose-700">{fmtINR(invoice.due_total)}</b></div>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {PAYMENT_METHODS.map((m) => (
              <button key={m.value}
                onClick={() => setMethod(m.value)}
                data-testid={`pm-${m.value}`}
                className={`px-1.5 py-1.5 text-[10px] font-semibold rounded border transition-colors ${
                  method === m.value ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}>
                {m.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">Amount</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              data-testid="pay-amount"
              className="w-full px-2 py-1.5 text-lg font-bold text-emerald-700 border border-slate-300 rounded text-right tabular-nums" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
              Reference {method === 'upi' ? '(UPI UTR)' : method === 'card' ? '(Card last-4)' : '(optional)'}
            </label>
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
              data-testid="pay-reference"
              className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono" />
          </div>
          {err && <ErrorToast err={err} testid="pay-error" />}
        </div>
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !amount || Number(amount) <= 0}
            data-testid="pay-submit"
            className="px-4 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded">
            {busy ? 'Saving…' : `Receive ${fmtINR(Number(amount) || 0)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- THERMAL PRINT (80mm) ----------
// HTML-escape every untrusted string (patient name, invoice_no, references, clinic fields, etc.)
// to prevent XSS when they contain characters like `<`, `>`, `&`, quotes.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printThermal(inv, clinic) {
  const lines = [];
  const inr = (n) => `₹${Number(n).toFixed(2)}`;
  const line = (s = '') => lines.push(s);
  const hr = () => lines.push('-'.repeat(32));

  line(`<div class="center"><b>${esc(clinic?.name || 'ACS Audiology')}</b></div>`);
  if (clinic?.city) line(`<div class="center small">${esc([clinic.city, clinic.state].filter(Boolean).join(', '))}</div>`);
  if (clinic?.phone) line(`<div class="center small">Ph: ${esc(clinic.phone)}</div>`);
  if (clinic?.gstin) line(`<div class="center small">GSTIN: ${esc(clinic.gstin)}</div>`);
  hr();
  line(`<div class="small">Invoice: <b>${esc(inv.invoice_no)}</b></div>`);
  line(`<div class="small">Date: ${esc(new Date(inv.invoice_date).toLocaleString('en-IN'))}</div>`);
  line(`<div class="small">Patient: <b>${esc(inv.patient_name)}</b>${inv.mrd ? ` (${esc(inv.mrd)})` : ''}</div>`);
  hr();
  line(`<div class="row"><span>Item</span><span>Amt</span></div>`);
  for (const l of inv.lines) {
    line(`<div class="row small"><span>${esc(l.description)}${l.quantity !== 1 ? ` × ${esc(l.quantity)}` : ''}</span><span>${inr(l.line_total)}</span></div>`);
    if (l.discount_amount > 0) {
      const label = l.discount_type === 'percent' && l.discount_value > 0
        ? `&nbsp;&nbsp;Discount (${esc(l.discount_value)}%)`
        : `&nbsp;&nbsp;Discount`;
      line(`<div class="row tiny" style="color:#666"><span>${label}</span><span>−${inr(l.discount_amount)}</span></div>`);
    }
  }
  hr();
  line(`<div class="row small"><span>Subtotal</span><span>${inr(inv.subtotal)}</span></div>`);
  if (inv.tax_total > 0) line(`<div class="row small"><span>GST</span><span>${inr(inv.tax_total)}</span></div>`);
  if (inv.round_off !== 0) line(`<div class="row small"><span>Round off</span><span>${inr(inv.round_off)}</span></div>`);
  line(`<div class="row big"><span><b>TOTAL</b></span><span><b>${inr(inv.rounded_total)}</b></span></div>`);
  hr();
  line(`<div class="row small"><span>Paid</span><span>${inr(inv.paid_total)}</span></div>`);
  line(`<div class="row small"><span><b>Due</b></span><span><b>${inr(inv.due_total)}</b></span></div>`);
  if (inv.payments?.length) {
    hr();
    line(`<div class="small"><b>Payments:</b></div>`);
    for (const p of inv.payments) {
      line(`<div class="row tiny"><span>${esc((p.method || '').toUpperCase())}${p.reference ? ` (${esc(p.reference)})` : ''}</span><span>${inr(p.amount)}</span></div>`);
    }
  }
  hr();
  line(`<div class="center small">Thank you!</div>`);

  // Build the receipt DOM in-memory, then transfer it into the popup using
  // DOM APIs (no document.write, no innerHTML on the popup window itself).
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) { alert('Popup blocked. Please allow popups to print the receipt.'); return; }
  const doc = w.document;

  // Title
  doc.title = inv.invoice_no || 'Receipt';

  // Styles (static, no interpolation)
  const style = doc.createElement('style');
  style.textContent = `
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: 'Courier New', monospace; width: 72mm; font-size: 11px; color: #000; margin: 0; padding: 2mm; }
    .center { text-align: center; }
    .small { font-size: 10px; }
    .tiny { font-size: 9px; }
    .big { font-size: 13px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 2px 0; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    b { font-weight: 700; }
  `;
  doc.head.appendChild(style);

  // Body — lines are pre-escaped HTML templates; innerHTML is safe because every
  // dynamic substring has been run through esc() above. Static tags (<div>, <b>,
  // <span>, class/style attrs) are author-controlled.
  //
  // Code review (Feb 2026) flagged this as a potential XSS vector. Retained after
  // audit: the esc() helper at line 348 escapes the 5 XSS-relevant characters
  // (& < > " ') on every dynamic value before it reaches `lines`. The only
  // non-escaped content is the hard-coded HTML scaffolding (class names, div/span
  // tags). If you ever interpolate a NEW dynamic field into `lines`, wrap it with
  // esc() or this comment's safety argument stops holding.
  const wrapper = doc.createElement('div');
  // Every dynamic value is escaped via esc() before reaching `lines`, so this
  // assignment is safe. The eslint plugin that enforced this rule isn't
  // installed in the current toolchain.
  wrapper.innerHTML = lines.join('\n');
  doc.body.appendChild(wrapper);

  // Trigger print after the popup has rendered, then close.
  w.addEventListener('load', () => { w.print(); setTimeout(() => w.close(), 500); });
  // Fallback if the popup is already loaded (about:blank)
  if (doc.readyState === 'complete') { w.print(); setTimeout(() => w.close(), 500); }
}
