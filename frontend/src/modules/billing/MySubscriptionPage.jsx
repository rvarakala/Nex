/**
 * My Subscription — clinic-facing self-service page.
 *
 * Surfaces:
 *  - Current plan card (tier + trial status + trial days left, with upgrade
 *    CTA when not Premium)
 *  - Pending Audinexa invoice banner (auto-prominent if there's a balance
 *    due) with one-click Pay via Razorpay
 *  - Past invoices table (paid + refunded) with status pills and any
 *    Razorpay payment reference
 *
 * Visible to clinic owners + super_admin / founder. Other roles see a
 * polite "ask your clinic owner" message.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { CreditCard, Sparkles, ShieldCheck, AlertTriangle, Calendar, ArrowUpRight, Receipt } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { useSubscription } from '../../SubscriptionContext';
import { RazorpayPayTenantInvoiceButton } from '../admin/panel/RazorpayTenantInvoiceActions';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};

const TIER_LABELS = {
  BASIC:    { name: 'Basic',    accent: 'from-slate-500 to-slate-600' },
  STANDARD: { name: 'Standard', accent: 'from-emerald-500 to-emerald-600' },
  PREMIUM:  { name: 'Premium',  accent: 'from-indigo-500 via-violet-500 to-fuchsia-500' },
};

const STATUS_TONES = {
  pending:             'bg-amber-50 text-amber-800 border-amber-200',
  paid:                'bg-emerald-50 text-emerald-800 border-emerald-200',
  refunded:            'bg-rose-50 text-rose-800 border-rose-200',
  partially_refunded:  'bg-amber-50 text-amber-800 border-amber-200',
  cancelled:           'bg-slate-100 text-slate-600 border-slate-200',
};

export default function MySubscriptionPage() {
  const { user } = useAuth();
  const sub = useSubscription();
  const [pending, setPending]   = useState([]);
  const [paid, setPaid]         = useState([]);
  const [other, setOther]       = useState([]);
  const [loading, setLoading]   = useState(true);

  const isOwner = user && ['clinic_owner', 'super_admin', 'founder'].includes(user.role);

  const load = useCallback(async () => {
    if (!isOwner) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await axios.get(`${API}/subscription/invoices`);
      setPending(r.data.pending || []);
      setPaid(r.data.paid || []);
      setOther(r.data.other || []);
    } catch {
      setPending([]); setPaid([]); setOther([]);
    } finally { setLoading(false); }
  }, [isOwner]);
  useEffect(() => { load(); }, [load]);

  const onPaid = (updated) => {
    // Refresh subscription context so tier/trial info updates immediately
    if (sub?.refresh) sub.refresh();
    load();
    if (updated?.invoice_id) {
      // Light celebration — non-blocking
      setTimeout(() => {
        // eslint-disable-next-line no-alert
        alert(`Payment received! Invoice ${updated.invoice_id} marked paid. Thank you.`);
      }, 200);
    }
  };

  if (!isOwner) {
    return (
      <div className="p-8 max-w-2xl mx-auto" data-testid="my-subscription-not-owner">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
          Subscription billing is only visible to the clinic owner. Please ask
          your clinic owner to manage subscription payments.
        </div>
      </div>
    );
  }

  const tierMeta = TIER_LABELS[sub?.tier] || TIER_LABELS.BASIC;
  const totalDue = pending.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const overduePending = pending.filter((i) => {
    if (!i.due_date) return false;
    return new Date(i.due_date) < new Date();
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl" data-testid="my-subscription-page">
      <header>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Receipt size={20} className="text-indigo-600" /> My Subscription
        </h1>
        <p className="text-[12.5px] text-slate-500 mt-0.5">
          Your AUDINEXA plan, invoices and payment history.
        </p>
      </header>

      {/* Plan card */}
      <section className={`rounded-xl overflow-hidden bg-gradient-to-br ${tierMeta.accent} text-white shadow-sm`} data-testid="my-sub-plan-card">
        <div className="px-5 py-4 flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/15 backdrop-blur">
            <Sparkles size={22} />
          </span>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-white/80">Current plan</div>
            <div className="text-2xl font-black leading-tight">{tierMeta.name}</div>
            {sub?.trialActive && (
              <div className="mt-1 text-[12px] text-white/90 inline-flex items-center gap-1">
                <Calendar size={12} /> Trial · {sub.trialDaysLeft} day{sub.trialDaysLeft === 1 ? '' : 's'} left
              </div>
            )}
          </div>
          <div className="text-right text-[12px]">
            {sub?.tier !== 'PREMIUM' && (
              <a
                href="/#pricing"
                target="_blank"
                rel="noreferrer"
                data-testid="my-sub-upgrade-cta"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/25 rounded-md font-semibold backdrop-blur">
                <ArrowUpRight size={12} /> See upgrade options
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Pending invoice banner */}
      {pending.length > 0 && (
        <section
          className={`rounded-xl border p-4 sm:p-5 ${overduePending.length > 0 ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}
          data-testid="my-sub-pending-banner">
          <div className="flex items-start gap-3">
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${overduePending.length > 0 ? 'bg-rose-200 text-rose-800' : 'bg-amber-200 text-amber-800'}`}>
              <AlertTriangle size={18} />
            </span>
            <div className="flex-1">
              <div className="text-[13.5px] font-bold text-slate-900">
                {overduePending.length > 0
                  ? `${overduePending.length} overdue invoice${overduePending.length === 1 ? '' : 's'} — please clear ${fmtINR(totalDue)} to continue uninterrupted service`
                  : `${pending.length} invoice${pending.length === 1 ? '' : 's'} pending · ${fmtINR(totalDue)} due`}
              </div>
              <p className="text-[11.5px] text-slate-700 mt-1 leading-relaxed">
                Pay securely via UPI, cards, netbanking or wallets. Your plan continues seamlessly the moment payment clears.
              </p>
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                {pending.map((inv) => (
                  <PendingInvoiceCard key={inv.invoice_id} inv={inv} onPaid={onPaid} />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* All-clear banner if no pending */}
      {pending.length === 0 && !loading && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3 text-[12.5px] text-emerald-800" data-testid="my-sub-allclear">
          <ShieldCheck size={16} className="text-emerald-600 flex-shrink-0" />
          <div>
            <b>You're all paid up.</b> Nothing due right now. Your next renewal invoice will appear here automatically.
          </div>
        </section>
      )}

      {/* Payment history */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="my-sub-history">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="text-[13px] font-bold text-slate-900">Invoice history</div>
          <div className="text-[11px] text-slate-500">{paid.length + other.length} record{(paid.length + other.length) === 1 ? '' : 's'}</div>
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center italic text-slate-400 text-sm">Loading invoices…</div>
        ) : (paid.length === 0 && other.length === 0) ? (
          <div className="px-4 py-12 text-center italic text-slate-400 text-sm">
            No paid invoices yet. Your first invoice will appear here once Audinexa issues it.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5">Invoice</th>
                  <th className="text-left px-4 py-2.5">Plan</th>
                  <th className="text-left px-4 py-2.5">Issued</th>
                  <th className="text-right px-4 py-2.5">Amount</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Reference</th>
                </tr>
              </thead>
              <tbody>
                {[...paid, ...other].map((i) => (
                  <tr key={i.invoice_id} className="border-t border-slate-100" data-testid={`my-sub-row-${i.invoice_id}`}>
                    <td className="px-4 py-2.5 font-mono text-[11px]">{i.invoice_id}</td>
                    <td className="px-4 py-2.5">{i.tier} · {(i.duration || '').replace('_', ' ')}</td>
                    <td className="px-4 py-2.5 text-slate-600">{fmtDate(i.created_at)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtINR(i.grand_total)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-semibold ${STATUS_TONES[i.status] || STATUS_TONES.cancelled}`}>
                        {String(i.status).replace(/_/g, ' ')}
                      </span>
                      {i.refunded_total > 0 && (
                        <div className="text-[10px] text-rose-600 mt-0.5">Refunded {fmtINR(i.refunded_total)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-500 font-mono">
                      {i.razorpay_payment_id || i.payment_ref || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[10.5px] text-slate-400 leading-relaxed">
        Need help with billing? Email <a href="mailto:billing@audinexa.com" className="text-indigo-600 underline">billing@audinexa.com</a> or open a support ticket from <i>AUDINEXA Care</i>. Refunds are processed via the original payment method within 5–7 business days as per our <a href="/refund" target="_blank" rel="noreferrer" className="text-indigo-600 underline">Refund Policy</a>.
      </p>
    </div>
  );
}

function PendingInvoiceCard({ inv, onPaid }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-2" data-testid={`my-sub-pending-${inv.invoice_id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold text-slate-900">{inv.tier} · {(inv.duration || '').replace('_', ' ')}</div>
          <div className="text-[10.5px] text-slate-500 font-mono truncate">{inv.invoice_id}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-black tabular-nums text-slate-900">₹{Number(inv.grand_total || 0).toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-500">incl. 18% GST</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
        <div className="text-[10.5px] text-slate-500">Due {fmtDate(inv.due_date) || 'on receipt'}</div>
        <div className="inline-flex items-center gap-1.5">
          <RazorpayPayTenantInvoiceButton invoice={inv} onPaid={onPaid} />
          <span className="inline-flex items-center text-[10px] text-slate-400 gap-1"><CreditCard size={10} /> via Razorpay</span>
        </div>
      </div>
    </div>
  );
}
