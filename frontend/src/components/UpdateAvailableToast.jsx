/**
 * App-update toast — surfaces in the topbar when a new service worker
 * has been installed and is waiting to take over. Clicking "Update now"
 * sends `SKIP_WAITING` to the waiting SW, which then activates and
 * triggers a `controllerchange` event in `index.js` → automatic reload.
 *
 * Lifecycle:
 *   index.js   → fires `audinexa:sw-update-ready` on `window` with the
 *                ServiceWorkerRegistration as `event.detail`.
 *   This file  → listens for that event, shows the pill, dismissable for
 *                10 minutes via sessionStorage so power users can keep
 *                working without forced reloads mid-task.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Sparkles, X } from 'lucide-react';

const SNOOZE_KEY = 'audinexa.swUpdateSnoozedUntil';
const SNOOZE_MS = 10 * 60 * 1000;       // 10 minutes

export default function UpdateAvailableToast() {
  const [reg, setReg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onReady = (e) => {
      // Honor an active snooze so we don't badger the user repeatedly.
      try {
        const until = parseInt(sessionStorage.getItem(SNOOZE_KEY) || '0', 10);
        if (Date.now() < until) return;
      } catch { /* ignore */ }
      setReg(e.detail || null);
      setDismissed(false);
    };
    window.addEventListener('audinexa:sw-update-ready', onReady);
    return () => window.removeEventListener('audinexa:sw-update-ready', onReady);
  }, []);

  const update = useCallback(() => {
    if (!reg || !reg.waiting) return;
    setBusy(true);
    // Tell the waiting SW to activate; index.js will reload on controllerchange.
    reg.waiting.postMessage('SKIP_WAITING');
    // Safety: if controllerchange doesn't fire (very rare), force reload after 4s.
    setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 4000);
  }, [reg]);

  const snooze = useCallback(() => {
    try { sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    setDismissed(true);
  }, []);

  if (!reg || dismissed) return null;

  return (
    <button
      onClick={update}
      disabled={busy}
      data-testid="sw-update-toast"
      title="A newer version of AUDINEXA is ready. Click to update — takes about 2 seconds."
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition select-none border bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-indigo-500 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-70 disabled:cursor-wait shadow-sm shadow-indigo-600/30">
      <Sparkles size={11} className="animate-pulse" />
      <span>{busy ? 'Updating…' : 'New version — click to update'}</span>
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); snooze(); }}
        data-testid="sw-update-dismiss"
        title="Snooze for 10 minutes"
        className="ml-0.5 -mr-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-white/20">
        <X size={10} />
      </span>
    </button>
  );
}
