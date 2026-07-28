/**
 * LaunchBanner — dismissable ribbon on the landing + signup pages.
 *
 * Fetches /api/platform/launch-banner (public, no auth). Renders nothing
 * when the banner is disabled server-side OR the user has dismissed the
 * current version (localStorage keyed by the banner's `version` string, so
 * a fresh edit re-shows to everyone who previously dismissed it).
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const DISMISS_KEY = 'audinexa_launch_banner_dismissed';

const TONE_CLASSES = {
  indigo:  'bg-indigo-600 text-white',
  emerald: 'bg-emerald-600 text-white',
  rose:    'bg-rose-600 text-white',
  amber:   'bg-amber-500 text-white',
};

export default function LaunchBanner() {
  const [b, setB] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    axios.get(`${API}/platform/launch-banner`)
      .then((r) => {
        if (!alive) return;
        setB(r.data);
        const lastDismissedVersion = localStorage.getItem(DISMISS_KEY);
        if (lastDismissedVersion === r.data.version) setDismissed(true);
      })
      .catch(() => { /* silently skip — never break the marketing page */ });
    return () => { alive = false; };
  }, []);

  if (!b || !b.enabled || dismissed) return null;

  const tone = TONE_CLASSES[b.tone] || TONE_CLASSES.indigo;

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, b.version || 'v0');
    setDismissed(true);
  };

  return (
    <div
      className={`w-full ${tone} shadow-sm`}
      data-testid="launch-banner"
      style={{ position: 'relative', zIndex: 40 }}
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
        <div className="flex-1 min-w-0 truncate font-medium" data-testid="launch-banner-message">
          {b.message}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {b.cta_text && b.cta_href && (
            <a
              href={b.cta_href}
              data-testid="launch-banner-cta"
              className="hidden sm:inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-white/15 hover:bg-white/25 rounded transition"
            >
              {b.cta_text} →
            </a>
          )}
          <button
            onClick={onDismiss}
            data-testid="launch-banner-dismiss"
            aria-label="Dismiss banner"
            className="p-1 hover:bg-white/10 rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
