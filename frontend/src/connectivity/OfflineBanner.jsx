/**
 * OfflineBanner — full-width red banner that appears below the topbar when
 * the app cannot reach the server. Shows "viewing cached data from HH:MM"
 * when the offline cache is serving stale responses, so users know whether
 * what they're looking at is fresh or last-known-good.
 * Disappears as soon as connectivity returns.
 */
import React from 'react';
import { WifiOff, Database } from 'lucide-react';
import { useConnectivity } from './ConnectivityContext';

export default function OfflineBanner() {
  const { status, retry, cacheServedAt } = useConnectivity();
  if (status !== 'offline') return null;
  const cachedTime = cacheServedAt
    ? cacheServedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div
      role="alert"
      data-testid="offline-banner"
      className="bg-rose-600 text-white text-[11px] font-semibold flex items-center justify-center gap-3 px-4 py-1.5 flex-wrap"
    >
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
    </div>
  );
}
