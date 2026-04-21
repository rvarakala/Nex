import React from 'react';
import SpeechAudiogramCanvas from '../../SpeechAudiogramCanvas';
import { SectionTitle } from '../SectionTitle';

const cell = (v) => (v === null || v === undefined || v === '' ? '—' : v);

const Tag = ({ children }) => (
  <td className="w-12 align-middle bg-gray-700 text-white text-[9px] font-bold text-center" rowSpan={1}>
    {children}
  </td>
);

// Compact "label: value" inline helper used for each field in the report printout.
const Pair = ({ label, value, color = 'text-gray-700' }) => (
  <span className="inline-flex items-center gap-1 mr-3 whitespace-nowrap">
    <span className={`text-[9px] font-semibold ${color}`}>{label}</span>
    <span className="font-mono text-[10px] border-b border-gray-300 px-1 min-w-[32px] inline-block text-center">
      {cell(value)}
    </span>
  </span>
);

export const SpeechSection = ({ speech, channelsToPlot }) => {
  const s = speech || {};
  const f = s.fields || {};
  const hasAnyField = Object.values(f).some((v) => v && String(v).trim() !== '');
  const hasWRS = ['wrs_right', 'wrs_left', 'wrs_soundfield', 'wrs_soundfield_aided']
    .some((k) => (s[k] || []).length > 0);

  const enabled = channelsToPlot || { right: true, left: true, soundfield: false, soundfield_aided: false };

  if (!hasAnyField && !hasWRS) return null;

  return (
    <div>
      <SectionTitle>Speech Audiometry</SectionTitle>

      {/* ===== Speech Audiogram (WRS curves) ===== */}
      {hasWRS && (
        <div className="mb-1">
          <div className="h-[220px] border border-gray-400 bg-white">
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

      {/* ===== SRT / SAT row ===== */}
      <table className="w-full text-[10px] border border-gray-400 mb-1">
        <tbody>
          <tr>
            <Tag>SRT / SAT</Tag>
            <td className="p-1 align-top">
              <div className="flex flex-wrap gap-y-0.5">
                <Pair label="R"          value={f.srt_r}        color="text-red-600" />
                <Pair label="R Masked"   value={f.srt_r_masked} color="text-red-600" />
                <Pair label="L"          value={f.srt_l}        color="text-blue-600" />
                <Pair label="L Masked"   value={f.srt_l_masked} color="text-blue-600" />
                <Pair label="Binaural R" value={f.srt_bin_r}    color="text-red-600" />
                <Pair label="Binaural L" value={f.srt_bin_l}    color="text-blue-600" />
                <Pair label="SAT R"      value={f.sat_r}        color="text-red-600" />
                <Pair label="SAT L"      value={f.sat_l}        color="text-blue-600" />
                <Pair label="SAT SF"     value={f.sat_sf}       color="text-green-700" />
                <Pair label="SAT SFA"    value={f.sat_sfa}      color="text-pink-700" />
              </div>
              <div className="flex flex-wrap gap-y-0.5 mt-1 pt-1 border-t border-gray-200">
                <Pair label="DiscrimList" value={f.discrim_list} />
                <Pair label="Voice Type"  value={f.voice_type} />
                <Pair label="Reliability" value={f.reliability || 'Good'} />
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ===== Word Recognition (Quiet) ===== */}
      {['unaided', 'aided', 'pipb'].some((row) =>
        ['r', 'l', 'bin'].some((side) =>
          ['pct', 'db', 'masked'].some((k) => f[`wr_${row}_${side}_${k}`])
        )
      ) && (
        <table className="w-full text-[10px] border border-gray-400 mb-1">
          <tbody>
            <tr>
              <Tag>WR</Tag>
              <td className="p-1 align-top">
                <div className="text-[9px] italic text-gray-500 mb-0.5">Word Recognition (Quiet)</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[9px] text-gray-600">
                      <th className="w-28"></th>
                      {['R', 'L', 'Binaural'].map((s_) => (
                        <th key={s_} colSpan={3} className="px-1 py-0.5 border-l border-gray-300">{s_}</th>
                      ))}
                    </tr>
                    <tr className="text-[9px] text-gray-500">
                      <th></th>
                      {['r', 'l', 'bin'].map((s_) => (
                        <React.Fragment key={s_}>
                          <th className="px-1 py-0 border-l border-gray-200">%</th>
                          <th className="px-1 py-0">dB</th>
                          <th className="px-1 py-0">Masked</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { key: 'unaided', label: 'Unaided',      color: 'text-purple-700' },
                      { key: 'aided',   label: 'Aided',        color: 'text-green-700' },
                      { key: 'pipb',    label: 'PIPB Unaided', color: 'text-purple-700' },
                    ].map((row) => (
                      <tr key={row.key} className="border-t border-gray-200">
                        <td className={`px-1 py-0 font-semibold ${row.color}`}>{row.label}</td>
                        {['r', 'l', 'bin'].map((side) => (
                          <React.Fragment key={side}>
                            <td className="px-1 py-0 text-center font-mono border-l border-gray-200">{cell(f[`wr_${row.key}_${side}_pct`])}</td>
                            <td className="px-1 py-0 text-center font-mono">{cell(f[`wr_${row.key}_${side}_db`])}</td>
                            <td className="px-1 py-0 text-center font-mono">{cell(f[`wr_${row.key}_${side}_masked`])}</td>
                          </React.Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* ===== Word Recognition in Noise ===== */}
      {['r', 'l', 'bin'].some((side) =>
        ['pct', 'db', 'noise'].some((k) => f[`wrn_${side}_${k}`])
      ) && (
        <table className="w-full text-[10px] border border-gray-400 mb-1">
          <tbody>
            <tr>
              <Tag>WRN</Tag>
              <td className="p-1 align-top">
                <div className="text-[9px] italic text-gray-500 mb-0.5">Word Recognition in Noise</div>
                <div className="flex gap-x-6">
                  {[
                    { side: 'r', label: 'R', color: 'text-red-600' },
                    { side: 'l', label: 'L', color: 'text-blue-600' },
                    { side: 'bin', label: 'Binaural', color: 'text-gray-700' },
                  ].map((col) => (
                    <div key={col.side} className="flex items-center gap-1">
                      <span className={`text-[10px] font-bold ${col.color} w-14`}>{col.label}</span>
                      <Pair label="%"     value={f[`wrn_${col.side}_pct`]} />
                      <Pair label="dB"    value={f[`wrn_${col.side}_db`]} />
                      <Pair label="Noise" value={f[`wrn_${col.side}_noise`]} />
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* ===== MCL / Quick SIN / UCL-LDL ===== */}
      {['mcl_r', 'mcl_l', 'mcl_bin_1', 'mcl_bin_2',
        'qsin_r_score', 'qsin_bin_score', 'qsin_l_score',
        'qsin_r_level', 'qsin_bin_level', 'qsin_l_level',
        'ucl_r', 'ucl_l', 'ucl_bin_1', 'ucl_bin_2'].some((k) => f[k]) && (
        <table className="w-full text-[10px] border border-gray-400">
          <tbody>
            <tr>
              <Tag>MCL / UCL</Tag>
              <td className="p-1 align-top">
                <div className="grid grid-cols-3 gap-x-4">
                  <div>
                    <div className="text-[9px] italic text-gray-500 mb-0.5">Most Comfortable Level</div>
                    <div className="flex flex-wrap gap-y-0.5">
                      <Pair label="R"        value={f.mcl_r}     color="text-red-600" />
                      <Pair label="L"        value={f.mcl_l}     color="text-blue-600" />
                      <Pair label="Binaural" value={f.mcl_bin_1} />
                      <Pair label="Binaural" value={f.mcl_bin_2} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] italic text-gray-500 mb-0.5">Quick SIN</div>
                    <div>
                      <div className="text-[9px] text-gray-600">Score</div>
                      <div className="flex flex-wrap gap-y-0.5">
                        <Pair label="R"        value={f.qsin_r_score}   color="text-red-600" />
                        <Pair label="Binaural" value={f.qsin_bin_score} />
                        <Pair label="L"        value={f.qsin_l_score}   color="text-blue-600" />
                      </div>
                      <div className="text-[9px] text-gray-600 mt-0.5">Level</div>
                      <div className="flex flex-wrap gap-y-0.5">
                        <Pair label="R"        value={f.qsin_r_level}   color="text-red-600" />
                        <Pair label="Binaural" value={f.qsin_bin_level} />
                        <Pair label="L"        value={f.qsin_l_level}   color="text-blue-600" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] italic text-gray-500 mb-0.5">Uncomfortable Level / LDL</div>
                    <div className="flex flex-wrap gap-y-0.5">
                      <Pair label="R"        value={f.ucl_r}     color="text-red-600" />
                      <Pair label="L"        value={f.ucl_l}     color="text-blue-600" />
                      <Pair label="Binaural" value={f.ucl_bin_1} />
                      <Pair label="Binaural" value={f.ucl_bin_2} />
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
};
