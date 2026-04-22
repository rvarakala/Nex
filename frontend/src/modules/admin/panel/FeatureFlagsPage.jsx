import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PageHeader, Card, Pill, tierTone, Empty } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function FeatureFlagsPage() {
  const [tenants, setTenants] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    axios.get(`${API}/admin/v2/tenants?limit=200`).then((r) => setTenants(r.data.rows || []));
  }, []);

  const filtered = tenants.filter((t) =>
    !q || (t.name || '').toLowerCase().includes(q.toLowerCase()) || t.clinic_id.includes(q.toLowerCase())
  );

  return (
    <div className="p-6 space-y-5" data-testid="admin-features-page">
      <PageHeader title="Feature Flags" subtitle="Per-tenant additive module toggles on top of their tier. Click a tenant to open.">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tenant…" className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg w-56" />
      </PageHeader>

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Tenant</th>
              <th className="px-4 py-2 text-center">Tier</th>
              <th className="px-4 py-2 text-center">Base</th>
              <th className="px-4 py-2 text-center">Extra</th>
              <th className="px-4 py-2 text-center">Disabled</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <TenantFlagsRow key={t.clinic_id} t={t} />
            ))}
            {filtered.length === 0 && <tr><td colSpan={6}><Empty>No tenants match.</Empty></td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const TenantFlagsRow = ({ t }) => {
  const [flags, setFlags] = useState(null);
  useEffect(() => {
    axios.get(`${API}/admin/v2/feature-flags/${t.clinic_id}`)
      .then((r) => setFlags(r.data))
      .catch(() => setFlags({ base_modules: [], extra_modules: [], disabled_modules: [] }));
  }, [t.clinic_id]);

  return (
    <tr className="border-t border-slate-100" data-testid={`flags-row-${t.clinic_id}`}>
      <td className="px-4 py-2">
        <Link to={`/admin/tenants/${t.clinic_id}`} className="font-semibold text-indigo-700 hover:underline">{t.name || t.clinic_id}</Link>
        <div className="text-[10px] text-slate-400 font-mono">{t.clinic_id}</div>
      </td>
      <td className="px-4 py-2 text-center"><Pill tone={tierTone(t.effective_tier)}>{t.effective_tier}</Pill></td>
      <td className="px-4 py-2 text-center text-xs font-semibold">{flags?.base_modules.length ?? '…'}</td>
      <td className="px-4 py-2 text-center text-xs text-indigo-700 font-semibold">+{flags?.extra_modules.length ?? 0}</td>
      <td className="px-4 py-2 text-center text-xs text-rose-700 font-semibold">−{flags?.disabled_modules.length ?? 0}</td>
      <td className="px-4 py-2 text-right">
        <Link to={`/admin/tenants/${t.clinic_id}`} className="text-xs text-indigo-700 hover:underline" data-testid={`flags-edit-${t.clinic_id}`}>Edit →</Link>
      </td>
    </tr>
  );
};
