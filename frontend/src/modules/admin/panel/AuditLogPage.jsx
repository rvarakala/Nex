import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, Pill, fmtDateTime, Empty } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AuditLogPage() {
  const [d, setD] = useState(null);
  const [actor, setActor] = useState(''); const [action, setAction] = useState(''); const [target, setTarget] = useState('');

  const load = async () => {
    const p = new URLSearchParams();
    if (actor) p.set('actor', actor);
    if (action) p.set('action', action);
    if (target) p.set('target', target);
    const r = await axios.get(`${API}/admin/v2/audit?${p}`);
    setD(r.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [actor, action, target]);

  if (!d) return <div className="p-6 text-slate-500">Loading audit trail…</div>;

  return (
    <div className="p-6 space-y-5" data-testid="admin-audit-page">
      <PageHeader title="Audit Log" subtitle={`${d.count} immutable events. Filter by actor / action / target.`} />

      <div className="grid grid-cols-3 gap-3">
        <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor email…" className="px-3 py-1.5 text-sm border border-slate-300 rounded" data-testid="audit-filter-actor" />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action contains…" className="px-3 py-1.5 text-sm border border-slate-300 rounded" data-testid="audit-filter-action" />
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target contains…" className="px-3 py-1.5 text-sm border border-slate-300 rounded" data-testid="audit-filter-target" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Top Actions" className="lg:col-span-1">
          <div className="p-3 space-y-1">
            {d.by_action.map((a) => (
              <div key={a.action} className="flex items-center justify-between text-xs">
                <span className="font-mono text-indigo-700 truncate">{a.action}</span>
                <span className="font-semibold">{a.count}</span>
              </div>
            ))}
            {d.by_action.length === 0 && <Empty>No data.</Empty>}
          </div>
        </Card>

        <Card title="Top Actors" className="lg:col-span-1">
          <div className="p-3 space-y-1">
            {d.by_actor.map((a) => (
              <div key={a.actor} className="flex items-center justify-between text-xs">
                <span className="text-slate-700 truncate">{a.actor}</span>
                <span className="font-semibold">{a.count}</span>
              </div>
            ))}
            {d.by_actor.length === 0 && <Empty>No data.</Empty>}
          </div>
        </Card>

        <Card title="Summary" className="lg:col-span-1">
          <div className="p-3 text-xs space-y-1">
            <div><span className="text-slate-500">Events shown:</span> <b>{d.count}</b></div>
            <div><span className="text-slate-500">Unique actions:</span> <b>{d.by_action.length}</b></div>
            <div><span className="text-slate-500">Unique actors:</span> <b>{d.by_actor.length}</b></div>
          </div>
        </Card>
      </div>

      <Card title="Events">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Actor</th>
              <th className="px-4 py-2 text-left">Action</th>
              <th className="px-4 py-2 text-left">Target</th>
              <th className="px-4 py-2 text-left">IP</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.log_id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(r.at)}</td>
                <td className="px-4 py-2 text-xs">{r.actor_email}<div className="text-[10px] text-slate-500">{r.actor_role}</div></td>
                <td className="px-4 py-2 font-mono text-[11px] text-indigo-700">{r.action}</td>
                <td className="px-4 py-2 text-xs">{r.target}</td>
                <td className="px-4 py-2 text-[10px] font-mono text-slate-500">{r.ip || '—'}</td>
              </tr>
            ))}
            {d.rows.length === 0 && <tr><td colSpan={5}><Empty>No events match.</Empty></td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
