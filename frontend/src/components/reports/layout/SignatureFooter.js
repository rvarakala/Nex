import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { fmtDate } from '../constants';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Signature / License / Date tri-column footer used at the very end of the report
// (either on the main page when Tympanometry is inline, or on the separate page when deferred).
//
// Auto-fetches the signing audiologist's drawn signature (if any) and renders
// it above the line. Falls back gracefully to the typed name if no sig is on
// file. The license number from the user's profile takes precedence over any
// `license` prop passed in (so reports don't need to know the audiologist's id).
export const SignatureFooter = ({ audiologistName, audiologistUserId, license }) => {
  const [sigUrl, setSigUrl] = useState(null);
  const [resolvedLicense, setResolvedLicense] = useState(license || '');

  useEffect(() => {
    let alive = true;
    let blobUrl = null;
    if (!audiologistUserId) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/settings/users/${audiologistUserId}/signature`, {
          responseType: 'blob',
        });
        if (!alive) return;
        blobUrl = URL.createObjectURL(r.data);
        setSigUrl(blobUrl);
        const lic = r.headers['x-license-no'] || r.headers['X-License-No'];
        if (lic && !license) setResolvedLicense(lic);
      } catch {
        // No signature on file — typed name fallback is fine.
      }
    })();
    return () => {
      alive = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [audiologistUserId, license]);

  return (
    <footer className="mt-4 pt-2 border-t border-gray-400 grid grid-cols-3 gap-4 text-[11px]" data-testid="report-signature-footer">
      <div>
        <div className="text-gray-500 mb-1">Signature</div>
        <div className="h-12 flex items-end">
          {sigUrl ? (
            <img
              src={sigUrl}
              alt="Audiologist signature"
              className="max-h-12 max-w-full object-contain"
              data-testid="report-signature-img"
            />
          ) : null}
        </div>
        <div className="border-b border-gray-400"></div>
        <div className="mt-0.5 font-semibold">{audiologistName || '—'}</div>
      </div>
      <div>
        <div className="text-gray-500 mb-4">License No.</div>
        <div className="border-b border-gray-400"></div>
        <div className="mt-0.5 font-semibold">{resolvedLicense || '—'}</div>
      </div>
      <div>
        <div className="text-gray-500 mb-4">Date</div>
        <div className="border-b border-gray-400"></div>
        <div className="mt-0.5 font-semibold">{fmtDate()}</div>
      </div>
    </footer>
  );
};
