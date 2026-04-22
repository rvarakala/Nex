import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, Pill, fmtDateTime, Empty } from './shared';
import { Megaphone } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function NotificationsPage() {
  const [rows, setRows] = useState([]);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    const r = await axios.get(`${API}/admin/v2/notifications`);
    setRows(r.data || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 space-y-5" data-testid="admin-notifications-page">
      <PageHeader title="Notifications Center" subtitle="Broadcast announcements to tenants · in-app live, email/SMS/WhatsApp recorded as MOCKED">
        <button onClick={() => setShowNew(true)} data-testid="notif-new-btn" className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded flex items-center gap-1"><Megaphone size={13} /> Send broadcast</button>
      </PageHeader>

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Title</th>
              <th className="px-4 py-2 text-left">Audience</th>
              <th className="px-4 py-2 text-center">Targets</th>
              <th className="px-4 py-2 text-left">Channels</th>
              <th className="px-4 py-2 text-left">Priority</th>
              <th className="px-4 py-2 text-left">Sent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.notification_id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs text-indigo-700">{n.notification_id}</td>
                <td className="px-4 py-2">
                  <div className="font-semibold">{n.title}</div>
                  <div className="text-[10px] text-slate-500 truncate max-w-md">{n.body}</div>
                </td>
                <td className="px-4 py-2 text-xs">{n.audience}{n.audience_filter ? ` · ${n.audience_filter}` : ''}</td>
                <td className="px-4 py-2 text-center text-xs font-semibold">{n.target_count}</td>
                <td className="px-4 py-2 text-xs">{(n.channels || []).map((c) => <span key={c} className="inline-block px-1.5 py-0.5 mr-1 bg-slate-100 rounded">{c}</span>)}</td>
                <td className="px-4 py-2"><Pill tone={n.priority === 'critical' ? 'rose' : n.priority === 'important' ? 'amber' : 'slate'}>{n.priority}</Pill></td>
                <td className="px-4 py-2 text-xs text-slate-500">{fmtDateTime(n.sent_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7}><Empty>No broadcasts sent yet.</Empty></td></tr>}
          </tbody>
        </table>
      </Card>

      {showNew && <NewBroadcastForm onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

const NewBroadcastForm = ({ onClose, onSaved }) => {
  const [f, setF] = useState({ title: '', body: '', audience: 'all', audience_filter: '', channels: ['in-app'], priority: 'info' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const toggleCh = (ch) => setF({ ...f, channels: f.channels.includes(ch) ? f.channels.filter((x) => x !== ch) : [...f.channels, ch] });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await axios.post(`${API}/admin/v2/notifications/send`, { ...f, audience_filter: f.audience === 'all' ? null : f.audience_filter }); onSaved(); }
    catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-3" data-testid="broadcast-form">
        <h3 className="text-base font-bold">Send broadcast</h3>
        <label className="block text-sm">Title <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
        <label className="block text-sm">Body <textarea required rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Audience
            <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded">
              <option value="all">All tenants</option><option value="tier">By tier</option><option value="tenant">Single tenant</option>
            </select>
          </label>
          {f.audience !== 'all' && (
            <label className="block text-sm">{f.audience === 'tier' ? 'Tier' : 'Clinic ID'}
              <input value={f.audience_filter} onChange={(e) => setF({ ...f, audience_filter: e.target.value })} placeholder={f.audience === 'tier' ? 'PREMIUM' : 'tenant-kims-hearing'} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" />
            </label>
          )}
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Channels</div>
          <div className="flex gap-2 mt-1">
            {['in-app', 'email', 'sms', 'whatsapp'].map((ch) => (
              <button type="button" key={ch} onClick={() => toggleCh(ch)} className={`px-2 py-1 text-xs rounded ${f.channels.includes(ch) ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>{ch}</button>
            ))}
          </div>
        </div>
        <label className="block text-sm">Priority
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded">
            <option value="info">Info</option><option value="important">Important</option><option value="critical">Critical</option>
          </select>
        </label>
        {err && <div className="text-xs text-rose-700">{typeof err === 'string' ? err : JSON.stringify(err)}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded">Send</button>
        </div>
      </form>
    </div>
  );
};
