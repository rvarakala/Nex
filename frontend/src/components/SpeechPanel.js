import React, { useState } from 'react';
import SpeechAudiogramCanvas from './SpeechAudiogramCanvas';

const COLUMNS = [
  { key: 'sat', label: 'SAT' },
  { key: 'srt', label: 'SRT' },
  { key: 'masking', label: 'Masking' },
  { key: 'mcl', label: 'MCL' },
  { key: 'ucl', label: 'UCL' },
];

const ROWS = [
  { key: 'right', label: 'Right', color: 'text-red-600' },
  { key: 'left', label: 'Left', color: 'text-blue-600' },
  { key: 'soundfield', label: 'Soundfield', color: 'text-green-700' },
  { key: 'soundfield_aided', label: 'Soundfield Aided', color: 'text-pink-700' },
];

const CHANNEL_LABEL = {
  right: 'Right',
  left: 'Left',
  soundfield: 'Soundfield',
  soundfield_aided: 'Soundfield Aided',
};

const DEFAULT_ROW = { sat: null, srt: null, masking: null, mcl: null, ucl: null };

// Merge incoming data with defaults so undefined keys don't crash the UI.
const normalize = (data) => ({
  right: { ...DEFAULT_ROW, ...(data?.right || {}) },
  left: { ...DEFAULT_ROW, ...(data?.left || {}) },
  soundfield: { ...DEFAULT_ROW, ...(data?.soundfield || {}) },
  soundfield_aided: { ...DEFAULT_ROW, ...(data?.soundfield_aided || {}) },
  wrs_right: data?.wrs_right || [],
  wrs_left: data?.wrs_left || [],
  wrs_soundfield: data?.wrs_soundfield || [],
  wrs_soundfield_aided: data?.wrs_soundfield_aided || [],
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

  const updateCell = (row, col, value) => {
    onChange({ ...speech, [row]: { ...speech[row], [col]: value || null } });
  };

  const wrsKey = (channel) => `wrs_${channel}`;
  const currentPoints = {
    right: speech.wrs_right,
    left: speech.wrs_left,
    soundfield: speech.wrs_soundfield,
    soundfield_aided: speech.wrs_soundfield_aided,
  };

  const addPoint = (dbHl, percent, masked = false) => {
    const key = wrsKey(activeChannel);
    const next = [...(speech[key] || []), { db_hl: Number(dbHl), percent: Number(percent), masked }];
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
    addPoint(db, pct, inputMasked);
    setInputDb('');
    setInputPct('');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3 space-y-3">
      {/* ============ TOP: Speech Audiometry table ============ */}
      <div className="bg-white border border-gray-300 rounded shadow-sm">
        <div className="bg-gray-100 border-b border-gray-300 px-3 py-1.5">
          <h3 className="text-sm font-bold text-gray-800 text-center">Speech Audiometry</h3>
        </div>
        <table className="w-full text-sm" data-testid="speech-table">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-300">
              <th className="px-2 py-1.5 text-left text-xs font-bold text-gray-700 w-40"></th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-1.5 text-xs font-bold text-gray-700 text-center">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key} className="border-b border-gray-200">
                <td className={`px-2 py-1 text-xs font-bold ${r.color}`}>{r.label}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-1 py-0.5">
                    <input
                      type="text"
                      value={speech[r.key][c.key] ?? ''}
                      onChange={(e) => updateCell(r.key, c.key, e.target.value)}
                      data-testid={`speech-${r.key}-${c.key}`}
                      className="w-full text-sm border border-gray-200 rounded px-1.5 py-0.5 text-center focus:outline-none focus:border-blue-500"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ============ BOTTOM: Speech Audiogram (WRS curve) ============ */}
      <div className="bg-white border border-gray-300 rounded shadow-sm flex-1 flex flex-col min-h-0">
        <div className="bg-gray-100 border-b border-gray-300 px-3 py-1.5 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">Speech Audiogram (% vs dB HL)</h3>
          <div className="text-[10px] text-gray-500 italic">Click chart to add point · drag sliders to adjust</div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left: controls */}
          <div className="w-[220px] flex-shrink-0 border-r border-gray-200 p-2 space-y-2 overflow-auto">
            {/* Active channel selector */}
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

            {/* Visible channels */}
            <div>
              <div className="text-[10px] font-bold text-gray-600 mb-1">Show on chart</div>
              <div className="space-y-0.5">
                {ROWS.map((r) => (
                  <label key={r.key} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledChannels[r.key]}
                      onChange={(e) =>
                        setEnabledChannels((s) => ({ ...s, [r.key]: e.target.checked }))
                      }
                      data-testid={`speech-show-${r.key}`}
                      className="w-3.5 h-3.5"
                    />
                    <span className={r.color}>{r.label}</span>
                    <span className="ml-auto text-[9px] text-gray-400">
                      {(currentPoints[r.key] || []).length}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Add-point form */}
            <div className="border-t border-gray-200 pt-2">
              <div className="text-[10px] font-bold text-gray-600 mb-1">
                Add point → <span className="text-blue-700">{CHANNEL_LABEL[activeChannel]}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <label className="text-[10px] text-gray-600">
                  dB HL
                  <input
                    type="number"
                    value={inputDb}
                    onChange={(e) => setInputDb(e.target.value)}
                    data-testid="speech-input-db"
                    className="w-full text-xs border border-gray-300 rounded px-1 py-0.5 mt-0.5"
                    step="5"
                  />
                </label>
                <label className="text-[10px] text-gray-600">
                  % Score
                  <input
                    type="number"
                    value={inputPct}
                    onChange={(e) => setInputPct(e.target.value)}
                    data-testid="speech-input-pct"
                    className="w-full text-xs border border-gray-300 rounded px-1 py-0.5 mt-0.5"
                    step="5"
                  />
                </label>
              </div>
              <label className="flex items-center gap-1 text-[10px] mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inputMasked}
                  onChange={(e) => setInputMasked(e.target.checked)}
                  data-testid="speech-input-masked"
                  className="w-3 h-3"
                />
                Masked
              </label>
              <button
                type="button"
                onClick={handleManualAdd}
                data-testid="speech-add-btn"
                className="w-full mt-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold py-1 rounded"
              >
                + Add point
              </button>
              <div className="grid grid-cols-2 gap-1 mt-1">
                <button
                  type="button"
                  onClick={removeLastPoint}
                  data-testid="speech-undo-btn"
                  className="text-[10px] border border-gray-300 rounded py-0.5 hover:bg-gray-100"
                >
                  Undo last
                </button>
                <button
                  type="button"
                  onClick={clearChannel}
                  data-testid="speech-clear-btn"
                  className="text-[10px] border border-red-300 text-red-600 rounded py-0.5 hover:bg-red-50"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="border-t border-gray-200 pt-2 text-[10px] text-gray-600 space-y-0.5">
              <div className="font-bold text-gray-700 mb-0.5">Legend</div>
              <div><span className="text-red-600 font-bold">○</span> Right</div>
              <div><span className="text-blue-600 font-bold">○</span> Left</div>
              <div><span className="text-green-700 font-bold">○</span> Soundfield</div>
              <div><span className="text-pink-700 font-bold">○</span> Soundfield Aided</div>
              <div className="pt-0.5 border-t border-gray-200 mt-0.5">
                Pink zone = beyond comfort (&gt;90 dB).
              </div>
            </div>
          </div>

          {/* Right: canvas */}
          <div className="flex-1 p-2 min-h-[340px]">
            <div className="w-full h-full border border-gray-300 rounded bg-white">
              <SpeechAudiogramCanvas
                points={currentPoints}
                enabledChannels={enabledChannels}
                activeChannel={activeChannel}
                onAddPoint={(db, pct) => addPoint(db, pct, inputMasked)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpeechPanel;
