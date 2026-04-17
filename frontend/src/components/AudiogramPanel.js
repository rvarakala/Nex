import React from 'react';
import AudiogramCanvas from './AudiogramCanvas';

const AudiogramPanel = ({ ear, data, onPlotPoint, activeMode, masked, onModeChange, onMaskedToggle }) => {
  const earLabel = ear.charAt(0).toUpperCase() + ear.slice(1);
  const textColor = ear === 'right' ? 'text-red-600' : 'text-blue-600';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      {/* Minimal Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className={`text-sm font-semibold ${textColor}`}>{earLabel} Ear</h3>
        {data?.pta_3freq && (
          <div className="text-xs text-gray-600">
            PTA: <span className="font-semibold text-gray-900">{data.pta_3freq} dB</span>
          </div>
        )}
      </div>
      
      <AudiogramCanvas
        ear={ear}
        data={data}
        onPlotPoint={onPlotPoint}
        activeMode={activeMode}
        masked={masked}
      />
      
      {/* Compact Mode Controls */}
      <div className="flex justify-center gap-2 mt-4">
        <button
          onClick={() => onModeChange('ac')}
          className={`px-3 py-1.5 text-xs rounded transition-all ${
            activeMode === 'ac'
              ? 'bg-blue-500 text-white font-medium'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          AC
        </button>
        <button
          onClick={() => onModeChange('bc')}
          className={`px-3 py-1.5 text-xs rounded transition-all ${
            activeMode === 'bc'
              ? 'bg-blue-500 text-white font-medium'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          BC
        </button>
        <button
          onClick={onMaskedToggle}
          className={`px-3 py-1.5 text-xs rounded transition-all ${
            masked
              ? 'bg-yellow-500 text-white font-medium'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Masked
        </button>
      </div>
    </div>
  );
};

export default AudiogramPanel;