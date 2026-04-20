import React from 'react';

const PatientInfoBar = ({ patient }) => {
  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-100 border-b border-gray-300 text-xs">
      <div className="flex items-center gap-1">
        <span className="font-semibold text-gray-600">Patient:</span>
        <span className="text-gray-800">{patient.name}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-semibold text-gray-600">MRD:</span>
        <span className="text-gray-800">{patient.patient_id}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-semibold text-gray-600">Age:</span>
        <span className="text-gray-800">{patient.age}Y</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-semibold text-gray-600">Gender:</span>
        <span className="text-gray-800">{patient.gender}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-semibold text-gray-600">Date:</span>
        <span className="text-gray-800">{new Date().toLocaleDateString()}</span>
      </div>
    </div>
  );
};

export default PatientInfoBar;
