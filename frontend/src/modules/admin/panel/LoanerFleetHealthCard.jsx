/**
 * LoanerFleetHealthCard — System Health widget for Phase 14 loaner fleet.
 *
 * Surfaces:
 *  • Current ON_LOAN count
 *  • Days-out distribution histogram
 *  • Overdue list (issued > 7 days ago, still in patient's hands)
 *  • Deposit ledger: collected vs refunded vs forfeited vs held
 *
 * Auto-refreshes alongside the rest of SystemHealthPage.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { Card } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function LoanerFleetHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/ha/service/loaner-fleet-health`);
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load loaner fleet stats');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <Card
      title="Loaner Fleet Health"
      subtitle="Phase 14 · loaner units currently issued to patients"
      actions={
        <button
          onClick={load} disabled={loading}
          data-testid="loaner-fleet-refresh"
          className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      }
    >
      <div className="p-5" data-testid="loaner-fleet-health-card">
        {err && (
          <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>
        )}
        {!data ? (
          <div className="text-slate-400 italic text-xs py-2">Loading…</div>
        ) : (
          <>
            {/* Top KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Kpi label="ON_LOAN now"        value={data.on_loan_count}     tone="amber" testid="loaner-kpi-on-loan" />
              <Kpi label="Open tickets"       value={data.open_tickets}      tone="slate" testid="loaner-kpi-open" />
              <Kpi label="Overdue (>7d)"      value={data.overdue_count}
                                              tone={data.overdue_count > 0 ? 'rose' : 'emerald'}
                                              testid="loaner-kpi-overdue" />
              <Kpi label="Deposits held"      value={fmtINR(data.deposits?.held)}
                                              tone={(data.deposits?.held || 0) > 0 ? 'indigo' : 'slate'}
                                              testid="loaner-kpi-deposits-held" />
            </div>

            {/* Days-out histogram */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">Days out (issued → today)</div>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(data.days_out_buckets || {}).map(([bucket, n]) => (
                  <div key={bucket}
                       data-testid={`loaner-bucket-${bucket}`}
                       className={`p-2 rounded border ${
                         bucket === '15d+' && n > 0 ? 'border-rose-300 bg-rose-50'
                         : bucket === '8-14d' && n > 0 ? 'border-amber-300 bg-amber-50'
                         : 'border-slate-200 bg-slate-50'
                       }`}>
                    <div className="text-[10px] text-slate-500">{bucket}</div>
                    <div className="text-lg font-bold">{n}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Overdue list */}
            {data.overdue && data.overdue.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle size={12} className="text-rose-600" />
                  <span className="text-[10px] uppercase tracking-wider text-rose-700 font-semibold">
                    Overdue loaners — chase these
                  </span>
                </div>
                <table className="w-full text-xs" data-testid="loaner-overdue-table">
                  <thead className="text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="text-left py-1">Ticket</th>
                      <th className="text-left">Patient</th>
                      <th className="text-left">Mobile</th>
                      <th className="text-left">Serial</th>
                      <th className="text-right">Days</th>
                      <th className="text-right">Deposit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overdue.map((row) => (
                      <tr key={row.ticket_no} className="border-t border-slate-100"
                          data-testid={`loaner-overdue-${row.ticket_no}`}>
                        <td className="py-1 font-mono text-[10px]">{row.ticket_no}</td>
                        <td>{row.patient_name || '—'}</td>
                        <td className="font-mono text-[10px]">{row.patient_mobile || '—'}</td>
                        <td className="font-mono text-[10px]">{row.loaner_serial_id}</td>
                        <td className="text-right font-bold text-rose-700">{row.days_out}d</td>
                        <td className="text-right font-mono">{row.deposit_amount ? fmtINR(row.deposit_amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.overdue_count > data.overdue.length && (
                  <div className="text-[10px] italic text-slate-500 mt-1">
                    Showing 20 worst offenders · {data.overdue_count - data.overdue.length} more not shown.
                  </div>
                )}
              </div>
            )}

            {/* Deposit ledger summary */}
            <div className="border-t border-slate-100 pt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
              <Ledger label="Collected" value={fmtINR(data.deposits?.collected)} testid="loaner-dep-collected" />
              <Ledger label="Refunded"  value={fmtINR(data.deposits?.refunded)}  testid="loaner-dep-refunded" />
              <Ledger label="Forfeited" value={fmtINR(data.deposits?.forfeited)} testid="loaner-dep-forfeited" />
              <Ledger label="Held"      value={fmtINR(data.deposits?.held)}      testid="loaner-dep-held" highlight />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function Kpi({ label, value, tone, testid }) {
  const colour = {
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
    rose:    'bg-rose-50 border-rose-200 text-rose-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    indigo:  'bg-indigo-50 border-indigo-200 text-indigo-900',
    slate:   'bg-slate-50 border-slate-200 text-slate-700',
  }[tone] || 'bg-slate-50 border-slate-200 text-slate-700';
  return (
    <div className={`p-3 rounded-md border ${colour}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider opacity-70 font-semibold">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Ledger({ label, value, testid, highlight }) {
  return (
    <div data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`font-mono mt-0.5 ${highlight ? 'font-bold text-indigo-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}
