/**
 * AUDINEXA changelog. Newest entry FIRST.
 *
 * Conventions:
 *   - `version`     monotonically incrementing semver-ish string. Bumped on
 *                   every meaningful release. Compared via simple string
 *                   sort — keep the format `YYYY.MM.DD` or `vN` so it sorts.
 *   - `date`        ISO date for the release headline.
 *   - `headline`    one-liner for the modal title under "What's new".
 *   - `bullets`     2-4 short user-facing bullets. No internal jargon.
 *
 * Update guideline: bump the version + prepend a new entry whenever the
 * deploy actually changes user-visible behavior. The "What's new" modal
 * surfaces ONLY this top entry on first launch after an update.
 */
export const CHANGELOG = [
  {
    version: '2026.04.28',
    date: '2026-04-28',
    headline: 'New patient hub, auto-greetings & faster updates',
    bullets: [
      'New unified Patients hub — search, register & open detailed profiles in one place',
      'Birthday & anniversary auto-greetings ready to send via WhatsApp',
      'Clinic Open / Close toggle on the topbar for end-of-day soft-blocking',
      'Smoother updates — desktop app now refreshes with one click, no reinstall',
    ],
  },
  {
    version: '2026.04.27',
    date: '2026-04-27',
    headline: 'Service pipeline & support desk',
    bullets: [
      '18% GST auto-invoicing at end of service pipeline',
      'AUDINEXA Care — submit support tickets right from inside the app',
      'New Estimate / Approval fields with conveyed amount + discount',
    ],
  },
];

/** Latest changelog entry — what the "What's new" modal surfaces. */
export const LATEST = CHANGELOG[0];

/** Compare two changelog versions. Returns true if `a` is strictly newer. */
export const isNewerThan = (a, b) => {
  if (!b) return false;       // no last-seen → caller decides (we silently seed)
  return String(a) > String(b);
};
