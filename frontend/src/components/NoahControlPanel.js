import React from 'react';

const NoahControlPanel = ({ activeTest, onTestChange, masked, onMaskedToggle, rightEarData, leftEarData }) => {
  const thresholdTypes = [
    { id: 'htl', label: 'HTL', leftSymbol: 'X', rightSymbol: 'O', leftTest: 'ac_left', rightTest: 'ac_right', leftNR: 'ac_left_nr', rightNR: 'ac_right_nr' },
    { id: 'bcl', label: 'BCL', leftSymbol: '>', rightSymbol: '<', leftTest: 'bc_left', rightTest: 'bc_right', leftNR: 'bc_left_nr', rightNR: 'bc_right_nr' },
    { id: 'mcl', label: 'MCL', leftSymbol: 'M', rightSymbol: 'M', leftTest: 'mcl_left', rightTest: 'mcl_right', leftNR: 'mcl_left_nr', rightNR: 'mcl_right_nr' },
    { id: 'ucl', label: 'UCL', leftSymbol: 'J', rightSymbol: 'L', leftTest: 'ucl_left', rightTest: 'ucl_right', leftNR: 'ucl_left_nr', rightNR: 'ucl_right_nr' },
    { id: 'ff', label: 'FF', leftSymbol: 'X', rightSymbol: 'O', leftTest: 'ff_left', rightTest: 'ff_right', leftNR: 'ff_left_nr', rightNR: 'ff_right_nr' },
    { id: 'ffa', label: 'FF-A', leftSymbol: '◊', rightSymbol: '◊', leftTest: 'ffa_left', rightTest: 'ffa_right', leftNR: 'ffa_left_nr', rightNR: 'ffa_right_nr' },
  ];

  // Calculate HTL and BCL averages
  const calculateAverage = (data, measurementType, frequencies) => {
    if (!data || !data[measurementType]) return '--';
    
    const measurements = data[measurementType].filter(m => 
      frequencies.includes(m.frequency) && 
      m.threshold_db !== null && 
      m.threshold_db !== undefined
    );
    
    if (measurements.length === 0) return '--';
    
    const sum = measurements.reduce((acc, m) => acc + m.threshold_db, 0);
    const avg = Math.round(sum / measurements.length);
    return avg;
  };

  const rightHTL = calculateAverage(rightEarData, 'ac_measurements', [500, 1000, 2000]);
  const rightBCL = calculateAverage(rightEarData, 'bc_measurements', [500, 1000, 2000]);
  const leftHTL = calculateAverage(leftEarData, 'ac_measurements', [500, 1000, 2000]);
  const leftBCL = calculateAverage(leftEarData, 'bc_measurements', [500, 1000, 2000]);

  return (
    <div className="flex flex-col items-center justify-start gap-0 px-2 py-3 bg-gray-100 border-x border-gray-300" style={{ width: '160px' }}>
      {thresholdTypes.map((type) => (
        <div key={type.id} className="flex items-center gap-0 mb-1 bg-white border border-gray-300 rounded">
          {/* NR Left */}
          <button
            onClick={() => onTestChange(type.leftNR)}
            className={`px-1 py-1 text-[10px] font-bold border-r border-gray-300 ${
              activeTest === type.leftNR ? 'bg-blue-200 text-blue-700' : 'text-gray-500 hover:bg-gray-50'
            }`}
            style={{ minWidth: '22px' }}
            title="No Response Left"
          >
            NR
          </button>
          
          {/* Response Left */}
          <button
            onClick={() => onTestChange(type.leftTest)}
            className={`px-1.5 py-1 text-[10px] font-bold border-r border-gray-300 ${
              activeTest === type.leftTest ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
            }`}
            style={{ minWidth: '20px' }}
          >
            {type.leftSymbol}
          </button>
          
          {/* Test Label */}
          <div className="px-2 py-1 text-[10px] font-semibold text-gray-700 bg-gray-50" style={{ minWidth: '38px', textAlign: 'center' }}>
            {type.label}
          </div>
          
          {/* Response Right */}
          <button
            onClick={() => onTestChange(type.rightTest)}
            className={`px-1.5 py-1 text-[10px] font-bold border-l border-gray-300 ${
              activeTest === type.rightTest ? 'bg-red-100 text-red-600' : 'text-gray-600 hover:bg-gray-50'
            }`}
            style={{ minWidth: '20px' }}
          >
            {type.rightSymbol}
          </button>
          
          {/* NR Right */}
          <button
            onClick={() => onTestChange(type.rightNR)}
            className={`px-1 py-1 text-[10px] font-bold border-l border-gray-300 ${
              activeTest === type.rightNR ? 'bg-red-200 text-red-700' : 'text-gray-500 hover:bg-gray-50'
            }`}
            style={{ minWidth: '22px' }}
            title="No Response Right"
          >
            NR
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
      
      {/* PTA Average Box */}
      <div className="w-full mt-3 bg-white border border-gray-400 rounded shadow-sm p-1.5 text-[10px]">
        <div className="text-[10px] font-bold text-gray-700 mb-1 text-center pb-0.5 border-b border-gray-300">
          PTA
        </div>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left pb-0.5 font-semibold text-gray-600"></th>
              <th className="text-center pb-0.5 font-semibold text-gray-700">HTL</th>
              <th className="text-center pb-0.5 font-semibold text-gray-700">BCL</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-0.5 font-medium text-red-600">R</td>
              <td className="text-center py-0.5 font-mono text-[10px]">{rightHTL}</td>
              <td className="text-center py-0.5 font-mono text-[10px]">{rightBCL}</td>
            </tr>
            <tr>
              <td className="py-0.5 font-medium text-blue-600">L</td>
              <td className="text-center py-0.5 font-mono text-[10px]">{leftHTL}</td>
              <td className="text-center py-0.5 font-mono text-[10px]">{leftBCL}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default NoahControlPanel;
