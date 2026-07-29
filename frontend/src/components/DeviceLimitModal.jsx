/**
 * DeviceLimitModal — shown when the login API returns HTTP 409
 * `DEVICE_LIMIT_EXCEEDED`. Lets the user pick which existing device to
 * sign out so the current login can proceed. Retries the login with
 * `replace_session_id` set to the chosen row.
 *
 * Purely presentational — the parent (LoginPage) owns the retry logic
 * and passes {devices, cap, count, onPick, onCancel, busy}.
 */
import React from 'react';
import {
  Monitor, Smartphone, Tablet, Globe, X, LogOut, Loader2,
} from 'lucide-react';

function pickIcon(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('iphone') || (l.includes('android') && !l.includes('tab'))) return Smartphone;
  if (l.includes('ipad') || l.includes('tablet')) return Tablet;
  if (l.includes('windows') || l.includes('mac') || l.includes('linux')) return Monitor;
  return Globe;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DeviceLimitModal({
  devices = [], cap = 0, count = 0,
  onPick, onCancel, busySid = null,
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"
      data-testid="device-limit-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-amber-700">
              Device limit reached
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-1">
              You&apos;re signed in on {count} of {cap} devices
            </h2>
            <p className="text-[13px] text-slate-600 mt-1 leading-snug">
              Your plan allows {cap} devices at a time. Pick one to sign out below and we&apos;ll finish signing you in on this device.
            </p>
          </div>
          <button
            onClick={onCancel}
            data-testid="device-limit-cancel"
            className="p-1 hover:bg-slate-100 rounded shrink-0"
            aria-label="Cancel"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {devices.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500 italic">No devices to choose from.</div>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => {
                const Icon = pickIcon(d.device_label);
                const isBusy = busySid === d.session_id;
                return (
                  <li
                    key={d.session_id}
                    className="border border-slate-200 rounded-lg p-3 flex items-start gap-3 hover:border-slate-300"
                    data-testid={`device-limit-row-${d.session_id}`}
                  >
                    <Icon size={22} className="text-slate-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13.5px] text-slate-900 truncate">
                        {d.device_label || 'Unknown device'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {d.ip ? <>IP {d.ip} · </> : null}
                        Last seen {timeAgo(d.last_seen_at)}
                      </div>
                    </div>
                    <button
                      onClick={() => onPick && onPick(d.session_id)}
                      disabled={!!busySid}
                      data-testid={`device-limit-kick-${d.session_id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-bold rounded bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 shrink-0"
                    >
                      {isBusy
                        ? <Loader2 size={12} className="animate-spin" />
                        : <LogOut size={12} />}
                      Sign out
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-[11.5px] text-slate-500">
          Tip: you can manage all your devices anytime from{' '}
          <span className="font-semibold text-slate-700">Settings → Security & Privacy → Sessions</span>.
        </div>
      </div>
    </div>
  );
}
