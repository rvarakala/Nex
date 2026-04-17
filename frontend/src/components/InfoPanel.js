import React, { useState } from 'react';

const InfoPanel = ({ rightEarData, leftEarData, notes, onNotesChange }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
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
    if (pta <= 70) return 'Mod-Severe';
    if (pta <= 90) return 'Severe';
    return 'Profound';
  };

  const rightPTA = calculatePTA(rightEarData);
  const leftPTA = calculatePTA(leftEarData);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-12 bg-white border-l border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-center"
      >
        <span className="transform -rotate-90 text-xs text-gray-500">Info</span>
      </button>
    );
  }

  return (
    <div className="w-64 bg-white border-l border-gray-200 flex flex-col">
      {/* Header with collapse button */}
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-700">Summary</h3>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-gray-400 hover:text-gray-600 text-lg"
        >
          ›
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Compact PTA Calculations */}
        <div className="p-4 space-y-3">
          <div className="bg-red-50 border-l-3 border-red-500 p-3 rounded">
            <div className="text-xs text-red-600 font-medium mb-1">Right Ear</div>
            <div className="text-lg font-bold text-gray-900">
              {rightPTA ? `${rightPTA} dB` : '--'}
            </div>
            {rightPTA && (
              <div className="text-xs text-gray-600 mt-1">{classifyDegree(rightPTA)}</div>
            )}
          </div>
          
          <div className="bg-blue-50 border-l-3 border-blue-500 p-3 rounded">
            <div className="text-xs text-blue-600 font-medium mb-1">Left Ear</div>
            <div className="text-lg font-bold text-gray-900">
              {leftPTA ? `${leftPTA} dB` : '--'}
            </div>
            {leftPTA && (
              <div className="text-xs text-gray-600 mt-1">{classifyDegree(leftPTA)}</div>
            )}
          </div>
        </div>

        {/* Compact Legend */}
        <div className="px-4 pb-4">
          <div className="text-xs font-semibold text-gray-500 mb-2">Symbols</div>
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="text-red-600 font-bold">⭕</span> AC Right
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-600 font-bold">✖️</span> AC Left
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-600 font-bold">◁</span> BC Right
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-600 font-bold">▷</span> BC Left
            </div>
          </div>
        </div>

        {/* Compact Notes */}
        <div className="px-4 pb-4">
          <label className="text-xs font-semibold text-gray-500 mb-2 block">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Clinical notes..."
            className="w-full h-24 p-2 border border-gray-300 rounded text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
};

export default InfoPanel;