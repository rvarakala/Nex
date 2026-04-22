import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, Pill, fmtDateTime, Empty } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const STATUS_TONE = { healthy: 'emerald', mocked: 'indigo', degraded: 'amber', down: 'rose' };

export default function SystemHealthPage() {
  const [d, setD] = useState(null);
  const [tick, setTick] = useState(0);
  const [showIncident, setShowIncident] = useState(false);

  const load = async () => {
    const r = await axios.get(`${API}/admin/v2/system/health`);
    setD(r.data);
  };
  useEffect(() => { load(); }, [tick]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 15000); return () => clearInterval(t); }, []);

  const resolve = async (id) => { await axios.post(`${API}/admin/v2/system/incidents/${id}/resolve`); load(); };

  if (!d) return <div className="p-6 text-slate-500">Pinging subsystems…</div>;

  const Card1 = ({ title, status, subtitle, value }) => (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{title}</div>
        <Pill tone={STATUS_TONE[status] || 'slate'}>{status}</Pill>
      </div>
      {value != null && <div className="text-xl font-bold text-slate-900 mt-2">{value}</div>}
      {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
    </div>
  );

  return (
    <div className="p-6 space-y-5" data-testid="admin-system-page">
      <PageHeader title="System Health" subtitle="Live subsystem monitoring — auto-refreshes every 15s">
        <button onClick={() => setShowIncident(true)} className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded" data-testid="incident-new-btn">+ Log Incident</button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card1 title="API" status={d.api.status} subtitle={`Uptime ${d.api.uptime_hours}h`} value="OK" />
        <Card1 title="Database" status={d.database.status} subtitle={`Ping ${d.database.latency_ms ?? '—'}ms`} value={d.database.latency_ms != null ? `${d.database.latency_ms}ms` : '—'} />
        <Card1 title="Email Gateway" status={d.email_gateway.status} subtitle={`${d.email_gateway.success_rate_7d}% 7d`} value="MOCK" />
        <Card1 title="SMS Gateway" status={d.sms_gateway.status} subtitle={`${d.sms_gateway.success_rate_7d}% 7d`} value="MOCK" />
        <Card1 title="WhatsApp" status={d.whatsapp_gateway.status} subtitle={`${d.whatsapp_gateway.success_rate_7d}% 7d`} value="MOCK" />
        <Card1 title="Queue backlog" status={d.queue_backlog > 10 ? "degraded" : "healthy"} value={d.queue_backlog} subtitle="service tickets WIP" />
        <Card1 title="Last backup" status={d.last_backup ? "healthy" : "degraded"} value={d.last_backup ? "✓" : "—"} subtitle={fmtDateTime(d.last_backup?.closed_at)} />
      </div>

      <Card title={`Incidents (${d.incidents.length})`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Severity</th>
              <th className="px-4 py-2 text-left">Title</th>
              <th className="px-4 py-2 text-left">Started</th>
              <th className="px-4 py-2 text-left">Resolved</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {d.incidents.map((i) => (
              <tr key={i.incident_id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs text-indigo-700">{i.incident_id}</td>
                <td className="px-4 py-2"><Pill tone={i.severity === 'critical' ? 'rose' : i.severity === 'major' ? 'amber' : 'slate'}>{i.severity}</Pill></td>
                <td className="px-4 py-2"><div className="font-semibold">{i.title}</div><div className="text-[10px] text-slate-500">{i.summary}</div></td>
                <td className="px-4 py-2 text-xs">{fmtDateTime(i.started_at)}</td>
                <td className="px-4 py-2 text-xs">{i.resolved_at ? fmtDateTime(i.resolved_at) : <Pill tone="amber">Open</Pill>}</td>
                <td className="px-4 py-2 text-right">{!i.resolved_at && <button onClick={() => resolve(i.incident_id)} className="text-xs text-emerald-700 hover:underline">Resolve</button>}</td>
              </tr>
            ))}
            {d.incidents.length === 0 && <tr><td colSpan={6}><Empty>No incidents logged. 🎉</Empty></td></tr>}
          </tbody>
        </table>
      </Card>

      {showIncident && <IncidentForm onClose={() => setShowIncident(false)} onSaved={() => { setShowIncident(false); load(); }} />}
    </div>
  );
}

const IncidentForm = ({ onClose, onSaved }) => {
  const [f, setF] = useState({ title: '', severity: 'minor', summary: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await axios.post(`${API}/admin/v2/system/incidents`, f); onSaved(); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-3">
        <h3 className="text-base font-bold">Log an Incident</h3>
        <label className="block text-sm">Title
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" />
        </label>
        <label className="block text-sm">Severity
          <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded">
            <option value="info">Info</option><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
          </select>
        </label>
        <label className="block text-sm">Summary
          <textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} rows={3} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 rounded">Log</button>
        </div>
      </form>
    </div>
  );
};
