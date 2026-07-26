/**
 * TierBadgeWidget — floating pill shown to trial clinics that surfaces
 * which paid tier the current page belongs to. Click to expand into an
 * upsell popover.
 *
 * Rules (from the founder's spec, 2026-07-26):
 *   • Only rendered when the clinic is on its 30-day trial (`trialActive=true`)
 *     — paid clinics see nothing.
 *   • Hidden on settings / admin / auth / marketing routes (see tierMap.js).
 *   • Bottom-right floating pill. User can dismiss for the session (× button)
 *     → localStorage key `audinexa.tier_badge_dismissed_until`.
 *   • Click the pill → popover expands with tier explainer + prices.
 *   • Popover shows an **Upgrade** CTA only in the last 7 days of trial —
 *     softest before that (urgency ramps).
 *
 * Data source: `SubscriptionContext` provides `trialActive` + `trialDaysLeft`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, X, ChevronUp, ChevronDown, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useSubscription } from '../SubscriptionContext';
import { matchRouteTier, TIER_META } from '../utils/tierMap';

const DISMISS_KEY = 'audinexa.tier_badge_dismissed_until';

function isDismissedForSession() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    return Number.isFinite(until) && Date.now() < until;
  } catch { return false; }
}

function dismissForSession() {
  // Dismiss for 24h — resurfaces the next day. Short enough to keep the
  // upsell alive, long enough to respect the user's "not now".
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
  } catch { /* localStorage might be blocked in incognito — fail silently */ }
}

export default function TierBadgeWidget() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { trialActive, trialDaysLeft, loading, superAdminBypass } = useSubscription();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => isDismissedForSession());

  // Route → tier lookup. Recomputes on navigation.
  const { tier, module } = useMemo(() => matchRouteTier(pathname), [pathname]);

  // Reset "dismissed" when we reload — but keep the localStorage flag alive.
  useEffect(() => setDismissed(isDismissedForSession()), [pathname]);

  // Gates that hide the widget entirely
  if (loading) return null;
  if (!trialActive) return null;              // paid clinic → hide
  if (superAdminBypass) return null;          // founder/super_admin → hide
  if (tier === 'HIDDEN') return null;         // route is plumbing/settings/etc.
  if (dismissed) return null;

  const meta = TIER_META[tier];
  const showUpgrade = (trialDaysLeft !== null && trialDaysLeft <= 7);
  const daysLabel = trialDaysLeft == null
    ? 'Trial active'
    : trialDaysLeft === 0 ? 'Trial ends today'
    : trialDaysLeft === 1 ? '1 day left'
    : `${trialDaysLeft} days left`;

  return (
    <div
      className="fixed z-40 bottom-5 right-5 max-w-[calc(100vw-2rem)]"
      data-testid="tier-badge-widget"
      data-tier={tier}
      style={{ pointerEvents: 'auto' }}
    >
      {/* Collapsed pill */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          data-testid="tier-badge-pill"
          className="group inline-flex items-center gap-2 pl-3 pr-2 py-2 rounded-full border shadow-lg backdrop-blur bg-white/90 hover:shadow-xl transition-shadow"
          style={{ borderColor: meta.border }}
        >
          <span
            className="inline-flex w-6 h-6 rounded-full items-center justify-center shrink-0"
            style={{ background: meta.bg }}
          >
            <Sparkles className="w-3.5 h-3.5" style={{ color: meta.hex }} />
          </span>
          <span className="text-[13px] font-semibold whitespace-nowrap" style={{ color: meta.hex }}>
            {meta.label} feature
          </span>
          <span className="text-[11px] text-slate-500 whitespace-nowrap hidden sm:inline">· {daysLabel}</span>
          <ChevronUp className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
          <span
            role="button"
            aria-label="Dismiss"
            data-testid="tier-badge-dismiss"
            onClick={(e) => { e.stopPropagation(); dismissForSession(); setDismissed(true); }}
            className="ml-1 w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-slate-100 text-slate-400"
          >
            <X className="w-3 h-3" />
          </span>
        </button>
      )}

      {/* Expanded popover */}
      {open && (
        <div
          data-testid="tier-badge-popover"
          className="rounded-2xl border shadow-2xl bg-white p-4 w-[320px]"
          style={{ borderColor: meta.border }}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex w-7 h-7 rounded-full items-center justify-center shrink-0"
                style={{ background: meta.bg }}
              >
                <Sparkles className="w-4 h-4" style={{ color: meta.hex }} />
              </span>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Current page</div>
                <div className="text-[15px] font-bold text-slate-900 leading-tight">{module || 'This feature'}</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              data-testid="tier-badge-collapse"
              className="p-1 rounded-md hover:bg-slate-100 text-slate-400"
              aria-label="Collapse"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2 text-[13px] text-slate-700 leading-relaxed">
            This is a <span className="font-bold" style={{ color: meta.hex }}>{meta.label}</span>-tier feature —
            <span className="font-semibold"> free during your trial</span>. To keep using it after day 30, you&apos;ll need
            {tier === 'BASIC'    && <> a <b>Basic</b>, Standard, or Premium plan.</>}
            {tier === 'STANDARD' && <> a <b>Standard</b> or Premium plan.</>}
            {tier === 'PREMIUM'  && <> the <b>Premium</b> plan.</>}
          </div>

          {/* Price tiles */}
          <div className="mt-3 space-y-1.5">
            {['BASIC', 'STANDARD', 'PREMIUM'].map((tCode) => {
              const t = TIER_META[tCode];
              const included = (
                (tCode === 'BASIC'    && tier === 'BASIC')
                || (tCode === 'STANDARD' && (tier === 'BASIC' || tier === 'STANDARD'))
                || (tCode === 'PREMIUM')
              );
              return (
                <div
                  key={tCode}
                  data-testid={`tier-badge-price-row-${tCode}`}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-[12px] ${included ? '' : 'opacity-40'}`}
                  style={{ background: included ? t.bg : '#F8FAFC' }}
                >
                  <span className="flex items-center gap-1.5">
                    {included && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: t.hex }} />}
                    <span className="font-semibold" style={{ color: included ? t.hex : '#94A3B8' }}>{t.label}</span>
                  </span>
                  <span className="font-mono text-slate-700 tabular-nums">{t.price}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 text-[11px] text-slate-500 text-center" data-testid="tier-badge-countdown">
            🎁 {trialDaysLeft == null
                 ? 'Free during your trial'
                 : trialDaysLeft === 0 ? 'Free — your trial ends today'
                 : trialDaysLeft === 1 ? 'Free — 1 day left in your trial'
                 : `Free for the next ${trialDaysLeft} days of your trial`}
          </div>

          {showUpgrade && (
            <button
              onClick={() => { navigate('/settings/subscription'); setOpen(false); }}
              data-testid="tier-badge-upgrade-cta"
              className="w-full mt-3 py-2.5 rounded-lg font-bold text-[13px] text-white inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
              style={{ background: meta.hex }}
            >
              Upgrade now to keep this <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => { dismissForSession(); setDismissed(true); setOpen(false); }}
            data-testid="tier-badge-dismiss-day"
            className="w-full mt-2 py-1 text-[11px] text-slate-400 hover:text-slate-600"
          >
            Hide for the day
          </button>
        </div>
      )}
    </div>
  );
}
