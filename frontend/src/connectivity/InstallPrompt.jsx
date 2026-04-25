/**
 * InstallPrompt — tasteful "Install AUDINEXA" banner.
 *
 * Browser support nuance:
 *   - Chrome / Edge / Android Chrome fire `beforeinstallprompt` once the PWA
 *     install criteria are met (manifest + SW + HTTPS + engagement). We capture
 *     it, show our banner, and trigger `prompt()` on user click.
 *   - iOS Safari NEVER fires `beforeinstallprompt`. We sniff the UA and show a
 *     short "Tap Share → Add to Home Screen" hint instead.
 *   - If the app is already running standalone (display-mode: standalone)
 *     OR the user installed via the native flow, we go silent forever.
 *
 * Don't-be-annoying rules:
 *   - User dismissal is remembered for 14 days (localStorage)
 *   - Once installed (`appinstalled` event fires) we never ask again
 *   - We delay first appearance by 8s after login so we're not the first
 *     thing a new user sees
 */
import React, { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

const STORAGE_KEY = 'audinexa.installPromptDismissedAt';
const DISMISS_DAYS = 14;
const FIRST_SHOW_DELAY_MS = 8_000;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // Safari-specific
  window.navigator.standalone === true;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isSafari = () =>
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

const dismissedRecently = () => {
  try {
    const ts = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    if (!ts) return false;
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return undefined;

    // Chromium browsers — capture the install event
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(() => setShow(true), FIRST_SHOW_DELAY_MS);
    };
    const onInstalled = () => {
      setShow(false);
      setDeferredPrompt(null);
      // Permanent dismiss
      try { localStorage.setItem(STORAGE_KEY, String(Date.now() + 365 * 24 * 60 * 60 * 1000)); } catch { /* noop */ }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS Safari fallback (no install event ever fires there)
    if (isIOS() && isSafari()) {
      const t = setTimeout(() => { setIosHint(true); setShow(true); }, FIRST_SHOW_DELAY_MS);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
        window.removeEventListener('appinstalled', onInstalled);
      };
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* noop */ }
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShow(false);
    if (outcome !== 'accepted') {
      // User said "not now" — respect that, ask again in 14 days
      try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* noop */ }
    }
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Install AUDINEXA"
      data-testid="install-prompt"
      className="fixed bottom-4 right-4 z-50 w-[320px] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-slide-in"
    >
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 px-4 py-3 flex items-start gap-3">
        <img src="/icon.svg" alt="" className="w-9 h-9 shrink-0 rounded-lg shadow" />
        <div className="flex-1">
          <div className="text-white text-sm font-bold leading-tight">Install AUDINEXA</div>
          <div className="text-indigo-100 text-[11px] mt-0.5 leading-snug">
            {iosHint
              ? 'Add to your Home Screen for faster access — even when offline.'
              : 'Get a real app icon, full-screen mode, and faster launch on your tablet or laptop.'}
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          data-testid="install-prompt-dismiss"
          className="text-indigo-100 hover:text-white transition shrink-0 -mt-0.5"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-3 bg-white">
        {iosHint ? (
          <div className="text-[11px] text-slate-700 leading-relaxed">
            Tap the <Share size={12} className="inline -mt-0.5 text-indigo-600" /> <b>Share</b> button in Safari, then choose <b>"Add to Home Screen"</b>.
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={install}
              data-testid="install-prompt-install"
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-sm transition"
            >
              <Download size={13} />
              Install
            </button>
            <button
              onClick={dismiss}
              data-testid="install-prompt-later"
              className="text-xs text-slate-600 hover:text-slate-800 font-semibold px-2"
            >
              Maybe later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
