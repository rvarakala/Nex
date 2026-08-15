/**
 * Hearing Aid spec constants — the vocabulary every fit/trial/quote/
 * order/inventory surface shares. Keep the option arrays curated so
 * inventory reports and stock filters stay clean; brand catalogs can
 * later extend `COLOR_OPTIONS` without breaking older rows.
 */

// Curated palette. Casing: value is the machine-safe id, label is what
// the audiologist sees. `Other / Custom` is the escape hatch for weird
// factory tints (e.g. Signia "Chestnut") — pairs with a text field
// captured as `spec.color_other`.
export const COLOR_OPTIONS = [
  { value: 'beige',      label: 'Beige' },
  { value: 'champagne',  label: 'Champagne' },
  { value: 'bronze',     label: 'Bronze' },
  { value: 'silver',     label: 'Silver' },
  { value: 'grey',       label: 'Grey' },
  { value: 'black',      label: 'Black' },
  { value: 'white',      label: 'White' },
  { value: 'chestnut',   label: 'Chestnut' },
  { value: 'espresso',   label: 'Espresso' },
  { value: 'blonde',     label: 'Blonde' },
  { value: 'sandy_brown', label: 'Sandy Brown' },
  { value: 'other',      label: 'Other / Custom…' },
];

// RIC receiver power classes — as printed on manufacturer datasheets
// (Phonak S/M/P/UP, Signia S/M/P/HP, Oticon MiniFit S/M/P). MAV* is
// the Phonak "medium-attenuation vent" variant; keep it in the list
// so we can capture it without inventing a synonym.
export const RIC_RECEIVER_POWERS = [
  { value: 'S',   label: 'S — Standard' },
  { value: 'M',   label: 'M — Medium' },
  { value: 'MAV', label: 'MAV — Medium-Attenuation Vent' },
  { value: 'P',   label: 'P — Power' },
  { value: 'UP',  label: 'UP — Ultra Power' },
];

// BTE amplifier power classes. Standard is the everyday BTE; SP is
// Super Power (severe losses); UP is Ultra Power (profound losses).
export const BTE_POWER_CLASSES = [
  { value: 'STD', label: 'Standard' },
  { value: 'SP',  label: 'SP — Super Power' },
  { value: 'UP',  label: 'UP — Ultra Power' },
];

// Wire/tube length units — identical numbering for RIC receiver wires
// AND BTE slim tubes. Values printed as strings so `00` doesn't
// collapse to `0` in JSON round-trips.
export const LENGTH_OPTIONS = ['00', '0', '1', '2', '3', '4', '5'];

// Device families the picker knows about. Anything else falls back to
// colour-only (custom shells have no external receiver/tube).
export const RIC_TYPES = new Set(['RIC', 'RITE']);   // treat RITE like RIC
export const BTE_TYPES = new Set(['BTE']);
export const CUSTOM_SHELL_TYPES = new Set(['IIC', 'CIC', 'ITC', 'ITE']);

// Render helper — turns a persisted spec object into the "2M R" style
// short label used across print templates (invoice, PO line, challan).
export function formatSpecShort(spec, side) {
  if (!spec || typeof spec !== 'object') return '';
  const parts = [];
  if (spec.receiver_length || spec.slim_tube_length) {
    parts.push(String(spec.receiver_length || spec.slim_tube_length));
  }
  const power = spec.receiver_power || spec.bte_power;
  if (power) parts.push(power);
  if (side) parts.push(String(side).toUpperCase());
  return parts.join('');
}

// Human-readable expansion for the Reports / print layouts —
// "Champagne · 2M Receiver".
export function formatSpecLong(spec) {
  if (!spec || typeof spec !== 'object') return '';
  const bits = [];
  const colorVal = spec.color_other || spec.color;
  if (colorVal && colorVal !== 'other') {
    const found = COLOR_OPTIONS.find((c) => c.value === colorVal);
    bits.push(found ? found.label : colorVal);
  }
  if (spec.receiver_length && spec.receiver_power) {
    bits.push(`${spec.receiver_length}${spec.receiver_power} Receiver`);
  } else if (spec.slim_tube_length && spec.bte_power) {
    const p = BTE_POWER_CLASSES.find((c) => c.value === spec.bte_power);
    bits.push(`${p ? p.label : spec.bte_power} · Tube ${spec.slim_tube_length}`);
  } else if (spec.bte_power) {
    const p = BTE_POWER_CLASSES.find((c) => c.value === spec.bte_power);
    bits.push(p ? p.label : spec.bte_power);
  } else if (spec.receiver_power) {
    bits.push(`${spec.receiver_power} Receiver`);
  }
  return bits.filter(Boolean).join(' · ');
}
