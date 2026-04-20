import React from 'react';

const NoahControlPanel = ({ activeTest, onTestChange, masked, onMaskedToggle }) => {
  const thresholdTypes = [
    { id: 'htl', label: 'HTL', leftSymbol: 'O', rightSymbol: 'X', leftTest: 'ac_right', rightTest: 'ac_left' },
    { id: 'bcl', label: 'BCL', leftSymbol: '<', rightSymbol: '>', leftTest: 'bc_right', rightTest: 'bc_left' },
    { id: 'mcl', label: 'MCL', leftSymbol: 'M', rightSymbol: 'M', leftTest: 'mcl_right', rightTest: 'mcl_left' },
    { id: 'ucl', label: 'UCL', leftSymbol: 'L', rightSymbol: 'J', leftTest: 'ucl_right', rightTest: 'ucl_left' },
    { id: 'ff', label: 'FF', leftSymbol: 'O', rightSymbol: 'X', leftTest: 'ff_right', rightTest: 'ff_left' },
    { id: 'ffa', label: 'FF-A', leftSymbol: '◊', rightSymbol: '◊', leftTest: 'ffa_right', rightTest: 'ffa_left' },
  ];

  return (
    <div className="flex flex-col items-center justify-start gap-0 px-2 py-3 bg-gray-100 border-x border-gray-300 w-20">
      {thresholdTypes.map((type) => (
        <div key={type.id} className="flex items-center gap-0 mb-1 bg-white border border-gray-300 rounded">
          <button
            onClick={() => onTestChange(type.leftTest)}
            className={`px-1.5 py-1 text-xs font-bold border-r border-gray-300 ${
              activeTest === type.leftTest ? 'bg-red-100 text-red-600' : 'text-gray-600 hover:bg-gray-50'
            }`}
            style={{ minWidth: '20px' }}
          >
            {type.leftSymbol}
          </button>
          <div className="px-2 py-1 text-[10px] font-semibold text-gray-700 bg-gray-50" style={{ minWidth: '35px', textAlign: 'center' }}>
            {type.label}
          </div>
          <button
            onClick={() => onTestChange(type.rightTest)}
            className={`px-1.5 py-1 text-xs font-bold border-l border-gray-300 ${
              activeTest === type.rightTest ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
            }`}
            style={{ minWidth: '20px' }}
          >
            {type.rightSymbol}
          </button>
        </div>
      ))}
      
      <div className="my-2 w-full border-t border-gray-300"></div>
      
      <button
        onClick={onMaskedToggle}
        className={`w-full px-2 py-1.5 text-[10px] font-medium rounded border ${
          masked
            ? 'bg-yellow-100 text-yellow-800 border-yellow-400'
            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
        }`}
      >
        Masked
      </button>
      
      <button
        className="w-full px-2 py-1.5 text-[10px] font-medium rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 mt-1"
      >
        Binaural
      </button>
    </div>
  );
};

export default NoahControlPanel;
