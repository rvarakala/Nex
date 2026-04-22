import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const KIND_META = {
  adaptation_1w:  { label: '1-week adaptation',  color: 'bg-emerald-100 text-emerald-800' },
  review_1mo:     { label: '1-month review',     color: 'bg-blue-100 text-blue-800' },
  review_3mo:     { label: '3-month review',     color: 'bg-indigo-100 text-indigo-800' },
  review_annual:  { label: 'Annual review',      color: 'bg-purple-100 text-purple-800' },
  trial_day3:     { label: 'Trial day 3',        color: 'bg-amber-100 text-amber-800' },
  trial_day7:     { label: 'Trial day 7',        color: 'bg-amber-100 text-amber-800' },
  trial_overdue:  { label: 'Trial overdue',      color: 'bg-rose-100 text-rose-800' },
  consumable:     { label: 'Consumable',         color: 'bg-teal-100 text-teal-800' },
  nps:            { label: 'NPS ask',            color: 'bg-pink-100 text-pink-800' },
  upgrade:        { label: 'Upgrade candidate',  color: 'bg-orange-100 text-orange-800' },
};

const STATUS_STYLE = {
  pending:   'bg-slate-200 text-slate-700',
  sent:      'bg-blue-100 text-blue-800',
  done:      'bg-emerald-100 text-emerald-800',
  dismissed: 'bg-slate-100 text-slate-400 line-through',
};


export default function FollowupBoardPage() {
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [bucket, setBucket] = useState('today');
  const [kind, setKind] = useState('');
  const [me, setMe] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(null);

  useEffect(() => { (async () => {
    try { setMe((await axios.get(`${API}/auth/me`)).data?.user || null); } catch {/*noop*/}
  })(); }, []);

  const canAct = useMemo(() => !!me && ['front_desk','audiologist','clinic_owner','super_admin'].includes(me.role), [me]);
  const canGenerate = useMemo(() => !!me && ['clinic_owner','super_admin'].includes(me.role), [me]);

  const load = useCallback(async () => {
    const [r, k] = await Promise.all([
      axios.get(`${API}/ha/followups`, { params: { bucket, kind: kind || undefined, limit: 200 } }),
      axios.get(`${API}/ha/followups-kpis`),
    ]);
    setRows(r.data);
    setKpis(k.data);
  }, [bucket, kind]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!window.confirm('Run the daily follow-up scan now? Safe — creates only missing entries.')) return;
    setGenerating(true);
    try {
      const r = await axios.post(`${API}/ha/followups/generate`);
      alert(`Scan complete — ${r.data.created} new follow-up(s) created.`);
      load();
    } catch (e) { alert(e?.response?.data?.detail || 'Generate failed'); }
    finally { setGenerating(false); }
  };

  const sendWA = async (f) => {
    if (!f.patient_mobile) { alert('Patient has no mobile number on file.'); return; }
    const msg = encodeURIComponent(f.message_template || '');
    const num = f.patient_mobile.replace(/\D/g, '');
    window.open(`https://wa.me/${num.startsWith('91') || num.length > 10 ? num : '91' + num}?text=${msg}`, '_blank');
    setBusy(f.followup_id);
    try {
      await axios.post(`${API}/ha/followups/${f.followup_id}/mark-sent`, { channel: 'whatsapp' });
      load();
    } catch {/*noop*/}
    finally { setBusy(null); }
  };

  const markDone = async (f) => {
    setBusy(f.followup_id);
    try {
      await axios.post(`${API}/ha/followups/${f.followup_id}/done`, {});
      load();
    } finally { setBusy(null); }
  };
  const dismiss = async (f) => {
    if (!window.confirm('Dismiss this follow-up? It will not show up again.')) return;
    setBusy(f.followup_id);
    try {
      await axios.post(`${API}/ha/followups/${f.followup_id}/dismiss`);
      load();
    } finally { setBusy(null); }
  };

  return (
    <div className="p-5" data-testid="ha-followup-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Follow-up Board</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Daily CRM queue — adaptation, reviews, consumables, trial check-ins, upgrade outreach.</p>
        </div>
        <div className="flex items-center gap-2">
          {canGenerate && (
            <button onClick={handleGenerate} disabled={generating} data-testid="ha-fup-generate" className="px-3 py-1.5 text-xs font-semibold bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-md shadow-sm">
              {generating ? 'Scanning…' : '↻ Run daily scan'}
            </button>
          )}
        </div>
      </div>

      {kpis && (
        <div className="grid grid-cols-5 gap-3 mb-4">
          <Kpi label="Overdue"   value={kpis.overdue}    color="bg-rose-50 text-rose-800 border-rose-200"       testid="ha-fup-kpi-overdue" />
          <Kpi label="Due today" value={kpis.due_today}  color="bg-amber-50 text-amber-800 border-amber-200"   testid="ha-fup-kpi-today" />
          <Kpi label="Upcoming"  value={kpis.upcoming}   color="bg-slate-50 text-slate-700 border-slate-200"   testid="ha-fup-kpi-upcoming" />
          <Kpi label="Sent today"    value={kpis.sent_today}    color="bg-blue-50 text-blue-800 border-blue-200"       testid="ha-fup-kpi-sent" />
          <Kpi label="Done today"    value={kpis.done_today}    color="bg-emerald-50 text-emerald-800 border-emerald-200" testid="ha-fup-kpi-done" />
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-slate-200 mb-3">
        {[['overdue','Overdue'],['today','Due Today'],['upcoming','Upcoming'],['done','Done / Dismissed']].map(([k,l]) => (
          <button key={k} onClick={() => setBucket(k)} data-testid={`ha-fup-tab-${k}`}
            className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider border-b-2 ${bucket === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {l}
          </button>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="ha-fup-kind-filter" className="ml-auto bg-white border border-slate-300 rounded-md px-2 py-1 text-xs mb-1">
          <option value="">All kinds</option>
          {Object.entries(KIND_META).map(([k,m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Due</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-3 py-2 text-left">Ref</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-400 italic text-xs">Nothing here — enjoy the quiet.</td></tr>}
            {rows.map(f => {
              const meta = KIND_META[f.kind] || { label: f.kind, color: 'bg-slate-100 text-slate-700' };
              const isOpen = f.status === 'pending' || f.status === 'sent';
              return (
                <tr key={f.followup_id} className="border-t border-slate-100 hover:bg-slate-50/50" data-testid={`ha-fup-row-${f.followup_id}`}>
                  <td className="px-3 py-2 text-xs tabular-nums">{f.due_date}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span></td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-semibold">{f.patient_name || f.patient_id}</div>
                    {f.patient_mobile && <div className="text-[10px] text-slate-500">{f.patient_mobile}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{f.title}</td>
                  <td className="px-3 py-2 text-[10px] font-mono text-slate-500">{f.ref_kind ? `${f.ref_kind}:${f.ref_id}` : '—'}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[f.status]}`}>{f.status.toUpperCase()}</span></td>
                  <td className="px-3 py-2">
                    {canAct && isOpen && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => sendWA(f)} disabled={busy === f.followup_id || !f.patient_mobile} data-testid={`ha-fup-wa-${f.followup_id}`} title={f.patient_mobile ? 'Open WhatsApp' : 'No mobile on file'}
                          className="px-2 py-0.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded">WA</button>
                        <button onClick={() => markDone(f)} disabled={busy === f.followup_id} data-testid={`ha-fup-done-${f.followup_id}`}
                          className="px-2 py-0.5 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">Done</button>
                        <button onClick={() => dismiss(f)} disabled={busy === f.followup_id} data-testid={`ha-fup-dismiss-${f.followup_id}`}
                          className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-800">✕</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


const Kpi = ({ label, value, color, testid }) => (
  <div data-testid={testid} className={`border rounded-md px-3 py-2 ${color}`}>
    <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
    <div className="text-lg font-bold tabular-nums">{value ?? 0}</div>
  </div>
);
