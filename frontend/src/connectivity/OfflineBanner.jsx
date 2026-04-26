/**
 * OfflineBanner — full-width red banner that appears below the topbar when
 * the app cannot reach the server. Shows "viewing cached data from HH:MM"
 * when the offline cache is serving stale responses, so users know whether
 * what they're looking at is fresh or last-known-good.
 *
 * Includes a "Connectivity tips" popover (Item 5 from the expert feedback)
 * recommending a backup internet plan — even with offline mode, a real
 * connection is eventually needed.
 */
import React, { useState } from 'react';
import { WifiOff, Database, Lightbulb } from 'lucide-react';
import { useConnectivity } from './ConnectivityContext';

export default function OfflineBanner() {
  const { status, retry, cacheServedAt } = useConnectivity();
  const [tipsOpen, setTipsOpen] = useState(false);
  if (status !== 'offline') return null;
  const cachedTime = cacheServedAt
    ? cacheServedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div
      role="alert"
      data-testid="offline-banner"
      className="bg-rose-600 text-white text-[11px] font-semibold px-4 py-1.5 relative"
    >
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <WifiOff size={13} />
          You are offline.
        </span>
        {cachedTime ? (
          <span className="inline-flex items-center gap-1.5 bg-white/15 rounded-full px-2 py-0.5" data-testid="offline-cache-meta">
            <Database size={11} />
            Viewing cached data from {cachedTime} — read-only until reconnected.
          </span>
        ) : (
          <span>Your last save may be queued. We'll auto-retry when the connection returns.</span>
        )}
        <button
          onClick={retry}
          data-testid="offline-banner-retry"
          className="bg-white/20 hover:bg-white/30 rounded-full px-2 py-0.5 text-[10px] font-bold"
        >
          Retry now
        </button>
        <button
          onClick={() => setTipsOpen((v) => !v)}
          data-testid="offline-tips-toggle"
          className="inline-flex items-center gap-1 bg-white/10 hover:bg-white/25 rounded-full px-2 py-0.5 text-[10px] font-bold"
        >
          <Lightbulb size={11} />
          Connectivity tips
        </button>
      </div>

      {tipsOpen && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-[420px] max-w-[calc(100vw-2rem)] bg-white text-slate-800 rounded-md shadow-2xl border border-rose-200 z-30"
          data-testid="offline-tips-popover"
          role="dialog"
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold flex items-center gap-1.5"><Lightbulb size={12} className="text-amber-500" /> Backup Internet — recommended for clinics</span>
            <button onClick={() => setTipsOpen(false)} className="text-slate-400 hover:text-slate-700 text-xs">×</button>
          </div>
          <div className="px-3 py-2 text-[11px] leading-relaxed text-slate-700 space-y-1.5">
            <p>Even with offline mode, your clinic eventually needs a connection. Best practices for Indian clinics:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><b>Primary</b> — Fiber broadband (Jio/Airtel/ACT) — 100+ Mbps</li>
              <li><b>Backup #1</b> — Mobile hotspot from a <i>different</i> carrier (Jio if primary is Airtel, etc.)</li>
              <li><b>Backup #2</b> — Dual-SIM 4G router (D-Link DWR-960, Tenda 4G06) — auto-failover</li>
              <li><b>Backup #3</b> — USB dongle (JioFi, Airtel 4G hotspot) for emergencies</li>
            </ul>
            <p className="text-slate-500 text-[10px] mt-1">AUDINEXA continues to work offline up to 24 hours from cached data. Sync resumes automatically.</p>
          </div>
        </div>
      )}
    </div>
  );
}
