import React from 'react';
import { fmtDate } from '../constants';

// Signature / License / Date tri-column footer used at the very end of the report
// (either on the main page when Tympanometry is inline, or on the separate page when deferred).
export const SignatureFooter = ({ audiologistName, license }) => (
  <footer className="mt-4 pt-2 border-t border-gray-400 grid grid-cols-3 gap-4 text-[11px]">
    <div>
      <div className="text-gray-500 mb-4">Signature</div>
      <div className="border-b border-gray-400"></div>
      <div className="mt-0.5 font-semibold">{audiologistName || '—'}</div>
    </div>
    <div>
      <div className="text-gray-500 mb-4">License No.</div>
      <div className="border-b border-gray-400"></div>
      <div className="mt-0.5 font-semibold">{license || '—'}</div>
    </div>
    <div>
      <div className="text-gray-500 mb-4">Date</div>
      <div className="border-b border-gray-400"></div>
      <div className="mt-0.5 font-semibold">{fmtDate()}</div>
    </div>
  </footer>
);
