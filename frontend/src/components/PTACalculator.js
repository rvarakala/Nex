import React, { useMemo } from 'react';

const PTACalculator = ({ rightEarData, leftEarData }) => {
  // Calculate PTA1: Average of 500, 1000, 2000 Hz
  // Calculate PTA2: Average of 1000, 2000, 4000 Hz
  
  const calculatePTA = (data, frequencies) => {
    if (!data || !data.ac_measurements) return '--';
    
    const measurements = data.ac_measurements.filter(m => 
      frequencies.includes(m.frequency) && 
      m.threshold_db !== null && 
      m.threshold_db !== undefined
    );
    
    if (measurements.length === 0) return '--';
    
    const sum = measurements.reduce((acc, m) => acc + m.threshold_db, 0);
    const avg = Math.round(sum / measurements.length);
    return avg;
  };

  const rightPTA1 = useMemo(() => calculatePTA(rightEarData, [500, 1000, 2000]), [rightEarData]);
  const rightPTA2 = useMemo(() => calculatePTA(rightEarData, [1000, 2000, 4000]), [rightEarData]);
  const leftPTA1 = useMemo(() => calculatePTA(leftEarData, [500, 1000, 2000]), [leftEarData]);
  const leftPTA2 = useMemo(() => calculatePTA(leftEarData, [1000, 2000, 4000]), [leftEarData]);

  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white border-2 border-gray-400 rounded shadow-lg p-2 text-xs">
      <div className="text-[10px] font-bold text-gray-700 mb-1 text-center border-b pb-0.5">
        Pure Tone Average
      </div>
      <table className="text-[10px]">
        <thead>
          <tr className="border-b">
            <th className="text-left pr-2 pb-0.5 font-semibold text-gray-600"></th>
            <th className="text-center px-2 pb-0.5 font-semibold text-gray-600">PTA1</th>
            <th className="text-center px-2 pb-0.5 font-semibold text-gray-600">PTA2</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="py-0.5 pr-2 font-medium text-red-600 text-[9px]">Right</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{rightPTA1}</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{rightPTA2}</td>
          </tr>
          <tr>
            <td className="py-0.5 pr-2 font-medium text-blue-600 text-[9px]">Left</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{leftPTA1}</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{leftPTA2}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[8px] text-gray-500 mt-1 text-center border-t pt-0.5">
        <div>PTA1: 500,1K,2K | PTA2: 1K,2K,4K</div>
      </div>
    </div>
  );
};

export default PTACalculator;
