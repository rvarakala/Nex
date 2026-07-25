/**
 * HearingReportViewerModal — read-only viewer for a saved hearing-report
 * snapshot. Mounts <ReportsPanel> with `hideBuilder={true}` and hydrates
 * all state from the snapshot JSON so the report re-renders exactly as
 * it was saved.
 *
 * Print: uses `window.print()` scoped to the modal's DOM tree via a
 * body-class + @media print rule so we don't accidentally print the
 * live editor behind the modal.
 *
 * Props:
 *   versionId : string
 *   onClose   : ()  → void
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X, Loader2, Printer } from 'lucide-react';
import ReportsPanel from './ReportsPanel';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function HearingReportViewerModal({ versionId, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!versionId) return;
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/hearing-reports/${versionId}`);
        if (alive) setData(r.data);
      } catch (e) {
        if (alive) setErr(e?.response?.data?.detail || 'Could not load saved report');
      }
    })();
    return () => { alive = false; };
  }, [versionId]);

  // Toggle a body class so @media print CSS hides everything outside the
  // modal → the browser print dialog only sees the archived report.
  useEffect(() => {
    document.body.classList.add('printing-past-report');
    return () => document.body.classList.remove('printing-past-report');
  }, []);

  const handlePrint = () => {
    window.print();
  };

  if (!versionId) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 flex flex-col past-report-viewer"
      data-testid="hearing-report-viewer-modal"
    >
      {/* Toolbar — NOT printed */}
      <div className="past-report-viewer-toolbar bg-slate-900 text-white px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-sm font-bold truncate">
            {data?.label || 'Saved Report'}
          </div>
          {data?.patient_name && (
            <div className="text-xs text-slate-300 truncate">
              · {data.patient_name}
              {data.patient_mrd ? ` · ${data.patient_mrd}` : ''}
            </div>
          )}
          <div className="text-[10px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded ml-2">
            View-only
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            data-testid="hearing-report-viewer-print"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-white text-slate-900 hover:bg-slate-100"
          >
            <Printer size={13} /> Print
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="hearing-report-viewer-close"
            className="w-8 h-8 rounded hover:bg-white/10 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-slate-100">
        {!data && !err && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-slate-400" />
          </div>
        )}
        {err && (
          <div className="p-8 text-center text-sm text-rose-600 font-semibold">{err}</div>
        )}
        {data && (
          <ReportsPanel
            patient={data.snapshot?.patient || {}}
            rightEarData={data.snapshot?.right_ear_audiogram || {}}
            leftEarData={data.snapshot?.left_ear_audiogram || {}}
            preTestData={data.snapshot?.pre_test_data || {}}
            impedanceData={data.snapshot?.impedance_data || {}}
            speechData={data.snapshot?.speech_data || {}}
            specialTestsData={data.snapshot?.special_tests_data || {}}
            oaeData={data.snapshot?.oae_data || {}}
            soundfieldData={data.snapshot?.soundfield_data || {}}
            abrData={data.snapshot?.abr_data || {}}
            pediatricData={data.snapshot?.pediatric_data || {}}
            tinnitusData={data.snapshot?.tinnitus_data || {}}
            sessionId={data.snapshot?.session?.session_id}
            audiologistName={data.snapshot?.audiologist?.name || ''}
            audiologistUserId={data.snapshot?.audiologist?.user_id || ''}
            clinicalImpression={data.snapshot?.builder?.clinical_impression || ''}
            recommendations={data.snapshot?.builder?.recommendations || []}
            audiogramMode="combined"
            initialBuilder={data.snapshot?.builder || {}}
            hideBuilder
            previewId="report-preview-past"
          />
        )}
      </div>
    </div>
  );
}
