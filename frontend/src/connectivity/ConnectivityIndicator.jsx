/**
 * ConnectivityIndicator — small status pill in the AppShell header.
 * Click to force-re-check.
 *
 * States:
 *   online  → green dot, hidden label on small screens
 *   slow    → amber pill with "Slow" label (latency > 2.5s)
 *   offline → red pill with "Offline" label + tooltip last-check time
 */
import React from 'react';
import { Wifi, WifiOff, Activity } from 'lucide-react';
import { useConnectivity } from './ConnectivityContext';

export default function ConnectivityIndicator() {
  const { status, lastChecked, latencyMs, retry } = useConnectivity();

  const config = {
    online:  { icon: Wifi,     color: 'text-emerald-700 bg-emerald-50 border-emerald-200',  label: 'Online',  dot: 'bg-emerald-500' },
    slow:    { icon: Activity, color: 'text-amber-800 bg-amber-50 border-amber-200',         label: 'Slow',    dot: 'bg-amber-500'   },
    offline: { icon: WifiOff,  color: 'text-rose-700 bg-rose-50 border-rose-300',            label: 'Offline', dot: 'bg-rose-500'    },
  }[status];

  const Icon = config.icon;
  const tip = (() => {
    const lc = lastChecked ? lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    if (status === 'offline') return `No connection to AUDINEXA server. Last check: ${lc}. Click to retry.`;
    if (status === 'slow') return `Slow connection (${latencyMs}ms). Click to re-check.`;
    return `Connected (${latencyMs}ms). Last check: ${lc}. Click to re-check.`;
  })();

  return (
    <button
      type="button"
      onClick={retry}
      title={tip}
      data-testid="connectivity-pill"
      data-status={status}
      className={`flex items-center gap-1.5 text-[10px] font-bold border rounded-full px-2 py-0.5 transition ${config.color} hover:brightness-95`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status === 'offline' ? 'animate-pulse' : ''}`} />
      <Icon size={11} className="hidden sm:inline" />
      {/* On phones we hide the label when online to save space; always show when slow/offline */}
      <span className={status === 'online' ? 'hidden md:inline' : ''}>{config.label}</span>
    </button>
  );
}
