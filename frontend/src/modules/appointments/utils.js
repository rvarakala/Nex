// Shared date / colour helpers for the new top-level Appointments calendar.
// Kept tiny + pure so the WeekGrid + StaffRail + future Day/Month/Persons
// views can all consume the same primitives without re-implementing them.

export const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Mon-anchored start of the ISO week containing `d`. */
export const startOfWeek = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
};

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const fmtRange = (start, end) => {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sM = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const eM = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} ${end.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  }
  return `${sM} – ${eM}`;
};

export const fmtTimeShort = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
};

/** Convert a full ISO timestamp to "HH:MM" (24h) using the local timezone. */
export const isoToHHMM = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Return contrast colour (#000 or #fff) for a hex background; lifted from W3C YIQ. */
export const contrastOn = (hex) => {
  if (!hex) return '#fff';
  const c = hex.replace('#', '');
  const v = c.length === 3
    ? c.split('').map((ch) => parseInt(ch + ch, 16))
    : [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (v.some(Number.isNaN)) return '#fff';
  const yiq = (v[0] * 299 + v[1] * 587 + v[2] * 114) / 1000;
  return yiq >= 150 ? '#0F172A' : '#FFFFFF';
};

/** Add alpha to a hex color: hexAlpha("#3B82F6", 0.18) → "rgba(59,130,246,0.18)". */
export const hexAlpha = (hex, a = 0.15) => {
  if (!hex) return `rgba(15,23,42,${a})`;
  const c = hex.replace('#', '');
  const v = c.length === 3
    ? c.split('').map((ch) => parseInt(ch + ch, 16))
    : [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (v.some(Number.isNaN)) return `rgba(15,23,42,${a})`;
  return `rgba(${v[0]},${v[1]},${v[2]},${a})`;
};
