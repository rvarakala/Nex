import React, { useState, useMemo, useEffect, useRef } from 'react';
import axios from 'axios';
import { captureAndUploadPdf, analyzeReportLayout } from './reports/captureAndUpload';
import ReportPreflightModal from './reports/ReportPreflightModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Constants, narrative builder
import { CLINIC_STORAGE_KEY, TOGGLEABLE_SECTIONS, FINDINGS_TITLES, loadClinic, fmtDate } from './reports/constants';
import { buildCaseHistoryNarrative } from './reports/narrative';

// Layout pieces
import { ReportHeader } from './reports/layout/ReportHeader';
import { PatientStrip } from './reports/layout/PatientStrip';
import { SignatureFooter } from './reports/layout/SignatureFooter';

// Registry + sections only used directly by the deferred-page layout
import { renderSectionById } from './reports/sectionRegistry';
import { ResultsGridSection } from './reports/sections/ResultsGridSection';
import { RecommendationsAdviceSection } from './reports/sections/RecommendationsAdviceSection';
import { TympanometryFullPage } from './reports/TympanometrySections';

// Builder sidebar (left aside)
import { BuilderSidebar } from './reports/BuilderSidebar';
import LandscapePrompt from './LandscapePrompt';

const ReportsPanel = ({
  patient,
  rightEarData,
  leftEarData,
  preTestData,
  impedanceData,
  speechData,
  specialTestsData,
  oaeData,
  soundfieldData,
  abrData,
  pediatricData,
  tinnitusData,
  sessionId,
  audiologistName,
  audiologistUserId,
  clinicalImpression,
  recommendations,
  audiogramMode = 'combined',
  onPersist, // (partial) => save to backend
  // Read-only past-report viewer props: when set, the panel hydrates its
  // internal state from a saved snapshot, hides BuilderSidebar, and skips
  // debounced auto-save so the archived report is truly immutable.
  initialBuilder = null,
  hideBuilder = false,
  previewId = 'report-preview',
}) => {
  // ========== Section config ==========
  const [sections, setSections] = useState(
    TOGGLEABLE_SECTIONS.map((s) => ({ id: s.id, label: s.label, enabled: s.defaultEnabled }))
  );

  // ========== Editable fields ==========
  const [resultsText, setResultsText] = useState(
    initialBuilder?.clinical_impression ?? clinicalImpression ?? ''
  );
  const [recText, setRecText] = useState(
    initialBuilder?.recommendations
      ? (initialBuilder.recommendations || []).join('\n')
      : (recommendations || []).join('\n')
  );
  const [furtherAdvice, setFurtherAdvice] = useState(initialBuilder?.further_advice ?? '');
  const [license, setLicense] = useState(initialBuilder?.license ?? '');
  // Per-section findings narrative — keyed by section id (see FINDINGS_TITLES).
  // Each enabled section that has an entry in FINDINGS_TITLES contributes a
  // findings cell to the Results grid; the audiologist edits the text in the
  // matching textarea in BuilderSidebar.
  const [findings, setFindings] = useState(initialBuilder?.findings_by_section ?? {});
  const setFinding = (id, val) =>
    setFindings((prev) => ({ ...prev, [id]: val }));
  const [provisionalDiagnosis, setProvisionalDiagnosis] = useState(
    initialBuilder?.provisional_diagnosis ?? ''
  );
  const [referredBy, setReferredBy] = useState(initialBuilder?.referred_by ?? '');
  const [mrdEdit, setMrdEdit] = useState(patient?.patient_id || '');

  // ========== Layout preferences ==========
  const [tympPlacement, setTympPlacement] = useState('auto'); // auto | inline | separate
  const [audiogramSize, setAudiogramSize] = useState('large'); // standard | large | xlarge — only honored when Tymp is on new page
  const [showABC, setShowABC] = useState(false);
  const [showBing, setShowBing] = useState(false);
  const tuningForkFull = showABC || showBing;

  // ========== Clinic branding (localStorage) ==========
  const [clinic, setClinic] = useState(loadClinic);
  useEffect(() => {
    try {
      localStorage.setItem(CLINIC_STORAGE_KEY, JSON.stringify(clinic));
    } catch { /* ignore quota errors */ }
  }, [clinic]);

  // Auto rule: if Reflex Decay, ET Dysfunction, or ETF-Intact are enabled, default to separate page
  const autoSeparatePage = !!(
    impedanceData?.reflex_decay?.enabled ||
    impedanceData?.et_dysfunction?.enabled ||
    impedanceData?.etf_intact?.enabled
  );
  const useSeparatePage =
    tympPlacement === 'separate' ||
    (tympPlacement === 'auto' && autoSeparatePage);

  // ========== Debounced auto-save ==========
  const saveTimer = useRef(null);
  useEffect(() => {
    // When viewing a saved snapshot, the panel is read-only — no writes.
    if (!onPersist || hideBuilder) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onPersist({
        clinical_impression: resultsText,
        // Legacy fields retained for backward-compat with the existing
        // `test_sessions` document & PDF templates that read them by name.
        puretone_findings:    findings.pure_tone || '',
        immitence_findings:   findings.tympanometry || '',
        speech_findings:      findings.speech || '',
        // New per-section findings — the full map is also persisted so we
        // never lose narrative for sections that aren't covered by the
        // 3 named legacy columns above.
        findings_by_section:  findings,
        provisional_diagnosis: provisionalDiagnosis,
        referred_by: referredBy,
        further_advice: furtherAdvice,
        recommendations: recText.split('\n').map((l) => l.trim()).filter(Boolean),
      });
    }, 800);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [
    resultsText, recText, findings, provisionalDiagnosis,
    referredBy, furtherAdvice, onPersist,
  ]);

  const toggleSection = (id) =>
    setSections((s) => s.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)));
  const moveSection = (idx, dir) =>
    setSections((s) => {
      const next = [...s];
      const tgt = idx + dir;
      if (tgt < 0 || tgt >= next.length) return s;
      [next[idx], next[tgt]] = [next[tgt], next[idx]];
      return next;
    });

  const caseHistoryNarrative = useMemo(
    () => buildCaseHistoryNarrative(patient, preTestData?.case_history || {}),
    [patient, preTestData]
  );

  // Which test sections are currently toggled ON — used to decide which Results
  // findings cells to show. Impedance also shows when Tymp is on a separate page.
  const isEnabled = (id) => !!sections.find((s) => s.id === id && s.enabled);
  const buildResultEntries = () => {
    // Honour the section order in the sidebar so the audiologist's drag/drop
    // re-order is reflected in the Results grid too.
    return sections
      .filter((s) => s.enabled && FINDINGS_TITLES[s.id])
      .map((s) => ({
        key: s.id,
        title: FINDINGS_TITLES[s.id],
        text: findings[s.id] || '',
      }));
  };

  // Shared context consumed by the section registry's render functions.
  const sectionContext = {
    isEnabled,
    caseHistoryNarrative,
    rightEarData, leftEarData, preTestData, impedanceData, speechData,
    specialTestsData, oaeData, soundfieldData, abrData, pediatricData, tinnitusData,
    audiogramMode, audiogramSize, useSeparatePage, tuningForkFull,
    showABC, showBing,
    recText, furtherAdvice,
    provisionalDiagnosis,
    buildResultEntries,
  };

  const handlePrint = async () => {
    // 1. Capture the live preview DOM → render to a multi-page A4 PDF.
    // 2. Upload that PDF blob to the backend so the Reports archive stores
    //    the *exact* file the audiologist just printed (not a server-side
    //    placeholder template). Runs in the background — never blocks print.
    const el = document.getElementById(previewId);
    if (el && sessionId && !hideBuilder) {
      captureAndUploadPdf(el, sessionId).catch((e) => {
        console.warn('Report PDF upload failed — falling back to template PDF for this session:', e?.message);
      });
    } else if (sessionId && !hideBuilder) {
      // Fallback: the DOM isn't mounted (unlikely) — just flip status.
      axios.post(`${API}/sessions/${sessionId}/mark-printed`).catch(() => { });
    }
    window.print();
  };

  // Preflight: when the audiologist clicks Print, first open the "Looks
  // good?" modal so they can sanity-check page count + layout warnings
  // BEFORE the PDF is uploaded to GridFS and sent to the patient.
  const [preflightOpen, setPreflightOpen] = useState(false);
  const openPreflight = () => setPreflightOpen(true);
  const closePreflight = () => setPreflightOpen(false);
  const confirmPrint = () => {
    setPreflightOpen(false);
    // Defer a microtask so the modal teardown fully unmounts before
    // html2canvas runs — the modal overlay itself is outside
    // `#report-preview` so it doesn't affect capture, but this keeps the
    // print flow feeling instant.
    setTimeout(() => { handlePrint(); }, 0);
  };

  // Auto-fix dispatcher: each preflight warning can carry a `fixKey` that
  // maps to a one-click remedy. Applying a fix closes the modal so the
  // audiologist can see the updated preview (the watchdog dot will update
  // within ~400ms); they can re-open Print when satisfied.
  const applyPreflightFix = (key) => {
    if (key === 'tymp-inline') {
      setTympPlacement('inline');
    } else if (key === 'shrink-audiograms') {
      setAudiogramSize('standard');
    }
    setPreflightOpen(false);
  };

  // ---------- Silent layout watchdog ----------
  // Re-runs analyzeReportLayout whenever the report preview DOM changes
  // (section toggled, finding typed, audiogram edited, …). Exposes a
  // severity "dot" on the Print button so the audiologist can see at a
  // glance whether anything needs attention — before they ever click
  // Print. The analyze call is canvas-free (~5 ms), so debouncing at
  // 400ms is enough to avoid thrash without feeling laggy.
  const [layoutStatus, setLayoutStatus] = useState({ pageCount: 0, warnLevel: 'ok' });
  useEffect(() => {
    const el = document.getElementById(previewId);
    if (!el) return undefined;
    let timer = null;
    const severityOf = (warnings) =>
      warnings.some((w) => w.level === 'error') ? 'error'
        : warnings.some((w) => w.level === 'warn') ? 'warn'
          : warnings.length > 0 ? 'info'
            : 'ok';
    const run = () => {
      try {
        const a = analyzeReportLayout(el);
        setLayoutStatus({ pageCount: a.pageCount, warnLevel: severityOf(a.warnings) });
      } catch {
        // Never surface a broken analyzer to the user — this is a hint, not a gate.
      }
    };
    const debounced = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 400); };
    run();
    const observer = new MutationObserver(debounced);
    observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, []);

  // When the Tymp page is "New page", the conclusion block (Results + Recommendations/Advice
  // + Signature) is deferred to the end of the report so the ENT reads test data first.
  const mainPageSections = sections
    .filter((s) => s.enabled)
    .filter((s) => !(useSeparatePage && (s.id === 'results' || s.id === 'recommendations')));

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-gray-100 overflow-hidden">
      {!hideBuilder && (
        <BuilderSidebar
          sections={sections}
          onToggleSection={toggleSection}
          onMoveSection={moveSection}
          clinic={clinic}
          setClinic={setClinic}
          showABC={showABC}
          setShowABC={setShowABC}
          showBing={showBing}
          setShowBing={setShowBing}
          tympPlacement={tympPlacement}
          setTympPlacement={setTympPlacement}
          useSeparatePage={useSeparatePage}
          autoSeparatePage={autoSeparatePage}
          audiogramSize={audiogramSize}
          setAudiogramSize={setAudiogramSize}
          ptFindings={findings.pure_tone || ''} setPtFindings={(v) => setFinding('pure_tone', v)}
          immFindings={findings.tympanometry || ''} setImmFindings={(v) => setFinding('tympanometry', v)}
          speechFindings={findings.speech || ''} setSpeechFindings={(v) => setFinding('speech', v)}
          findings={findings}
          setFinding={setFinding}
          provisionalDiagnosis={provisionalDiagnosis}
          setProvisionalDiagnosis={setProvisionalDiagnosis}
          referredBy={referredBy} setReferredBy={setReferredBy}
          mrdEdit={mrdEdit} setMrdEdit={setMrdEdit}
          recText={recText} setRecText={setRecText}
          furtherAdvice={furtherAdvice} setFurtherAdvice={setFurtherAdvice}
          license={license} setLicense={setLicense}
          patient={patient}
          rightEarData={rightEarData}
          leftEarData={leftEarData}
          onPrint={openPreflight}
          layoutStatus={layoutStatus}
        />
      )}

      {/* ========== LIVE PREVIEW ========== */}
      <div className="flex-1 overflow-auto bg-gray-300 p-4 print-area">
        <div className="max-w-[210mm] mx-auto mb-2 no-print">
          <LandscapePrompt
            featureKey="report_builder"
            message="Rotate to landscape (or use a tablet) — the A4 preview is 210 mm wide."
            testid="report-builder-landscape"
          />
        </div>
        <div
          id={previewId}
          className="mx-auto bg-white shadow-lg report-page"
          style={{ width: '210mm', minHeight: '297mm', padding: '10mm 12mm', fontFamily: 'Arial, sans-serif', color: '#1f2937' }}
        >
          <ReportHeader clinic={clinic} />
          <PatientStrip
            patient={patient}
            referredBy={referredBy}
            mrd={mrdEdit}
            audiologistName={audiologistName}
          />

          {/* Configurable sections (minus conclusion when tymp uses separate page) */}
          {mainPageSections.map((s) => renderSectionById(s.id, sectionContext))}

          {/* Signature on main page only when Tymp is inline */}
          {!useSeparatePage && (
            <SignatureFooter audiologistName={audiologistName} audiologistUserId={audiologistUserId} license={license} />
          )}

          {/* Tympanometry (separate page) + deferred Results/Recs/Signature */}
          {sections.find((s) => s.id === 'tympanometry' && s.enabled) && useSeparatePage && (
            <div className="report-page-break">
              <header className="flex items-center justify-between border-b-2 border-blue-700 pb-2 mb-3 pt-3">
                <div className="text-[11px] text-gray-700">
                  <span className="font-semibold">{clinic.name}</span>{clinic.tel ? ` · ${clinic.tel}` : ''}
                </div>
                <div className="text-[11px] text-gray-800">
                  <span className="font-bold">{patient.name || '—'}</span> · ID: {patient.patient_id || '—'} · {fmtDate()}
                </div>
              </header>
              <TympanometryFullPage impedance={impedanceData} />

              {sections.find((s) => s.id === 'results' && s.enabled) && (
                <div className="mt-4">
                  <ResultsGridSection entries={buildResultEntries()} />
                </div>
              )}
              {sections.find((s) => s.id === 'recommendations' && s.enabled) && (
                <div className="mt-3">
                  <RecommendationsAdviceSection recommendations={recText} advice={furtherAdvice} />
                </div>
              )}

              <SignatureFooter audiologistName={audiologistName} audiologistUserId={audiologistUserId} license={license} />
            </div>
          )}
        </div>
      </div>

      {/* Preflight "Looks good?" modal — rendered at the panel root so it
          overlays both the sidebar and the preview, and shows before the
          PDF capture runs. */}
      <ReportPreflightModal
        open={preflightOpen}
        onConfirm={confirmPrint}
        onCancel={closePreflight}
        onApplyFix={applyPreflightFix}
        rootElementId={previewId}
      />
    </div>
  );
};

export default ReportsPanel;
