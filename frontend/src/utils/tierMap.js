/**
 * Route → Tier mapping — powers the TierBadgeWidget.
 *
 * Kept as a flat matching table (no regex libraries) so it stays fast and
 * obvious. `matchRouteTier(pathname)` walks the entries in order and returns
 * the first match. `HIDDEN` means: don't render the badge at all on that
 * route (settings, admin, auth, marketing pages).
 *
 * Tier semantics mirror `backend/utils/tiers.py::TIER_MODULES`:
 *   BASIC    → frontdesk + diagnostics
 *   STANDARD → adds hearing-aids, amc, patient-portal
 *   PREMIUM  → adds repair, analytics, referral-partners
 *
 * When you add a new route in App.js, add a matching line below so trial
 * users see the right tier badge.
 */

/** @type {'BASIC'|'STANDARD'|'PREMIUM'|'HIDDEN'} */
const T = Object.freeze({ B: 'BASIC', S: 'STANDARD', P: 'PREMIUM', H: 'HIDDEN' });

// Prefix → tier. Longer prefixes matter more — put them FIRST.
const ROUTE_TIER = [
  // ---- Hidden (plumbing, auth, marketing, founder-only) --------------------
  { prefix: '/admin',            tier: T.H },
  { prefix: '/settings',         tier: T.H },
  { prefix: '/account',          tier: T.H },
  { prefix: '/data-export',      tier: T.H },
  { prefix: '/login',            tier: T.H },
  { prefix: '/signup',           tier: T.H },
  { prefix: '/verify-email',     tier: T.H },
  { prefix: '/forgot-password',  tier: T.H },
  { prefix: '/reset-password',   tier: T.H },
  { prefix: '/invite',           tier: T.H },
  { prefix: '/terms',            tier: T.H },
  { prefix: '/privacy',          tier: T.H },
  { prefix: '/refund',           tier: T.H },
  { prefix: '/contact',          tier: T.H },
  { prefix: '/status',           tier: T.H },
  { prefix: '/demo',             tier: T.H },
  { prefix: '/queue',            tier: T.H },
  { prefix: '/vault',            tier: T.H },
  { prefix: '/legacy-landing',   tier: T.H },
  { prefix: '/app',              tier: T.H },

  // ---- Premium ------------------------------------------------------------
  { prefix: '/repair',           tier: T.P, module: 'Repair Workflow' },
  { prefix: '/analytics',        tier: T.P, module: 'Owner Analytics' },
  { prefix: '/partners',         tier: T.P, module: 'Referral Partners' },
  { prefix: '/partner',          tier: T.P, module: 'Referral Partner Portal' },
  { prefix: '/referrals',        tier: T.P, module: 'Referral Corner' },

  // ---- Standard -----------------------------------------------------------
  { prefix: '/ha',               tier: T.S, module: 'Hearing-Aid Sales' },
  { prefix: '/care',             tier: T.S, module: 'Aftercare & AMC' },
  { prefix: '/patient-portal',   tier: T.S, module: 'Patient Portal' },

  // ---- Basic --------------------------------------------------------------
  { prefix: '/patients',         tier: T.B, module: 'Patient Records' },
  { prefix: '/appointments',     tier: T.B, module: 'Appointments' },
  { prefix: '/closeout',         tier: T.B, module: 'Day Close-out' },
  { prefix: '/billing',          tier: T.B, module: 'Billing' },
  { prefix: '/accounts',         tier: T.B, module: 'Accounts' },
  { prefix: '/test',             tier: T.B, module: 'Diagnostics' },
  { prefix: '/reports',          tier: T.B, module: 'Reports' },
  { prefix: '/token',            tier: T.B, module: 'Token Print' },

  // ---- Landing / root — the only fully-catch line, MUST BE LAST ----------
  { prefix: '/',                 tier: T.H },
];

/**
 * @param {string} pathname
 * @returns {{tier: 'BASIC'|'STANDARD'|'PREMIUM'|'HIDDEN', module?: string}}
 */
export function matchRouteTier(pathname) {
  if (!pathname) return { tier: 'HIDDEN' };
  for (const entry of ROUTE_TIER) {
    if (pathname === entry.prefix
        || pathname.startsWith(`${entry.prefix}/`)
        || (entry.prefix === '/' && pathname === '/')) {
      return { tier: entry.tier, module: entry.module };
    }
  }
  return { tier: 'HIDDEN' };
}

// Display config for each tier — colours, labels, price
export const TIER_META = {
  BASIC:    { label: 'Basic',    price: '₹499/mo',   hex: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },   // emerald
  STANDARD: { label: 'Standard', price: '₹999/mo',   hex: '#0284C7', bg: '#F0F9FF', border: '#BAE6FD' },   // sky
  PREMIUM:  { label: 'Premium',  price: '₹1,499/mo', hex: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },   // violet
};
