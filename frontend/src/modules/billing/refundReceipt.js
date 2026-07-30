/**
 * Refund Receipt Printer — opens an 80 mm thermal-format popup and
 * triggers Print → Cancel. Mirrors the layout of `printThermal()` in
 * InvoiceDetailPage.js but the copy is refund-specific so the patient
 * gets a clear, standalone acknowledgement to keep.
 *
 * Everything user-facing is HTML-escaped via `esc()` to prevent XSS
 * even if a reason field ever contains stray `<` / `>` / `&` chars.
 */

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const inr = (n) => `₹${Number(Math.abs(n || 0)).toFixed(2)}`;

const methodLabel = (m) => {
  const map = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank Transfer', insurance: 'Insurance' };
  return map[m] || (m ? String(m).toUpperCase() : '—');
};

/**
 * Build a receipt reference from a payment_id like "PAY-A1B2C3D4"
 * → "RFND-A1B2C3D4" so the piece of paper the patient holds is
 * obviously a refund, not a payment.
 */
function receiptRef(paymentId) {
  if (!paymentId) return 'RFND-————————';
  return paymentId.replace(/^PAY-?/i, 'RFND-');
}

function fmtWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/**
 * @param {Object} refund     - Refund row from either /billing/payments
 *                              (consolidated feed) or invoice.payments
 *                              (embedded).
 * @param {Object} [invoice]  - Optional parent invoice info for MRD /
 *                              patient contact. Consolidated feed rows
 *                              already carry invoice_no + patient_name;
 *                              this arg back-fills the rest when the
 *                              caller happens to have it.
 * @param {Object} clinic     - `clinic` from AuthContext.
 */
export function printRefundReceipt(refund, invoice, clinic) {
  const lines = [];
  const line = (s = '') => lines.push(s);
  const hr = () => lines.push(`<div class="hr"></div>`);

  const amt = Math.abs(Number(refund?.amount) || 0);
  const patientName = refund?.patient_name || invoice?.patient_name || '—';
  const patientMrd = invoice?.mrd || '';
  const patientMobile = invoice?.patient_mobile || '';
  const invoiceNo = refund?.invoice_no || invoice?.invoice_no || '—';
  const method = refund?.method;
  const reason = refund?.reason || '';
  const reference = refund?.reference || '';
  const notes = refund?.notes || '';
  const receivedBy = refund?.received_by_user_name || refund?.received_by_user_id || '';

  // ─── Header ───
  line(`<div class="center brand"><b>${esc(clinic?.name || 'AUDINEXA Audiology Clinic')}</b></div>`);
  if (clinic?.address) line(`<div class="center small">${esc(clinic.address)}</div>`);
  if (clinic?.city || clinic?.state) {
    line(`<div class="center small">${esc([clinic?.city, clinic?.state, clinic?.pincode].filter(Boolean).join(', '))}</div>`);
  }
  if (clinic?.phone) line(`<div class="center small">Ph: ${esc(clinic.phone)}</div>`);
  if (clinic?.email) line(`<div class="center small">${esc(clinic.email)}</div>`);
  if (clinic?.gstin) line(`<div class="center small">GSTIN: ${esc(clinic.gstin)}</div>`);
  hr();

  // ─── Title ───
  line(`<div class="center title"><b>REFUND RECEIPT</b></div>`);
  hr();

  // ─── Meta ───
  line(`<div class="row small"><span>Ref</span><span>${esc(receiptRef(refund?.payment_id))}</span></div>`);
  line(`<div class="row small"><span>Date</span><span>${esc(fmtWhen(refund?.paid_at))}</span></div>`);
  line(`<div class="row small"><span>Invoice</span><span>${esc(invoiceNo)}</span></div>`);
  hr();

  // ─── Patient block ───
  line(`<div class="small"><b>Refund to:</b></div>`);
  line(`<div class="small">${esc(patientName)}</div>`);
  if (patientMrd) line(`<div class="tiny" style="color:#555">MRD: ${esc(patientMrd)}</div>`);
  if (patientMobile) line(`<div class="tiny" style="color:#555">Mobile: ${esc(patientMobile)}</div>`);
  hr();

  // ─── Refund details ───
  line(`<div class="row small"><span>Method</span><span>${esc(methodLabel(method))}</span></div>`);
  if (reference) {
    line(`<div class="row small"><span>Reference</span><span>${esc(reference)}</span></div>`);
  }
  if (reason) {
    line(`<div class="small" style="margin-top:2px"><b>Reason:</b></div>`);
    line(`<div class="tiny" style="white-space:pre-wrap">${esc(reason)}</div>`);
  }
  if (notes) {
    line(`<div class="tiny" style="color:#666;margin-top:2px"><i>Note: ${esc(notes)}</i></div>`);
  }
  hr();

  // ─── Amount (big) ───
  line(`<div class="row big"><span><b>REFUNDED</b></span><span><b>${inr(amt)}</b></span></div>`);
  hr();

  if (receivedBy) {
    line(`<div class="tiny" style="color:#555">Processed by: ${esc(receivedBy)}</div>`);
  }
  line(`<div class="tiny" style="margin-top:4px">This is a system-generated refund acknowledgement. Actual funds move via the method shown above and may take up to 5 business days to reflect in your account.</div>`);
  hr();

  // ─── Signature lines ───
  line(`<div class="small" style="margin-top:6px">Patient signature: __________________</div>`);
  line(`<div class="small" style="margin-top:8px">Clinic stamp: _______________________</div>`);
  line(`<div class="center small" style="margin-top:8px">Thank you.</div>`);

  // ─── Popup ───
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) { alert('Popup blocked. Please allow popups to print the receipt.'); return; }
  const doc = w.document;
  doc.title = `Refund ${receiptRef(refund?.payment_id)}`;

  const style = doc.createElement('style');
  style.textContent = `
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: 'Courier New', monospace; width: 72mm; font-size: 11px; color: #000; margin: 0; padding: 2mm; }
    .center { text-align: center; }
    .small { font-size: 10px; }
    .tiny { font-size: 9px; }
    .brand { font-size: 12px; }
    .title { font-size: 12px; letter-spacing: 1px; }
    .big { font-size: 13px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3px 0; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    .hr { border-top: 1px dashed #000; margin: 3px 0; }
    b { font-weight: 700; }
  `;
  doc.head.appendChild(style);

  // Every dynamic value is escaped via esc() above; the static scaffolding
  // (<div>, <b>, <span>, class attrs) is author-controlled.
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = lines.join('\n');
  doc.body.appendChild(wrapper);

  w.addEventListener('load', () => { w.print(); setTimeout(() => w.close(), 500); });
  if (doc.readyState === 'complete') { w.print(); setTimeout(() => w.close(), 500); }
}
