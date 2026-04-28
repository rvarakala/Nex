/**
 * "What's new" modal — auto-opens once per release after the user updates.
 *
 * Behavior:
 *   - First-ever login on a device  → silently seeds `lastSeenVersion` to the
 *                                     current version. No modal shown (don't
 *                                     spam brand-new users with old releases).
 *   - Subsequent logins after a deploy that bumped CHANGELOG[0].version →
 *                                     modal opens once, then localStorage is
 *                                     updated so it never reopens for that
 *                                     version.
 *   - "View older releases"          toggles the full CHANGELOG array.
 *
 * Mounted globally in AppShell so it triggers on every authenticated load.
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, X, ChevronDown, ChevronUp } from 'lucide-react';
import { CHANGELOG, LATEST } from '../data/changelog';

const STORAGE_KEY = 'audinexa.lastSeenVersion';

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};

export default function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let last;
    try { last = localStorage.getItem(STORAGE_KEY); } catch { last = null; }

    if (!last) {
      // Fresh device — seed silently so we don't bombard new users with the
      // very first changelog entry as if it were "new".
      try { localStorage.setItem(STORAGE_KEY, LATEST.version); } catch { /* ignore */ }
      return;
    }
    if (String(LATEST.version) > String(last)) {
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, LATEST.version); } catch { /* ignore */ }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 p-3 sm:p-4" data-testid="whats-new-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 pt-5 pb-3 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white relative">
          <button
            onClick={dismiss}
            data-testid="whats-new-close"
            className="absolute top-3 right-3 w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-white/15"
            aria-label="Close">
            <X size={14} />
          </button>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white/20 backdrop-blur">
              <Sparkles size={18} />
            </span>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-white/80">What's new</div>
              <div className="text-base font-bold leading-tight">{LATEST.headline}</div>
              <div className="text-[10.5px] text-white/75 mt-0.5">v{LATEST.version} · {fmtDate(LATEST.date)}</div>
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <ul className="space-y-2 text-[12.5px] text-slate-700 leading-relaxed">
            {LATEST.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 items-start" data-testid={`whats-new-bullet-${i}`}>
                <span className="mt-[5px] inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {CHANGELOG.length > 1 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              data-testid="whats-new-history-toggle"
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900">
              {showHistory ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {showHistory ? 'Hide older releases' : `View ${CHANGELOG.length - 1} older release${CHANGELOG.length === 2 ? '' : 's'}`}
            </button>
          )}

          {showHistory && (
            <div className="mt-3 border-t border-slate-200 pt-3 space-y-3" data-testid="whats-new-history">
              {CHANGELOG.slice(1).map((entry) => (
                <div key={entry.version}>
                  <div className="text-[11px] font-bold text-slate-800">{entry.headline}</div>
                  <div className="text-[10px] text-slate-500 mb-1">v{entry.version} · {fmtDate(entry.date)}</div>
                  <ul className="space-y-1 text-[11.5px] text-slate-600">
                    {entry.bullets.map((b, i) => (
                      <li key={i} className="flex gap-1.5 items-start">
                        <span className="mt-[5px] inline-block w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={dismiss}
            data-testid="whats-new-dismiss"
            className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-md shadow-sm shadow-indigo-600/30">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
