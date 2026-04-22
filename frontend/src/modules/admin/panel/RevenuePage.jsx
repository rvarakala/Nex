import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PageHeader, Card, Pill, tierTone, KPITile, fmtINR, fmtDate, Empty } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function RevenuePage() {
  const [d, setD] = useState(null);

  const load = async () => {
    const r = await axios.get(`${API}/admin/v2/revenue`);
    setD(r.data);
  };
  useEffect(() => { load(); }, []);

  const markPaid = async (id) => {
    await axios.post(`${API}/admin/v2/subscriptions/invoices/${id}/mark-paid`);
    load();
  };

  if (!d) return <div className="p-6 text-slate-500">Loading revenue…</div>;
  const m = d.this_month;

  return (
    <div className="p-6 space-y-5" data-testid="admin-revenue-page">
      <PageHeader title="Revenue & Billing" subtitle="Platform-wide SaaS revenue (clinic-level billing lives inside each tenant)" />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KPITile label="Collected This Month" value={fmtINR(m.paid.sum)} tone="emerald" testid="kpi-collected" />
        <KPITile label="Pending Invoices" value={fmtINR(m.pending.sum)} tone="amber" testid="kpi-pending" />
        <KPITile label="Failed" value={fmtINR(m.failed.sum)} tone="rose" testid="kpi-failed" />
        <KPITile label="Annual Contracts" value={d.annual_contracts_open} tone="fuchsia" testid="kpi-annual" />
        <KPITile label="Refunds" value={d.refunds_count} tone="slate" testid="kpi-refunds" />
        <KPITile label="Overdue Count" value={d.overdue.length} tone="amber" testid="kpi-overdue" />
      </div>

      <Card title="Overdue Invoices" subtitle="Pending past due date — highest-risk accounts" testid="overdue-card">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Invoice</th>
              <th className="px-4 py-2 text-left">Tenant</th>
              <th className="px-4 py-2 text-left">Tier</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-left">Issued</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {d.overdue.map((i) => (
              <tr key={i.invoice_id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs text-indigo-700">{i.invoice_id}</td>
                <td className="px-4 py-2"><Link to={`/admin/tenants/${i.clinic_id}`} className="text-sm font-semibold text-indigo-700 hover:underline">{i.clinic_name || i.clinic_id}</Link></td>
                <td className="px-4 py-2"><Pill tone={tierTone(i.tier)}>{i.tier}</Pill></td>
                <td className="px-4 py-2 text-right font-bold">{fmtINR(i.grand_total)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(i.issued_at)}</td>
                <td className="px-4 py-2 text-right"><button onClick={() => markPaid(i.invoice_id)} className="text-xs text-emerald-700 hover:underline" data-testid={`mark-paid-${i.invoice_id}`}>Mark paid</button></td>
              </tr>
            ))}
            {d.overdue.length === 0 && <tr><td colSpan={6}><Empty>No overdue invoices. 🎉</Empty></td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="Recent Invoices" subtitle="Last 50">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Invoice</th>
              <th className="px-4 py-2 text-left">Tenant</th>
              <th className="px-4 py-2 text-left">Tier</th>
              <th className="px-4 py-2 text-left">Duration</th>
              <th className="px-4 py-2 text-right">Grand</th>
              <th className="px-4 py-2 text-center">Status</th>
              <th className="px-4 py-2 text-left">Issued</th>
            </tr>
          </thead>
          <tbody>
            {d.recent_invoices.map((i) => (
              <tr key={i.invoice_id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs text-indigo-700">{i.invoice_id}</td>
                <td className="px-4 py-2"><Link to={`/admin/tenants/${i.clinic_id}`} className="text-sm text-indigo-700 hover:underline">{i.clinic_name || i.clinic_id}</Link></td>
                <td className="px-4 py-2"><Pill tone={tierTone(i.tier)}>{i.tier}</Pill></td>
                <td className="px-4 py-2 text-xs capitalize">{i.duration.replace('_', ' ')}</td>
                <td className="px-4 py-2 text-right font-bold">{fmtINR(i.grand_total)}</td>
                <td className="px-4 py-2 text-center"><Pill tone={i.status === 'paid' ? 'emerald' : i.status === 'pending' ? 'amber' : 'rose'}>{i.status}</Pill></td>
                <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(i.issued_at)}</td>
              </tr>
            ))}
            {d.recent_invoices.length === 0 && <tr><td colSpan={7}><Empty>No invoices issued yet. Open a tenant detail page → click "+ Invoice".</Empty></td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
