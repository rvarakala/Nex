import React from 'react';
import TympanogramCanvas from './TympanogramCanvas';
import ETFCanvas from './ETFCanvas';

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

const PROBE_HZ_OPTIONS = [
  { value: '226',  label: '226 Hz' },
  { value: '678',  label: '678 Hz' },
  { value: '800',  label: '800 Hz' },
  { value: '1000', label: '1000 Hz' },
];

const REFLEX_FREQS = ['250', '500', '1000', '2000', '4000', '6000', 'BBN', 'LBN', 'HBN'];
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
            <label className="text-[10px] font-medium text-gray-600">Probe tone</label>
            <Select
              testId={`tymp-${earSide}-probe`}
              value={value.probe_hz ? String(value.probe_hz) : '226'}
              onChange={(v) => onChange({ ...value, probe_hz: v ? parseInt(v, 10) : 226 })}
              options={PROBE_HZ_OPTIONS}
              className="w-full"
            />
          </div>
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
            <label className="text-[10px] font-medium text-gray-600">Volume / ECV (cc)</label>
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
            earSide={earSide}
            probeHz={value.probe_hz || 226}
          />
        </div>
      </div>
    </div>
  );
};

// ==================== Acoustic Reflex — Contra / Ipsi rows ====================
// Each "side" (ipsi | contra) renders a single-row strip: freq headers on top,
// one free-text input per cell below. Accepts numbers AND alphabetic markers
// (e.g. "85", "NR", "CNT", "90 NR").
const ReflexRow = ({ earLabel, earSide, freqs, side, reflexData, onChange, testPrefix }) => {
  const colorCls = earSide === 'right' ? 'text-red-600' : 'text-blue-600';
  const earData = reflexData?.[earSide] || {};
  const sideData = earData?.[side] || { freqs: {} };

  const updateCell = (freq, v) => {
    const next = {
      ...reflexData,
      [earSide]: {
        ...earData,
        [side]: {
          ...sideData,
          freqs: {
            ...(sideData.freqs || {}),
            [freq]: { ...((sideData.freqs || {})[freq] || {}), level: v },
          },
        },
      },
    };
    onChange(next);
  };

  return (
    <div className="flex-1 min-w-0">
      <div className={`text-[11px] font-bold ${colorCls} mb-0.5`}>
        Stimulus (Probe) {earLabel} Ear
      </div>
      <div className={`border-t-2 ${earSide === 'right' ? 'border-red-500' : 'border-blue-500'} mb-1`}></div>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${freqs.length}, minmax(0, 1fr))` }}>
        {freqs.map((f) => (
          <div key={f} className="flex flex-col items-center">
            <div className={`text-[10px] font-bold ${colorCls} leading-tight`}>{f}</div>
            <input
              type="text"
              value={sideData.freqs?.[f]?.level ?? ''}
              onChange={(e) => updateCell(f, e.target.value || null)}
              data-testid={`${testPrefix}-${earSide}-${side}-${f}`}
              className="w-full text-[11px] border border-gray-300 rounded px-0.5 py-0.5 text-center focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// Contra- or Ipsi-lateral Acoustic Reflex section (both ears side by side).
const AcousticReflexSection = ({ title, side, reflexData, onChange, freqs, testPrefix }) => (
  <div className="border border-gray-300 rounded bg-white shadow-sm">
    <div className="text-xs font-bold text-gray-800 px-2 py-1 border-b border-gray-300 bg-gray-50">
      {title}
    </div>
    <div className="flex gap-4 p-2">
      <ReflexRow
        earLabel="Right"
        earSide="right"
        freqs={freqs}
        side={side}
        reflexData={reflexData}
        onChange={onChange}
        testPrefix={testPrefix}
      />
      <ReflexRow
        earLabel="Left"
        earSide="left"
        freqs={freqs}
        side={side}
        reflexData={reflexData}
        onChange={onChange}
        testPrefix={testPrefix}
      />
    </div>
  </div>
);

// ==================== Acoustic Reflex Decay ====================
// Two ear blocks, each with label like "Earphone R (probe L)". Accepts
// alphanumeric decay markers (e.g. "NR", "P", "N").
const DecaySection = ({ decayData, onChange }) => {
  const updateCell = (earSide, freq, v) => {
    // In Decay, measurements are contralateral only. We store under `contra.freqs` for consistency.
    const earData = decayData?.[earSide] || {};
    const sideData = earData?.contra || { freqs: {} };
    const next = {
      ...decayData,
      [earSide]: {
        ...earData,
        contra: {
          ...sideData,
          freqs: {
            ...(sideData.freqs || {}),
            [freq]: { ...((sideData.freqs || {})[freq] || {}), level: v },
          },
        },
      },
    };
    onChange(next);
  };

  const Block = ({ earphoneLabel, earSide, colorCls }) => {
    const sideData = decayData?.[earSide]?.contra || { freqs: {} };
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className={`text-[11px] font-bold ${colorCls} whitespace-nowrap`}>{earphoneLabel}</div>
        <div className="flex gap-2">
          {DECAY_FREQS.map((f) => (
            <div key={f} className="flex flex-col items-center">
              <div className={`text-[10px] font-bold ${colorCls} leading-tight`}>{f}</div>
              <input
                type="text"
                value={sideData.freqs?.[f]?.level ?? ''}
                onChange={(e) => updateCell(earSide, f, e.target.value || null)}
                data-testid={`decay-${earSide}-${f}`}
                className="w-14 text-[11px] border border-gray-300 rounded px-0.5 py-0.5 text-center focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="border border-gray-300 rounded bg-white shadow-sm">
      <div className="text-xs font-bold text-gray-800 px-2 py-1 border-b border-gray-300 bg-gray-50">
        Acoustic Reflex Decay
      </div>
      <div className="flex gap-6 p-2">
        {/* Note on ear-label convention:
            "Earphone R (probe L)" = stimulus delivered via the Right earphone, probe placed in the Left ear.
            Per the contralateral convention that's a LEFT-ear contralateral measurement → stored at decayData.left.contra. */}
        <Block earphoneLabel="Earphone R (probe L)" earSide="left"  colorCls="text-orange-600" />
        <Block earphoneLabel="Earphone L (probe R)" earSide="right" colorCls="text-blue-600" />
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

// ==================== ETF-Intact TM (Williams) ====================
// One plot per ear — overlays 3 tympanogram curves at Pressure 1/2/3, plus a
// shaded normal-range rectangle. Volume is entered once per ear and scales the
// peak amplitudes shared across all 3 curves.
const ETFBlock = ({ earLabel, earSide, value, onChange }) => {
  const colorCls = earSide === 'right' ? 'text-red-600' : 'text-blue-600';
  const update = (field, v) => onChange({ ...value, [field]: v });

  return (
    <div className="flex-1 min-w-0 border border-gray-300 rounded bg-white shadow-sm">
      <div className="px-2 py-1 border-b border-gray-300 bg-gray-50 flex items-center justify-between">
        <span className={`text-xs font-bold ${colorCls}`}>{earLabel} Ear</span>
        <span className="text-[9px] text-gray-500 italic">ETF-Intact (Williams)</span>
      </div>
      <div className="p-2 space-y-2">
        {/* Canvas */}
        <div className="h-[200px] border border-gray-300 rounded bg-white">
          <ETFCanvas
            volume={value?.volume}
            pressure_1={value?.pressure_1}
            pressure_2={value?.pressure_2}
            pressure_3={value?.pressure_3}
            earSide={earSide}
          />
        </div>

        {/* Inputs — 2 columns to stay compact */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <div>
            <div className="text-[9px] text-gray-600">Volume (mL)</div>
            <NumInput
              testId={`etf-${earSide}-volume`}
              value={value?.volume}
              onChange={(v) => update('volume', v)}
              step={0.01}
            />
          </div>
          <div>
            <div className="text-[9px] text-gray-600">Pressure 1 — Baseline (daPa)</div>
            <NumInput
              testId={`etf-${earSide}-p1`}
              value={value?.pressure_1}
              onChange={(v) => update('pressure_1', v)}
              step={1}
            />
          </div>
          <div>
            <div className="text-[9px] text-gray-600">Pressure 2 — post-Valsalva (daPa)</div>
            <NumInput
              testId={`etf-${earSide}-p2`}
              value={value?.pressure_2}
              onChange={(v) => update('pressure_2', v)}
              step={1}
            />
          </div>
          <div>
            <div className="text-[9px] text-gray-600">Pressure 3 — post-Toynbee (daPa)</div>
            <NumInput
              testId={`etf-${earSide}-p3`}
              value={value?.pressure_3}
              onChange={(v) => update('pressure_3', v)}
              step={1}
            />
          </div>
          <div className="col-span-2">
            <div className="text-[9px] text-gray-600">Notes</div>
            <input
              type="text"
              value={value?.notes || ''}
              onChange={(e) => update('notes', e.target.value)}
              data-testid={`etf-${earSide}-notes`}
              className="w-full text-xs border border-gray-300 rounded px-1 py-0.5"
            />
          </div>
        </div>
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
  const etf = data.etf_intact || { enabled: false, right: {}, left: {} };

  const update = (key, patch) => onChange({ ...data, [key]: { ...data[key], ...patch } });
  const updateTympEar = (ear, next) =>
    onChange({ ...data, tympanometry: { ...tymp, [ear]: next } });
  const updateReflexEar = (key, ear, next) =>
    onChange({ ...data, [key]: { ...data[key], [ear]: next } });
  const updateEtEar = (ear, next) =>
    onChange({ ...data, et_dysfunction: { ...et, [ear]: next } });
  const updateEtfEar = (ear, next) =>
    onChange({ ...data, etf_intact: { ...etf, [ear]: next } });

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
        <Toggle
          label="ETF-Intact (Williams)"
          value={etf.enabled}
          onChange={(v) => update('etf_intact', { enabled: v })}
          testId="imp-toggle-etf"
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

        {/* Acoustic Reflex — Contralateral + Ipsilateral sections */}
        {reflex.enabled && (
          <div className="space-y-2">
            <AcousticReflexSection
              title="Contralateral Acoustic Reflexes"
              side="contra"
              reflexData={reflex}
              onChange={(next) => onChange({ ...data, acoustic_reflex: next })}
              freqs={REFLEX_FREQS}
              testPrefix="reflex-contra"
            />
            <AcousticReflexSection
              title="Ipsilateral Acoustic Reflexes"
              side="ipsi"
              reflexData={reflex}
              onChange={(next) => onChange({ ...data, acoustic_reflex: next })}
              freqs={REFLEX_FREQS}
              testPrefix="reflex-ipsi"
            />
          </div>
        )}

        {/* Reflex Decay — compact contralateral-only block */}
        {decay.enabled && (
          <DecaySection
            decayData={decay}
            onChange={(next) => onChange({ ...data, reflex_decay: next })}
          />
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

        {/* ETF-Intact TM (Williams) */}
        {etf.enabled && (
          <div>
            <div className="text-xs font-bold text-gray-700 mb-1 px-0.5">
              Eustachian Tube Function — Intact TM (Williams Test)
            </div>
            <div className="flex gap-2">
              <ETFBlock
                earLabel="Right"
                earSide="right"
                value={etf.right}
                onChange={(next) => updateEtfEar('right', next)}
              />
              <ETFBlock
                earLabel="Left"
                earSide="left"
                value={etf.left}
                onChange={(next) => updateEtfEar('left', next)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImpedancePanel;
