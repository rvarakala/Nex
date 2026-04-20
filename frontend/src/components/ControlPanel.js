import React from 'react';

const ControlPanel = ({ activeTest, onTestChange, masked, onMaskedToggle }) => {
  const tests = [
    { id: 'ac_right', label: 'AC - Right', color: 'red', symbol: 'O' },
    { id: 'ac_left', label: 'AC - Left', color: 'blue', symbol: 'X' },
    { id: 'bc_right', label: 'BC - Right', color: 'red', symbol: '<' },
    { id: 'bc_left', label: 'BC - Left', color: 'blue', symbol: '>' },
  ];

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-6 bg-gray-50 border-x border-gray-300">
      <div className="text-sm font-semibold text-gray-700 mb-2">Test Type</div>
      
      {tests.map((test) => (
        <button
          key={test.id}
          onClick={() => onTestChange(test.id)}
          className={`
            w-32 px-4 py-2.5 text-sm font-medium rounded
            transition-all duration-150
            ${
              activeTest === test.id
                ? test.color === 'red'
                  ? 'bg-red-500 text-white shadow-md'
                  : 'bg-blue-500 text-white shadow-md'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }
          `}
        >
          <span className="font-bold mr-2">{test.symbol}</span>
          {test.label}
        </button>
      ))}
      
      <div className="w-full border-t border-gray-300 my-2"></div>
      
      <button
        onClick={onMaskedToggle}
        className={`
          w-32 px-4 py-2.5 text-sm font-medium rounded
          transition-all duration-150
          ${
            masked
              ? 'bg-yellow-500 text-white shadow-md'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }
        `}
      >
        {masked ? '✓ Masked' : 'Masked'}
      </button>
    </div>
  );
};

export default ControlPanel;
