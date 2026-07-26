/**
 * Founder Dashboard — Email Health page
 *
 * Full read of `/api/admin/v2/email-health`:
 *   - Current provider + optional fallback
 *   - Traffic-light status pill (healthy | degraded | critical)
 *   - 1h + 24h roll-ups (sent, errors, error rate, fallback used)
 *   - Last 5 error events with timestamp, purpose, recipient, and reason
 *
 * No mutations — this is a read-only observability view. Recovery actions
 * live on `/admin/stuck-users`.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Mail, RefreshCw, Zap, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_STYLE = {
  healthy:  { pill: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2, label: 'Healthy' },
  degraded: { pill: 'bg-amber-100 text-amber-900 border-amber-200',       dot: 'bg-amber-500',   icon: AlertTriangle, label: 'Degraded' },
  critical: { pill: 'bg-rose-100 text-rose-800 border-rose-200',           dot: 'bg-rose-500',    icon: AlertTriangle, label: 'Critical' },
};

function StatTile({ label, value, sub, tone = 'slate', testid }) {
  const tint = {
    slate:   'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    rose:    'bg-rose-50 border-rose-200 text-rose-900',
    fuchsia: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-900',
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${tint}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-2xl font-extrabold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] mt-1 opacity-70">{sub}</div>}
    </div>
  );
}

export default function EmailHealthPage() {
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true); setErr('');
    try {
      const r = await axios.get(`${API}/admin/v2/email-health`);
      setHealth(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load');
    } finally { setRefreshing(false); }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (err) return <div className="p-6"><div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3" data-testid="email-health-error">{err}</div></div>;
  if (!health) return <div className="p-6 text-slate-500" data-testid="email-health-loading">Loading email health…</div>;

  const s = STATUS_STYLE[health.status] || STATUS_STYLE.healthy;
  const StatusIcon = s.icon;
  const h1 = health.last_1h || {};
  const h24 = health.last_24h || {};

  return (
    <div className="p-6 space-y-6" data-testid="email-health-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader title="Email Health" subtitle="Real-time deliverability from the sending provider" />
        <button
          onClick={load} disabled={refreshing}
          data-testid="email-health-refresh"
          className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Status + provider strip */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3" data-testid="email-health-status-pill">
          <span className={`inline-flex w-2.5 h-2.5 rounded-full ${s.dot} ${health.status === 'healthy' ? '' : 'animate-pulse'}`} />
          <span className={`text-sm font-semibold uppercase tracking-wider border px-2.5 py-0.5 rounded-full inline-flex items-center gap-1.5 ${s.pill}`}>
            <StatusIcon className="w-3.5 h-3.5" /> {s.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Zap className="w-4 h-4 text-slate-500" />
          <span className="text-slate-600">Provider</span>
          <span className="font-mono text-slate-900" data-testid="email-health-provider">{health.provider}</span>
        </div>
        {health.fallback_provider ? (
          <div className="flex items-center gap-2 text-sm">
            <Shield className="w-4 h-4 text-slate-500" />
            <span className="text-slate-600">Fallback</span>
            <span className="font-mono text-slate-900" data-testid="email-health-fallback">{health.fallback_provider}</span>
          </div>
        ) : (
          <div className="text-xs text-slate-500 italic" data-testid="email-health-no-fallback">
            No fallback configured — set <span className="font-mono">EMAIL_FALLBACK_PROVIDER</span> to enable auto-failover.
          </div>
        )}
        <div className="text-xs text-slate-400 ml-auto">
          Checked {new Date(health.checked_at).toLocaleTimeString()}
        </div>
      </div>

      {/* Rollups: 1h + 24h */}
      <div>
        <h3 className="text-[11px] uppercase font-semibold tracking-wider text-slate-500 mb-2">Last 1 hour</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Total attempts" value={h1.total || 0}   tone="slate"   testid="stat-1h-total" />
          <StatTile label="Sent"           value={h1.sent || 0}    tone="emerald" testid="stat-1h-sent" />
          <StatTile label="Errors"         value={h1.errors || 0}  tone={h1.errors ? 'rose' : 'slate'} testid="stat-1h-errors" />
          <StatTile label="Error rate"     value={`${h1.error_rate_pct || 0}%`} tone={h1.error_rate_pct > 5 ? 'rose' : 'slate'} testid="stat-1h-rate" />
        </div>
      </div>
      <div>
        <h3 className="text-[11px] uppercase font-semibold tracking-wider text-slate-500 mb-2">Last 24 hours</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Total attempts" value={h24.total || 0}   tone="slate"   testid="stat-24h-total" />
          <StatTile label="Sent"           value={h24.sent || 0}    tone="emerald" testid="stat-24h-sent" />
          <StatTile label="Errors"         value={h24.errors || 0}  tone={h24.errors ? 'rose' : 'slate'} testid="stat-24h-errors" />
          <StatTile label="Fallback used"  value={h24.used_fallback || 0} sub="Times secondary provider rescued a send" tone="fuchsia" testid="stat-24h-fallback" />
        </div>
      </div>

      {/* Recent errors */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-slate-500" /> Recent errors
          </h3>
          <Link to="/admin/stuck-users" className="text-xs font-semibold text-fuchsia-700 hover:underline" data-testid="link-to-stuck-users">
            View stuck users →
          </Link>
        </div>
        {(!health.recent_errors || health.recent_errors.length === 0) ? (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="no-recent-errors">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 mb-2" />
            No delivery errors in the last 30 days. Nice.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {health.recent_errors.map((ev, i) => (
              <div key={i} className="px-5 py-3 flex flex-wrap items-start gap-3" data-testid={`error-row-${i}`}>
                <AlertTriangle className="w-4 h-4 mt-1 text-rose-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-900 truncate">
                    <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{ev.provider}</span>
                    <span className="mx-2 text-slate-400">→</span>
                    <span className="font-medium">{(ev.to || []).join(', ')}</span>
                  </div>
                  <div className="text-xs text-rose-700 mt-0.5 break-words">{ev.error}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {ev.purpose} · {new Date(ev.timestamp).toLocaleString()}
                    {ev.fallback_provider && <> · fallback tried: {ev.fallback_provider}</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
