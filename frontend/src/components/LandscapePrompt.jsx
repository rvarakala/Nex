/**
 * LandscapePrompt — one-time hint asking the user to rotate their phone.
 *
 * Shows only when:
 *   • Viewport width < 640 (small mobile) AND
 *   • Portrait orientation (height > width) AND
 *   • The user hasn't dismissed the tip for this feature yet
 *
 * Once dismissed (localStorage key), it stays dismissed for that feature.
 * It also self-hides the moment the user rotates to landscape, so no
 * dismiss is needed if they follow the tip.
 */
import React, { useEffect, useState } from 'react';
import { RotateCw, X } from 'lucide-react';

const STORAGE_KEY_PREFIX = 'audinexa_landscape_hint_';

export default function LandscapePrompt({
  featureKey = 'default',
  message = 'Rotate your phone to landscape for a bigger canvas.',
  testid = 'landscape-prompt',
}) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Skip entirely if already dismissed for this feature.
    if (localStorage.getItem(STORAGE_KEY_PREFIX + featureKey) === 'yes') {
      setDismissed(true);
      return;
    }
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // < 640 = tailwind sm breakpoint. Portrait = height > width.
      setVisible(w < 640 && h > w);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [featureKey]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY_PREFIX + featureKey, 'yes');
    setDismissed(true);
  };

  if (dismissed || !visible) return null;

  return (
    <div
      className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded p-2.5 mb-3 text-xs text-indigo-800"
      data-testid={testid}
    >
      <RotateCw size={14} className="shrink-0 text-indigo-600" />
      <span className="flex-1">{message}</span>
      <button
        onClick={dismiss}
        aria-label="Dismiss tip"
        data-testid={`${testid}-dismiss`}
        className="p-0.5 hover:bg-indigo-100 rounded shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}
