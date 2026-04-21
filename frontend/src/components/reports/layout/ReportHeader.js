import React from 'react';

// Clinic header band: logo + name + contact info + report title ("Hearing Assessment").
export const ReportHeader = ({ clinic }) => {
  const logoClass = clinic.logo_shape === 'circle'
    ? 'w-14 h-14 rounded-full'
    : clinic.logo_shape === 'rectangle'
      ? 'w-20 h-12 rounded'
      : 'w-14 h-14 rounded';

  return (
    <header className="border-b-2 border-blue-700 pb-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {clinic.logo_base64 ? (
            <img
              src={clinic.logo_base64}
              alt={`${clinic.name} logo`}
              className={`bg-white border border-gray-200 object-contain flex-shrink-0 ${logoClass}`}
            />
          ) : (
            <div className={`bg-blue-700 text-white flex items-center justify-center font-black text-lg flex-shrink-0 ${logoClass}`}>
              {(clinic.name || 'C').trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[10px] text-gray-500 truncate leading-tight">{clinic.tagline}</div>
            <div className="text-[17px] font-extrabold text-blue-900 leading-tight truncate">{clinic.name}</div>
          </div>
        </div>
        <div className="text-[10px] text-right text-gray-700 leading-tight flex-shrink-0">
          {clinic.address_line1 && <div>{clinic.address_line1}</div>}
          {clinic.address_line2 && <div>{clinic.address_line2}</div>}
          {clinic.tel && <div>Tel: {clinic.tel}</div>}
          {clinic.email && <div>{clinic.email}</div>}
        </div>
      </div>
      <div className="text-center mt-1">
        <h1 className="text-[18px] font-extrabold text-gray-800 tracking-wide">Hearing Assessment</h1>
      </div>
    </header>
  );
};
