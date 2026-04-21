import React from 'react';
import ReportAudiogram from '../../ReportAudiogram';
import { SectionTitle } from '../SectionTitle';
import { ptaAvg } from '../ptaCalc';
import { LABELS, pick } from '../constants';

// Compact PTA table below the legend. PTA 1 = 500·1K·2K, PTA 2 = 1K·2K·4K, AB Gap = AC PTA1 − BC PTA1.
const PTAMiniTable = ({ rightEar, leftEar }) => {
  const rP1 = ptaAvg(rightEar, 'ac_measurements', [500, 1000, 2000]);
  const rP2 = ptaAvg(rightEar, 'ac_measurements', [1000, 2000, 4000]);
  const lP1 = ptaAvg(leftEar,  'ac_measurements', [500, 1000, 2000]);
  const lP2 = ptaAvg(leftEar,  'ac_measurements', [1000, 2000, 4000]);
  const rB1 = ptaAvg(rightEar, 'bc_measurements', [500, 1000, 2000]);
  const lB1 = ptaAvg(leftEar,  'bc_measurements', [500, 1000, 2000]);
  const rABG = rP1 !== null && rB1 !== null ? rP1 - rB1 : null;
  const lABG = lP1 !== null && lB1 !== null ? lP1 - lB1 : null;
  return (
    <div className="border border-gray-300 rounded bg-white">
      <div className="text-[10px] font-bold text-gray-700 bg-gray-100 text-center py-0.5 border-b border-gray-300">
        PTA Summary (dB HL)
      </div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="px-1.5 py-0.5 text-left font-semibold text-gray-600">Ear</th>
            <th className="px-1.5 py-0.5 font-semibold text-gray-700" title="Average of 500, 1000, 2000 Hz">PTA 1</th>
            <th className="px-1.5 py-0.5 font-semibold text-gray-700" title="Average of 1000, 2000, 4000 Hz">PTA 2</th>
            <th className="px-1.5 py-0.5 font-semibold text-gray-700" title="AC PTA1 − BC PTA1 (500·1K·2K Hz)">AB Gap</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-100">
            <td className="px-1.5 py-0.5 font-semibold text-red-600">R</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{rP1 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{rP2 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{rABG ?? '—'}</td>
          </tr>
          <tr>
            <td className="px-1.5 py-0.5 font-semibold text-blue-600">L</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{lP1 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{lP2 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{lABG ?? '—'}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[8px] text-gray-500 px-1.5 py-0.5 border-t border-gray-200 leading-tight">
        PTA 1: 500·1K·2K · PTA 2: 1K·2K·4K · AB Gap: AC−BC @ PTA 1
      </div>
    </div>
  );
};

// Compact Rinne + Weber micro-table living inside the PTA sidebar (shown when ABC/Bing opt-ins are OFF).
const TuningForkMiniTable = ({ tf = {} }) => (
  <div className="border border-gray-300 rounded bg-white">
    <div className="text-[10px] font-bold text-gray-700 bg-gray-100 text-center py-0.5 border-b border-gray-300">
      Tuning Fork ({tf.frequency_hz || 512} Hz)
    </div>
    <table className="w-full text-[10px]">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="px-1.5 py-0.5 text-left font-semibold text-gray-600">Test</th>
          <th className="px-1.5 py-0.5 font-semibold text-gray-700">R</th>
          <th className="px-1.5 py-0.5 font-semibold text-gray-700">L</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-gray-100">
          <td className="px-1.5 py-0.5 font-medium">Rinne</td>
          <td className="px-1.5 py-0.5 text-center">{pick(LABELS.rinne, tf.rinne_right)}</td>
          <td className="px-1.5 py-0.5 text-center">{pick(LABELS.rinne, tf.rinne_left)}</td>
        </tr>
        <tr>
          <td className="px-1.5 py-0.5 font-medium">Weber</td>
          <td className="px-1.5 py-0.5 text-center" colSpan={2}>{pick(LABELS.weber, tf.weber)}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

export const PureToneSection = ({
  rightEar,
  leftEar,
  mode = 'combined',
  tuningFork,
  showTuningForkMini = false,
  size = 'standard', // 'standard' | 'large' | 'xlarge' — only effective when report has room (Tymp on new page)
}) => {
  // Height map keyed by (mode, size). Standard values preserve the compact A4-fit default.
  const HEIGHTS = {
    combined: { standard: 240, large: 380, xlarge: 550 },
    separate: { standard: 280, large: 400, xlarge: 550 },
  };
  const chartHeight = HEIGHTS[mode === 'separate' ? 'separate' : 'combined'][size] || HEIGHTS.combined.standard;

  const Sidebar = (
    <div className="w-[180px] flex-shrink-0 flex flex-col gap-1.5 text-[10px] text-gray-700">
      <div className="border border-gray-300 rounded p-1.5 bg-gray-50">
        <div className="font-bold text-[11px] mb-1">Legend</div>
        <div className="flex items-center gap-1.5 mb-0.5"><span className="text-red-600 font-bold">O</span> Right AC (unmasked)</div>
        <div className="flex items-center gap-1.5 mb-0.5"><span className="text-red-600 font-bold">△</span> Right AC (masked)</div>
        <div className="flex items-center gap-1.5 mb-0.5"><span className="text-red-600 font-bold">&lt;</span> Right BC</div>
        <div className="flex items-center gap-1.5 mb-0.5"><span className="text-blue-600 font-bold">X</span> Left AC (unmasked)</div>
        <div className="flex items-center gap-1.5 mb-0.5"><span className="text-blue-600 font-bold">□</span> Left AC (masked)</div>
        <div className="flex items-center gap-1.5 mb-0.5"><span className="text-blue-600 font-bold">&gt;</span> Left BC</div>
        <div className="flex items-center gap-1.5 mt-0.5 pt-0.5 border-t border-gray-300">↙ ↘ No Response</div>
      </div>
      <PTAMiniTable rightEar={rightEar} leftEar={leftEar} />
      {showTuningForkMini && <TuningForkMiniTable tf={tuningFork} />}
    </div>
  );

  if (mode === 'separate') {
    return (
      <div>
        <SectionTitle>Puretone Audiometry</SectionTitle>
        <div className="flex gap-2 items-stretch">
          <div className="flex-1" style={{ height: `${chartHeight}px` }}>
            <ReportAudiogram rightEarData={rightEar} leftEarData={null} title="Right Ear" />
          </div>
          <div className="flex-1" style={{ height: `${chartHeight}px` }}>
            <ReportAudiogram rightEarData={null} leftEarData={leftEar} title="Left Ear" />
          </div>
          {Sidebar}
        </div>
      </div>
    );
  }

  // combined (default)
  return (
    <div>
      <SectionTitle>Puretone Audiometry</SectionTitle>
      <div className="flex gap-3">
        <div className="flex-1" style={{ height: `${chartHeight}px` }}>
          <ReportAudiogram rightEarData={rightEar} leftEarData={leftEar} />
        </div>
        {Sidebar}
      </div>
    </div>
  );
};
