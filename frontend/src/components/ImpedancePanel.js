import React from 'react';
import TympanogramCanvas from './TympanogramCanvas';

// ==================== Auto-classify Jerger Type ====================
// Clinical thresholds (simplified): used when user hasn't explicitly chosen a type
export const autoClassifyJerger = ({ me_pressure, compliance, volume }) => {
  const P = me_pressure, C = compliance, V = volume;
  if (P === null || C === null || P === undefined || C === undefined) return null;
  if (C < 0.1) return 'B';                           // flat / no peak
  if (P < -100) return 'C';                          // negative pressure
  if (C > 1.5) return 'Ad';                          // hypermobile
  if (C >= 0.3 && C <= 1.5 && P >= -100 && P <= 50) return 'A';
  if (C < 0.3) return 'As';                          // shallow / stiff
  return 'A';
};

// ==================== Reusable small input ====================
const NumInput = ({ value, onChange, placeholder, step = 0.1, testId, className = '' }) => (
  <input
    type="number"
    step={step}
    value={value ?? ''}
    onChange={(e) => {
      const n = parseFloat(e.target.value);
      onChange(Number.isNaN(n) ? null : n);
    }}
    placeholder={placeholder}
    data-testid={testId}
    className={`w-full text-xs border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500 ${className}`}
  />
);

const Select = ({ value, onChange, options, testId, className = '' }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value || null)}
    data-testid={testId}
    className={`text-xs border border-gray-300 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-blue-500 ${className}`}
  >
    <option value="">—</option>
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

const JERGER_OPTIONS = [
  { value: 'A',  label: 'Type A' },
  { value: 'As', label: 'Type As' },
  { value: 'Ad', label: 'Type Ad' },
  { value: 'B',  label: 'Type B' },
  { value: 'C',  label: 'Type C' },
];

const INTERP_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'equivocal', label: 'Equivocal' },
];

const REFLEX_FREQS = ['250', '500', '1000', '2000', '4000'];
const DECAY_FREQS = ['500', '1000'];

// ==================== Tympanogram block (per ear) ====================
const TympanogramBlock = ({ earLabel, earSide, value, onChange }) => {
  const autoType = autoClassifyJerger({
    me_pressure: value.me_pressure,
    compliance: value.compliance,
    volume: value.volume,
  });
  const effectiveType = value.jerger_type || autoType;
  const colorCls = earSide === 'right' ? 'text-red-600' : 'text-blue-600';

  return (
    <div className="flex-1 min-w-0 border border-gray-300 rounded bg-white shadow-sm">
      <div className={`flex items-center justify-between px-2 py-1 border-b border-gray-300 bg-gray-50`}>
        <span className={`text-xs font-bold ${colorCls}`}>{earLabel} Ear</span>
        <span className="text-[10px] text-gray-500">
          Auto type: <b>{autoType || '—'}</b>{value.jerger_type && value.jerger_type !== autoType ? ' (overridden)' : ''}
        </span>
      </div>

      <div className="flex gap-2 p-2">
        {/* Input column */}
        <div className="w-[140px] flex-shrink-0 space-y-1">
          <div>
            <label className="text-[10px] font-medium text-gray-600">Type</label>
            <Select
              testId={`tymp-${earSide}-type`}
              value={value.jerger_type}
              onChange={(v) => onChange({ ...value, jerger_type: v })}
              options={JERGER_OPTIONS}
              className="w-full"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-gray-600">ME Pressure (daPa)</label>
            <NumInput
              testId={`tymp-${earSide}-pressure`}
              value={value.me_pressure}
              onChange={(v) => onChange({ ...value, me_pressure: v })}
              placeholder="-50"
              step={1}
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-gray-600">Compliance (mL)</label>
            <NumInput
              testId={`tymp-${earSide}-compliance`}
              value={value.compliance}
              onChange={(v) => onChange({ ...value, compliance: v })}
              placeholder="0.60"
              step={0.01}
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-gray-600">Volume (cc)</label>
            <NumInput
              testId={`tymp-${earSide}-volume`}
              value={value.volume}
              onChange={(v) => onChange({ ...value, volume: v })}
              placeholder="1.00"
              step={0.01}
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-gray-600">Notes</label>
            <input
              type="text"
              value={value.notes || ''}
              onChange={(e) => onChange({ ...value, notes: e.target.value })}
              data-testid={`tymp-${earSide}-notes`}
              className="w-full text-xs border border-gray-300 rounded px-1 py-0.5"
            />
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0 h-[220px] border border-gray-200 rounded">
          <TympanogramCanvas
            jergerType={effectiveType}
            mePressure={value.me_pressure}
            compliance={value.compliance}
            volume={value.volume}
            earSide={earSide}
          />
        </div>
      </div>
    </div>
  );
};

// ==================== Acoustic Reflex / Decay Grid ====================
const ReflexGrid = ({ title, earLabel, earSide, value, onChange, freqs }) => {
  const colorCls = earSide === 'right' ? 'text-red-600' : 'text-blue-600';
  const updateCell = (side, freq, field, v) => {
    const next = {
      ...value,
      [side]: {
        ...value[side],
        freqs: {
          ...(value[side]?.freqs || {}),
          [freq]: { ...((value[side]?.freqs || {})[freq] || {}), [field]: v },
        },
      },
    };
    onChange(next);
  };

  const renderSide = (sideKey, sideLabel) => {
    const sideData = value[sideKey] || { freqs: {} };
    return (
      <div className="border border-gray-300 rounded">
        <div className="text-[10px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 border-b border-gray-300">
          {sideLabel}
        </div>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-1 py-0.5 font-semibold"></th>
              {freqs.map((f) => (
                <th key={f} className="px-1 py-0.5 font-semibold text-gray-700">
                  {parseInt(f) >= 1000 ? `${parseInt(f) / 1000}K` : f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['level', 'volume', 'pressure'].map((row) => (
              <tr key={row} className="border-b border-gray-100">
                <td className="px-1 py-0.5 text-gray-600 font-medium capitalize">{row}</td>
                {freqs.map((f) => (
                  <td key={f} className="px-0.5 py-0.5">
                    <input
                      type="number"
                      step={row === 'level' ? 1 : 0.01}
                      value={sideData.freqs?.[f]?.[row] ?? ''}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        updateCell(sideKey, f, row, Number.isNaN(n) ? null : n);
                      }}
                      data-testid={`${title.toLowerCase().replace(/\s/g, '-')}-${earSide}-${sideKey}-${f}-${row}`}
                      className="w-full text-[10px] border border-gray-200 rounded px-0.5 py-0 text-center focus:outline-none focus:border-blue-500"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex-1 min-w-0 border border-gray-300 rounded bg-white shadow-sm">
      <div className="px-2 py-1 border-b border-gray-300 bg-gray-50">
        <span className={`text-xs font-bold ${colorCls}`}>{earLabel} Ear</span>
      </div>
      <div className="p-2 space-y-1.5">
        {renderSide('ipsi', 'Ipsilateral')}
        {renderSide('contra', 'Contralateral')}
      </div>
    </div>
  );
};

// ==================== ET Dysfunction ====================
const ETBlock = ({ earLabel, earSide, value, onChange }) => {
  const colorCls = earSide === 'right' ? 'text-red-600' : 'text-blue-600';
  const update = (man, field, v) =>
    onChange({ ...value, [man]: { ...(value[man] || {}), [field]: v } });

  const maneuvers = [
    { id: 'toynbee', label: 'Toynbee' },
    { id: 'valsalva', label: 'Valsalva' },
    { id: 'pressure_app', label: 'Pressure-application' },
  ];

  return (
    <div className="flex-1 min-w-0 border border-gray-300 rounded bg-white shadow-sm">
      <div className="px-2 py-1 border-b border-gray-300 bg-gray-50">
        <span className={`text-xs font-bold ${colorCls}`}>{earLabel} Ear</span>
      </div>
      <div className="p-2 space-y-1.5">
        {maneuvers.map((m) => {
          const mv = value[m.id] || {};
          return (
            <div key={m.id} className="border border-gray-200 rounded p-1.5 bg-gray-50">
              <div className="text-[10px] font-bold text-gray-700 mb-1">{m.label}</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <div>
                  <div className="text-[9px] text-gray-600">Pressure before (daPa)</div>
                  <NumInput
                    testId={`et-${earSide}-${m.id}-before`}
                    value={mv.pressure_before}
                    onChange={(v) => update(m.id, 'pressure_before', v)}
                    step={1}
                  />
                </div>
                <div>
                  <div className="text-[9px] text-gray-600">Pressure after (daPa)</div>
                  <NumInput
                    testId={`et-${earSide}-${m.id}-after`}
                    value={mv.pressure_after}
                    onChange={(v) => update(m.id, 'pressure_after', v)}
                    step={1}
                  />
                </div>
                <div>
                  <div className="text-[9px] text-gray-600">Interpretation</div>
                  <Select
                    testId={`et-${earSide}-${m.id}-interp`}
                    value={mv.interpretation}
                    onChange={(v) => update(m.id, 'interpretation', v)}
                    options={INTERP_OPTIONS}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="text-[9px] text-gray-600">Notes</div>
                  <input
                    type="text"
                    value={mv.notes || ''}
                    onChange={(e) => update(m.id, 'notes', e.target.value)}
                    data-testid={`et-${earSide}-${m.id}-notes`}
                    className="w-full text-xs border border-gray-300 rounded px-1 py-0.5"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==================== Main Panel ====================
const ImpedancePanel = ({ data, onChange }) => {
  const tymp = data.tympanometry;
  const reflex = data.acoustic_reflex;
  const decay = data.reflex_decay;
  const et = data.et_dysfunction;

  const update = (key, patch) => onChange({ ...data, [key]: { ...data[key], ...patch } });
  const updateTympEar = (ear, next) =>
    onChange({ ...data, tympanometry: { ...tymp, [ear]: next } });
  const updateReflexEar = (key, ear, next) =>
    onChange({ ...data, [key]: { ...data[key], [ear]: next } });
  const updateEtEar = (ear, next) =>
    onChange({ ...data, et_dysfunction: { ...et, [ear]: next } });

  const Toggle = ({ label, value, onChange: onT, testId }) => (
    <label className="flex items-center gap-1.5 px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 cursor-pointer">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onT(e.target.checked)}
        data-testid={testId}
        className="w-3.5 h-3.5"
      />
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </label>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-100 overflow-hidden">
      {/* ===== Top toggle bar ===== */}
      <div className="flex items-center gap-2 px-2 py-2 bg-white border-b border-gray-300 flex-shrink-0">
        <span className="text-xs font-bold text-gray-700 mr-1">Show sub-tests:</span>
        <Toggle
          label="Acoustic Reflex"
          value={reflex.enabled}
          onChange={(v) => update('acoustic_reflex', { enabled: v })}
          testId="imp-toggle-reflex"
        />
        <Toggle
          label="Reflex Decay"
          value={decay.enabled}
          onChange={(v) => update('reflex_decay', { enabled: v })}
          testId="imp-toggle-decay"
        />
        <Toggle
          label="ET Dysfunction"
          value={et.enabled}
          onChange={(v) => update('et_dysfunction', { enabled: v })}
          testId="imp-toggle-et"
        />
      </div>

      {/* ===== Scrollable content ===== */}
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {/* Tympanometry (always visible, side-by-side) */}
        <div>
          <div className="text-xs font-bold text-gray-700 mb-1 px-0.5">Tympanometry</div>
          <div className="flex gap-2">
            <TympanogramBlock
              earLabel="Right"
              earSide="right"
              value={tymp.right}
              onChange={(next) => updateTympEar('right', next)}
            />
            <TympanogramBlock
              earLabel="Left"
              earSide="left"
              value={tymp.left}
              onChange={(next) => updateTympEar('left', next)}
            />
          </div>
        </div>

        {/* Acoustic Reflex */}
        {reflex.enabled && (
          <div>
            <div className="text-xs font-bold text-gray-700 mb-1 px-0.5">Acoustic Reflex</div>
            <div className="flex gap-2">
              <ReflexGrid
                title="Reflex"
                earLabel="Right"
                earSide="right"
                value={reflex.right}
                onChange={(next) => updateReflexEar('acoustic_reflex', 'right', next)}
                freqs={REFLEX_FREQS}
              />
              <ReflexGrid
                title="Reflex"
                earLabel="Left"
                earSide="left"
                value={reflex.left}
                onChange={(next) => updateReflexEar('acoustic_reflex', 'left', next)}
                freqs={REFLEX_FREQS}
              />
            </div>
          </div>
        )}

        {/* Reflex Decay */}
        {decay.enabled && (
          <div>
            <div className="text-xs font-bold text-gray-700 mb-1 px-0.5">Reflex Decay</div>
            <div className="flex gap-2">
              <ReflexGrid
                title="Decay"
                earLabel="Right"
                earSide="right"
                value={decay.right}
                onChange={(next) => updateReflexEar('reflex_decay', 'right', next)}
                freqs={DECAY_FREQS}
              />
              <ReflexGrid
                title="Decay"
                earLabel="Left"
                earSide="left"
                value={decay.left}
                onChange={(next) => updateReflexEar('reflex_decay', 'left', next)}
                freqs={DECAY_FREQS}
              />
            </div>
          </div>
        )}

        {/* ET Dysfunction */}
        {et.enabled && (
          <div>
            <div className="text-xs font-bold text-gray-700 mb-1 px-0.5">Eustachian Tube Dysfunction</div>
            <div className="flex gap-2">
              <ETBlock
                earLabel="Right"
                earSide="right"
                value={et.right}
                onChange={(next) => updateEtEar('right', next)}
              />
              <ETBlock
                earLabel="Left"
                earSide="left"
                value={et.left}
                onChange={(next) => updateEtEar('left', next)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImpedancePanel;
