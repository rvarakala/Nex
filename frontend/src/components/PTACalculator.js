import React, { useMemo } from 'react';

const PTACalculator = ({ rightEarData, leftEarData }) => {
  // Calculate HTL (AC average) and BCL (BC average)
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

  // Calculate 3-frequency average (500, 1000, 2000 Hz)
  const rightHTL = useMemo(() => calculateAverage(rightEarData, 'ac_measurements', [500, 1000, 2000]), [rightEarData]);
  const rightBCL = useMemo(() => calculateAverage(rightEarData, 'bc_measurements', [500, 1000, 2000]), [rightEarData]);
  const leftHTL = useMemo(() => calculateAverage(leftEarData, 'ac_measurements', [500, 1000, 2000]), [leftEarData]);
  const leftBCL = useMemo(() => calculateAverage(leftEarData, 'bc_measurements', [500, 1000, 2000]), [leftEarData]);

  return (
    <div className="absolute bottom-3 right-3 bg-white border border-gray-400 rounded shadow-md p-2 text-[10px]">
      <div className="text-[10px] font-bold text-gray-700 mb-1 text-center pb-0.5 border-b border-gray-300">
        Pure Tone Average
      </div>
      <table className="text-[9px] mt-1">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="text-left pr-2 pb-0.5 font-normal text-gray-600"></th>
            <th className="text-center px-2 pb-0.5 font-semibold text-gray-700">HTL</th>
            <th className="text-center px-2 pb-0.5 font-semibold text-gray-700">BCL</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-200">
            <td className="py-0.5 pr-2 font-medium text-gray-700">Right (3 Freq)</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{rightHTL}</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{rightBCL}</td>
          </tr>
          <tr>
            <td className="py-0.5 pr-2 font-medium text-gray-700">Left (3 Freq)</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{leftHTL}</td>
            <td className="text-center px-2 py-0.5 font-mono text-[10px]">{leftBCL}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default PTACalculator;
