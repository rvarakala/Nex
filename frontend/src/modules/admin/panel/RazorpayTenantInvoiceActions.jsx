/**
 * Razorpay action buttons for a single tenant invoice row in the Founder
 * admin TenantDetailPage. Two buttons depending on invoice status:
 *   - status=pending  → "Pay with Razorpay" (opens Checkout, posts /verify on success)
 *   - status=paid     → "Refund" (full or partial; super_admin/founder only)
 *
 * Both flows hit /api/billing/tenant-invoices/{id}/razorpay/* — the
 * subscription billing surface, NOT patient-facing invoices.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { CornerUpLeft, CreditCard } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

const loadRazorpayScript = () => new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve();
  const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`);
  if (existing) {
    existing.addEventListener('load', () => resolve());
    existing.addEventListener('error', () => reject(new Error('Razorpay SDK failed to load')));
    return;
  }
  const s = document.createElement('script');
  s.src = RAZORPAY_SCRIPT; s.async = true;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error('Razorpay SDK failed to load'));
  document.body.appendChild(s);
});

export function RazorpayPayTenantInvoiceButton({ invoice, onPaid }) {
  const [busy, setBusy] = useState(false);

  const startCheckout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await loadRazorpayScript();
      const orderRes = await axios.post(
        `${API}/billing/tenant-invoices/${invoice.invoice_id}/razorpay/order`,
      );
      const order = orderRes.data;
      const opts = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: 'AUDINEXA — Clinic Subscription',
        description: `${order.tier} · ${order.duration?.replace?.('_', ' ') || ''}`,
        image: undefined,
        prefill: { name: order.clinic_name || '' },
        notes: { tenant_invoice_id: invoice.invoice_id, clinic_name: order.clinic_name },
        theme: { color: '#3399cc' },
        modal: { ondismiss: () => setBusy(false), confirm_close: true },
        handler: async (resp) => {
          try {
            const verifyRes = await axios.post(
              `${API}/billing/tenant-invoices/${invoice.invoice_id}/razorpay/verify`,
              {
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              },
            );
            if (typeof onPaid === 'function') onPaid(verifyRes.data);
          } catch (e) {
            // eslint-disable-next-line no-alert
            alert('Verification failed: ' + (e?.response?.data?.detail || e.message));
          } finally {
            setBusy(false);
          }
        },
      };
      const rzp = new window.Razorpay(opts);
      rzp.on('payment.failed', (r) => {
        const e = r?.error || {};
        // eslint-disable-next-line no-alert
        alert(`Payment failed: ${e.code || ''} ${e.description || 'Could not complete payment.'}`);
        setBusy(false);
      });
      rzp.open();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Could not start Razorpay: ' + (e?.response?.data?.detail || e.message));
      setBusy(false);
    }
  };

  return (
    <button
      onClick={startCheckout}
      disabled={busy}
      data-testid={`tenant-inv-pay-${invoice.invoice_id}`}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-white bg-[#3399cc] hover:bg-[#2c87b3] disabled:bg-slate-300 font-semibold">
      <CreditCard size={11} />
      {busy ? 'Opening…' : 'Pay'}
    </button>
  );
}

export function RazorpayRefundTenantInvoiceButton({ invoice, onRefunded }) {
  const [busy, setBusy] = useState(false);

  const refund = async (full) => {
    const grand = Number(invoice.grand_total || 0);
    const already = Number(invoice.refunded_total || 0);
    const refundable = Math.max(0, grand - already).toFixed(2);
    const promptMsg = full
      ? `Refund the FULL invoice amount of ₹${refundable} via Razorpay?\n\nThis cannot be undone.`
      : `Partial refund — enter amount in ₹ (max ₹${refundable}):`;
    let amount = null;
    if (!full) {
      // eslint-disable-next-line no-alert
      const v = window.prompt(promptMsg, refundable);
      if (v === null) return;
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n <= 0) { alert('Invalid amount.'); return; }
      amount = n;
    } else {
      // eslint-disable-next-line no-alert
      if (!window.confirm(promptMsg)) return;
    }
    // eslint-disable-next-line no-alert
    const reason = window.prompt('Reason for refund (audit log):', 'Subscription cancelled') || '';
    setBusy(true);
    try {
      const r = await axios.post(
        `${API}/billing/tenant-invoices/${invoice.invoice_id}/refund`,
        { amount, notes: reason, speed: 'normal' },
      );
      if (typeof onRefunded === 'function') onRefunded(r.data);
      // eslint-disable-next-line no-alert
      alert(`Refund initiated. Status: ${r.data.status} · Refunded total: ₹${r.data.refunded_total || 0}`);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Refund failed: ' + (e?.response?.data?.detail || e.message));
    } finally { setBusy(false); }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() => refund(true)}
        disabled={busy}
        data-testid={`tenant-inv-refund-full-${invoice.invoice_id}`}
        title="Refund the full invoice via Razorpay"
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-rose-700 hover:bg-rose-50 border border-rose-200 disabled:opacity-50 font-semibold">
        <CornerUpLeft size={11} />
        {busy ? '…' : 'Refund'}
      </button>
      <button
        onClick={() => refund(false)}
        disabled={busy}
        data-testid={`tenant-inv-refund-partial-${invoice.invoice_id}`}
        title="Partial refund (custom amount)"
        className="text-[10.5px] text-rose-600 hover:text-rose-800 underline">
        partial
      </button>
    </span>
  );
}
