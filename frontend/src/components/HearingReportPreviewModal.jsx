/**
 * HearingReportPreviewModal — LIVE report viewer.
 *
 * Mounts <ReportsPanel hideBuilder /> inside a full-screen modal,
 * hydrated from the LATEST session data + patient record. This is
 * the "click View Report" experience — audiologists get the real
 * audiogram graphs (like `123.pdf`), not the plain-table server
 * PDF fallback (`report-SES-*.pdf`).
 *
 * Print: uses `window.print()` scoped via body class + @media print
 * so only the report DOM prints (matches HearingReportViewerModal's
 * proven pattern for saved snapshots).
 *
 * Sections shown = TOGGLEABLE_SECTIONS defaults PLUS every section
 * whose data is populated (impedance/speech/OAE/etc.). So if the
 * audiologist did speech-audiometry, that section auto-appears.
 *
 * Props:
 *   sessionId    : string   — required
 *   onClose      : () => void
 *   shareContext : optional { sessionId, patientMobile, patientName, clinicName }
 *                  Powers the WhatsApp share chip (unchanged endpoint).
 *   title        : optional string  — toolbar title
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { X, Printer, Loader2, AlertCircle, MessageCircle } from 'lucide-react';
import ReportsPanel from './ReportsPanel';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const BACKEND_ORIGIN = process.env.REACT_APP_BACKEND_URL || '';

function cleanMobileForWhatsApp(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export default function HearingReportPreviewModal({
  sessionId,
  onClose,
  shareContext,
  title = 'Hearing Assessment Report',
}) {
  const [session, setSession] = useState(null);
  const [patient, setPatient] = useState(null);
  const [err, setErr] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareErr, setShareErr] = useState('');

  // Hydrate session + patient once per open.
  useEffect(() => {
    if (!sessionId) return undefined;
    let alive = true;
    (async () => {
      try {
        const sr = await axios.get(`${API}/sessions/${sessionId}`);
        if (!alive) return;
        setSession(sr.data);
        const pid = sr.data?.patient_id;
        if (pid) {
          try {
            const pr = await axios.get(`${API}/patients/${pid}`);
            if (alive) setPatient(pr.data);
          } catch { /* patient row may be missing — panel renders without it */ }
        }
      } catch (e) {
        if (alive) {
          setErr(e?.response?.data?.detail || 'Could not load session data.');
        }
      }
    })();
    return () => { alive = false; };
  }, [sessionId]);

  // Body class + scroll lock + Escape to close. Same pattern as the
  // saved-snapshot viewer so print CSS scopes correctly.
  useEffect(() => {
    document.body.classList.add('printing-past-report');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('printing-past-report');
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Sections come STRAIGHT from the persisted session doc. The
  // audiologist's Report Builder checkbox state is authoritative —
  // sections they unchecked stay hidden even if the underlying data
  // is populated. If nothing has been persisted yet (older sessions,
  // brand-new drafts), we return null so ReportsPanel falls through
  // to TOGGLEABLE_SECTIONS.defaultEnabled.
  const enabledSections = useMemo(() => {
    if (!session) return null;
    const persisted = session.sections;
    if (Array.isArray(persisted) && persisted.length > 0) {
      return persisted.map((s) => ({ id: s.id, enabled: !!s.enabled }));
    }
    return null;
  }, [session]);

  const initialBuilder = useMemo(() => {
    if (!session) return null;
    const findingsBySection = session.findings_by_section || {};
    // Legacy fields still populate their per-section counterparts so
    // older sessions predating findings_by_section still render narrative.
    if (!findingsBySection.pure_tone && session.puretone_findings) {
      findingsBySection.pure_tone = session.puretone_findings;
    }
    if (!findingsBySection.tympanometry && session.immitence_findings) {
      findingsBySection.tympanometry = session.immitence_findings;
    }
    if (!findingsBySection.speech && session.speech_findings) {
      findingsBySection.speech = session.speech_findings;
    }
    return {
      clinical_impression: session.clinical_impression || '',
      recommendations: session.recommendations || [],
      further_advice: session.further_advice || '',
      license: session.license || '',
      findings_by_section: findingsBySection,
      provisional_diagnosis: session.provisional_diagnosis || '',
      referred_by: session.referred_by || '',
      // null → ReportsPanel uses TOGGLEABLE_SECTIONS.defaultEnabled.
      // Otherwise the audiologist's persisted checkbox state wins.
      ...(enabledSections ? { sections: enabledSections } : {}),
    };
  }, [session, enabledSections]);

  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = async () => {
    if (!shareContext?.sessionId || !shareContext?.patientMobile || sharing) return;
    setSharing(true); setShareErr('');
    try {
      const r = await axios.post(
        `${API}/reports/${shareContext.sessionId}/share-link`,
        { ttl_hours: 168 }
      );
      const path = r.data?.path || '';
      if (!path) throw new Error('Backend did not return a share path.');
      const publicUrl = `${BACKEND_ORIGIN.replace(/\/$/, '')}${path}`;
      const patientName = shareContext.patientName || 'there';
      const clinicName = shareContext.clinicName || 'your clinic';
      const message = `Hello ${patientName}, your hearing assessment report from ${clinicName} is ready: ${publicUrl}. This link is valid for 7 days.`;
      const cleaned = cleanMobileForWhatsApp(shareContext.patientMobile);
      const waUrl = cleaned
        ? `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setShareErr(e?.response?.data?.detail || e?.message || 'Could not create the share link.');
      setTimeout(() => setShareErr(''), 4000);
    } finally {
      setSharing(false);
    }
  };

  if (!sessionId) return null;

  const canShare = Boolean(
    shareContext?.sessionId && shareContext?.patientMobile
  );

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/70 flex flex-col past-report-viewer"
      data-testid="hearing-report-preview-modal"
    >
      {/* Toolbar — hidden while printing via .past-report-viewer-toolbar CSS */}
      <div className="past-report-viewer-toolbar bg-slate-900 text-white px-4 py-2 flex items-center justify-between flex-shrink-0 gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{title}</div>
          {patient?.name && (
            <div className="text-[11px] text-slate-300 truncate">
              {patient.name}
              {patient.mrd ? ` · ${patient.mrd}` : ''}
              {patient.age != null ? ` · ${patient.age}${(patient.gender || '')[0] || ''}` : ''}
            </div>
          )}
          <div className="text-[10px] font-bold uppercase tracking-wide bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded inline-block mt-0.5">
            Live view
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {canShare && (
            <button
              type="button"
              onClick={handleShareWhatsApp}
              disabled={sharing || !session}
              data-testid="hearing-report-preview-share-whatsapp"
              title={`Share via WhatsApp to ${shareContext.patientMobile}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <MessageCircle size={13} />
              {sharing ? 'Sharing…' : 'Share via WhatsApp'}
            </button>
          )}
          <button
            type="button"
            onClick={handlePrint}
            disabled={!session}
            data-testid="hearing-report-preview-print"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer size={13} /> Print
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="hearing-report-preview-close"
            title="Close (Esc)"
            className="w-8 h-8 rounded hover:bg-white/10 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {shareErr && (
        <div
          className="past-report-viewer-toolbar bg-rose-600 text-white text-xs font-semibold px-4 py-1.5 text-center"
          data-testid="hearing-report-preview-share-error"
        >
          {shareErr}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto bg-slate-200">
        {!session && !err && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-slate-400" />
          </div>
        )}
        {err && (
          <div className="p-8 text-center">
            <AlertCircle size={22} className="mx-auto text-rose-500 mb-2" />
            <div className="text-sm font-semibold text-slate-800 mb-1">
              Report unavailable
            </div>
            <div className="text-xs text-slate-600 mb-3">{err}</div>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold px-4 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        )}
        {session && (
          <ReportsPanel
            patient={patient || { patient_id: session.patient_id }}
            rightEarData={session.right_ear_audiogram || {}}
            leftEarData={session.left_ear_audiogram || {}}
            preTestData={session.pre_test_data || {}}
            impedanceData={session.impedance_data || {}}
            speechData={session.speech_data || {}}
            specialTestsData={session.special_tests_data || {}}
            oaeData={session.oae_data || {}}
            soundfieldData={session.soundfield_data || {}}
            abrData={session.abr_data || {}}
            pediatricData={session.pediatric_data || {}}
            tinnitusData={session.tinnitus_data || {}}
            sessionId={session.session_id}
            audiologistName={session.audiologist_name || ''}
            audiologistUserId={session.audiologist_user_id || ''}
            clinicalImpression={session.clinical_impression || ''}
            recommendations={session.recommendations || []}
            audiogramMode="separate"
            initialBuilder={initialBuilder}
            hideBuilder
            previewId="report-preview-past"
          />
        )}
      </div>
    </div>
  );
}
