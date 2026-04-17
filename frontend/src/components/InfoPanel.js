import React from 'react';

const InfoPanel = ({ rightEarData, leftEarData, notes, onNotesChange }) => {
  const calculatePTA = (data) => {
    if (!data || !data.ac_measurements) return null;
    
    const freqs = [500, 1000, 2000];
    const measurements = {};
    
    data.ac_measurements.forEach(m => {
      if (m.threshold_db !== null && freqs.includes(m.frequency)) {
        measurements[m.frequency] = m.threshold_db;
      }
    });
    
    if (Object.keys(measurements).length === 3) {
      const avg = (measurements[500] + measurements[1000] + measurements[2000]) / 3;
      return Math.round(avg * 10) / 10;
    }
    
    return null;
  };

  const classifyDegree = (pta) => {
    if (!pta) return 'Unknown';
    if (pta <= 15) return 'Normal';
    if (pta <= 25) return 'Slight';
    if (pta <= 40) return 'Mild';
    if (pta <= 55) return 'Moderate';
    if (pta <= 70) return 'Moderately Severe';
    if (pta <= 90) return 'Severe';
    return 'Profound';
  };

  const rightPTA = calculatePTA(rightEarData);
  const leftPTA = calculatePTA(leftEarData);

  return (
    <div className="w-72 bg-gray-50 border-l border-gray-300 overflow-y-auto">
      {/* Legends */}
      <div className="p-4 border-b border-gray-300">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-3 tracking-wide">
          Legends
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-red-600 font-bold text-base">⭕</span>
            <span>AC - Right</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-red-600 font-bold text-base">◁</span>
            <span>BC - Right</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-red-600 font-bold text-base">△</span>
            <span>AC Masked - R</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-blue-600 font-bold text-base">✖️</span>
            <span>AC - Left</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-blue-600 font-bold text-base">▷</span>
            <span>BC - Left</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-blue-600 font-bold text-base">□</span>
            <span>AC Masked - L</span>
          </div>
        </div>
      </div>

      {/* Current Measurement */}
      <div className="p-4 border-b border-gray-300">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-3 tracking-wide">
          Current Measurement
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-600">Transducer:</span>
            <span className="font-semibold">Headphones</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Mode:</span>
            <span className="font-semibold">AC Unmasked</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Time:</span>
            <span className="font-semibold">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* Calculations */}
      <div className="p-4 border-b border-gray-300">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-3 tracking-wide">
          Calculations (PTA)
        </div>
        
        <div className="bg-white p-3 rounded border-l-3 border-red-500 mb-3">
          <div className="font-semibold text-red-600 mb-1.5 text-sm">Right Ear</div>
          <div className="flex justify-between items-center">
            <span className="text-xs">3-Freq PTA:</span>
            <span className="font-bold text-lg">{rightPTA ? `${rightPTA} dB` : '--'}</span>
          </div>
          {rightPTA && (
            <div className="text-xs text-gray-600 mt-1">{classifyDegree(rightPTA)}</div>
          )}
        </div>
        
        <div className="bg-white p-3 rounded border-l-3 border-blue-500">
          <div className="font-semibold text-blue-600 mb-1.5 text-sm">Left Ear</div>
          <div className="flex justify-between items-center">
            <span className="text-xs">3-Freq PTA:</span>
            <span className="font-bold text-lg">{leftPTA ? `${leftPTA} dB` : '--'}</span>
          </div>
          {leftPTA && (
            <div className="text-xs text-gray-600 mt-1">{classifyDegree(leftPTA)}</div>
          )}
        </div>
      </div>

      {/* Assistant */}
      <div className="p-4 border-b border-gray-300">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-3 tracking-wide">
          Assistant
        </div>
        <div className="bg-blue-50 border border-blue-200 p-3 rounded text-xs">
          <div className="font-semibold text-blue-700 mb-2">💡 Suggestions</div>
          <ul className="space-y-1 text-blue-900">
            <li>• Click on audiogram to plot thresholds</li>
            <li>• Use mode buttons to switch AC/BC</li>
            <li>• Enable masking when needed</li>
          </ul>
        </div>
      </div>

      {/* Notes */}
      <div className="p-4">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-3 tracking-wide">
          Clinical Notes
        </div>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Type clinical notes here..."
          className="w-full min-h-24 p-2 border border-gray-300 rounded text-xs resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
};

export default InfoPanel;