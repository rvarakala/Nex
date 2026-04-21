import React, { useState, useMemo, useEffect, useRef } from 'react';

// Constants, narrative builder, and report building blocks
import { CLINIC_STORAGE_KEY, TOGGLEABLE_SECTIONS, loadClinic } from './reports/constants';
import { buildCaseHistoryNarrative } from './reports/narrative';

// Layout pieces
import { ReportHeader } from './reports/layout/ReportHeader';
import { PatientStrip } from './reports/layout/PatientStrip';
import { SignatureFooter } from './reports/layout/SignatureFooter';

// Body sections
import { CaseHistorySection } from './reports/sections/CaseHistorySection';
import { PureToneSection } from './reports/sections/PureToneSection';
import { TuningForkSection } from './reports/sections/TuningForkSection';
import { OtoscopySection } from './reports/sections/OtoscopySection';
import { PlaceholderTable } from './reports/sections/PlaceholderTable';
import { SpeechSection } from './reports/sections/SpeechSection';
import { GenericClinicalSection } from './reports/sections/GenericClinicalSection';
import { ResultsGridSection } from './reports/sections/ResultsGridSection';
import { RecommendationsAdviceSection } from './reports/sections/RecommendationsAdviceSection';
import { TympanometryInlineSection, TympanometryFullPage } from './reports/TympanometrySections';

// Builder sidebar (left aside)
import { BuilderSidebar } from './reports/BuilderSidebar';

// Mini utilities
import { fmtDate } from './reports/constants';

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
  sessionId, // eslint-disable-line no-unused-vars
  audiologistName,
  clinicalImpression,
  recommendations,
  audiogramMode = 'combined',
  onPersist, // (partial) => save to backend
}) => {
  // ========== Section config ==========
  const [sections, setSections] = useState(
    TOGGLEABLE_SECTIONS.map((s) => ({ id: s.id, label: s.label, enabled: s.defaultEnabled }))
  );

  // ========== Editable fields ==========
  const [resultsText, setResultsText] = useState(clinicalImpression || '');
  const [recText, setRecText] = useState((recommendations || []).join('\n'));
  const [furtherAdvice, setFurtherAdvice] = useState('');
  const [license, setLicense] = useState('');
  const [ptFindings, setPtFindings] = useState('');
  const [immFindings, setImmFindings] = useState('');
  const [speechFindings, setSpeechFindings] = useState('');
  const [referredBy, setReferredBy] = useState('');
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
    if (!onPersist) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onPersist({
        clinical_impression: resultsText,
        puretone_findings: ptFindings,
        immitence_findings: immFindings,
        speech_findings: speechFindings,
        referred_by: referredBy,
        further_advice: furtherAdvice,
        recommendations: recText.split('\n').map((l) => l.trim()).filter(Boolean),
      });
    }, 800);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [resultsText, recText, ptFindings, immFindings, speechFindings, referredBy, furtherAdvice, onPersist]);

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
    const list = [];
    if (isEnabled('pure_tone'))    list.push({ key: 'pt',     title: 'Puretone Audiometry Findings', text: ptFindings });
    if (isEnabled('speech'))       list.push({ key: 'speech', title: 'Speech Audiometry Findings',   text: speechFindings });
    if (isEnabled('tympanometry')) list.push({ key: 'imm',    title: 'Immitence Audiometry Findings', text: immFindings });
    return list;
  };

  // ========== Section renderer ==========
  const renderSection = (id) => {
    switch (id) {
      case 'case_history':
        return <CaseHistorySection key={id} narrative={caseHistoryNarrative} />;
      case 'pure_tone': {
        const tfSectionEnabled = !!sections.find((s) => s.id === 'tuning_fork' && s.enabled);
        // Only apply custom audiogram size when there is vertical room (i.e. Tymp on a separate page).
        // Otherwise stay at the compact "standard" height to preserve single-A4 fit.
        const effectiveSize = useSeparatePage ? audiogramSize : 'standard';
        return (
          <PureToneSection
            key={id}
            rightEar={rightEarData}
            leftEar={leftEarData}
            mode={audiogramMode}
            tuningFork={preTestData?.tuning_fork}
            showTuningForkMini={tfSectionEnabled && !tuningForkFull}
            size={effectiveSize}
          />
        );
      }
      case 'tuning_fork':
        return tuningForkFull
          ? <TuningForkSection key={id} tf={preTestData?.tuning_fork} showABC={showABC} showBing={showBing} />
          : null;
      case 'otoscopy':
        return <OtoscopySection key={id} ot={preTestData?.otoscopy} />;
      case 'speech':
        return <SpeechSection key={id} speech={speechData} />;
      case 'special_tests':
        return <GenericClinicalSection key={id} title="Special Diagnostic Tests" data={specialTestsData} impressionKey="st_impression" />;
      case 'oae':
        return <GenericClinicalSection key={id} title="Otoacoustic Emissions" data={oaeData} impressionKey="oae_impression" />;
      case 'soundfield':
        return <GenericClinicalSection key={id} title="Sound Field / Aided" data={soundfieldData} impressionKey="sf_impression" />;
      case 'abr':
        return <GenericClinicalSection key={id} title="ABR / ASSR" data={abrData} impressionKey="abr_impression" />;
      case 'pediatric':
        return <GenericClinicalSection key={id} title="Pediatric Audiometry" data={pediatricData} impressionKey="ped_impression" />;
      case 'tinnitus':
        return <GenericClinicalSection key={id} title="Tinnitus Assessment" data={tinnitusData} impressionKey="tin_impression" />;
      case 'tympanometry':
        return useSeparatePage ? null : <TympanometryInlineSection key={id} impedance={impedanceData} />;
      case 'results':
        return <ResultsGridSection key={id} entries={buildResultEntries()} />;
      case 'recommendations':
        return (
          <RecommendationsAdviceSection
            key={id}
            recommendations={recText}
            advice={furtherAdvice}
          />
        );
      default:
        return null;
    }
  };

  const handlePrint = () => window.print();

  // When the Tymp page is "New page", the conclusion block (Results + Recommendations/Advice
  // + Signature) is deferred to the end of the report so the ENT reads test data first.
  const mainPageSections = sections
    .filter((s) => s.enabled)
    .filter((s) => !(useSeparatePage && (s.id === 'results' || s.id === 'recommendations')));

  return (
    <div className="flex-1 flex min-h-0 bg-gray-100 overflow-hidden">
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
        ptFindings={ptFindings} setPtFindings={setPtFindings}
        immFindings={immFindings} setImmFindings={setImmFindings}
        speechFindings={speechFindings} setSpeechFindings={setSpeechFindings}
        referredBy={referredBy} setReferredBy={setReferredBy}
        mrdEdit={mrdEdit} setMrdEdit={setMrdEdit}
        recText={recText} setRecText={setRecText}
        furtherAdvice={furtherAdvice} setFurtherAdvice={setFurtherAdvice}
        license={license} setLicense={setLicense}
        onPrint={handlePrint}
      />

      {/* ========== LIVE PREVIEW ========== */}
      <div className="flex-1 overflow-auto bg-gray-300 p-4 print-area">
        <div
          id="report-preview"
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
          {mainPageSections.map((s) => renderSection(s.id))}

          {/* Signature on main page only when Tymp is inline */}
          {!useSeparatePage && (
            <SignatureFooter audiologistName={audiologistName} license={license} />
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

              <SignatureFooter audiologistName={audiologistName} license={license} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsPanel;
