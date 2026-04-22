import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, KPITile, Empty, fmtDate, fmtINR } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function MarketingPage() {
  const [d, setD] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    const r = await axios.get(`${API}/admin/v2/marketing/campaigns`);
    setD(r.data);
  };
  useEffect(() => { load(); }, []);

  if (!d) return <div className="p-6 text-slate-500">Loading campaigns…</div>;
  const t = d.totals;

  return (
    <div className="p-6 space-y-5" data-testid="admin-marketing-page">
      <PageHeader title="Marketing CRM" subtitle="Campaigns, attribution, CAC, conversion">
        <button onClick={() => setShowNew(true)} data-testid="campaign-new-btn" className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded">+ New campaign</button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KPITile label="Total spend" value={fmtINR(t.total_budget)} tone="amber" />
        <KPITile label="Leads generated" value={t.total_leads} tone="indigo" />
        <KPITile label="Converted" value={t.total_converted} tone="emerald" />
        <KPITile label="Overall Conv %" value={`${t.overall_conversion_pct}%`} tone="fuchsia" />
        <KPITile label="Blended CAC" value={t.blended_cac != null ? fmtINR(t.blended_cac) : '—'} tone="rose" />
        <KPITile label="Partner conv." value={t.partner_referrals_converted} tone="slate" />
      </div>

      <Card title="Campaigns">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Campaign</th>
              <th className="px-4 py-2 text-left">Source</th>
              <th className="px-4 py-2 text-left">Channel</th>
              <th className="px-4 py-2 text-right">Budget</th>
              <th className="px-4 py-2 text-right">Leads</th>
              <th className="px-4 py-2 text-right">Conv</th>
              <th className="px-4 py-2 text-right">Conv %</th>
              <th className="px-4 py-2 text-right">CAC</th>
              <th className="px-4 py-2 text-left">Dates</th>
            </tr>
          </thead>
          <tbody>
            {d.campaigns.map((c) => (
              <tr key={c.campaign_id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{c.campaign_id}</div>
                </td>
                <td className="px-4 py-2 text-xs">{c.source}</td>
                <td className="px-4 py-2 text-xs">{c.channel || '—'}</td>
                <td className="px-4 py-2 text-right text-xs">{fmtINR(c.budget)}</td>
                <td className="px-4 py-2 text-right">{c.leads_generated}</td>
                <td className="px-4 py-2 text-right">{c.converted}</td>
                <td className="px-4 py-2 text-right text-indigo-700 font-semibold">{c.conversion_pct}%</td>
                <td className="px-4 py-2 text-right font-bold">{c.cac != null ? fmtINR(c.cac) : '—'}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(c.started_at)} — {fmtDate(c.ended_at)}</td>
              </tr>
            ))}
            {d.campaigns.length === 0 && <tr><td colSpan={9}><Empty>No campaigns yet.</Empty></td></tr>}
          </tbody>
        </table>
      </Card>

      {showNew && <NewCampaignForm onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

const NewCampaignForm = ({ onClose, onSaved }) => {
  const [f, setF] = useState({ name: '', source: '', channel: 'paid', budget: 0, started_at: '', ended_at: '', notes: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await axios.post(`${API}/admin/v2/marketing/campaigns`, { ...f, budget: parseFloat(f.budget) || 0 }); onSaved(); }
    catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-3" data-testid="campaign-form">
        <h3 className="text-base font-bold">New Campaign</h3>
        <label className="block text-sm">Name <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Source <input required value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Google Ads / Instagram / Partner Referral" className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
          <label className="block text-sm">Channel
            <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded">
              <option value="paid">Paid</option><option value="organic">Organic</option><option value="referral">Referral</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">Budget (₹) <input type="number" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
          <label className="block text-sm">Start <input type="date" value={f.started_at} onChange={(e) => setF({ ...f, started_at: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
          <label className="block text-sm">End <input type="date" value={f.ended_at} onChange={(e) => setF({ ...f, ended_at: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
        </div>
        <label className="block text-sm">Notes <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
        {err && <div className="text-xs text-rose-700">{typeof err === 'string' ? err : JSON.stringify(err)}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded">Create</button>
        </div>
      </form>
    </div>
  );
};
