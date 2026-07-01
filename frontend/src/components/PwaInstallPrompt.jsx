/**
 * PWA Install Prompt (AUDINEXA · Phase 16.4)
 * -------------------------------------------
 * Renders a dismissible install banner on the dashboard that lets
 * audiologists / front-desk staff install AUDINEXA to their device
 * home-screen and launch it full-screen like a native app.
 *
 * Behaviour by platform:
 *   • Chrome / Edge / Samsung Internet (Android + desktop):
 *     captures the `beforeinstallprompt` event, then shows a custom
 *     "Install AUDINEXA" pill. Clicking it fires `prompt()` and
 *     resolves.
 *   • iOS Safari:
 *     no `beforeinstallprompt` — we detect iOS via UA and show a
 *     one-time hint ("Tap the Share icon then Add to Home Screen").
 *   • Already installed (standalone display-mode):
 *     component renders nothing.
 *   • Dismissed by the user:
 *     stored in `localStorage['audinexa.pwa.dismissed']` for 30 days.
 */
import React, { useEffect, useState } from 'react';
import { Download, Share, X, Smartphone } from 'lucide-react';

const DISMISS_KEY = 'audinexa.pwa.dismissed';
const DISMISS_DAYS = 30;

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isDismissedRecently = () => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch { return false; }
};

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState(null); // 'android' | 'ios'

  useEffect(() => {
    if (isStandalone()) return;
    if (isDismissedRecently()) return;

    // Android / desktop Chromium
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setMode('android');
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS — no beforeinstallprompt event. Only show once per session
    // to avoid noise.
    if (isIOS() && !sessionStorage.getItem('audinexa.pwa.ios-shown')) {
      setMode('ios');
      setVisible(true);
      sessionStorage.setItem('audinexa.pwa.ios-shown', '1');
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (choice?.outcome !== 'accepted') {
      // user cancelled the browser prompt — remember, don't nag
      dismiss();
    } else {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  if (!visible) return null;

  return (
    <div
      className="relative overflow-hidden rounded-2xl text-white shadow-[0_10px_30px_-10px_rgba(15,29,58,0.35)]"
      style={{
        background: 'linear-gradient(135deg,#0F1D3A 0%,#1B2A4E 55%,#0891B2 100%)',
      }}
      data-testid="pwa-install-prompt"
    >
      {/* Decorative glow */}
      <div
        aria-hidden
        className="absolute -top-16 -right-10 w-56 h-56 rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #22D3EE 0%, transparent 65%)' }}
      />

      <button
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        data-testid="pwa-install-dismiss"
        className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition"
      >
        <X size={16} />
      </button>

      <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-4 px-5 py-4 sm:py-5">
        {/* Icon medallion */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg,#22D3EE,#0891B2)' }}
        >
          <Smartphone size={26} strokeWidth={2.2} className="text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[15px] sm:text-[16px] font-extrabold tracking-tight">
            Add AUDINEXA to your home screen
          </div>
          <div className="text-[12.5px] text-white/75 font-medium mt-1 max-w-[520px]">
            {mode === 'ios'
              ? 'Tap the Share icon in Safari, then choose "Add to Home Screen" to launch AUDINEXA full-screen — no browser bar, no distractions.'
              : 'One tap install. Launches full-screen like a native app, works even on flaky clinic Wi-Fi, and keeps you signed in.'}
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          {mode === 'android' && (
            <button
              onClick={install}
              data-testid="pwa-install-btn"
              className="inline-flex items-center gap-1.5 bg-white text-slate-900 hover:bg-cyan-50 text-[13px] font-extrabold px-4 py-2.5 rounded-full shadow-md transition"
            >
              <Download size={15} strokeWidth={2.6} />
              Install
            </button>
          )}
          {mode === 'ios' && (
            <span
              data-testid="pwa-install-hint-ios"
              className="inline-flex items-center gap-1.5 bg-white/15 text-white text-[12px] font-bold px-3 py-2 rounded-full backdrop-blur-sm"
            >
              <Share size={13} strokeWidth={2.4} />
              Share ▸ Add to Home Screen
            </span>
          )}
          <button
            onClick={dismiss}
            data-testid="pwa-install-later"
            className="hidden sm:inline-flex text-[12.5px] font-bold text-white/80 hover:text-white px-3 py-2"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
