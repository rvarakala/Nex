import React from 'react';
import AudiogramCanvas from './AudiogramCanvas';

const AudiogramPanel = ({ ear, data, onPlotPoint, activeMode, masked, onModeChange, onMaskedToggle }) => {
  const colors = {
    right: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
    left: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  };

  const color = colors[ear];
  const earLabel = ear.charAt(0).toUpperCase() + ear.slice(1);

  return (
    <div className="bg-white border border-gray-300 rounded shadow-sm p-4">
      <div className={`text-center font-semibold mb-3 py-2 rounded ${color.bg} ${color.text}`}>
        {earLabel} EAR
      </div>
      
      <AudiogramCanvas
        ear={ear}
        data={data}
        onPlotPoint={onPlotPoint}
        activeMode={activeMode}
        masked={masked}
      />
      
      <div className="flex justify-center gap-2 mt-3 flex-wrap">
        <button
          onClick={() => onModeChange('ac')}
          className={`
            px-3 py-1.5 border rounded text-xs font-medium transition-all
            ${activeMode === 'ac'
              ? 'bg-blue-500 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }
          `}
        >
          🎧 AC Mode
        </button>
        <button
          onClick={() => onModeChange('bc')}
          className={`
            px-3 py-1.5 border rounded text-xs font-medium transition-all
            ${activeMode === 'bc'
              ? 'bg-blue-500 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }
          `}
        >
          ⚡ BC Mode
        </button>
        <button
          onClick={onMaskedToggle}
          className={`
            px-3 py-1.5 border rounded text-xs font-medium transition-all
            ${masked
              ? 'bg-yellow-500 text-white border-yellow-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }
          `}
        >
          {ear === 'right' ? '△' : '□'} Masked
        </button>
        <button className="px-3 py-1.5 border border-gray-300 bg-white rounded text-xs hover:bg-gray-100">
          ↓ No Response
        </button>
      </div>
      
      {data && (
        <div className="mt-3 text-center text-xs text-gray-600">
          PTA: {data.pta_3freq ? `${data.pta_3freq} dB` : 'Not calculated'}
        </div>
      )}
    </div>
  );
};

export default AudiogramPanel;