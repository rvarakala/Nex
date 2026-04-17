import React from 'react';

const PatientContext = ({ patient, session }) => {
  if (!patient) {
    return (
      <div className="bg-white border-b border-gray-300 px-5 py-2 flex gap-8 items-center">
        <div className="text-gray-500 text-sm">No patient selected</div>
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-gray-300 px-5 py-2 flex gap-8 items-center">
      <div className="font-semibold text-base">{patient.name}</div>
      <div className="text-sm text-gray-600">{patient.age}Y • {patient.gender}</div>
      <div className="text-sm text-gray-600">MRD: {patient.patient_id}</div>
      {session && (
        <div className="text-sm text-gray-600">
          Session: {new Date(session.test_date).toLocaleString()}
        </div>
      )}
      {patient.referring_physician && (
        <div className="text-sm text-gray-600">Ref: {patient.referring_physician}</div>
      )}
    </div>
  );
};

export default PatientContext;