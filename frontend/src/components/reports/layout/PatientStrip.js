import React from 'react';
import { fmtDate } from '../constants';

// Compact single-line patient demographics strip (flex-wraps on narrow screens).
export const PatientStrip = ({ patient, referredBy, mrd, audiologistName }) => {
  const fields = [
    { label: 'Patient Name', value: patient.name || '—' },
    { label: 'Age/Gender',   value: `${patient.age ?? '—'}/${(patient.gender || '—').charAt(0).toUpperCase()}` },
    { label: 'Referred by',  value: referredBy || '—' },
    { label: 'MRD',          value: mrd || '—' },
    { label: 'DOB',          value: patient.dob || '—' },
    { label: 'Audiologist',  value: audiologistName || '—' },
    { label: 'Date',         value: fmtDate() },
  ];
  return (
    <section
      data-testid="report-patient-strip"
      className="mt-1.5 border border-gray-400 px-2 py-1 text-[11px] leading-snug flex flex-wrap items-center gap-x-4 gap-y-0.5"
    >
      {fields.map((c) => (
        <span key={c.label} className="whitespace-nowrap">
          <span className="text-gray-500">{c.label}:</span>{' '}
          <span className="font-semibold">{c.value}</span>
        </span>
      ))}
    </section>
  );
};
