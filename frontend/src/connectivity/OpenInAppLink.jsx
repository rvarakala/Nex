/**
 * OpenInAppLink — subtle "Open in app" footer link for the login screen.
 *
 * Reuses the same browser-detection logic as InstallPrompt but renders inline
 * (no toast / no banner) so it fits on the public login page without
 * interrupting the visual hierarchy. Three behaviors:
 *
 *   1. Already installed (display-mode: standalone)        → renders nothing
 *   2. Chromium with `beforeinstallprompt` available       → "Open in app" link
 *      that triggers the native install prompt on click
 *   3. iOS Safari (no install event ever fires)            → "Add to home screen"
 *      link that toggles a tiny tooltip with the Share→Add steps
 *
 * On any other combo (Firefox, Brave with installs disabled, etc.) we render
 * nothing — better silent than promising an action we can't deliver.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Smartphone, Share } from 'lucide-react';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isSafari = () => /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

export default function OpenInAppLink() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [iosHintOpen, setIosHintOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (isStandalone()) return undefined;
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => setDeferredPrompt(null);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Close iOS hint on outside click
  useEffect(() => {
    if (!iosHintOpen) return undefined;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIosHintOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [iosHintOpen]);

  // Bail on already-installed sessions OR browsers that can't deliver
  if (isStandalone()) return null;
  const showChromium = !!deferredPrompt;
  const showIos = isIOS() && isSafari();
  if (!showChromium && !showIos) return null;

  const handleClick = async () => {
    if (showChromium) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
    } else if (showIos) {
      setIosHintOpen((v) => !v);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        data-testid="open-in-app-link"
        className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-300 transition underline-offset-2 hover:underline"
      >
        <Smartphone size={11} />
        Open in app
      </button>

      {iosHintOpen && (
        <div
          role="tooltip"
          data-testid="open-in-app-ios-hint"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[220px] bg-slate-800 text-white text-[11px] leading-snug rounded-md shadow-lg px-3 py-2"
        >
          <div className="font-bold mb-0.5">Add AUDINEXA to your iPhone</div>
          <div className="text-slate-300">
            Tap the <Share size={10} className="inline -mt-0.5 text-indigo-300" /> Share button below, then choose <b>Add to Home Screen</b>.
          </div>
          {/* Caret */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-800" />
        </div>
      )}
    </div>
  );
}
