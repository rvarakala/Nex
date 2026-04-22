import React, { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../../AuthContext';
import { Link } from 'react-router-dom';

// Printable A4 waiting-room poster with a QR code that links to the public queue TV.
// Route: /frontdesk/qr-poster  (protected, inside AppShell).
// Print target: body background white, fit to A4 portrait, visible on screen otherwise.
export default function QRPosterPage() {
  const { clinic } = useAuth();
  const queueUrl = `${window.location.origin}/queue/${clinic?.clinic_id || ''}`;
  const posterRef = useRef(null);

  return (
    <div className="p-4" data-testid="qr-poster-page">
      {/* Toolbar (hidden on print) */}
      <div className="no-print flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Waiting Room QR Poster</h2>
          <p className="text-[11px] text-slate-500">Print this and stick on your waiting-room wall. Patients scan to see the live queue on their phone.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/frontdesk" className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded border border-slate-300">← Back</Link>
          <a href={queueUrl} target="_blank" rel="noreferrer"
             data-testid="qr-preview-link"
             className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-900 text-white rounded font-semibold">
            Preview live queue ↗
          </a>
          <button onClick={() => window.print()} data-testid="qr-print-btn"
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold shadow-sm">
            🖨 Print Poster
          </button>
        </div>
      </div>

      {/* A4 Poster (portrait 210 × 297 mm) */}
      <div id="qr-poster" ref={posterRef}
        className="mx-auto bg-white shadow-2xl border border-slate-200 print:shadow-none print:border-0
                   w-[210mm] h-[297mm] p-[18mm] flex flex-col">
        {/* Clinic header */}
        <header className="text-center border-b-4 border-blue-700 pb-4 mb-8">
          <div className="text-[40px] font-black tracking-tight text-slate-900 leading-none">
            {clinic?.name || 'ACS Audiology Clinic'}
          </div>
          {clinic?.city && (
            <div className="text-[14px] text-slate-500 uppercase tracking-[0.25em] mt-1">
              {[clinic.city, clinic.state].filter(Boolean).join(' · ')}
            </div>
          )}
        </header>

        {/* Hero text */}
        <div className="text-center mb-6">
          <div className="text-[34px] font-bold text-blue-800 leading-tight">See your turn, live</div>
          <div className="text-[18px] text-slate-600 mt-1">अपनी बारी लाइव देखें</div>
        </div>

        {/* QR with ticks */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="bg-white p-6 rounded-2xl border-[6px] border-blue-700 shadow-lg">
            <QRCodeSVG
              value={queueUrl}
              size={360}
              level="H"
              includeMargin={false}
              data-testid="qr-code-svg"
            />
          </div>
          <div className="mt-5 text-[15px] text-slate-500 font-mono break-all max-w-[160mm] text-center" data-testid="qr-url-text">
            {queueUrl}
          </div>
        </div>

        {/* Instructions strip */}
        <div className="grid grid-cols-3 gap-3 mt-6 mb-3">
          <Step n="1" text="Open your phone camera" hindi="कैमरा खोलें" />
          <Step n="2" text="Point at the QR above" hindi="QR पर कैमरा रखें" />
          <Step n="3" text="Tap the link · Stay seated" hindi="लिंक पर टैप करें" />
        </div>

        {/* Footer */}
        <footer className="text-center pt-4 border-t border-slate-200 text-[11px] text-slate-400 uppercase tracking-[0.2em]">
          {clinic?.phone && <span>Ph: {clinic.phone} · </span>}
          Powered by ACS Clinic Suite
        </footer>
      </div>

      {/* Print overrides — hides everything except the A4 poster node */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { background: white !important; margin: 0; padding: 0; }
          body * { visibility: hidden !important; }
          .no-print, .no-print * { display: none !important; }
          #qr-poster, #qr-poster * { visibility: visible !important; }
          #qr-poster {
            position: absolute; left: 0; top: 0;
            width: 210mm; height: 297mm;
            box-shadow: none !important; border: 0 !important;
            margin: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}

const Step = ({ n, text, hindi }) => (
  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
    <div className="w-9 h-9 mx-auto mb-1 rounded-full bg-blue-700 text-white text-lg font-bold flex items-center justify-center">
      {n}
    </div>
    <div className="text-[13px] font-semibold text-slate-800 leading-tight">{text}</div>
    <div className="text-[11px] text-slate-500 mt-0.5">{hindi}</div>
  </div>
);
