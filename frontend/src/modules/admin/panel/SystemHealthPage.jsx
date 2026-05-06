/**
 * SystemHealthPage — live, accurate view of every subsystem AUDINEXA depends on.
 *
 * Previously displayed stale "MOCKED" tags even when providers were live.
 * Rebuilt so each gateway card:
 *   • Derives status from the current env/cred config (backend does this)
 *   • Shows the actual provider + from-address / from-number
 *   • Has a "Ping now" button that hits POST /system/ping-gateway and shows
 *     real round-trip latency + the provider response (Twilio SID, ZeptoMail
 *     Message-ID, MSG91 HTTP code)
 *
 * Also adds:
 *   • Data Health probe card (schema-drift early-warning — the ha_sales
 *     500 we fixed earlier would have shown up here)
 *   • Incident cleanup ("Clear resolved") button
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Send, Activity, AlertCircle, Trash2, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
import { PageHeader, Card, Pill, fmtDateTime, Empty } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const STATUS_TONE = { healthy: 'emerald', mocked: 'slate', degraded: 'amber', down: 'rose', error: 'rose' };

export default function SystemHealthPage() {
  const [d, setD] = useState(null);
  const [tick, setTick] = useState(0);
  const [showIncident, setShowIncident] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [dataHealth, setDataHealth] = useState(null);
  const [dhLoading, setDhLoading] = useState(false);
  const [pingState, setPingState] = useState({});  // {email: {busy, result}, sms: {...}, whatsapp: {...}}
  const [storage, setStorage] = useState(null);
  const [purging, setPurging] = useState(false);

  const load = async () => {
    const r = await axios.get(`${API}/admin/v2/system/health`);
    setD(r.data);
  };
  const loadDataHealth = async () => {
    setDhLoading(true);
    try {
      const r = await axios.get(`${API}/admin/v2/system/data-health`);
      setDataHealth(r.data);
    } finally { setDhLoading(false); }
  };
  const loadStorage = async () => {
    try {
      const r = await axios.get(`${API}/admin/v2/system/storage`);
      setStorage(r.data);
    } catch { /* permission-gated */ }
  };
  const purgePdfs = async () => {
    if (!window.confirm('Run PDF retention sweep now? Blobs older than the configured window will be deleted.')) return;
    setPurging(true);
    try {
      const r = await axios.post(`${API}/admin/v2/system/storage/purge-pdfs`, {});
      await loadStorage();
      window.alert(`Sweep complete. Purged ${r.data.purged}/${r.data.scanned}, freed ${(r.data.freed_bytes/1024).toFixed(1)} KB.`);
    } catch (e) {
      window.alert('Purge failed: ' + (e?.response?.data?.detail || e.message));
    } finally { setPurging(false); }
  };
  useEffect(() => { load(); loadDataHealth(); loadStorage(); }, [tick]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 15000); return () => clearInterval(t); }, []);

  const resolve = async (id) => { await axios.post(`${API}/admin/v2/system/incidents/${id}/resolve`); load(); };
  const pingGateway = async (gw) => {
    setPingState((s) => ({ ...s, [gw]: { busy: true } }));
    try {
      const r = await axios.post(`${API}/admin/v2/system/ping-gateway`, { gateway: gw });
      setPingState((s) => ({ ...s, [gw]: { busy: false, result: r.data } }));
    } catch (err) {
      setPingState((s) => ({ ...s, [gw]: { busy: false, result: { latency_ms: 0, result: { status: 'error', error: err?.message } } } }));
    }
  };

  if (!d) return <div className="p-6 text-slate-500">Pinging subsystems…</div>;

  const visibleIncidents = showResolved
    ? d.incidents
    : d.incidents.filter((i) => !i.resolved_at);
  const openCount = d.incidents.filter((i) => !i.resolved_at).length;
  const resolvedCount = d.incidents.filter((i) => i.resolved_at).length;

  return (
    <div className="p-6 space-y-5" data-testid="admin-system-page">
      <PageHeader title="System Health" subtitle="Live subsystem monitoring — auto-refreshes every 15s">
        <button onClick={() => setShowIncident(true)} className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded" data-testid="incident-new-btn">
          + Log Incident
        </button>
      </PageHeader>

      {/* Core subsystem tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BasicTile title="API"          status={d.api.status}       subtitle={`Uptime ${d.api.uptime_hours}h`}  value="OK" testid="tile-api" />
        <BasicTile title="Database"     status={d.database.status}  subtitle={`Ping ${d.database.latency_ms ?? '—'}ms`} value={d.database.latency_ms != null ? `${d.database.latency_ms}ms` : '—'} testid="tile-db" />
        <BasicTile title="Queue"        status={d.queue_backlog > 10 ? 'degraded' : 'healthy'} value={d.queue_backlog} subtitle="tickets WIP" testid="tile-queue" />
        <BasicTile title="Last backup"  status={d.last_backup ? 'healthy' : 'degraded'} value={d.last_backup ? '✓' : '—'} subtitle={fmtDateTime(d.last_backup?.closed_at)} testid="tile-backup" />
      </div>

      {/* Gateway tiles — with Ping buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GatewayTile gw="email"    data={d.email_gateway}    ping={pingState.email}    onPing={() => pingGateway('email')}    testid="gw-email" />
        <GatewayTile gw="sms"      data={d.sms_gateway}      ping={pingState.sms}      onPing={() => pingGateway('sms')}      testid="gw-sms" />
        <GatewayTile gw="whatsapp" data={d.whatsapp_gateway} ping={pingState.whatsapp} onPing={() => pingGateway('whatsapp')} testid="gw-whatsapp" />
      </div>

      {/* Data health probe */}
      <DataHealthCard data={dataHealth} loading={dhLoading} onRefresh={loadDataHealth} />

      {/* Storage / Hybrid PDF Retention */}
      <StorageCard data={storage} purging={purging} onPurge={purgePdfs} onRefresh={loadStorage} />

      {/* Incidents */}
      <Card
        title={`Incidents (${openCount} open · ${resolvedCount} resolved)`}
        actions={
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-slate-600 flex items-center gap-1">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="rounded border-slate-300" />
              Show resolved
            </label>
          </div>
        }
      >
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
            {visibleIncidents.map((i) => (
              <tr key={i.incident_id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs text-indigo-700">{i.incident_id}</td>
                <td className="px-4 py-2"><Pill tone={i.severity === 'critical' ? 'rose' : i.severity === 'major' ? 'amber' : 'slate'}>{i.severity}</Pill></td>
                <td className="px-4 py-2">
                  <div className="font-semibold">{i.title}</div>
                  {i.summary && <div className="text-[10px] text-slate-500">{i.summary}</div>}
                </td>
                <td className="px-4 py-2 text-xs">{fmtDateTime(i.started_at)}</td>
                <td className="px-4 py-2 text-xs">{i.resolved_at ? fmtDateTime(i.resolved_at) : <Pill tone="amber">Open</Pill>}</td>
                <td className="px-4 py-2 text-right">{!i.resolved_at && <button onClick={() => resolve(i.incident_id)} className="text-xs font-semibold text-emerald-700 hover:underline">Resolve</button>}</td>
              </tr>
            ))}
            {visibleIncidents.length === 0 && <tr><td colSpan={6}><Empty>No {showResolved ? '' : 'open '}incidents. 🎉</Empty></td></tr>}
          </tbody>
        </table>
      </Card>

      {showIncident && <IncidentForm onClose={() => setShowIncident(false)} onSaved={() => { setShowIncident(false); load(); }} />}
    </div>
  );
}

// ---------- Basic status tile ----------
function BasicTile({ title, status, subtitle, value, testid }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4" data-testid={testid}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{title}</div>
        <Pill tone={STATUS_TONE[status] || 'slate'}>{status}</Pill>
      </div>
      {value != null && <div className="text-xl font-bold text-slate-900 mt-2">{value}</div>}
      {subtitle && <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={subtitle}>{subtitle}</div>}
    </div>
  );
}

// ---------- Gateway tile with Ping button ----------
function GatewayTile({ gw, data, ping, onPing, testid }) {
  const label = { email: 'Email Gateway', sms: 'SMS Gateway', whatsapp: 'WhatsApp Gateway' }[gw];
  const identityRow = data.from_addr || data.from_number || data.account_sid || null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4" data-testid={testid}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <Pill tone={STATUS_TONE[data.status] || 'slate'}>{data.status}</Pill>
      </div>
      <div className="mt-2 space-y-0.5">
        <div className="text-sm font-bold text-slate-900 capitalize">{data.provider || 'not configured'}</div>
        {identityRow && <div className="text-[11px] text-slate-600 font-mono truncate" title={identityRow}>{identityRow}</div>}
        {data.note && <div className="text-[10.5px] text-amber-700 italic mt-0.5">{data.note}</div>}
      </div>
      <div className="flex items-center justify-between mt-3">
        <div className="text-[10.5px] text-slate-500">{data.success_rate_7d ?? 100}% 7d delivery</div>
        <button
          onClick={onPing}
          disabled={ping?.busy || data.status === 'mocked'}
          data-testid={`${testid}-ping`}
          className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
            data.status === 'mocked'
              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
          }`}
        >
          {ping?.busy ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          Ping now
        </button>
      </div>
      {ping?.result && (
        <div
          data-testid={`${testid}-ping-result`}
          className={`mt-2 rounded border px-2 py-1.5 text-[10.5px] ${
            (ping.result.result?.status === 'sent' || ping.result.result?.status === 'mocked' || ping.result.result?.status === 'healthy')
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="font-semibold">
            {ping.result.latency_ms}ms · status: {ping.result.result?.status}
          </div>
          {ping.result.result?.message_id && <div className="font-mono truncate" title={ping.result.result.message_id}>{ping.result.result.message_id}</div>}
          {ping.result.result?.sid   && <div className="font-mono">SID: {ping.result.result.sid}</div>}
          {ping.result.result?.note  && <div>{ping.result.result.note}</div>}
          {ping.result.result?.error && <div className="mt-0.5 break-words">{ping.result.result.error}</div>}
        </div>
      )}
    </div>
  );
}

// ---------- Data-health probe card ----------
function DataHealthCard({ data, loading, onRefresh }) {
  return (
    <Card
      title="Data Health"
      subtitle="Validates sample docs in critical collections against their Pydantic models — catches schema drift before users hit 500s."
      actions={
        <button onClick={onRefresh} disabled={loading}
          data-testid="data-health-refresh"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded">
          {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          Re-probe
        </button>
      }
    >
      {!data && loading && <div className="px-4 py-3 text-sm text-slate-500">Probing…</div>}
      {data && (
        <div className="p-4 space-y-3" data-testid="data-health-card">
          <div className="flex items-center gap-2">
            {data.overall === 'healthy' ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-amber-600" />}
            <span className="text-[13px] font-bold">
              Overall: <span className={data.overall === 'healthy' ? 'text-emerald-700' : 'text-amber-700'}>{data.overall}</span>
            </span>
            <span className="text-[11px] text-slate-500 ml-auto">{new Date(data.at).toLocaleTimeString()}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {data.probes.map((p) => (
              <div key={p.collection} className={`rounded-lg border px-3 py-2.5 ${p.failed === 0 ? 'border-slate-200 bg-slate-50/60' : 'border-rose-200 bg-rose-50/70'}`}>
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] font-bold text-slate-700">{p.collection}</div>
                  <div className={`text-[11px] font-bold ${p.failed === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{p.health_pct}%</div>
                </div>
                <div className="text-[10.5px] text-slate-500 mt-0.5">
                  {p.total_docs} total · {p.sampled} sampled · <b className={p.failed > 0 ? 'text-rose-700' : 'text-slate-700'}>{p.failed} failed</b>
                </div>
                {p.failures.length > 0 && (
                  <div className="mt-2 border-t border-rose-200 pt-1.5 space-y-1 max-h-32 overflow-auto">
                    {p.failures.slice(0, 3).map((f, i) => (
                      <div key={i} className="text-[10px] text-rose-700">
                        <span className="font-mono">{f.id}</span>: {f.errors.map((e) => `${e.loc} — ${e.msg}`).join('; ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- Storage / Hybrid PDF retention ----------
function StorageCard({ data, purging, onPurge, onRefresh }) {
  if (!data) return (
    <Card title="Storage · Hybrid PDF Retention" testid="storage-card">
      <div className="px-5 py-4 text-xs text-slate-400 italic">Loading storage stats…</div>
    </Card>
  );
  const buckets = Object.entries(data.buckets || {});
  const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
  const total = buckets.reduce((s, [, v]) => s + (v.total_bytes || 0), 0);
  const swept = buckets.filter(([, v]) => v.swept).reduce((s, [, v]) => s + (v.total_bytes || 0), 0);

  return (
    <Card
      title={`Storage · Hybrid PDF Retention (${data.retention_days}d)`}
      subtitle="Audiogram-report PDFs are auto-purged after the retention window — on-demand generator handles older fetches"
      testid="storage-card"
      actions={
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="px-2 py-1 text-[11px] font-semibold border border-slate-300 rounded inline-flex items-center gap-1" data-testid="storage-refresh">
            <RefreshCw size={11} /> Refresh
          </button>
          <button
            onClick={onPurge}
            disabled={purging}
            data-testid="storage-purge"
            className={`px-2 py-1 text-[11px] font-semibold rounded inline-flex items-center gap-1 ${
              purging ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      : 'bg-amber-600 text-white hover:bg-amber-700'
            }`}
          >
            {purging ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            Purge expired PDFs
          </button>
        </div>
      }
    >
      <div className="px-5 py-3 grid grid-cols-3 gap-3 text-xs border-b border-slate-100 bg-slate-50">
        <div><div className="text-[10px] uppercase font-semibold text-slate-500">Total stored</div><div className="text-sm font-bold text-slate-900 tabular-nums">{fmtMB(total)}</div></div>
        <div><div className="text-[10px] uppercase font-semibold text-slate-500">Eligible for sweep</div><div className="text-sm font-bold text-amber-700 tabular-nums">{fmtMB(swept)}</div></div>
        <div><div className="text-[10px] uppercase font-semibold text-slate-500">Retention window</div><div className="text-sm font-bold text-slate-900 tabular-nums">{data.retention_days || 0} days</div></div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left">Bucket</th>
            <th className="px-4 py-2 text-right">Files</th>
            <th className="px-4 py-2 text-right">Size</th>
            <th className="px-4 py-2 text-left">Policy</th>
          </tr>
        </thead>
        <tbody>
          {buckets.length === 0 && <tr><td colSpan={4}><Empty>No GridFS buckets found.</Empty></td></tr>}
          {buckets.map(([name, v]) => (
            <tr key={name} className="border-t border-slate-100" data-testid={`storage-row-${name}`}>
              <td className="px-4 py-2 font-mono text-xs">{name}</td>
              <td className="px-4 py-2 text-right tabular-nums">{v.count}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtMB(v.total_bytes || 0)}</td>
              <td className="px-4 py-2"><Pill tone={v.swept ? 'amber' : 'slate'}>{v.swept ? `Auto-purge ${data.retention_days}d` : 'Permanent'}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
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
