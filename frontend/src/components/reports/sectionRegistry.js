import React from 'react';

import { CaseHistorySection } from './sections/CaseHistorySection';
import { PureToneSection } from './sections/PureToneSection';
import { TuningForkSection } from './sections/TuningForkSection';
import { OtoscopySection } from './sections/OtoscopySection';
import { SpeechSection } from './sections/SpeechSection';
import { ResultsGridSection } from './sections/ResultsGridSection';
import { RecommendationsAdviceSection } from './sections/RecommendationsAdviceSection';
import { ProvisionalDiagnosisSection } from './sections/ProvisionalDiagnosisSection';
import { GenericClinicalSection } from './sections/GenericClinicalSection';
import { TympanometryInlineSection } from './TympanometrySections';
import ABRWaveformCanvas from '../ABRWaveformCanvas';
import SoundFieldMiniAudiogram from '../SoundFieldMiniAudiogram';

/**
 * Section registry — one entry per toggleable section id. Each entry is a
 * pure render function `(ctx) => ReactNode | null` that receives the shared
 * report context from ReportsPanel. Keeping this map flat + data-driven lets us
 * add/remove sections without touching the main panel, and avoids a
 * 40-line switch statement for every new clinical tab.
 *
 * A section returning `null` is silently skipped — useful when a dependency
 * flag hides it (e.g. Tympanometry inline is suppressed when a separate page
 * is active, or Tuning Fork mini-table only appears in full mode).
 */
export const SECTION_REGISTRY = {
  case_history: (ctx) => <CaseHistorySection narrative={ctx.caseHistoryNarrative} />,

  pure_tone: (ctx) => {
    // Only apply custom audiogram size when there is vertical room (i.e. Tymp
    // on a separate page). Otherwise stay "standard" to preserve A4 fit.
    const effectiveSize = ctx.useSeparatePage ? ctx.audiogramSize : 'standard';
    const tfSectionEnabled = ctx.isEnabled('tuning_fork');
    return (
      <PureToneSection
        rightEar={ctx.rightEarData}
        leftEar={ctx.leftEarData}
        mode={ctx.audiogramMode}
        tuningFork={ctx.preTestData?.tuning_fork}
        showTuningForkMini={tfSectionEnabled && !ctx.tuningForkFull}
        size={effectiveSize}
      />
    );
  },

  tuning_fork: (ctx) =>
    ctx.tuningForkFull ? (
      <TuningForkSection
        tf={ctx.preTestData?.tuning_fork}
        showABC={ctx.showABC}
        showBing={ctx.showBing}
      />
    ) : null,

  otoscopy: (ctx) => <OtoscopySection ot={ctx.preTestData?.otoscopy} />,
  speech:   (ctx) => <SpeechSection speech={ctx.speechData} />,

  // Generic clinical tabs — each pulls from its own Dict and impression field.
  special_tests: (ctx) => (
    <GenericClinicalSection title="Special Diagnostic Tests" data={ctx.specialTestsData} impressionKey="st_impression" />
  ),
  oae: (ctx) => (
    <GenericClinicalSection title="Otoacoustic Emissions" data={ctx.oaeData} impressionKey="oae_impression" />
  ),
  soundfield: (ctx) => {
    const hasAnyField = Object.values(ctx.soundfieldData?.fields || {}).some((v) => v && String(v).trim() !== '');
    if (!hasAnyField) return null;
    return (
      <div>
        <div className="mb-1">
          <div className="h-[180px] border border-gray-400 bg-white">
            <SoundFieldMiniAudiogram fields={ctx.soundfieldData?.fields || {}} height={180} />
          </div>
        </div>
        <GenericClinicalSection title="Sound Field / Aided" data={ctx.soundfieldData} impressionKey="sf_impression" />
      </div>
    );
  },
  abr: (ctx) => {
    const hasAnyField = Object.values(ctx.abrData?.fields || {}).some((v) => v && String(v).trim() !== '');
    if (!hasAnyField) return null;
    return (
      <div>
        <div className="mb-1">
          <div className="h-[180px] border border-gray-400 bg-white">
            <ABRWaveformCanvas fields={ctx.abrData?.fields || {}} height={180} />
          </div>
        </div>
        <GenericClinicalSection title="ABR / ASSR" data={ctx.abrData} impressionKey="abr_impression" />
      </div>
    );
  },
  pediatric: (ctx) => (
    <GenericClinicalSection title="Pediatric Audiometry" data={ctx.pediatricData} impressionKey="ped_impression" />
  ),
  tinnitus: (ctx) => (
    <GenericClinicalSection title="Tinnitus Assessment" data={ctx.tinnitusData} impressionKey="tin_impression" />
  ),

  // Tymp is suppressed on main page when it's moved to a separate page.
  tympanometry: (ctx) =>
    ctx.useSeparatePage ? null : <TympanometryInlineSection impedance={ctx.impedanceData} />,

  results:         (ctx) => <ResultsGridSection entries={ctx.buildResultEntries()} />,
  provisional_diagnosis: (ctx) => (
    <ProvisionalDiagnosisSection text={ctx.provisionalDiagnosis} />
  ),
  recommendations: (ctx) => (
    <RecommendationsAdviceSection
      recommendations={ctx.recText}
      advice={ctx.furtherAdvice}
    />
  ),
};

// Render a single section by id given the full context. Returns null if either
// the id isn't registered or the section's render function opts out.
export const renderSectionById = (id, ctx) => {
  const fn = SECTION_REGISTRY[id];
  if (!fn) return null;
  const node = fn(ctx);
  if (!node) return null;
  // Auto-attach a stable key so callers can map() without wrappers.
  return React.cloneElement(node, { key: id });
};
