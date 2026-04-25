/**
 * OfflineBanner — full-width red banner that appears below the topbar when
 * the app cannot reach the server. Disappears as soon as connectivity returns.
 * Intentionally kept minimal — the toast & pill carry the rest of the info.
 */
import React from 'react';
import { WifiOff } from 'lucide-react';
import { useConnectivity } from './ConnectivityContext';

export default function OfflineBanner() {
  const { status, retry } = useConnectivity();
  if (status !== 'offline') return null;
  return (
    <div
      role="alert"
      data-testid="offline-banner"
      className="bg-rose-600 text-white text-[11px] font-semibold flex items-center justify-center gap-3 px-4 py-1.5"
    >
      <WifiOff size={13} />
      <span>You are offline — your last save may be queued. We'll auto-retry when the connection returns.</span>
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
