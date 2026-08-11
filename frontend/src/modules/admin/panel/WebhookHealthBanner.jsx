/**
 * Founder Dashboard — Razorpay Webhook Health Banner
 *
 * Polls `/api/billing/razorpay/webhook-health` every 5 minutes and
 * lights up when Razorpay isn't successfully calling the webhook.
 *
 * The banner *never* fires for a "quiet but working" server (no
 * payments = no webhooks expected). It only surfaces two real
 * problems:
 *   - `stale`          → payments are happening but webhooks have gone
 *                        silent for 7+ days (usually: dashboard URL
 *                        still points at the old preview domain, or
 *                        webhook was accidentally disabled).
 *   - `never_received` → NO webhook has ever landed, even though the
 *                        server is fully configured. This is the
 *                        current state on production until the URL is
 *                        pointed at audinexa.com and Enabled.
 *   - `misconfigured`  → server-side env vars aren't set (rare).
 *
 * The founder can click "Copy URL" to grab the exact address to paste
 * into Razorpay Dashboard → Settings → Webhooks.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { AlertTriangle, XCircle, Copy, CheckCircle2, ExternalLink } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 5 * 60_000; // 5 min

export default function WebhookHealthBanner() {
  const [h, setH] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/billing/razorpay/webhook-health`);
      setH(r.data);
    } catch {
      // Silent — never break the dashboard on a health-check hiccup.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!h) return null;

  // Healthy or quiet → render nothing so the executive dashboard stays clean.
  if (h.status === 'healthy' || h.status === 'quiet') return null;

  const isCritical = h.status === 'stale' || h.status === 'misconfigured';
  const tone = isCritical
    ? { bg: 'bg-rose-50',  border: 'border-rose-200',  text: 'text-rose-800',   accent: 'text-rose-600' }
    : { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900',  accent: 'text-amber-700' };
  const Icon = isCritical ? XCircle : AlertTriangle;

  const headline = {
    never_received:
      'No Razorpay webhook has ever reached this server — payments are working but async updates are silent.',
    stale:
      `Razorpay webhook has been silent for 7+ days, even though ${h.orders_last_7d} order(s) were created in that window.`,
    misconfigured:
      'Razorpay is not configured on the server. Payments cannot be processed.',
  }[h.status] || 'Razorpay webhook needs attention.';

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(h.expected_webhook_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard perms — ignore */ }
  };

  const lastSeen = h.last_event_at
    ? new Date(h.last_event_at).toLocaleString()
    : 'never';

  return (
    <div
      className={`mb-4 border ${tone.border} ${tone.bg} rounded-lg px-4 py-3`}
      data-testid="webhook-health-banner"
    >
      <div className="flex items-start gap-3">
        <Icon size={18} className={`${tone.accent} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-bold ${tone.text}`} data-testid="webhook-health-headline">
            Razorpay Webhook · {h.status.replace('_', ' ')}
          </div>
          <div className={`text-[12px] ${tone.text} mt-0.5`}>{headline}</div>

          <div className={`text-[11px] ${tone.text} opacity-80 mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5`}>
            <span>Last received: <b>{lastSeen}</b></span>
            <span>1h · <b>{h.counts?.last_1h ?? 0}</b></span>
            <span>24h · <b>{h.counts?.last_24h ?? 0}</b></span>
            <span>7d · <b>{h.counts?.last_7d ?? 0}</b></span>
            <span>Orders 7d · <b>{h.orders_last_7d ?? 0}</b></span>
            {h.is_live && (
              <span className="uppercase tracking-wider text-[9.5px] font-bold border border-current rounded px-1 py-0.5">
                LIVE MODE
              </span>
            )}
          </div>

          {h.expected_webhook_url && h.status !== 'misconfigured' && (
            <div className={`mt-2 border ${tone.border} bg-white/60 rounded px-2.5 py-1.5 flex flex-wrap items-center gap-2`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${tone.accent}`}>
                Set this URL in Razorpay Dashboard
              </span>
              <code className="text-[11.5px] font-mono text-slate-800 truncate flex-1 min-w-0">{h.expected_webhook_url}</code>
              <button
                type="button"
                onClick={copyUrl}
                data-testid="webhook-health-copy-url"
                className={`inline-flex items-center gap-1 text-[10.5px] font-semibold ${tone.accent} hover:opacity-70 px-1.5 py-0.5 rounded`}
              >
                {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a
                href="https://dashboard.razorpay.com/app/webhooks"
                target="_blank"
                rel="noreferrer"
                data-testid="webhook-health-open-dashboard"
                className={`inline-flex items-center gap-1 text-[10.5px] font-semibold ${tone.accent} hover:opacity-70`}
              >
                <ExternalLink size={10} /> Open Razorpay
              </a>
            </div>
          )}

          {Array.isArray(h.recent) && h.recent.length > 0 && (
            <details className="mt-2">
              <summary className={`text-[10.5px] font-semibold ${tone.accent} cursor-pointer hover:opacity-70`}>
                Show last {h.recent.length} received event{h.recent.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {h.recent.map((r, i) => (
                  <li key={i} className={`text-[10.5px] ${tone.text} flex items-center gap-2`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${r.processed ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span className="font-mono">{new Date(r.received_at).toLocaleString()}</span>
                    <span className="font-semibold">{r.event}</span>
                    {r.payment_id && <span className="opacity-70">· {r.payment_id}</span>}
                    {!r.processed && <span className="text-rose-700 font-bold">· NOT PROCESSED</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
