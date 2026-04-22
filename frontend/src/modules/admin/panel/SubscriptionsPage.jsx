import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, Pill, tierTone, fmtINR, Empty } from './shared';
import { Save } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function SubscriptionsPage() {
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});      // tier -> {user_limit, branch_limit, ...}
  const [busy, setBusy] = useState('');

  const load = async () => {
    const r = await axios.get(`${API}/admin/v2/subscriptions/plans`);
    setData(r.data);
    // seed edits with current overrides
    const e = {};
    for (const p of r.data.plans) {
      e[p.tier] = {
        user_limit: p.user_limit ?? (p.tier === 'BASIC' ? 3 : p.tier === 'STANDARD' ? 10 : 50),
        branch_limit: p.branch_limit ?? (p.tier === 'BASIC' ? 1 : p.tier === 'STANDARD' ? 3 : 20),
        storage_limit_mb: p.storage_limit_mb ?? (p.tier === 'BASIC' ? 1024 : p.tier === 'STANDARD' ? 10240 : 102400),
        sms_credits: p.sms_credits ?? (p.tier === 'BASIC' ? 100 : p.tier === 'STANDARD' ? 500 : 2000),
        whatsapp_credits: p.whatsapp_credits ?? (p.tier === 'BASIC' ? 100 : p.tier === 'STANDARD' ? 1000 : 5000),
        support_level: p.support_level ?? (p.tier === 'BASIC' ? 'Email' : p.tier === 'STANDARD' ? 'Priority Email' : '24x7 Dedicated'),
        custom_note: p.custom_note ?? '',
      };
    }
    setEdits(e);
  };
  useEffect(() => { load(); }, []);

  const save = async (tier) => {
    setBusy(tier);
    try {
      await axios.put(`${API}/admin/v2/subscriptions/plans/${tier}`, edits[tier]);
      await load();
    } finally { setBusy(''); }
  };

  const update = (tier, key, val) => {
    setEdits((e) => ({ ...e, [tier]: { ...e[tier], [key]: val } }));
  };

  if (!data) return <div className="p-6 text-slate-500">Loading plans…</div>;

  return (
    <div className="p-6 space-y-5" data-testid="admin-plans-page">
      <PageHeader title="Plans & Pricing" subtitle="Override capacity limits & support levels per tier. Pricing is locked per annual base." />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.plans.map((p) => {
          const e = edits[p.tier] || {};
          return (
            <Card key={p.tier} testid={`plan-card-${p.tier}`} className="overflow-hidden">
              <div className={`p-5 bg-gradient-to-br ${p.tier === 'PREMIUM' ? 'from-fuchsia-100 to-fuchsia-50' : p.tier === 'STANDARD' ? 'from-indigo-100 to-indigo-50' : 'from-slate-100 to-slate-50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Tier</div>
                    <h2 className="text-2xl font-bold">{p.name}</h2>
                  </div>
                  <Pill tone={tierTone(p.tier)}>{p.tier}</Pill>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-bold">{fmtINR(p.annual_price)}<span className="text-sm text-slate-500"> /yr</span></div>
                  <div className="text-[11px] text-slate-500">½yr {fmtINR(p.half_yearly_price)} · Qtr {fmtINR(p.quarterly_price)}</div>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Modules included</div>
                <div className="flex flex-wrap gap-1">
                  {p.modules_included.map((m) => <span key={m} className="px-1.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] rounded">{m}</span>)}
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <NumField label="User limit" v={e.user_limit} onChange={(v) => update(p.tier, 'user_limit', v)} />
                  <NumField label="Branch limit" v={e.branch_limit} onChange={(v) => update(p.tier, 'branch_limit', v)} />
                  <NumField label="Storage (MB)" v={e.storage_limit_mb} onChange={(v) => update(p.tier, 'storage_limit_mb', v)} />
                  <NumField label="SMS credits / mo" v={e.sms_credits} onChange={(v) => update(p.tier, 'sms_credits', v)} />
                  <NumField label="WhatsApp credits / mo" v={e.whatsapp_credits} onChange={(v) => update(p.tier, 'whatsapp_credits', v)} />
                  <label className="block text-[11px]">
                    <span className="text-slate-500 font-semibold uppercase tracking-wider">Support level</span>
                    <input value={e.support_level || ''} onChange={(ev) => update(p.tier, 'support_level', ev.target.value)} className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-300 rounded" />
                  </label>
                  <label className="block text-[11px]">
                    <span className="text-slate-500 font-semibold uppercase tracking-wider">Note</span>
                    <input value={e.custom_note || ''} onChange={(ev) => update(p.tier, 'custom_note', ev.target.value)} className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-300 rounded" />
                  </label>
                </div>

                <button
                  onClick={() => save(p.tier)}
                  disabled={busy === p.tier}
                  data-testid={`plan-save-${p.tier}`}
                  className="w-full flex items-center justify-center gap-1 mt-2 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50"
                >
                  <Save size={12} /> {busy === p.tier ? 'Saving…' : 'Save overrides'}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const NumField = ({ label, v, onChange }) => (
  <label className="block text-[11px]">
    <span className="text-slate-500 font-semibold uppercase tracking-wider">{label}</span>
    <input type="number" value={v ?? ''} onChange={(e) => onChange(parseInt(e.target.value) || 0)} className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-300 rounded" />
  </label>
);
