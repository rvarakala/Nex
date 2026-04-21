import React, { useState } from 'react';
import SpeechAudiogramCanvas from './SpeechAudiogramCanvas';

// ====================================================================
// Shared style helpers
// ====================================================================
const COL = {
  R: 'text-red-600',
  L: 'text-blue-600',
  Bin: 'text-gray-700',
  U: 'text-purple-700',   // Unaided
  A: 'text-green-700',    // Aided
  PIPB: 'text-purple-700',
};

// Tiny labelled text input used all over this panel.
const Field = ({ label, labelColor = 'text-gray-700', value, onChange, testId, width = 'w-16' }) => (
  <div className="flex flex-col items-center">
    {label && <div className={`text-[10px] font-semibold ${labelColor} mb-0.5 whitespace-nowrap`}>{label}</div>}
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      className={`${width} text-xs border border-gray-300 rounded px-1 py-0.5 text-center focus:outline-none focus:border-blue-500`}
    />
  </div>
);

// Left "tag" block (black label box on left edge of each section) mirroring the reference image.
const SectionTag = ({ title }) => (
  <div className="w-16 flex-shrink-0 bg-gray-700 text-white text-xs font-bold flex items-center justify-center text-center py-1 rounded-sm">
    {title}
  </div>
);

const SectionRow = ({ tag, subtitle, children }) => (
  <div className="flex gap-2 items-stretch border border-gray-300 rounded bg-white mb-2 shadow-sm">
    <SectionTag title={tag} />
    <div className="flex-1 p-2">
      {subtitle && <div className="text-[10px] italic text-gray-500 mb-1.5">{subtitle}</div>}
      {children}
    </div>
  </div>
);

// ====================================================================
// Main SpeechPanel
// ====================================================================
const CHANNEL_LABEL = {
  right: 'Right',
  left: 'Left',
  soundfield: 'Soundfield',
  soundfield_aided: 'Soundfield Aided',
};

const ROWS = [
  { key: 'right', label: 'Right', color: 'text-red-600' },
  { key: 'left', label: 'Left', color: 'text-blue-600' },
  { key: 'soundfield', label: 'Soundfield', color: 'text-green-700' },
  { key: 'soundfield_aided', label: 'Soundfield Aided', color: 'text-pink-700' },
];

const normalize = (data) => ({
  wrs_right: data?.wrs_right || [],
  wrs_left: data?.wrs_left || [],
  wrs_soundfield: data?.wrs_soundfield || [],
  wrs_soundfield_aided: data?.wrs_soundfield_aided || [],
  fields: data?.fields || {},
});

const SpeechPanel = ({ data, onChange }) => {
  const speech = normalize(data);
  const [activeChannel, setActiveChannel] = useState('right');
  const [inputDb, setInputDb] = useState('');
  const [inputPct, setInputPct] = useState('');
  const [inputMasked, setInputMasked] = useState(false);
  const [enabledChannels, setEnabledChannels] = useState({
    right: true, left: true, soundfield: false, soundfield_aided: false,
  });

  // --- Fields dict CRUD ---
  const getF = (k) => speech.fields?.[k] ?? '';
  const setF = (k, v) => {
    const nextFields = { ...(speech.fields || {}) };
    if (v === '' || v === null || v === undefined) delete nextFields[k];
    else nextFields[k] = v;
    onChange({ ...speech, fields: nextFields });
  };

  // --- WRS curve CRUD ---
  const wrsKey = (channel) => `wrs_${channel}`;
  const currentPoints = {
    right: speech.wrs_right,
    left: speech.wrs_left,
    soundfield: speech.wrs_soundfield,
    soundfield_aided: speech.wrs_soundfield_aided,
  };

  const addPoint = (dbHl, percent, opts = {}) => {
    const { masked = false, noResponse = false } = opts;
    const key = wrsKey(activeChannel);
    const db = Number(dbHl);
    const pct = Number(percent);
    const existing = speech[key] || [];
    // Replace-or-append at the same dB (Pure Tone audiometry convention).
    const filtered = existing.filter((p) => p.db_hl !== db);
    const next = [...filtered, { db_hl: db, percent: pct, masked, no_response: noResponse }]
      .sort((a, b) => a.db_hl - b.db_hl);
    onChange({ ...speech, [key]: next });
  };
  const deletePointAtDb = (dbHl) => {
    const key = wrsKey(activeChannel);
    const next = (speech[key] || []).filter((p) => p.db_hl !== Number(dbHl));
    onChange({ ...speech, [key]: next });
  };
  const removeLastPoint = () => {
    const key = wrsKey(activeChannel);
    const curr = speech[key] || [];
    if (!curr.length) return;
    onChange({ ...speech, [key]: curr.slice(0, -1) });
  };
  const clearChannel = () => {
    const key = wrsKey(activeChannel);
    onChange({ ...speech, [key]: [] });
  };
  const handleManualAdd = () => {
    const db = parseFloat(inputDb);
    const pct = parseFloat(inputPct);
    if (Number.isNaN(db) || Number.isNaN(pct)) return;
    addPoint(db, pct, { masked: inputMasked });
    setInputDb('');
    setInputPct('');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3 space-y-3">
      {/* ============ TOP: Speech Audiogram (WRS curve) ============ */}
      <div className="bg-white border border-gray-300 rounded shadow-sm flex flex-col" style={{ height: '420px' }}>
        <div className="bg-gray-100 border-b border-gray-300 px-3 py-1.5 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-bold text-gray-800">Speech Audiogram (% vs dB HL)</h3>
          <div className="text-[10px] text-gray-500 italic">Click chart to add point · drag sliders to adjust</div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left: controls */}
          <div className="w-[220px] flex-shrink-0 border-r border-gray-200 p-2 space-y-2 overflow-auto">
            <div>
              <div className="text-[10px] font-bold text-gray-600 mb-1">Active channel</div>
              <div className="grid grid-cols-2 gap-1">
                {ROWS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setActiveChannel(r.key)}
                    data-testid={`speech-active-${r.key}`}
                    className={`px-1.5 py-1 text-[10px] font-medium border rounded ${
                      activeChannel === r.key
                        ? 'bg-blue-100 border-blue-400 text-blue-700 font-bold'
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold text-gray-600 mb-1">Show on chart</div>
              <div className="space-y-0.5">
                {ROWS.map((r) => (
                  <label key={r.key} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledChannels[r.key]}
                      onChange={(e) => setEnabledChannels((s) => ({ ...s, [r.key]: e.target.checked }))}
                      data-testid={`speech-show-${r.key}`}
                      className="w-3.5 h-3.5"
                    />
                    <span className={r.color}>{r.label}</span>
                    <span className="ml-auto text-[9px] text-gray-400">{(currentPoints[r.key] || []).length}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-2">
              <div className="text-[10px] font-bold text-gray-600 mb-1">
                Add point → <span className="text-blue-700">{CHANNEL_LABEL[activeChannel]}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <label className="text-[10px] text-gray-600">
                  dB HL
                  <input type="number" value={inputDb} onChange={(e) => setInputDb(e.target.value)} data-testid="speech-input-db" className="w-full text-xs border border-gray-300 rounded px-1 py-0.5 mt-0.5" step="5" />
                </label>
                <label className="text-[10px] text-gray-600">
                  % Score
                  <input type="number" value={inputPct} onChange={(e) => setInputPct(e.target.value)} data-testid="speech-input-pct" className="w-full text-xs border border-gray-300 rounded px-1 py-0.5 mt-0.5" step="5" />
                </label>
              </div>
              <label className="flex items-center gap-1 text-[10px] mt-1 cursor-pointer">
                <input type="checkbox" checked={inputMasked} onChange={(e) => setInputMasked(e.target.checked)} data-testid="speech-input-masked" className="w-3 h-3" />
                Masked
              </label>
              <button type="button" onClick={handleManualAdd} data-testid="speech-add-btn" className="w-full mt-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold py-1 rounded">+ Add point</button>
              <div className="grid grid-cols-2 gap-1 mt-1">
                <button type="button" onClick={removeLastPoint} data-testid="speech-undo-btn" className="text-[10px] border border-gray-300 rounded py-0.5 hover:bg-gray-100">Undo last</button>
                <button type="button" onClick={clearChannel} data-testid="speech-clear-btn" className="text-[10px] border border-red-300 text-red-600 rounded py-0.5 hover:bg-red-50">Clear</button>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-2 text-[10px] text-gray-600 space-y-0.5">
              <div className="font-bold text-gray-700 mb-0.5">Legend</div>
              <div className="flex items-center gap-1.5"><span className="text-red-600 font-bold w-4 text-center">O</span> Right (unmasked)</div>
              <div className="flex items-center gap-1.5"><span className="text-red-600 font-bold w-4 text-center">△</span> Right (masked)</div>
              <div className="flex items-center gap-1.5"><span className="text-blue-600 font-bold w-4 text-center">X</span> Left (unmasked)</div>
              <div className="flex items-center gap-1.5"><span className="text-blue-600 font-bold w-4 text-center">□</span> Left (masked)</div>
              <div className="flex items-center gap-1.5"><span className="text-green-700 font-bold w-4 text-center">S</span> Soundfield</div>
              <div className="flex items-center gap-1.5"><span className="text-pink-700 font-bold w-4 text-center">A</span> Soundfield Aided</div>
              <div className="mt-0.5 pt-0.5 border-t border-gray-200 text-gray-500 italic">
                Right-click → NR · Delete · Clear
              </div>
            </div>
          </div>

          {/* Right: canvas */}
          <div className="flex-1 p-2 overflow-hidden">
            <div className="w-full h-full border border-gray-300 rounded bg-white">
              <SpeechAudiogramCanvas
                points={currentPoints}
                enabledChannels={enabledChannels}
                activeChannel={activeChannel}
                masked={inputMasked}
                onPlotPoint={(db, pct, opts) => addPoint(db, pct, opts)}
                onDeletePoint={deletePointAtDb}
                onClearChannel={clearChannel}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ============ SRT / SAT section ============ */}
      <SectionRow tag="SRT / SAT" subtitle="(Threshold, Head Phones, Spondaic Words, Unaided)">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          {/* Right SRT + Masked */}
          <div className="flex gap-2">
            <Field label="R"        labelColor={COL.R} testId="srt-r"        value={getF('srt_r')}        onChange={(v) => setF('srt_r', v)} />
            <Field label="Masked"   labelColor={COL.R} testId="srt-r-masked" value={getF('srt_r_masked')} onChange={(v) => setF('srt_r_masked', v)} />
          </div>
          {/* Left SRT + Masked */}
          <div className="flex gap-2">
            <Field label="L"        labelColor={COL.L} testId="srt-l"        value={getF('srt_l')}        onChange={(v) => setF('srt_l', v)} />
            <Field label="Masked"   labelColor={COL.L} testId="srt-l-masked" value={getF('srt_l_masked')} onChange={(v) => setF('srt_l_masked', v)} />
          </div>
          {/* Binaural R, L */}
          <div className="flex gap-2 items-end">
            <span className="text-[10px] font-semibold text-gray-700 mb-1.5 mr-1">Binaural</span>
            <Field label="R" labelColor={COL.R} testId="srt-bin-r" value={getF('srt_bin_r')} onChange={(v) => setF('srt_bin_r', v)} />
            <Field label="L" labelColor={COL.L} testId="srt-bin-l" value={getF('srt_bin_l')} onChange={(v) => setF('srt_bin_l', v)} />
          </div>
          {/* SAT R / L / SF / SFA */}
          <div className="flex gap-2">
            <Field label="SAT R"   labelColor={COL.R}  testId="sat-r"   value={getF('sat_r')}   onChange={(v) => setF('sat_r', v)} />
            <Field label="SAT L"   labelColor={COL.L}  testId="sat-l"   value={getF('sat_l')}   onChange={(v) => setF('sat_l', v)} />
            <Field label="SAT SF"  labelColor="text-green-700"  testId="sat-sf"  value={getF('sat_sf')}  onChange={(v) => setF('sat_sf', v)} />
            <Field label="SAT SFA" labelColor="text-pink-700" testId="sat-sfa" value={getF('sat_sfa')} onChange={(v) => setF('sat_sfa', v)} />
          </div>
        </div>

        {/* DiscrimList / Voice Type / Reliability */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 pt-3 border-t border-gray-200">
          <label className="flex items-center gap-2 text-[11px] text-gray-700">
            <span className="font-semibold">DiscrimList</span>
            <input type="text" value={getF('discrim_list')} onChange={(e) => setF('discrim_list', e.target.value)} data-testid="speech-discrim-list" className="w-32 text-xs border border-gray-300 rounded px-1.5 py-0.5" />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-gray-700">
            <span className="font-semibold">Voice Type</span>
            <input type="text" value={getF('voice_type')} onChange={(e) => setF('voice_type', e.target.value)} data-testid="speech-voice-type" className="w-32 text-xs border border-gray-300 rounded px-1.5 py-0.5" />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-gray-700 ml-auto">
            <span className="font-semibold">Speech Test Reliability</span>
            <select value={getF('reliability') || 'Good'} onChange={(e) => setF('reliability', e.target.value)} data-testid="speech-reliability" className="text-xs border border-gray-300 rounded px-1.5 py-0.5">
              <option>Good</option>
              <option>Fair</option>
              <option>Poor</option>
            </select>
          </label>
        </div>
      </SectionRow>

      {/* ============ WR — Word Recognition ============ */}
      <SectionRow tag="WR" subtitle="(Discrimination, Head Phones, Phonetically Balanced · Word Recognition Quiet)">
        <div className="grid grid-cols-3 gap-6">
          {[
            { side: 'r',   sideLabel: 'R',        colorHeader: COL.R, rowTagColor: COL.U },
            { side: 'l',   sideLabel: 'L',        colorHeader: COL.L, rowTagColor: COL.U },
            { side: 'bin', sideLabel: 'Binaural', colorHeader: 'text-gray-700', rowTagColor: COL.U },
          ].map((col) => (
            <div key={col.side} className="space-y-1.5">
              {/* Column headers: %, dB, Masked */}
              <div className="flex items-end gap-1.5 pl-[88px]">
                <div className={`w-16 text-center text-[10px] font-semibold ${col.colorHeader}`}>%</div>
                <div className={`w-16 text-center text-[10px] font-semibold ${col.colorHeader}`}>dB</div>
                <div className={`w-16 text-center text-[10px] font-semibold ${col.colorHeader}`}>Masked</div>
              </div>
              {/* 3 rows: Unaided / Aided / PIPB Unaided */}
              {[
                { key: 'unaided', label: 'Unaided',      color: COL.U },
                { key: 'aided',   label: 'Aided',        color: COL.A },
                { key: 'pipb',    label: 'PIPB Unaided', color: COL.PIPB },
              ].map((row) => (
                <div key={row.key} className="flex items-center gap-1.5">
                  <div className={`w-[88px] text-right text-[11px] font-semibold ${row.color}`}>
                    <span>{row.label} </span>
                    <span className={col.colorHeader}>{col.sideLabel}</span>
                  </div>
                  <input type="text" value={getF(`wr_${row.key}_${col.side}_pct`)}    onChange={(e) => setF(`wr_${row.key}_${col.side}_pct`, e.target.value)}    data-testid={`wr-${row.key}-${col.side}-pct`}    className="w-16 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
                  <input type="text" value={getF(`wr_${row.key}_${col.side}_db`)}     onChange={(e) => setF(`wr_${row.key}_${col.side}_db`, e.target.value)}     data-testid={`wr-${row.key}-${col.side}-db`}     className="w-16 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
                  <input type="text" value={getF(`wr_${row.key}_${col.side}_masked`)} onChange={(e) => setF(`wr_${row.key}_${col.side}_masked`, e.target.value)} data-testid={`wr-${row.key}-${col.side}-masked`} className="w-16 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </SectionRow>

      {/* ============ WRN — Word Recognition in Noise ============ */}
      <SectionRow tag="WRN" subtitle="Discrimination, Head Phones, Phonetically Balanced, Unaided">
        <div className="grid grid-cols-3 gap-6">
          {[
            { side: 'r',   sideLabel: 'R',        color: COL.R },
            { side: 'l',   sideLabel: 'L',        color: COL.L },
            { side: 'bin', sideLabel: 'Binaural', color: 'text-gray-700' },
          ].map((col) => (
            <div key={col.side} className="space-y-1.5">
              <div className="flex items-end gap-1.5 pl-14">
                <div className={`w-16 text-center text-[10px] font-semibold ${col.color}`}>%</div>
                <div className={`w-16 text-center text-[10px] font-semibold ${col.color}`}>dB</div>
                <div className={`w-16 text-center text-[10px] font-semibold ${col.color}`}>Noise</div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-14 text-right text-[11px] font-semibold ${col.color}`}>{col.sideLabel}</div>
                <input type="text" value={getF(`wrn_${col.side}_pct`)}   onChange={(e) => setF(`wrn_${col.side}_pct`, e.target.value)}   data-testid={`wrn-${col.side}-pct`}   className="w-16 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
                <input type="text" value={getF(`wrn_${col.side}_db`)}    onChange={(e) => setF(`wrn_${col.side}_db`, e.target.value)}    data-testid={`wrn-${col.side}-db`}    className="w-16 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
                <input type="text" value={getF(`wrn_${col.side}_noise`)} onChange={(e) => setF(`wrn_${col.side}_noise`, e.target.value)} data-testid={`wrn-${col.side}-noise`} className="w-16 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
              </div>
            </div>
          ))}
        </div>
      </SectionRow>

      {/* ============ MCL / Quick SIN / UCL-LDL ============ */}
      <SectionRow tag="MCL / UCL" subtitle="">
        <div className="grid grid-cols-3 gap-6">

          {/* MCL */}
          <div className="border border-gray-200 rounded p-2 bg-gray-50">
            <div className="text-[11px] font-semibold text-gray-600 mb-1">(Most Comfortable Level)</div>
            <div className="flex gap-2">
              <Field label="R"        labelColor={COL.R}   testId="mcl-r"     value={getF('mcl_r')}     onChange={(v) => setF('mcl_r', v)} />
              <Field label="L"        labelColor={COL.L}   testId="mcl-l"     value={getF('mcl_l')}     onChange={(v) => setF('mcl_l', v)} />
              <Field label="Binaural" labelColor={COL.Bin} testId="mcl-bin-1" value={getF('mcl_bin_1')} onChange={(v) => setF('mcl_bin_1', v)} />
              <Field label="Binaural" labelColor={COL.Bin} testId="mcl-bin-2" value={getF('mcl_bin_2')} onChange={(v) => setF('mcl_bin_2', v)} />
            </div>
            <div className="mt-2 bg-gray-700 text-white text-[10px] font-bold text-center py-0.5 rounded-sm">MCL</div>
          </div>

          {/* Quick SIN */}
          <div className="border border-gray-200 rounded p-2 bg-gray-50">
            <div className="flex items-end gap-2 text-[10px] font-semibold text-gray-600 mb-0.5 pl-10">
              <div className={`w-12 text-center ${COL.R}`}>R</div>
              <div className="w-12 text-center">Binaural</div>
              <div className={`w-12 text-center ${COL.L}`}>L</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-10 text-[10px] font-semibold text-gray-600 text-right">Score</div>
              <input type="text" value={getF('qsin_r_score')}   onChange={(e) => setF('qsin_r_score', e.target.value)}   data-testid="qsin-r-score"   className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
              <input type="text" value={getF('qsin_bin_score')} onChange={(e) => setF('qsin_bin_score', e.target.value)} data-testid="qsin-bin-score" className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
              <input type="text" value={getF('qsin_l_score')}   onChange={(e) => setF('qsin_l_score', e.target.value)}   data-testid="qsin-l-score"   className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-10 text-[10px] font-semibold text-gray-600 text-right">Level</div>
              <input type="text" value={getF('qsin_r_level')}   onChange={(e) => setF('qsin_r_level', e.target.value)}   data-testid="qsin-r-level"   className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
              <input type="text" value={getF('qsin_bin_level')} onChange={(e) => setF('qsin_bin_level', e.target.value)} data-testid="qsin-bin-level" className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
              <input type="text" value={getF('qsin_l_level')}   onChange={(e) => setF('qsin_l_level', e.target.value)}   data-testid="qsin-l-level"   className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5 text-center" />
            </div>
            <div className="mt-2 bg-gray-700 text-white text-[10px] font-bold text-center py-0.5 rounded-sm">Quick SIN</div>
          </div>

          {/* UCL / LDL */}
          <div className="border border-gray-200 rounded p-2 bg-gray-50">
            <div className="text-[11px] font-semibold text-gray-600 mb-1">Uncomfortable Level</div>
            <div className="flex gap-2">
              <Field label="R"        labelColor={COL.R}   testId="ucl-r"     value={getF('ucl_r')}     onChange={(v) => setF('ucl_r', v)} />
              <Field label="L"        labelColor={COL.L}   testId="ucl-l"     value={getF('ucl_l')}     onChange={(v) => setF('ucl_l', v)} />
              <Field label="Binaural" labelColor={COL.Bin} testId="ucl-bin-1" value={getF('ucl_bin_1')} onChange={(v) => setF('ucl_bin_1', v)} />
              <Field label="Binaural" labelColor={COL.Bin} testId="ucl-bin-2" value={getF('ucl_bin_2')} onChange={(v) => setF('ucl_bin_2', v)} />
            </div>
            <div className="mt-2 bg-gray-700 text-white text-[10px] font-bold text-center py-0.5 rounded-sm">UCL / LDL</div>
          </div>

        </div>
      </SectionRow>
    </div>
  );
};

export default SpeechPanel;
