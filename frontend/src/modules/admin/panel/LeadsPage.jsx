import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, fmtDate, Empty } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STAGE_COLOR = {
  'Lead': 'bg-slate-100 text-slate-700 border-slate-300',
  'Demo Scheduled': 'bg-indigo-50 text-indigo-800 border-indigo-200',
  'Trial Started': 'bg-amber-50 text-amber-800 border-amber-200',
  'Active Trial': 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200',
  'Converted': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'Lost': 'bg-rose-50 text-rose-800 border-rose-200',
};

export default function LeadsPage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const r = await axios.get(`${API}/admin/v2/leads`);
      setD(r.data);
    } catch (e) { setErr(e?.response?.data?.detail?.message || 'Failed'); }
  };
  useEffect(() => { load(); }, []);

  const moveLead = async (email, stage) => {
    await axios.patch(`${API}/admin/v2/leads/${encodeURIComponent(email)}`, { stage });
    load();
  };

  if (err) return <div className="p-6 text-rose-700">{err}</div>;
  if (!d) return <div className="p-6 text-slate-500">Loading leads pipeline…</div>;

  const byStage = Object.fromEntries(d.stages.map((s) => [s, d.rows.filter((r) => (r.stage || 'Lead') === s)]));

  return (
    <div className="p-6 space-y-5" data-testid="admin-leads-page">
      <PageHeader title="Leads / Trial CRM" subtitle={`${d.rows.length} prospects in the pipeline`} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
        {d.stages.map((s) => (
          <div key={s} className="bg-white rounded-xl border border-slate-200 flex flex-col min-h-[300px]">
            <div className={`px-4 py-2.5 border-b border-slate-200 flex items-center justify-between ${STAGE_COLOR[s]}`}>
              <span className="text-[11px] font-bold uppercase tracking-wider">{s}</span>
              <span className="text-[10px] font-mono">{d.counts[s] || 0}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-auto" data-testid={`stage-col-${s.replace(' ', '-')}`}>
              {byStage[s].map((r) => (
                <div key={r.email} className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-indigo-300 hover:bg-white cursor-grab">
                  <div className="text-sm font-semibold text-slate-900">{r.clinic_name || r.email}</div>
                  <div className="text-[11px] text-slate-600">{r.contact_name || '—'}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{r.email}</div>
                  {r.city && <div className="text-[10px] text-slate-500">{r.city}</div>}
                  {r.source && <div className="text-[9px] mt-1 text-indigo-600 font-semibold uppercase tracking-wider">{r.source}</div>}
                  {r.notes && <div className="text-[10px] text-slate-500 mt-1 italic line-clamp-2">{r.notes}</div>}
                  <div className="text-[9px] text-slate-400 mt-2">{fmtDate(r.created_at)}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {d.stages.filter((x) => x !== s).map((to) => (
                      <button key={to} onClick={() => moveLead(r.email, to)}
                        className="text-[9px] px-1.5 py-0.5 rounded text-slate-600 bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-700"
                        data-testid={`move-${r.email}-to-${to.replace(' ', '-')}`}>
                        → {to}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {byStage[s].length === 0 && <Empty>—</Empty>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
