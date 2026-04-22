import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip } from 'recharts';
import { PageHeader, Card, KPITile, Pill, tierTone, Empty } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const RISK_TONE = { low: 'emerald', medium: 'amber', high: 'rose' };
const RISK_COLOR = { low: '#10b981', medium: '#f59e0b', high: '#e11d48' };

export default function UsageAnalyticsPage() {
  const [d, setD] = useState(null);
  const [days, setDays] = useState(30);
  const [riskFilter, setRisk] = useState('');

  useEffect(() => {
    axios.get(`${API}/admin/v2/usage-analytics?days=${days}`).then((r) => setD(r.data));
  }, [days]);

  if (!d) return <div className="p-6 text-slate-500">Crunching usage…</div>;
  const rows = riskFilter ? d.rows.filter((r) => r.churn_risk === riskFilter) : d.rows;
  const pie = [
    { name: 'High risk', value: d.totals.high_risk, fill: RISK_COLOR.high },
    { name: 'Medium risk', value: d.totals.medium_risk, fill: RISK_COLOR.medium },
    { name: 'Low risk', value: d.totals.low_risk, fill: RISK_COLOR.low },
  ];

  return (
    <div className="p-6 space-y-5" data-testid="admin-usage-page">
      <PageHeader title="Usage Analytics" subtitle={`Per-tenant activity + churn-risk scoring (last ${days} days)`}>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} className="text-xs px-2 py-1.5 border border-slate-300 rounded">
          <option value={7}>7d</option><option value={30}>30d</option><option value={90}>90d</option>
        </select>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPITile label="Tenants" value={d.totals.total_tenants} tone="slate" />
        <KPITile label="Platform DAU" value={d.totals.platform_dau} tone="indigo" />
        <KPITile label="Platform MAU" value={d.totals.platform_mau} tone="fuchsia" />
        <KPITile label="High risk" value={d.totals.high_risk} tone="rose" />
        <KPITile label="Low risk" value={d.totals.low_risk} tone="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Churn Risk Distribution" className="lg:col-span-1">
          <div className="p-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {pie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Top at-risk tenants" subtitle="High-risk first" className="lg:col-span-2">
          <div className="p-2">
            {d.rows.filter((r) => r.churn_risk === 'high').slice(0, 5).map((r) => (
              <div key={r.clinic_id} className="flex items-center justify-between p-2 border-b border-slate-100">
                <div>
                  <Link to={`/admin/tenants/${r.clinic_id}`} className="font-semibold text-indigo-700 hover:underline text-sm">{r.name}</Link>
                  <div className="text-[10px] text-slate-500">MAU {r.mau} · inactive {r.inactive_days ?? '—'}d · adoption {r.feature_adoption}/6</div>
                </div>
                <Pill tone="rose">High</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title={`Tenant Usage (${rows.length})`} actions={(
        <select value={riskFilter} onChange={(e) => setRisk(e.target.value)} className="text-xs px-2 py-1 border border-slate-300 rounded">
          <option value="">All risk</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      )}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Tenant</th>
              <th className="px-4 py-2 text-center">Tier</th>
              <th className="px-4 py-2 text-right">DAU</th>
              <th className="px-4 py-2 text-right">MAU</th>
              <th className="px-4 py-2 text-right">Active Users</th>
              <th className="px-4 py-2 text-right">Patients Added</th>
              <th className="px-4 py-2 text-right">Reports</th>
              <th className="px-4 py-2 text-right">Adoption</th>
              <th className="px-4 py-2 text-right">Inactive d</th>
              <th className="px-4 py-2 text-center">Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.clinic_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2"><Link to={`/admin/tenants/${r.clinic_id}`} className="text-indigo-700 hover:underline font-semibold">{r.name}</Link></td>
                <td className="px-4 py-2 text-center"><Pill tone={tierTone(r.tier)}>{r.tier}</Pill></td>
                <td className="px-4 py-2 text-right text-xs">{r.dau}</td>
                <td className="px-4 py-2 text-right text-xs">{r.mau}</td>
                <td className="px-4 py-2 text-right text-xs">{r.active_users_month}</td>
                <td className="px-4 py-2 text-right text-xs">{r.patients_added}</td>
                <td className="px-4 py-2 text-right text-xs">{r.reports_generated}</td>
                <td className="px-4 py-2 text-right text-xs">{r.feature_adoption}/6</td>
                <td className="px-4 py-2 text-right text-xs">{r.inactive_days ?? '—'}</td>
                <td className="px-4 py-2 text-center"><Pill tone={RISK_TONE[r.churn_risk]}>{r.churn_risk}</Pill></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10}><Empty>No tenants match.</Empty></td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
