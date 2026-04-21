import React from 'react';
import TympanogramCanvas from '../TympanogramCanvas';
import ETFCanvas from '../ETFCanvas';
import { SectionTitle } from './SectionTitle';
import { effectiveJerger } from './ptaCalc';

// Central vertical summary table used in the 3-column tympanometry layout.
// Probe Hz in the header is derived from the right ear's probe setting (falls back to left, then 226).
const TympanometrySummaryTable = ({ impedance }) => {
  const R = impedance?.tympanometry?.right || {};
  const L = impedance?.tympanometry?.left || {};
  const probeHz = R.probe_hz || L.probe_hz || 226;
  const rows = [
    { label: 'Type',             r: effectiveJerger(R) || '—',           l: effectiveJerger(L) || '—' },
    { label: 'Pressure (daPa)',  r: R.me_pressure ?? '—',                l: L.me_pressure ?? '—' },
    { label: 'Compliance (mL)',  r: R.compliance != null ? Number(R.compliance).toFixed(2) : '—',
                                 l: L.compliance != null ? Number(L.compliance).toFixed(2) : '—' },
    { label: 'Volume (cc)',      r: R.volume != null ? Number(R.volume).toFixed(2) : '—',
                                 l: L.volume != null ? Number(L.volume).toFixed(2) : '—' },
  ];
  return (
    <div className="border border-gray-400 rounded bg-white text-[10px] overflow-hidden">
      <div className="bg-gray-100 border-b border-gray-400 px-2 py-1 text-center">
        <span className="font-bold text-[11px] tracking-wide">TYMPANOMETRY [{probeHz} Hz]</span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="w-[32%] px-1 py-1 text-center font-bold text-red-600 border-r border-gray-300">Right</th>
            <th className="w-[36%] px-1 py-1 text-center font-bold text-gray-700"></th>
            <th className="w-[32%] px-1 py-1 text-center font-bold text-blue-600 border-l border-gray-300">Left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-gray-200 last:border-b-0">
              <td className="px-1 py-1 text-center font-mono border-r border-gray-300">{r.r}</td>
              <td className="px-1 py-1 text-center font-semibold text-gray-700 bg-gray-50">{r.label}</td>
              <td className="px-1 py-1 text-center font-mono border-l border-gray-300">{r.l}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ReflexTable = ({ title, reflex, freqs }) => {
  const row = (earLabel, earData, side, sideLabel, colour) => (
    <tr>
      <td className={`border border-gray-400 px-1 py-0.5 font-semibold ${colour}`}>{earLabel}</td>
      <td className="border border-gray-400 px-1 py-0.5">{sideLabel}</td>
      {freqs.map((f) => {
        const cell = earData?.[side]?.freqs?.[f] || {};
        return (
          <td key={f} className="border border-gray-400 px-1 py-0.5 text-center">
            {cell.level ?? '—'}
          </td>
        );
      })}
    </tr>
  );
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-700 mt-1 mb-0.5">{title} — Threshold level (dB HL)</div>
      <table className="w-full text-[10px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-1 py-0.5">Ear</th>
            <th className="border border-gray-400 px-1 py-0.5">Probe</th>
            {freqs.map((f) => (
              <th key={f} className="border border-gray-400 px-1 py-0.5">
                {parseInt(f) >= 1000 ? `${parseInt(f) / 1000}K` : f} Hz
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('Right', reflex?.right, 'ipsi', 'Ipsi', 'text-red-600')}
          {row('Right', reflex?.right, 'contra', 'Contra', 'text-red-600')}
          {row('Left',  reflex?.left,  'ipsi', 'Ipsi', 'text-blue-600')}
          {row('Left',  reflex?.left,  'contra', 'Contra', 'text-blue-600')}
        </tbody>
      </table>
    </div>
  );
};

const ETTable = ({ et }) => {
  const earCol = (earLabel, earData, colour) => (
    <tr>
      <td className={`border border-gray-400 px-1 py-0.5 font-semibold ${colour}`}>{earLabel}</td>
      {['toynbee', 'valsalva', 'pressure_app'].map((m) => {
        const v = earData?.[m] || {};
        return (
          <td key={m} className="border border-gray-400 px-1 py-0.5">
            <div className="text-[10px]">
              <div>Before: {v.pressure_before ?? '—'} · After: {v.pressure_after ?? '—'}</div>
              <div className="font-semibold capitalize">{v.interpretation || '—'}</div>
              {v.notes && <div className="italic text-gray-500">{v.notes}</div>}
            </div>
          </td>
        );
      })}
    </tr>
  );
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-700 mt-1 mb-0.5">Eustachian Tube Dysfunction</div>
      <table className="w-full text-[10px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-1 py-0.5">Ear</th>
            <th className="border border-gray-400 px-1 py-0.5">Toynbee</th>
            <th className="border border-gray-400 px-1 py-0.5">Valsalva</th>
            <th className="border border-gray-400 px-1 py-0.5">Pressure App.</th>
          </tr>
        </thead>
        <tbody>
          {earCol('Right', et?.right, 'text-red-600')}
          {earCol('Left',  et?.left,  'text-blue-600')}
        </tbody>
      </table>
    </div>
  );
};

// Compact tympanometry section (inline on PTA page) — single-row 3-column layout.
export const TympanometryInlineSection = ({ impedance }) => {
  const R = impedance?.tympanometry?.right || {};
  const L = impedance?.tympanometry?.left || {};
  return (
    <div>
      <SectionTitle>Tympanometry</SectionTitle>
      <div className="flex gap-2 items-stretch">
        <div className="flex-1 flex flex-col">
          <div className="bg-yellow-50 border border-gray-400 text-[10px] font-bold text-gray-700 px-1.5 py-0.5">
            Right Tympanogram
          </div>
          <div className="flex-1 h-[160px] border border-t-0 border-gray-400">
            <TympanogramCanvas
              jergerType={effectiveJerger(R)}
              mePressure={R.me_pressure}
              compliance={R.compliance}
              volume={R.volume}
              earSide="right"
            />
          </div>
        </div>
        <div className="w-[200px] flex-shrink-0 flex items-stretch">
          <div className="w-full">
            <TympanometrySummaryTable impedance={impedance} />
          </div>
        </div>
        <div className="flex-1 flex flex-col">
          <div className="bg-yellow-50 border border-gray-400 text-[10px] font-bold text-gray-700 px-1.5 py-0.5">
            Left Tympanogram
          </div>
          <div className="flex-1 h-[160px] border border-t-0 border-gray-400">
            <TympanogramCanvas
              jergerType={effectiveJerger(L)}
              mePressure={L.me_pressure}
              compliance={L.compliance}
              volume={L.volume}
              earSide="left"
            />
          </div>
        </div>
      </div>
      {impedance?.acoustic_reflex?.enabled && (
        <ReflexTable title="Acoustic Reflex" reflex={impedance.acoustic_reflex} freqs={['250', '500', '1000', '2000', '4000']} />
      )}
    </div>
  );
};

// Full-page tympanometry section (with page break) — single-row 3-column layout + extras.
export const TympanometryFullPage = ({ impedance }) => {
  const R = impedance?.tympanometry?.right || {};
  const L = impedance?.tympanometry?.left || {};
  return (
    <div className="page-break-before">
      <SectionTitle>Tympanometry &amp; Immittance</SectionTitle>
      <div className="flex gap-3 items-stretch">
        <div className="flex-1 flex flex-col">
          <div className="bg-yellow-50 border border-gray-400 text-[11px] font-bold text-gray-700 px-2 py-1">
            Right Tympanogram
          </div>
          <div className="flex-1 h-[260px] border border-t-0 border-gray-400">
            <TympanogramCanvas
              jergerType={effectiveJerger(R)}
              mePressure={R.me_pressure}
              compliance={R.compliance}
              earSide="right"
              probeHz={R.probe_hz || 226}
            />
          </div>
        </div>
        <div className="w-[220px] flex-shrink-0 flex items-stretch">
          <div className="w-full">
            <TympanometrySummaryTable impedance={impedance} />
          </div>
        </div>
        <div className="flex-1 flex flex-col">
          <div className="bg-yellow-50 border border-gray-400 text-[11px] font-bold text-gray-700 px-2 py-1">
            Left Tympanogram
          </div>
          <div className="flex-1 h-[260px] border border-t-0 border-gray-400">
            <TympanogramCanvas
              jergerType={effectiveJerger(L)}
              mePressure={L.me_pressure}
              compliance={L.compliance}
              earSide="left"
              probeHz={L.probe_hz || 226}
            />
          </div>
        </div>
      </div>
      {impedance?.acoustic_reflex?.enabled && (
        <ReflexTable title="Acoustic Reflex" reflex={impedance.acoustic_reflex} freqs={['250', '500', '1000', '2000', '4000']} />
      )}
      {impedance?.reflex_decay?.enabled && (
        <ReflexTable title="Reflex Decay" reflex={impedance.reflex_decay} freqs={['500', '1000']} />
      )}
      {impedance?.et_dysfunction?.enabled && <ETTable et={impedance.et_dysfunction} />}
      {impedance?.etf_intact?.enabled && <ETFIntactSection etf={impedance.etf_intact} />}
    </div>
  );
};

// ETF-Intact (Williams) — two side-by-side canvases with peak-pressure summary below
const ETFIntactSection = ({ etf }) => {
  const R = etf?.right || {};
  const L = etf?.left || {};
  const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : v);
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold text-gray-700 mb-0.5">
        Eustachian Tube Function — Intact TM (Williams)
      </div>
      <div className="flex gap-2">
        {/* Right */}
        <div className="flex-1 flex flex-col">
          <div className="bg-red-50 border border-gray-400 text-[10px] font-bold text-red-700 px-1.5 py-0.5">
            Right — Volume {fmt(R.volume)} mL
          </div>
          <div className="h-[180px] border border-t-0 border-gray-400 bg-white">
            <ETFCanvas
              volume={R.volume}
              pressure_1={R.pressure_1}
              pressure_2={R.pressure_2}
              pressure_3={R.pressure_3}
              earSide="right"
            />
          </div>
          <table className="w-full text-[10px] border border-t-0 border-gray-400">
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="px-1.5 py-0.5 text-gray-600">Pressure 1 (baseline)</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-red-600">{fmt(R.pressure_1)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="px-1.5 py-0.5 text-gray-600">Pressure 2 (Valsalva)</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-blue-600">{fmt(R.pressure_2)}</td>
              </tr>
              <tr>
                <td className="px-1.5 py-0.5 text-gray-600">Pressure 3 (Toynbee)</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-green-600">{fmt(R.pressure_3)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Left */}
        <div className="flex-1 flex flex-col">
          <div className="bg-blue-50 border border-gray-400 text-[10px] font-bold text-blue-700 px-1.5 py-0.5">
            Left — Volume {fmt(L.volume)} mL
          </div>
          <div className="h-[180px] border border-t-0 border-gray-400 bg-white">
            <ETFCanvas
              volume={L.volume}
              pressure_1={L.pressure_1}
              pressure_2={L.pressure_2}
              pressure_3={L.pressure_3}
              earSide="left"
            />
          </div>
          <table className="w-full text-[10px] border border-t-0 border-gray-400">
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="px-1.5 py-0.5 text-gray-600">Pressure 1 (baseline)</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-red-600">{fmt(L.pressure_1)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="px-1.5 py-0.5 text-gray-600">Pressure 2 (Valsalva)</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-blue-600">{fmt(L.pressure_2)}</td>
              </tr>
              <tr>
                <td className="px-1.5 py-0.5 text-gray-600">Pressure 3 (Toynbee)</td>
                <td className="px-1.5 py-0.5 text-right font-mono text-green-600">{fmt(L.pressure_3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {(R.notes || L.notes) && (
        <div className="text-[10px] text-gray-600 mt-1 leading-tight">
          {R.notes && <div><span className="font-semibold text-red-600">R:</span> {R.notes}</div>}
          {L.notes && <div><span className="font-semibold text-blue-600">L:</span> {L.notes}</div>}
        </div>
      )}
    </div>
  );
};
