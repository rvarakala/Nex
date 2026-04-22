import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, Pill, KPITile, fmtDateTime, Empty } from './shared';
import { AlertCircle, MessageCircle, Send } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PRIO_TONE = { low: 'slate', medium: 'indigo', high: 'amber', urgent: 'rose' };
const STATUS_TONE = { Open: 'amber', Pending: 'indigo', Resolved: 'emerald', Escalated: 'rose', Closed: 'slate' };

export default function SupportDeskPage() {
  const [d, setD] = useState(null);
  const [statusFilter, setStatus] = useState('');
  const [priorityFilter, setPriority] = useState('');
  const [sel, setSel] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (priorityFilter) p.set('priority', priorityFilter);
    const r = await axios.get(`${API}/admin/v2/tickets?${p}`);
    setD(r.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter, priorityFilter]);

  if (!d) return <div className="p-6 text-slate-500">Loading tickets…</div>;

  return (
    <div className="p-6 space-y-5" data-testid="admin-support-page">
      <PageHeader title="Support Desk" subtitle={`${d.count} tickets across the platform`}>
        <select value={statusFilter} onChange={(e) => setStatus(e.target.value)} className="text-sm px-2 py-1.5 border border-slate-300 rounded">
          <option value="">All statuses</option>
          {d.stats.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriority(e.target.value)} className="text-sm px-2 py-1.5 border border-slate-300 rounded">
          <option value="">All priorities</option>
          {d.stats.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={() => setShowNew(true)} data-testid="ticket-new-btn" className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded">+ New ticket</button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KPITile label="Avg Response" value={d.stats.avg_response_hrs != null ? `${d.stats.avg_response_hrs}h` : '—'} tone="indigo" />
        <KPITile label="Avg Resolution" value={d.stats.avg_resolution_hrs != null ? `${d.stats.avg_resolution_hrs}h` : '—'} tone="emerald" />
        <KPITile label="SLA Breaches" value={d.stats.sla_breaches} tone="rose" />
        {['low', 'medium', 'high', 'urgent'].map((p) => (
          <KPITile key={p} label={`${p} open`} value={d.stats.open_by_priority[p] || 0} tone={PRIO_TONE[p]} />
        )).slice(0, 3)}
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Ticket</th>
              <th className="px-4 py-2 text-left">Subject</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-center">Priority</th>
              <th className="px-4 py-2 text-center">Status</th>
              <th className="px-4 py-2 text-left">Tenant</th>
              <th className="px-4 py-2 text-left">SLA Due</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((t) => (
              <tr key={t.ticket_id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setSel(t)} data-testid={`ticket-row-${t.ticket_id}`}>
                <td className="px-4 py-2 font-mono text-xs text-indigo-700">{t.ticket_id}</td>
                <td className="px-4 py-2 font-semibold">{t.subject}</td>
                <td className="px-4 py-2 text-xs">{t.category}</td>
                <td className="px-4 py-2 text-center"><Pill tone={PRIO_TONE[t.priority]}>{t.priority}</Pill></td>
                <td className="px-4 py-2 text-center"><Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill></td>
                <td className="px-4 py-2 text-xs">{t.clinic_id || 'Internal'}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{fmtDateTime(t.sla_due_at)}</td>
              </tr>
            ))}
            {d.rows.length === 0 && <tr><td colSpan={7}><Empty>No tickets.</Empty></td></tr>}
          </tbody>
        </table>
      </Card>

      {sel && <TicketDrawer ticket={sel} categories={d.stats.categories} statuses={d.stats.statuses} priorities={d.stats.priorities} onClose={() => setSel(null)} onSaved={() => { setSel(null); load(); }} />}
      {showNew && <NewTicketForm categories={d.stats.categories} priorities={d.stats.priorities} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

const TicketDrawer = ({ ticket, statuses, priorities, onClose, onSaved }) => {
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = { status, priority };
      if (reply.trim()) body.reply = reply.trim();
      await axios.patch(`${API}/admin/v2/tickets/${ticket.ticket_id}`, body);
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-end justify-end z-40">
      <div className="bg-white w-full max-w-xl h-full overflow-auto flex flex-col" data-testid="ticket-drawer">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] text-slate-500">{ticket.ticket_id}</div>
            <h3 className="text-lg font-bold">{ticket.subject}</h3>
            <div className="flex gap-2 mt-1"><Pill tone={PRIO_TONE[ticket.priority]}>{ticket.priority}</Pill><Pill tone={STATUS_TONE[ticket.status]}>{ticket.status}</Pill><span className="text-xs text-slate-500">{ticket.category}</span></div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl">×</button>
        </div>

        <div className="flex-1 p-5 space-y-4">
          <div className="space-y-2">
            {(ticket.thread || []).map((m, i) => (
              <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  <MessageCircle size={10} /> {m.kind || 'msg'} · {m.author} · {fmtDateTime(m.at)}
                </div>
                <div className="text-sm whitespace-pre-wrap">{m.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t p-5 space-y-3">
          <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply…" className="w-full px-3 py-2 text-sm border border-slate-300 rounded" data-testid="ticket-reply" />
          <div className="flex gap-2 flex-wrap">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 rounded">{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 rounded">{priorities.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <button disabled={busy} onClick={save} className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50" data-testid="ticket-save"><Send size={12} /> Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const NewTicketForm = ({ categories, priorities, onClose, onSaved }) => {
  const [f, setF] = useState({ category: categories[0], priority: 'medium', subject: '', body: '', clinic_id: '', contact_email: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await axios.post(`${API}/admin/v2/tickets`, { ...f, clinic_id: f.clinic_id || null });
      onSaved();
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-3" data-testid="ticket-new-form">
        <h3 className="text-base font-bold">New Support Ticket</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Category
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded">{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label className="block text-sm">Priority
            <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded">{priorities.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </label>
        </div>
        <label className="block text-sm">Subject
          <input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" />
        </label>
        <label className="block text-sm">Description
          <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required rows={4} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Clinic ID (optional)
            <input value={f.clinic_id} onChange={(e) => setF({ ...f, clinic_id: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="tenant-kims-hearing" />
          </label>
          <label className="block text-sm">Contact email
            <input value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} type="email" className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" />
          </label>
        </div>
        {err && <div className="text-xs text-rose-700">{typeof err === 'string' ? err : JSON.stringify(err)}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded">{busy ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </form>
    </div>
  );
};
