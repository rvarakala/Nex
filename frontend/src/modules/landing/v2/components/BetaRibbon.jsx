/**
 * BetaRibbon — sticky top banner that signals "beta cohort full, queue
 * open for the next batch".
 *
 * Sits ABOVE the navbar (z-50) so users see it on every page-view
 * regardless of scroll. Loads waitlist stats live from
 * `/api/public/waitlist-stats` so the "N clinics in queue" number is
 * always real (small env-controlled floor so a fresh prod still shows a
 * non-zero number).
 *
 * Tone is **honest + premium**, not desperate. The CTA pulses subtly to
 * draw attention without being aggressive.
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function BetaRibbon({ onJoinWaitlist }) {
  const [stats, setStats] = useState({ in_queue: null, next_batch: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/public/waitlist-stats`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setStats(j);
      } catch { /* silent — ribbon shows its static copy fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const inQueue = stats.in_queue;
  const nextBatch = stats.next_batch;

  return (
    <div
      data-testid="beta-ribbon"
      className="fixed top-0 inset-x-0 z-[60] bg-gradient-to-r from-[#0F52BA] via-[#0F52BA] to-[#1E40AF] text-white shadow-md"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-12 py-2 flex items-center justify-center md:justify-between gap-3 text-[12.5px] md:text-[13px] font-medium">
        <div className="flex items-center gap-2 min-w-0">
          <span className="hidden sm:inline-flex items-center justify-center h-5 w-5 rounded-full bg-white/15 shrink-0">
            <Sparkles size={11} className="text-amber-200" />
          </span>
          <span className="font-semibold tracking-tight">
            Beta cohort full
          </span>
          <span className="hidden sm:inline opacity-80">·</span>
          <span className="opacity-90 truncate">
            {inQueue !== null && (
              <>
                <span data-testid="beta-ribbon-queue-count" className="font-bold tabular-nums">
                  {inQueue}
                </span>
                <span className="opacity-80"> clinics in queue</span>
              </>
            )}
            {nextBatch && (
              <>
                <span className="opacity-60 mx-1.5">·</span>
                <span className="opacity-90">Next batch: <span className="font-semibold">{nextBatch}</span></span>
              </>
            )}
          </span>
        </div>
        <button
          onClick={onJoinWaitlist}
          data-testid="beta-ribbon-cta"
          className="shrink-0 inline-flex items-center gap-1.5 bg-white text-[#0F52BA] hover:bg-amber-50 active:scale-[0.97] transition px-3 py-1 rounded-full font-semibold text-[12px] shadow-sm"
        >
          Join waitlist
          <ArrowRight size={12} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
