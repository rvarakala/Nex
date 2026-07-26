/**
 * Founder Dashboard — Email Health Banner
 *
 * Polls `/api/admin/v2/email-health` every 60s and lights up if any error
 * in the last 5 minutes OR degraded 24h error rate. Silent when healthy so
 * the executive dashboard stays quiet on normal days.
 *
 * Colour language matches the rest of the founder panel:
 *   healthy  → nothing rendered
 *   degraded → amber (something worth checking, not on fire yet)
 *   critical → rose (users are being dropped right now)
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 60_000;

export default function EmailHealthBanner() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const r = await axios.get(`${API}/admin/v2/email-health`);
        if (!stopped) setHealth(r.data);
      } catch (e) {
        // Silent — banner should never break the dashboard on transient blips
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  if (!health || health.status === 'healthy') return null;

  const critical = health.status === 'critical';
  const tone = critical
    ? { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-800', accent: 'text-rose-600', dot: 'bg-rose-500' }
    : { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', accent: 'text-amber-700', dot: 'bg-amber-500' };
  const Icon = critical ? XCircle : AlertTriangle;

  const h1 = health.last_1h || {};
  const h24 = health.last_24h || {};
  const headline = critical
    ? `Email delivery is failing — ${health.errors_last_5m} error(s) in the last 5 minutes`
    : `Email delivery is degraded — ${h24.errors || 0}/${h24.total || 0} failed in the last 24h (${h24.error_rate_pct}%)`;

  return (
    <div
      data-testid="email-health-banner"
      data-status={health.status}
      className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${tone.bg} ${tone.border}`}
    >
      <span className={`inline-flex w-8 h-8 rounded-full items-center justify-center shrink-0 ${tone.bg}`}>
        <Icon className={`w-5 h-5 ${tone.accent}`} strokeWidth={2.4} />
      </span>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${tone.text}`} data-testid="email-health-headline">
          {headline}
        </div>
        <div className={`text-xs mt-0.5 ${tone.text} opacity-80`}>
          Provider: <strong className="font-mono">{health.provider}</strong>
          {health.fallback_provider && <> · Fallback: <strong className="font-mono">{health.fallback_provider}</strong></>}
          {' · '}Last hour: {h1.sent || 0} sent · {h1.errors || 0} errors
          {(h1.used_fallback > 0) && <> · <span className="italic">Fallback used {h1.used_fallback}×</span></>}
        </div>
      </div>
      <Link
        to="/admin/email-health"
        data-testid="email-health-details-link"
        className={`inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap px-2.5 py-1.5 rounded-md hover:underline ${tone.accent}`}
      >
        View details <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
