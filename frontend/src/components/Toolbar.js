import React from 'react';

const Toolbar = ({ viewMode, onViewModeChange, reliability, onReliabilityChange }) => {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center">
      {/* Minimal View Mode Toggle */}
      <div className="flex gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium mr-2">View:</span>
        <button
          onClick={() => onViewModeChange('standard')}
          className={`px-3 py-1.5 text-xs rounded transition-all ${
            viewMode === 'standard'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Standard
        </button>
        <button
          onClick={() => onViewModeChange('speech_banana')}
          className={`px-3 py-1.5 text-xs rounded transition-all ${
            viewMode === 'speech_banana'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Speech Banana
        </button>
      </div>
      
      {/* Reliability Selector */}
      <div className="flex gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium mr-2">Reliability:</span>
        {['good', 'fair', 'poor'].map((option) => (
          <button
            key={option}
            onClick={() => onReliabilityChange(option)}
            className={`px-3 py-1.5 text-xs rounded capitalize transition-all ${
              reliability === option
                ? 'bg-green-500 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Toolbar;