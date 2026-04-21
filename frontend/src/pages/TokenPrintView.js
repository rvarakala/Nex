import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * TokenPrintView — A5-sized printable OPD token slip.
 * Fetches the token record (needs tenant-scoped lookup; we find it in today's list).
 */
export default function TokenPrintView() {
  const { tokenId } = useParams();
  const navigate = useNavigate();
  const { clinic } = useAuth();
  const [token, setToken] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/tokens`, { params: { today_only: true, limit: 500 } });
        const found = (r.data || []).find((t) => t.token_id === tokenId);
        if (!found) setErr('Token not found or expired.');
        else setToken(found);
      } catch (e) {
        setErr(e?.message || 'Failed to load token');
      }
    })();
  }, [tokenId]);

  const printed = useRef(false);
  useEffect(() => {
    if (token && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [token]);

  if (err) return (
    <div className="p-8 text-center">
      <div className="text-sm text-red-700">{err}</div>
      <button onClick={() => navigate(-1)} className="mt-3 px-3 py-1.5 text-xs bg-slate-200 rounded">← Back</button>
    </div>
  );
  if (!token) return <div className="p-8 text-center text-sm text-slate-500">Loading token…</div>;

  const issued = new Date(token.issued_at);

  return (
    <>
      {/* Print-specific CSS */}
      <style>{`
        @page { size: A5; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .token-sheet { box-shadow: none !important; border: none !important; page-break-after: avoid; }
        }
      `}</style>

      <div className="min-h-screen bg-slate-200 flex flex-col items-center py-4">
        {/* Non-print controls */}
        <div className="no-print w-full max-w-[148mm] mb-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="text-xs text-slate-600 hover:text-slate-900" data-testid="token-back">← Back</button>
          <div className="flex gap-2">
            <button onClick={() => window.print()} data-testid="token-reprint" className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded shadow">Print Again</button>
            <button onClick={() => navigate('/frontdesk')} data-testid="token-done" className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded">Done</button>
          </div>
        </div>

        {/* The printable A5 slip */}
        <div className="token-sheet bg-white w-[148mm] min-h-[210mm] border border-slate-300 shadow-lg p-6 flex flex-col" data-testid="token-sheet">
          {/* Clinic header */}
          <div className="text-center border-b-2 border-slate-800 pb-3">
            <div className="text-xl font-bold text-slate-900 tracking-tight">{clinic?.name || 'ACS Audiology Clinic'}</div>
            <div className="text-xs text-slate-600 mt-0.5">
              {[clinic?.address, clinic?.city, clinic?.state, clinic?.pincode].filter(Boolean).join(', ')}
            </div>
            <div className="text-xs text-slate-600">
              {clinic?.phone} {clinic?.email && <>· {clinic.email}</>}
            </div>
            {clinic?.gstin && <div className="text-[10px] text-slate-500 mt-0.5">GSTIN: {clinic.gstin}</div>}
          </div>

          {/* Token number — biggest element */}
          <div className="text-center my-6">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Token No.</div>
            <div className="text-7xl font-black text-blue-700 tabular-nums leading-none mt-1">{String(token.token_no).padStart(3, '0')}</div>
            <div className="text-[11px] text-slate-500 mt-2 uppercase tracking-wider">{token.priority !== 'normal' ? token.priority : ''}</div>
          </div>

          {/* Patient info */}
          <div className="space-y-1.5 text-sm border-t border-slate-200 pt-3">
            <Row label="Patient" value={token.patient_name} bold />
            <Row label="MRD" value={token.mrd || token.patient_id} mono />
            {token.patient_mobile && <Row label="Mobile" value={token.patient_mobile} />}
            <Row label="Service" value={token.service || 'Registration'} />
            <Row label="Date" value={issued.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })} />
            <Row label="Time" value={issued.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} />
          </div>

          <div className="flex-1" />

          {/* Footer */}
          <div className="border-t border-slate-200 pt-3 text-[10px] text-slate-500 text-center">
            Please retain this slip. Present at the audiology room when called.
            <div className="mt-2 text-[9px]">Issued at {issued.toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>
    </>
  );
}

const Row = ({ label, value, bold, mono }) => (
  <div className="flex items-baseline">
    <span className="w-24 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
    <span className={`flex-1 ${bold ? 'text-lg font-bold text-slate-900' : 'text-sm text-slate-800'} ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);
