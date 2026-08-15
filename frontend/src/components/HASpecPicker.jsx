/**
 * HASpecPicker — single reusable widget that captures the extra
 * fitting attributes users need everywhere HA is being specified.
 *
 * Behaviour depends on `deviceType`:
 *   · RIC / RITE  → Colour + Receiver Power (S/M/MAV/P/UP) + Receiver Wire Length
 *   · BTE         → Colour + Power Class (Standard/SP/UP) + Slim Tube Length
 *   · IIC/CIC/ITC/ITE (custom shells) → Colour only
 *
 * `side` supports L / R / BOTH. When BOTH, we render two side-by-side
 * spec cards so the audiologist can capture DIFFERENT wire lengths &
 * powers per ear (they often do — asymmetric losses are common).
 *
 * `value` shape:
 *   Single ear (side = L or R):
 *     { color, color_other?, receiver_power?, receiver_length?,
 *       bte_power?, slim_tube_length? }
 *   Both ears (side = BOTH):
 *     { left: {...single spec...}, right: {...single spec...} }
 *
 * The picker never mutates `value`; it calls `onChange(newValue)` with
 * the whole updated blob (single or both). Persisting is the caller's
 * job — this component is stateless-with-defaults so it can live inside
 * forms of any framework (react-hook-form / formik / plain useState).
 */
import React from 'react';
import {
  COLOR_OPTIONS, RIC_RECEIVER_POWERS, BTE_POWER_CLASSES, LENGTH_OPTIONS,
  RIC_TYPES, BTE_TYPES, CUSTOM_SHELL_TYPES,
} from '../lib/haSpecs';

const cellCls =
  'w-full text-[12px] px-2 py-1.5 rounded border border-slate-300 ' +
  'focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white ' +
  'disabled:bg-slate-100 disabled:text-slate-500';
const labelCls =
  'block text-[10.5px] uppercase tracking-widest text-slate-500 ' +
  'font-semibold mb-0.5';

function SingleEar({
  side, spec, onChange, deviceType, testIdPrefix,
}) {
  const isRIC = RIC_TYPES.has(String(deviceType || '').toUpperCase());
  const isBTE = BTE_TYPES.has(String(deviceType || '').toUpperCase());
  const isCustom = CUSTOM_SHELL_TYPES.has(String(deviceType || '').toUpperCase());

  const set = (patch) => onChange({ ...(spec || {}), ...patch });
  const s = spec || {};

  return (
    <div className="grid grid-cols-3 gap-2">
      {/* Colour — always present */}
      <div className="col-span-1">
        <label className={labelCls}>Colour</label>
        <select
          value={s.color || ''}
          onChange={(e) => set({ color: e.target.value })}
          data-testid={`${testIdPrefix}-color`}
          className={cellCls}
        >
          <option value="">Select…</option>
          {COLOR_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {s.color === 'other' && (
          <input
            type="text"
            placeholder="Custom colour"
            value={s.color_other || ''}
            onChange={(e) => set({ color_other: e.target.value })}
            data-testid={`${testIdPrefix}-color-other`}
            className={`${cellCls} mt-1`}
          />
        )}
      </div>

      {/* Power — RIC or BTE (custom shells have no external power) */}
      {(isRIC || isBTE) && (
        <div className="col-span-1">
          <label className={labelCls}>
            {isRIC ? 'Receiver power' : 'Power class'}
          </label>
          <select
            value={isRIC ? (s.receiver_power || '') : (s.bte_power || '')}
            onChange={(e) => set(isRIC
              ? { receiver_power: e.target.value }
              : { bte_power: e.target.value })}
            data-testid={`${testIdPrefix}-power`}
            className={cellCls}
          >
            <option value="">Select…</option>
            {(isRIC ? RIC_RECEIVER_POWERS : BTE_POWER_CLASSES).map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Length — RIC wire OR BTE slim tube */}
      {(isRIC || isBTE) && (
        <div className="col-span-1">
          <label className={labelCls}>
            {isRIC ? 'Wire length' : 'Slim tube length'}
          </label>
          <select
            value={isRIC ? (s.receiver_length || '') : (s.slim_tube_length || '')}
            onChange={(e) => set(isRIC
              ? { receiver_length: e.target.value }
              : { slim_tube_length: e.target.value })}
            data-testid={`${testIdPrefix}-length`}
            className={cellCls}
          >
            <option value="">Select…</option>
            {LENGTH_OPTIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      )}

      {isCustom && !isRIC && !isBTE && (
        <div className="col-span-2 text-[11px] text-slate-500 flex items-end pb-1.5 italic">
          Custom-shell devices — power &amp; receiver are internal, only
          colour is captured here.
        </div>
      )}
    </div>
  );
}

export default function HASpecPicker({
  deviceType,
  side = 'L',                    // 'L' | 'R' | 'BOTH'
  value,
  onChange,
  className = '',
  compact = false,
  title = 'Device spec',
  testIdPrefix = 'ha-spec',
}) {
  const sideUpper = String(side || 'L').toUpperCase();
  const isBoth = sideUpper === 'BOTH';

  // Two-ear form: normalise value into { left, right }.
  if (isBoth) {
    const both = value && typeof value === 'object' && ('left' in value || 'right' in value)
      ? value
      : { left: {}, right: {} };

    return (
      <div className={`space-y-2 ${className}`}>
        {!compact && (
          <div className="text-[10.5px] uppercase tracking-widest text-slate-500 font-semibold">
            {title} · per ear
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded border border-slate-200 bg-slate-50 p-2.5"
               data-testid={`${testIdPrefix}-left`}>
            <div className="text-[10px] font-bold text-rose-700 uppercase tracking-widest mb-1">
              Left ear
            </div>
            <SingleEar
              side="L"
              spec={both.left || {}}
              onChange={(nl) => onChange({ ...both, left: nl })}
              deviceType={deviceType}
              testIdPrefix={`${testIdPrefix}-left`}
            />
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2.5"
               data-testid={`${testIdPrefix}-right`}>
            <div className="text-[10px] font-bold text-blue-700 uppercase tracking-widest mb-1">
              Right ear
            </div>
            <SingleEar
              side="R"
              spec={both.right || {}}
              onChange={(nr) => onChange({ ...both, right: nr })}
              deviceType={deviceType}
              testIdPrefix={`${testIdPrefix}-right`}
            />
          </div>
        </div>
      </div>
    );
  }

  // Single-ear form.
  return (
    <div className={className} data-testid={testIdPrefix}>
      {!compact && (
        <div className="text-[10.5px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
          {title}
        </div>
      )}
      <SingleEar
        side={sideUpper}
        spec={value || {}}
        onChange={onChange}
        deviceType={deviceType}
        testIdPrefix={testIdPrefix}
      />
    </div>
  );
}
