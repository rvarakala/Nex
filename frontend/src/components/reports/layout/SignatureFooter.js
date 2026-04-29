import React, { useEffect, useState } from 'react';
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
        // Use fetch (not axios) so a 404 doesn't trip our global axios
        // interceptor — that interceptor reads `responseText`, which the
        // browser blocks when responseType is 'blob', producing a noisy
        // dev-mode overlay even though the page itself is fine.
        const url = `${API}/settings/users/${audiologistUserId}/signature`;
        const headers = {};
        try {
          const tok = localStorage.getItem('acs.token');
          if (tok) headers.Authorization = `Bearer ${tok}`;
        } catch { /* ignore */ }
        const res = await fetch(url, { headers, credentials: 'omit' });
        if (!alive || !res.ok) return;             // 404 → no signature on file
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        setSigUrl(blobUrl);
        const lic = res.headers.get('x-license-no');
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
      {/* Three-column footer with consistent vertical rhythm so the
          signature image, license value, and date all sit on the same
          baseline. The fixed `h-12` content row guarantees all three
          underlines line up across columns regardless of whether the
          signature image loads. */}
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
        <div className="text-gray-500 mb-1">License No.</div>
        <div className="h-12"></div>
        <div className="border-b border-gray-400"></div>
        <div className="mt-0.5 font-semibold">{resolvedLicense || '—'}</div>
      </div>
      <div>
        <div className="text-gray-500 mb-1">Date</div>
        <div className="h-12"></div>
        <div className="border-b border-gray-400"></div>
        <div className="mt-0.5 font-semibold">{fmtDate()}</div>
      </div>
    </footer>
  );
};
