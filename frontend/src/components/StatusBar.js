import React from 'react';

const StatusBar = () => {
  return (
    <div className="bg-gray-800 text-white px-5 py-1 text-xs flex justify-between items-center">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
        <span>AUD HW: Connected</span>
      </div>
      <div className="flex items-center gap-2">
        <span>Transducer: Headphones</span>
      </div>
      <div className="flex items-center gap-2">
        <span>Session Active</span>
      </div>
    </div>
  );
};

export default StatusBar;