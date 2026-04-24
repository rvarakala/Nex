import React from 'react';

// Clinic header band: logo + name + contact info + report title ("Hearing Assessment").
//
// Design notes:
//   - Clinic name MUST NEVER be truncated. Audiology clinics often have
//     multi-service names like "ACS Audiology Clinic & Vertigo Clinic &
//     Rehabilitation Center"; we let the name wrap to up to 2 lines and
//     auto-shrink the font if very long. The right-side address column
//     capped at max-w so it can't starve the name column of space.
//   - Tagline uses a medium gray (600). `gray-500` was too light — html2canvas
//     rendered it visually half-faded in the final PDF.
export const ReportHeader = ({ clinic }) => {
  const logoClass = clinic.logo_shape === 'circle'
    ? 'w-14 h-14 rounded-full'
    : clinic.logo_shape === 'rectangle'
      ? 'w-20 h-12 rounded'
      : 'w-14 h-14 rounded';

  // Auto-shrink the clinic name when it's long enough to risk awkward wrapping.
  // Threshold picked empirically: ~42 chars comfortably fits 2 lines at 17px;
  // beyond that, drop one step so 2 lines remain readable.
  const name = (clinic.name || '').trim();
  const nameClass = name.length > 52
    ? 'text-[13px] leading-snug'
    : name.length > 42
      ? 'text-[15px] leading-snug'
      : 'text-[17px] leading-tight';

  return (
    <header className="border-b-2 border-blue-700 pb-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {clinic.logo_base64 ? (
            <img
              src={clinic.logo_base64}
              alt={`${clinic.name} logo`}
              className={`bg-white border border-gray-200 object-contain flex-shrink-0 ${logoClass}`}
            />
          ) : (
            <div className={`bg-blue-700 text-white flex items-center justify-center font-black text-lg flex-shrink-0 ${logoClass}`}>
              {(name || 'C').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {clinic.tagline && (
              <div className="text-[10px] text-gray-600 font-medium leading-tight break-words">{clinic.tagline}</div>
            )}
            <div className={`font-extrabold text-blue-900 break-words ${nameClass}`}>{name}</div>
          </div>
        </div>
        <div className="text-[10px] text-right text-gray-700 leading-tight flex-shrink-0 max-w-[42%]">
          {clinic.address_line1 && <div className="break-words">{clinic.address_line1}</div>}
          {clinic.address_line2 && <div className="break-words">{clinic.address_line2}</div>}
          {clinic.tel && <div>Tel: {clinic.tel}</div>}
          {clinic.email && <div className="break-all">{clinic.email}</div>}
        </div>
      </div>
      <div className="text-center mt-1">
        <h1 className="text-[18px] font-extrabold text-gray-800 tracking-wide">Hearing Assessment</h1>
      </div>
    </header>
  );
};
