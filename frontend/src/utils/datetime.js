/**
 * Datetime utilities — shared across the app to guarantee consistent
 * UTC-to-local conversion.
 *
 * Why this exists:
 *   Backend saves timestamps via `datetime.utcnow()` and serialises them
 *   through `utils.serde.serialize_datetime` which emits ISO strings
 *   *without* a trailing `Z` (e.g. "2026-08-12T09:04:00.123456").
 *
 *   JavaScript's `new Date(naiveIso)` parses such strings as **local
 *   time**, not UTC. On an IST browser (UTC+5:30) a 14:35 IST event
 *   stored as `09:04 UTC` was rendering as 9:04 AM instead of 2:35 PM.
 *
 *   `parseUtcIso` detects the missing timezone marker and appends `Z`
 *   before construction, so every downstream `.toLocaleString(…)` call
 *   correctly converts to the browser's timezone.
 *
 * Rules:
 *   - ALWAYS use `parseUtcIso` when the source is a backend-generated
 *     timestamp field (created_at, updated_at, paid_at, start_at, etc.).
 *   - Do NOT use for user-typed date strings (birthday, appointment
 *     picker) — those don't have timezone semantics.
 */

/**
 * Parse a backend ISO datetime string, treating naive strings as UTC.
 * Returns a `Date` object safe for `.toLocaleString()` display.
 *
 * Accepts:
 *   - `"2026-08-12T09:04:00.123456"`  → treated as UTC ✔
 *   - `"2026-08-12T09:04:00Z"`         → treated as UTC ✔
 *   - `"2026-08-12T14:34:00+05:30"`    → respected as-is ✔
 *   - `Date` objects → passed through
 *   - null/undefined/empty → returns null
 */
export function parseUtcIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;

  const s = value.trim();
  // If it already has timezone info (Z or ±HH:MM at the end), trust it.
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  const normalised = hasTz ? s : `${s}Z`;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a backend ISO string as "12 Aug 2026, 2:34 pm" style.
 * Falls back to a dash for null/invalid inputs.
 */
export function fmtDateTime(iso, opts = {}) {
  const d = parseUtcIso(iso);
  if (!d) return '—';
  return d.toLocaleString('en-IN', {
    dateStyle: opts.dateStyle || 'medium',
    timeStyle: opts.timeStyle || 'short',
  });
}

/** Date-only variant — hides the time component. */
export function fmtDate(iso, opts = {}) {
  const d = parseUtcIso(iso);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { dateStyle: opts.dateStyle || 'medium' });
}

/** Relative time helper — "2 minutes ago", "3 hours ago", "5 days ago". */
export function fmtRelative(iso) {
  const d = parseUtcIso(iso);
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs < 0;
  const sec = Math.floor(abs / 1000);
  if (sec < 60)   return future ? 'in a moment' : 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60)   return future ? `in ${min} min` : `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)    return future ? `in ${hr} hr`  : `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30)   return future ? `in ${day} d`  : `${day} d ago`;
  return fmtDate(iso);
}
