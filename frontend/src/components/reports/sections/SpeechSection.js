import React from 'react';
import SpeechAudiogramCanvas from '../../SpeechAudiogramCanvas';
import { SectionTitle } from '../SectionTitle';

const SPEECH_ROWS = [
  { key: 'right',            label: 'Right',            color: 'text-red-600' },
  { key: 'left',             label: 'Left',             color: 'text-blue-600' },
  { key: 'soundfield',       label: 'Soundfield',       color: 'text-green-700' },
  { key: 'soundfield_aided', label: 'Soundfield Aided', color: 'text-pink-700' },
];
const WR_ROWS = [
  { key: 'wr_right',            label: 'Right',            color: 'text-red-600' },
  { key: 'wr_left',             label: 'Left',             color: 'text-blue-600' },
  { key: 'wr_soundfield_right', label: 'Soundfield Right', color: 'text-green-700' },
  { key: 'wr_soundfield_left',  label: 'Soundfield Left',  color: 'text-green-700' },
];
const WRN_ROWS = [
  { key: 'wrn_right', label: 'Right', color: 'text-red-600' },
  { key: 'wrn_left',  label: 'Left',  color: 'text-blue-600' },
];

const cell = (v) => (v === null || v === undefined || v === '' ? '—' : v);

// Speech Audiometry section for the printed report:
//   1. Speech Audiometry table (SAT / SRT / Masking / MCL / UCL)
//   2. Speech Audiogram (WRS curve chart)
//   3. Word Recognition table (Word List + Presentation pair)
//   4. Word Recognition in Noise table
// Any missing sub-section is skipped silently.
export const SpeechSection = ({ speech, channelsToPlot }) => {
  const s = speech || {};
  const hasSpeechTable = SPEECH_ROWS.some((r) => {
    const row = s[r.key] || {};
    return ['sat', 'srt', 'masking', 'mcl', 'ucl'].some((c) => row[c]);
  });
  const hasWRS = ['wrs_right', 'wrs_left', 'wrs_soundfield', 'wrs_soundfield_aided']
    .some((k) => (s[k] || []).length > 0);
  const hasWR = WR_ROWS.some((r) => {
    const row = s[r.key] || {};
    return ['db_hl_unaided', 'percent_unaided', 'masking_unaided', 'db_hl_aided', 'percent_aided', 'masking_aided']
      .some((c) => row[c]);
  });
  const hasWRN = WRN_ROWS.some((r) => {
    const row = s[r.key] || {};
    return ['db_hl', 'percent', 'noise_level'].some((c) => row[c]);
  });

  const enabled = channelsToPlot || { right: true, left: true, soundfield: false, soundfield_aided: false };

  return (
    <div>
      <SectionTitle>Speech Audiometry</SectionTitle>

      {/* ===== 1. Speech Audiometry table ===== */}
      {hasSpeechTable && (
        <table className="w-full text-[11px] border border-gray-400 mb-1">
          <thead className="bg-gray-100">
            <tr>
              <th className="border border-gray-400 px-2 py-0.5 text-left"></th>
              <th className="border border-gray-400 px-2 py-0.5">SAT</th>
              <th className="border border-gray-400 px-2 py-0.5">SRT</th>
              <th className="border border-gray-400 px-2 py-0.5">Masking</th>
              <th className="border border-gray-400 px-2 py-0.5">MCL</th>
              <th className="border border-gray-400 px-2 py-0.5">UCL</th>
            </tr>
          </thead>
          <tbody>
            {SPEECH_ROWS.map((r) => (
              <tr key={r.key}>
                <td className={`border border-gray-400 px-2 py-0.5 font-semibold ${r.color}`}>{r.label}</td>
                <td className="border border-gray-400 px-2 py-0.5 text-center">{cell(s[r.key]?.sat)}</td>
                <td className="border border-gray-400 px-2 py-0.5 text-center">{cell(s[r.key]?.srt)}</td>
                <td className="border border-gray-400 px-2 py-0.5 text-center">{cell(s[r.key]?.masking)}</td>
                <td className="border border-gray-400 px-2 py-0.5 text-center">{cell(s[r.key]?.mcl)}</td>
                <td className="border border-gray-400 px-2 py-0.5 text-center">{cell(s[r.key]?.ucl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ===== 2. Speech Audiogram (WRS curve) ===== */}
      {hasWRS && (
        <div className="mt-1 mb-1">
          <div className="text-[11px] font-semibold text-gray-700 mb-0.5">Speech Audiogram (% vs dB HL)</div>
          <div className="h-[240px] border border-gray-400 bg-white">
            <SpeechAudiogramCanvas
              points={{
                right: s.wrs_right || [],
                left: s.wrs_left || [],
                soundfield: s.wrs_soundfield || [],
                soundfield_aided: s.wrs_soundfield_aided || [],
              }}
              enabledChannels={enabled}
            />
          </div>
        </div>
      )}

      {/* ===== 3. Word Recognition ===== */}
      {hasWR && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold text-gray-700 mb-0.5">Word Recognition</div>
          {(s.word_list || s.presentation) && (
            <div className="grid grid-cols-2 text-[10px] border border-gray-400 border-b-0">
              <div className="px-2 py-0.5 border-r border-gray-300">
                <span className="font-semibold text-gray-600">Word List:</span> {s.word_list || '—'}
              </div>
              <div className="px-2 py-0.5">
                <span className="font-semibold text-gray-600">Presentation:</span> {s.presentation || '—'}
              </div>
            </div>
          )}
          <table className="w-full text-[10px] border border-gray-400 mb-1">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-400 px-1 py-0.5 text-left" rowSpan={2}></th>
                <th className="border border-gray-400 px-1 py-0.5" colSpan={3}>Word List</th>
                <th className="border border-gray-400 px-1 py-0.5" colSpan={3}>Presentation</th>
              </tr>
              <tr>
                <th className="border border-gray-400 px-1 py-0.5">dBHL</th>
                <th className="border border-gray-400 px-1 py-0.5">%</th>
                <th className="border border-gray-400 px-1 py-0.5">Masking</th>
                <th className="border border-gray-400 px-1 py-0.5">dBHL</th>
                <th className="border border-gray-400 px-1 py-0.5">% (aided)</th>
                <th className="border border-gray-400 px-1 py-0.5">Masking</th>
              </tr>
            </thead>
            <tbody>
              {WR_ROWS.map((r) => {
                const isSoundfield = r.key.startsWith('wr_soundfield');
                const row = s[r.key] || {};
                return (
                  <tr key={r.key}>
                    <td className={`border border-gray-400 px-1 py-0.5 font-semibold ${r.color}`}>{r.label}</td>
                    <td className="border border-gray-400 px-1 py-0.5 text-center">{cell(row.db_hl_unaided)}</td>
                    <td className="border border-gray-400 px-1 py-0.5 text-center">{cell(row.percent_unaided)}</td>
                    <td className={`border border-gray-400 px-1 py-0.5 text-center ${isSoundfield ? 'bg-gray-200' : ''}`}>
                      {isSoundfield ? '' : cell(row.masking_unaided)}
                    </td>
                    <td className="border border-gray-400 px-1 py-0.5 text-center">{cell(row.db_hl_aided)}</td>
                    <td className="border border-gray-400 px-1 py-0.5 text-center">{cell(row.percent_aided)}</td>
                    <td className={`border border-gray-400 px-1 py-0.5 text-center ${isSoundfield ? 'bg-gray-200' : ''}`}>
                      {isSoundfield ? '' : cell(row.masking_aided)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== 4. Word Recognition in Noise ===== */}
      {hasWRN && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold text-gray-700 mb-0.5">Word Recognition in Noise</div>
          <table className="w-full text-[10px] border border-gray-400">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-400 px-1 py-0.5 text-left"></th>
                <th className="border border-gray-400 px-1 py-0.5">dBHL</th>
                <th className="border border-gray-400 px-1 py-0.5">%</th>
                <th className="border border-gray-400 px-1 py-0.5">N. Level</th>
              </tr>
            </thead>
            <tbody>
              {WRN_ROWS.map((r) => {
                const row = s[r.key] || {};
                return (
                  <tr key={r.key}>
                    <td className={`border border-gray-400 px-1 py-0.5 font-semibold ${r.color}`}>{r.label}</td>
                    <td className="border border-gray-400 px-1 py-0.5 text-center">{cell(row.db_hl)}</td>
                    <td className="border border-gray-400 px-1 py-0.5 text-center">{cell(row.percent)}</td>
                    <td className="border border-gray-400 px-1 py-0.5 text-center">{cell(row.noise_level)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty-state hint if nothing entered */}
      {!hasSpeechTable && !hasWRS && !hasWR && !hasWRN && (
        <div className="text-[11px] italic text-gray-500">(no speech audiometry data recorded)</div>
      )}
    </div>
  );
};
