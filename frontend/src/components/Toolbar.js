import React from 'react';

const Toolbar = ({ viewMode, onViewModeChange, reliability, onReliabilityChange }) => {
  const viewModes = [
    { id: 'standard', label: '📊 Standard View' },
    { id: 'speech_banana', label: '🍌 Speech Banana' },
    { id: 'hearing_loss', label: '📈 Hearing Loss' },
    { id: 'audibility', label: '🔊 Audibility Index' },
  ];

  const reliabilityOptions = ['good', 'fair', 'poor'];

  return (
    <div className="bg-gray-50 border-b border-gray-300 px-4 py-2 flex gap-2 items-center flex-wrap">
      {viewModes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onViewModeChange(mode.id)}
          className={`
            px-3 py-1.5 border rounded text-xs font-medium transition-all
            ${viewMode === mode.id
              ? 'bg-blue-500 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }
          `}
        >
          {mode.label}
        </button>
      ))}
      
      <div className="w-px h-5 bg-gray-300 mx-1"></div>
      
      <button className="px-3 py-1.5 border border-gray-300 bg-white rounded text-xs hover:bg-gray-100">
        ↩️ Undo
      </button>
      <button className="px-3 py-1.5 border border-gray-300 bg-white rounded text-xs hover:bg-gray-100">
        ↪️ Redo
      </button>
      <button className="px-3 py-1.5 border border-gray-300 bg-white rounded text-xs hover:bg-gray-100">
        🗑️ Clear
      </button>
      
      <div className="w-px h-5 bg-gray-300 mx-1"></div>
      
      <span className="text-xs text-gray-600 font-medium">Test Reliability:</span>
      {reliabilityOptions.map((option) => (
        <button
          key={option}
          onClick={() => onReliabilityChange(option)}
          className={`
            px-3 py-1.5 border rounded text-xs font-medium capitalize transition-all
            ${reliability === option
              ? 'bg-blue-500 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }
          `}
        >
          {option}
        </button>
      ))}
    </div>
  );
};

export default Toolbar;