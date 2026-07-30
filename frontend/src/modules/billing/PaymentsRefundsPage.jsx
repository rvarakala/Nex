/**
 * Consolidated Payments & Refunds page.
 *
 * Shows every payment and refund row across all invoices, ordered by
 * date desc, with filter tabs, top-of-page rollup KPIs, and a jump-to-
 * invoice link per row. Solves the previous confusion where "Invoices"
 * and "Payments & Refunds" in the sidebar rendered the same view.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Printer, RefreshCw, TrendingUp, TrendingDown, IndianRupee } from 'lucide-react';
import { API, fmtINR, fmtDateTime } from './billingUtils';
import { printRefundReceipt } from './refundReceipt';
import { useAuth } from '../../AuthContext';
import LandscapePrompt from '../../components/LandscapePrompt';

const KIND_LABELS = {
  payment: { label: 'Payment', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800' },
  refund:  { label: 'Refund',  bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-800'    },
};

const methodShort = (m) => {
  const map = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank', insurance: 'Insurance' };
  return map[m] || (m || '—');
};

export default function PaymentsRefundsPage() {
  const { clinic } = useAuth();
  const [filter, setFilter] = useState('all');    // 'all' | 'payment' | 'refund'
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ payments: 0, refunds: 0, net: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filter !== 'all') params.set('kind', filter);
      const r = await axios.get(`${API}/billing/payments?${params.toString()}`);
      setRows(r.data?.items || []);
      setTotals(r.data?.totals || { payments: 0, refunds: 0, net: 0 });
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to load payments');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-3" data-testid="payments-refunds-page">
      <LandscapePrompt
        featureKey="billing_payments_refunds"
        message="Rotate to landscape to see every column — patient, invoice, method, amount and reason."
        testid="billing-payments-refunds-landscape"
      />

      {/* Rollup KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          testid="pr-kpi-payments"
          label="Payments received"
          value={totals.payments}
          Icon={TrendingUp}
          tone="emerald"
        />
        <KpiCard
          testid="pr-kpi-refunds"
          label="Refunds issued"
          value={totals.refunds}
          Icon={TrendingDown}
          tone="rose"
        />
        <KpiCard
          testid="pr-kpi-net"
          label="Net collections"
          value={totals.net}
          Icon={IndianRupee}
          tone={totals.net >= 0 ? 'slate' : 'rose'}
        />
      </div>

      {/* Filter tabs + refresh */}
      <div className="bg-white rounded-lg border border-slate-200 p-2 flex items-center gap-1.5 flex-wrap">
        <FilterTab value="all" active={filter} onClick={setFilter} testid="pr-filter-all" label="All" count={rows.length} />
        <FilterTab value="payment" active={filter} onClick={setFilter} testid="pr-filter-payment" label="Payments only" />
        <FilterTab value="refund" active={filter} onClick={setFilter} testid="pr-filter-refund" label="Refunds only" />
        <div className="flex-1" />
        <button
          onClick={load}
          data-testid="pr-refresh"
          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {err && (
        <div className="p-3 border border-rose-300 bg-rose-50 text-xs text-rose-800 rounded" data-testid="pr-error">
          {err}
        </div>
      )}

      {/* Rows table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-xs" data-testid="pr-table">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <Th>When</Th>
              <Th>Kind</Th>
              <Th>Invoice</Th>
              <Th>Patient</Th>
              <Th>Method</Th>
              <Th right>Amount</Th>
              <Th>Reason / Reference</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-10 text-sm text-slate-400 italic">
                  No {filter === 'all' ? 'payments or refunds' : filter === 'payment' ? 'payments' : 'refunds'} yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const kind = r.kind || (r.amount < 0 ? 'refund' : 'payment');
              const K = KIND_LABELS[kind];
              const signedAmount = kind === 'refund' ? -Math.abs(r.amount) : Math.abs(r.amount);
              return (
                <tr
                  key={r.payment_id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                  data-testid={`pr-row-${r.payment_id}`}
                >
                  <Td>{fmtDateTime(r.paid_at)}</Td>
                  <Td>
                    <span
                      className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${K.bg} ${K.border} ${K.text}`}
                      data-testid={`pr-kind-${kind}`}
                    >
                      {K.label}
                    </span>
                  </Td>
                  <Td>
                    {r.invoice_no ? (
                      <Link
                        to={`/billing/invoice/${r.invoice_id}`}
                        className="text-emerald-700 hover:underline font-mono"
                      >
                        {r.invoice_no}
                      </Link>
                    ) : <span className="text-slate-400 font-mono">—</span>}
                  </Td>
                  <Td className="max-w-[180px] truncate">{r.patient_name || '—'}</Td>
                  <Td>{methodShort(r.method)}</Td>
                  <Td right>
                    <span className={`font-bold tabular-nums ${kind === 'refund' ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {kind === 'refund' ? '−' : ''}
                      {fmtINR(Math.abs(r.amount))}
                    </span>
                  </Td>
                  <Td className="max-w-[300px]">
                    <div className="text-[11px] text-slate-700 truncate" title={r.reason || r.reference || ''}>
                      {r.reason || r.reference || <span className="text-slate-400 italic">—</span>}
                    </div>
                    {r.notes && (
                      <div className="text-[10px] text-slate-400 truncate italic">{r.notes}</div>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1 justify-end">
                      {kind === 'refund' && (
                        <button
                          onClick={() => printRefundReceipt(r, null, clinic)}
                          data-testid={`pr-print-refund-${r.payment_id}`}
                          title="Print 80 mm refund receipt for the patient"
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 border border-rose-200 rounded"
                        >
                          <Printer size={11} /> Print
                        </button>
                      )}
                      {r.invoice_id && (
                        <Link
                          to={`/billing/invoice/${r.invoice_id}`}
                          className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-emerald-700 px-1"
                          title="Open invoice"
                        >
                          Open <ArrowUpRight size={11} />
                        </Link>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-slate-400 italic text-center">
        Showing up to 200 most recent entries. Use the filter tabs to narrow, or open a specific invoice to see its full payment ledger.
      </div>
    </div>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────

function KpiCard({ label, value, Icon, tone, testid }) {
  const tones = {
    emerald: { border: 'border-emerald-200', text: 'text-emerald-700', bg: 'bg-emerald-50' },
    rose:    { border: 'border-rose-200',    text: 'text-rose-700',    bg: 'bg-rose-50' },
    slate:   { border: 'border-slate-200',   text: 'text-slate-800',   bg: 'bg-slate-50' },
  };
  const t = tones[tone] || tones.slate;
  return (
    <div className={`border ${t.border} ${t.bg} rounded-lg p-3 flex items-center gap-2`} data-testid={testid}>
      <div className={`${t.text} p-1.5 bg-white rounded-md`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className={`text-base font-bold tabular-nums ${t.text}`}>{fmtINR(value || 0)}</div>
      </div>
    </div>
  );
}

function FilterTab({ value, active, onClick, testid, label, count }) {
  const isActive = active === value;
  return (
    <button
      onClick={() => onClick(value)}
      data-testid={testid}
      className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors ${
        isActive ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
      {isActive && count !== undefined && (
        <span className="ml-1.5 opacity-80">({count})</span>
      )}
    </button>
  );
}

const Th = ({ children, right }) => (
  <th className={`px-2 py-1.5 font-semibold ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);
const Td = ({ children, right, className = '' }) => (
  <td className={`px-2 py-1.5 ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>
);
