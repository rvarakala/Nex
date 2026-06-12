import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Sparkles } from 'lucide-react';
import { PageHeader, Card, fmtDate, Empty } from './shared';
import InviteSuccessModal from './InviteSuccessModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PER_STAGE_LIMIT = 25;

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
  const [expanded, setExpanded] = useState({}); // stage → bool
  const [inviteResult, setInviteResult] = useState(null);
  const [convertBusy, setConvertBusy] = useState({}); // email → bool

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

  const convertLead = async (lead) => {
    if (convertBusy[lead.email]) return;
    if (!window.confirm(`Convert ${lead.clinic_name || lead.email} to a clinic and send invite to ${lead.email}?`)) return;
    setConvertBusy((b) => ({ ...b, [lead.email]: true }));
    try {
      const r = await axios.post(
        `${API}/admin/v2/leads/${encodeURIComponent(lead.email)}/convert`,
        { trial_days: 30 },
      );
      setInviteResult(r.data);
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Conversion failed';
      alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setConvertBusy((b) => ({ ...b, [lead.email]: false }));
    }
  };

  const toggleStage = (s) => setExpanded((prev) => ({ ...prev, [s]: !prev[s] }));

  if (err) return <div className="p-6 text-rose-700">{err}</div>;
  if (!d) return <div className="p-6 text-slate-500">Loading leads pipeline…</div>;

  const byStage = Object.fromEntries(d.stages.map((s) => [s, d.rows.filter((r) => (r.stage || 'Lead') === s)]));

  return (
    <div className="p-6 space-y-5" data-testid="admin-leads-page">
      <PageHeader title="Leads / Trial CRM" subtitle={`${d.rows.length} prospects in the pipeline`} />

      {typeof d.in_queue_this_week === 'number' && (
        <div
          data-testid="leads-week-counter"
          className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-fuchsia-50 shadow-sm"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-indigo-200">
            <Sparkles size={16} className="text-indigo-600" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-700">
              Inbound this week
            </div>
            <div className="text-sm font-semibold text-slate-900">
              <span className="text-indigo-600 font-extrabold text-lg mr-1">
                {d.in_queue_this_week}
              </span>
              in queue this week
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
        {d.stages.map((s) => {
          const all = byStage[s];
          const showAll = expanded[s];
          const shown = showAll ? all : all.slice(0, PER_STAGE_LIMIT);
          const more = all.length - shown.length;
          return (
            <div key={s} className="bg-white rounded-xl border border-slate-200 flex flex-col min-h-[300px]">
              <div className={`px-4 py-2.5 border-b border-slate-200 flex items-center justify-between ${STAGE_COLOR[s]}`}>
                <span className="text-[11px] font-bold uppercase tracking-wider">{s}</span>
                <span className="text-[10px] font-mono">{d.counts[s] || 0}</span>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-auto" data-testid={`stage-col-${s.replace(' ', '-')}`}>
                {shown.map((r) => (
                  <div key={r.email} className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-indigo-300 hover:bg-white cursor-grab">
                    <div className="text-sm font-semibold text-slate-900">{r.clinic_name || r.email}</div>
                    <div className="text-[11px] text-slate-600">{r.contact_name || '—'}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{r.email}</div>
                    {r.city && <div className="text-[10px] text-slate-500">{r.city}</div>}
                    {r.source && <div className="text-[9px] mt-1 text-indigo-600 font-semibold uppercase tracking-wider">{r.source}</div>}
                    {r.notes && <div className="text-[10px] text-slate-500 mt-1 italic line-clamp-2">{r.notes}</div>}
                    <div className="text-[9px] text-slate-400 mt-2">{fmtDate(r.created_at)}</div>
                    {(r.stage || 'Lead') !== 'Converted' && (
                      <button
                        onClick={() => convertLead(r)}
                        disabled={!!convertBusy[r.email]}
                        data-testid={`convert-lead-${r.email}`}
                        className="mt-2 w-full inline-flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 rounded text-white bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 disabled:from-slate-300 disabled:to-slate-300 shadow-sm transition-all"
                      >
                        <Sparkles size={11} />
                        {convertBusy[r.email] ? 'Converting…' : 'Convert & Send Invite'}
                      </button>
                    )}
                    {r.converted_clinic_id && (
                      <div className="mt-1.5 text-[9px] text-emerald-700 font-mono truncate" title={r.converted_clinic_id}>
                        ✓ {r.converted_clinic_id.slice(0, 28)}…
                      </div>
                    )}
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
                {all.length === 0 && <Empty>—</Empty>}
                {more > 0 && (
                  <button
                    onClick={() => toggleStage(s)}
                    data-testid={`leads-show-more-${s.replace(' ', '-')}`}
                    className="w-full py-2 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    + Show {more} more
                  </button>
                )}
                {showAll && all.length > PER_STAGE_LIMIT && (
                  <button
                    onClick={() => toggleStage(s)}
                    className="w-full py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    Collapse ↑
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {inviteResult && (
        <InviteSuccessModal result={inviteResult} onClose={() => setInviteResult(null)} />
      )}
    </div>
  );
}
