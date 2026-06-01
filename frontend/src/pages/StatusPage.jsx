/**
 * StatusPage — public, unauthenticated `/status` route.
 *
 * Polls `/api/status/public` every 30s, shows green/amber/red dots per
 * component, plus a single-line overall banner. Designed to be linkable
 * from the marketing footer + the Help menu inside the app.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Activity, CheckCircle2, AlertTriangle, XCircle, HelpCircle,
  Database, Mail, MessageSquare, Phone, CreditCard, Server, RefreshCw,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/status/public`;

const ICON_BY_NAME = {
  'API':                       Server,
  'Database (MongoDB)':        Database,
  'Daily backups':             RefreshCw,
  'Email (ZeptoMail)':         Mail,
  'SMS (Twilio)':              MessageSquare,
  'WhatsApp (MSG91)':          Phone,
  'Payments (Razorpay)':       CreditCard,
};

const STATUS_COPY = {
  operational: { label: 'Operational',  Icon: CheckCircle2,   color: 'emerald' },
  degraded:    { label: 'Degraded',     Icon: AlertTriangle, color: 'amber' },
  outage:      { label: 'Outage',       Icon: XCircle,       color: 'rose' },
  unknown:     { label: 'Unknown',      Icon: HelpCircle,    color: 'slate' },
};

function StatusDot({ status }) {
  const cls = {
    operational: 'bg-emerald-500',
    degraded:    'bg-amber-500',
    outage:      'bg-rose-500',
    unknown:     'bg-slate-400',
  }[status] || 'bg-slate-400';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

function Banner({ overall, asOf }) {
  if (overall === 'operational') {
    return (
      <div data-testid="status-banner-operational" className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-4 flex items-center gap-3">
        <CheckCircle2 size={22} className="text-emerald-600 shrink-0" />
        <div>
          <div className="font-bold text-emerald-900 text-base">All systems operational</div>
          <div className="text-[12px] text-emerald-700">Updated {new Date(asOf).toLocaleString()}.</div>
        </div>
      </div>
    );
  }
  const palette = STATUS_COPY[overall] || STATUS_COPY.unknown;
  const colorMap = {
    amber: { bg: 'bg-amber-50',  border: 'border-amber-300', text: 'text-amber-900', sub: 'text-amber-700', icon: 'text-amber-600' },
    rose:  { bg: 'bg-rose-50',   border: 'border-rose-300',  text: 'text-rose-900',  sub: 'text-rose-700',  icon: 'text-rose-600'  },
    slate: { bg: 'bg-slate-50',  border: 'border-slate-300', text: 'text-slate-900', sub: 'text-slate-700', icon: 'text-slate-500' },
  }[palette.color] || { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-900', sub: 'text-slate-700', icon: 'text-slate-500' };
  const Icon = palette.Icon;
  return (
    <div
      data-testid={`status-banner-${overall}`}
      className={`rounded-xl border ${colorMap.border} ${colorMap.bg} px-5 py-4 flex items-center gap-3`}
    >
      <Icon size={22} className={`${colorMap.icon} shrink-0`} />
      <div>
        <div className={`font-bold ${colorMap.text} text-base`}>
          {overall === 'outage' ? 'Service disruption detected' :
           overall === 'degraded' ? 'Some systems are degraded' :
           'Some systems are reporting unknown status'}
        </div>
        <div className={`text-[12px] ${colorMap.sub}`}>Updated {new Date(asOf).toLocaleString()}. Engineering has been auto-alerted.</div>
      </div>
    </div>
  );
}

export default function StatusPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.get(API);
        if (!cancelled) { setData(r.data); setErr(''); }
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Failed to load status');
      }
    };
    load();
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return (
    <div className="min-h-screen bg-slate-50 py-16 px-4">
      <div className="max-w-3xl mx-auto" data-testid="status-page-root">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <a href="/" className="inline-flex items-center gap-2 text-[#0F52BA] font-bold text-lg" data-testid="status-home-link">
            <Activity size={20} />
            AUDINEXA
          </a>
          <div className="text-[12px] text-slate-500">Live system status</div>
        </div>

        {/* Banner */}
        {!data && !err && (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-[13px] text-slate-500" data-testid="status-loading">
            Checking systems…
          </div>
        )}
        {err && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-[13px] text-rose-700" data-testid="status-error">
            Couldn't reach the status API: {err}
          </div>
        )}
        {data && <Banner overall={data.overall} asOf={data.as_of} />}

        {/* Components */}
        {data && (
          <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden" data-testid="status-components">
            <div className="px-5 py-3 border-b border-slate-100 text-[11px] uppercase tracking-wider font-bold text-slate-500">
              Components
            </div>
            <ul className="divide-y divide-slate-100">
              {data.components.map((c) => {
                const Icon = ICON_BY_NAME[c.name] || Server;
                const palette = STATUS_COPY[c.status] || STATUS_COPY.unknown;
                return (
                  <li
                    key={c.name}
                    data-testid={`status-component-${c.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`}
                    className="px-5 py-4 flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-900 text-[14px]">{c.name}</div>
                      {(c.detail || c.error || c.last_run_at) && (
                        <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">
                          {c.error || c.detail || `Last run ${new Date(c.last_run_at).toLocaleString()}`}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusDot status={c.status} />
                      <span className="text-[12.5px] font-semibold text-slate-700">{palette.label}</span>
                      {typeof c.latency_ms === 'number' && (
                        <span className="text-[11px] text-slate-400 font-mono">{c.latency_ms}ms</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 text-center text-[11.5px] text-slate-500" data-testid="status-footer">
          Page refreshes every 30 seconds.{' '}
          <a href="mailto:lead@audinexa.com" className="text-[#0F52BA] hover:underline">
            Report an issue
          </a>
        </div>
      </div>
    </div>
  );
}
