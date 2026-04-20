import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReportAudiogram from './ReportAudiogram';

// ==================== CLINIC BRANDING (hardcoded) ====================
const CLINIC = {
  name: 'ACS Audiology Clinic',
  tagline: 'Hearing & Balance Centre',
  address_line1: '123 Medical Plaza, MG Road',
  city: 'Bangalore',
  state: 'Karnataka',
  postal: '560001',
  tel: '+91 80 1234 5678',
  fax: '+91 80 1234 5679',
  email: 'info@acsaudiology.com',
};

// ==================== SECTION CATALOGUE ====================
// `fixed` sections always appear (header/patient/signature).
// Remaining sections are toggleable & reorderable.
const TOGGLEABLE_SECTIONS = [
  { id: 'case_history',   label: 'Case History (summary)',   defaultEnabled: true },
  { id: 'pure_tone',      label: 'Pure Tone Audiometry',     defaultEnabled: true },
  { id: 'pta_table',      label: 'PTA Summary Table',        defaultEnabled: true },
  { id: 'tuning_fork',    label: 'Tuning Fork Tests',        defaultEnabled: true },
  { id: 'otoscopy',       label: 'Otoscopic Examination',    defaultEnabled: false },
  { id: 'speech',         label: 'Speech Audiometry',        defaultEnabled: false },
  { id: 'tympanometry',   label: 'Tympanometry',             defaultEnabled: false },
  { id: 'results',        label: 'Results (narrative)',      defaultEnabled: true },
  { id: 'recommendations', label: 'Recommendations',         defaultEnabled: true },
];

// ==================== HELPERS ====================

const fmtDate = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

const LABELS = {
  onset: { sudden: 'Sudden', gradual: 'Gradual', unknown: 'Unknown' },
  ear:   { right: 'Right', left: 'Left', both: 'Both ears', unknown: 'Unknown' },
  progression: { fluctuating: 'fluctuating', gradual: 'gradually progressive', rapid: 'rapidly progressive', sudden: 'sudden-onset' },
  ysn: { yes: 'Yes', no: 'No', not_sure: 'Not sure' },
  rinne: { positive: 'Positive (AC>BC)', negative: 'Negative (BC>AC)', equal: 'Equal' },
  weber: { midline: 'Midline / Not lateralised', right: 'Lateralised → Right', left: 'Lateralised → Left', not_lateralized: 'Not perceived' },
  abc:   { normal: 'Normal', reduced: 'Reduced' },
  bing:  { positive: 'Positive', negative: 'Negative' },
  pinna: { normal: 'Normal', abnormal: 'Abnormal' },
  eac:   { clear: 'Clear', wax: 'Wax / cerumen', debris: 'Debris', inflamed: 'Inflamed', foreign_body: 'Foreign body', other: 'Other' },
  tm:    { intact_normal: 'Intact, normal', retracted: 'Retracted', bulging: 'Bulging', perforated: 'Perforated', dull: 'Dull', erythematous: 'Erythematous', effusion: 'Effusion / fluid', scarred: 'Scarred', other: 'Other' },
  cond:  { diabetes: 'Diabetes', hypertension: 'Hypertension', stroke_tia: 'Stroke/TIA', meningitis: 'Meningitis', mumps: 'Mumps', measles: 'Measles', multiple_sclerosis: 'Multiple Sclerosis', bells_palsy: "Bell's Palsy", high_fevers: 'High fevers (hx)', concussion: 'Concussion/skull fx', cancer: 'Cancer', seizures: 'Seizures' },
};
const pick = (map, v) => (v && map[v]) || '—';

// ==================== CASE HISTORY NARRATIVE ====================
const buildCaseHistoryNarrative = (patient, ch = {}) => {
  const parts = [];
  const hs = ch.hearing_specifics || {};
  const td = ch.tinnitus_detail || {};
  const dd = ch.dizziness_detail || {};
  const ne = ch.noise_exposure || {};
  const fh = ch.family_history || {};
  const mh = ch.medical_history || {};
  const ha = ch.hearing_aid_history || {};

  const demog = `${patient.age}-y/o ${patient.gender?.toLowerCase() || ''}`.trim();
  const complaint = ch.chief_complaint ? `c/o ${ch.chief_complaint.toLowerCase()}` : 'presenting for evaluation';
  const duration = ch.duration ? ` × ${ch.duration}` : '';
  const onset = ch.onset ? `, ${LABELS.onset[ch.onset].toLowerCase()} onset` : '';
  const ear = ch.affected_ear ? `, ${LABELS.ear[ch.affected_ear].toLowerCase()} side` : '';
  parts.push(`${demog}, ${complaint}${duration}${onset}${ear}.`);

  // symptoms
  const syms = [];
  if (ch.tinnitus) syms.push('tinnitus');
  if (ch.vertigo) syms.push('vertigo');
  if (ch.otalgia) syms.push('otalgia');
  if (ch.otorrhea) syms.push('otorrhea');
  if (hs.aural_fullness) syms.push('aural fullness');
  if (syms.length) parts.push(`Associated symptoms: ${syms.join(', ')}.`);

  // hearing specifics
  const hsBits = [];
  if (hs.progression) hsBits.push(`${LABELS.progression[hs.progression]} hearing loss`);
  if (hs.better_ear && hs.better_ear !== 'same') hsBits.push(`better hearing in ${hs.better_ear} ear`);
  if (hs.prior_test) hsBits.push(`previous audiometry${hs.prior_test_details ? ` (${hs.prior_test_details})` : ''}`);
  if (hs.earache_drainage_3mo) hsBits.push('recent earache/drainage');
  if (hsBits.length) parts.push(`${hsBits.join('; ')}.`);

  // tinnitus detail
  if (ch.tinnitus && (td.ear || td.frequency || td.bothersome)) {
    const tinBits = [];
    if (td.ear) tinBits.push(`${td.ear} ear`);
    if (td.frequency) tinBits.push(td.frequency);
    if (td.bothersome) tinBits.push(`bothersome: ${td.bothersome}`);
    if (td.sound_description) tinBits.push(`"${td.sound_description}"`);
    parts.push(`Tinnitus: ${tinBits.join(', ')}.`);
  }

  // dizziness
  if (dd.falls_12mo || dd.dizzy_today || (dd.associated_symptoms || []).length) {
    const dzBits = [];
    if (dd.dizzy_today) dzBits.push('dizzy today');
    if ((dd.associated_symptoms || []).length) dzBits.push(`associated: ${dd.associated_symptoms.join(', ')}`);
    if (dd.falls_12mo) dzBits.push(`${dd.falls_count ?? 'recurrent'} fall(s) in last 12 mo${dd.falls_injured ? ' with injury' : ''}`);
    parts.push(`Balance: ${dzBits.join('; ')}.`);
  }

  // noise
  if (ne.exposed) parts.push(`Noise exposure: ${ne.description || 'yes'}.`);

  // family
  if (fh.hearing_loss_in_family === 'yes') parts.push(`Family history of hearing loss${fh.description ? ` (${fh.description})` : ''}.`);

  // medical
  const medBits = [];
  if (mh.prior_head_neck_surgery) medBits.push(`prior head/neck surgery${mh.prior_head_neck_surgery_details ? ` (${mh.prior_head_neck_surgery_details})` : ''}`);
  if (mh.head_trauma) medBits.push(`head trauma${mh.head_trauma_details ? ` (${mh.head_trauma_details})` : ''}`);
  if ((mh.conditions || []).length) medBits.push(`comorbidities: ${mh.conditions.map((c) => LABELS.cond[c] || c).join(', ')}`);
  if (mh.medications) medBits.push(`medications: ${mh.medications}`);
  if (medBits.length) parts.push(`Medical hx: ${medBits.join('; ')}.`);

  // hearing aid
  if (ha.ever_used || ha.currently_using) {
    parts.push(`Hearing aid: ${ha.currently_using ? 'currently using' : 'past use'}${ha.ear ? ` (${ha.ear})` : ''}${ha.years_of_use ? `, ${ha.years_of_use}` : ''}.`);
  }

  if (ch.notes) parts.push(ch.notes);

  return parts.join(' ');
};

// ==================== PTA CALC ====================
const ptaAvg = (data, which) => {
  if (!data) return null;
  const arr = (data[which] || []).filter((m) => [500, 1000, 2000].includes(m.frequency) && m.threshold_db !== null && m.threshold_db !== undefined && !m.no_response);
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, m) => a + m.threshold_db, 0) / arr.length);
};

const classifyDegree = (pta) => {
  if (pta === null) return '—';
  if (pta <= 15) return 'Normal';
  if (pta <= 25) return 'Slight';
  if (pta <= 40) return 'Mild';
  if (pta <= 55) return 'Moderate';
  if (pta <= 70) return 'Moderately severe';
  if (pta <= 90) return 'Severe';
  return 'Profound';
};

// ==================== REPORT PREVIEW SECTIONS ====================

const SectionTitle = ({ children }) => (
  <h3 className="text-[13px] font-bold text-blue-800 border-b border-gray-300 pb-0.5 mt-3 mb-1.5">{children}</h3>
);

const CaseHistorySection = ({ narrative }) => (
  <div>
    <SectionTitle>Case History</SectionTitle>
    <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap">{narrative || '—'}</p>
  </div>
);

const PureToneSection = ({ rightEar, leftEar }) => (
  <div>
    <SectionTitle>Puretone Audiometry</SectionTitle>
    <div className="flex gap-3">
      <div className="flex-1 h-[320px]">
        <ReportAudiogram rightEarData={rightEar} leftEarData={leftEar} />
      </div>
      <div className="w-[160px] text-[10px] text-gray-700">
        <div className="border border-gray-300 rounded p-1.5 bg-gray-50">
          <div className="font-bold text-[11px] mb-1">Legend</div>
          <div className="flex items-center gap-1.5 mb-0.5"><span className="text-red-600 font-bold">O</span> Right AC (unmasked)</div>
          <div className="flex items-center gap-1.5 mb-0.5"><span className="text-red-600 font-bold">△</span> Right AC (masked)</div>
          <div className="flex items-center gap-1.5 mb-0.5"><span className="text-red-600 font-bold">&lt;</span> Right BC</div>
          <div className="flex items-center gap-1.5 mb-0.5"><span className="text-blue-600 font-bold">X</span> Left AC (unmasked)</div>
          <div className="flex items-center gap-1.5 mb-0.5"><span className="text-blue-600 font-bold">□</span> Left AC (masked)</div>
          <div className="flex items-center gap-1.5 mb-0.5"><span className="text-blue-600 font-bold">&gt;</span> Left BC</div>
          <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-gray-300">↙ ↘ No Response</div>
        </div>
      </div>
    </div>
  </div>
);

const PTATableSection = ({ rightEar, leftEar }) => {
  const rHTL = ptaAvg(rightEar, 'ac_measurements');
  const lHTL = ptaAvg(leftEar, 'ac_measurements');
  const rBCL = ptaAvg(rightEar, 'bc_measurements');
  const lBCL = ptaAvg(leftEar, 'bc_measurements');
  return (
    <div>
      <SectionTitle>PTA Summary (500, 1K, 2K Hz)</SectionTitle>
      <table className="w-full text-[11px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-2 py-0.5 text-left">Ear</th>
            <th className="border border-gray-400 px-2 py-0.5">HTL (dB)</th>
            <th className="border border-gray-400 px-2 py-0.5">BCL (dB)</th>
            <th className="border border-gray-400 px-2 py-0.5">Degree</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-400 px-2 py-0.5 font-semibold text-red-600">Right</td>
            <td className="border border-gray-400 px-2 py-0.5 text-center">{rHTL ?? '—'}</td>
            <td className="border border-gray-400 px-2 py-0.5 text-center">{rBCL ?? '—'}</td>
            <td className="border border-gray-400 px-2 py-0.5">{classifyDegree(rHTL)}</td>
          </tr>
          <tr>
            <td className="border border-gray-400 px-2 py-0.5 font-semibold text-blue-600">Left</td>
            <td className="border border-gray-400 px-2 py-0.5 text-center">{lHTL ?? '—'}</td>
            <td className="border border-gray-400 px-2 py-0.5 text-center">{lBCL ?? '—'}</td>
            <td className="border border-gray-400 px-2 py-0.5">{classifyDegree(lHTL)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const TuningForkSection = ({ tf = {} }) => (
  <div>
    <SectionTitle>Tuning Fork Tests ({tf.frequency_hz || 512} Hz)</SectionTitle>
    <table className="w-full text-[11px] border border-gray-400">
      <thead className="bg-gray-100">
        <tr>
          <th className="border border-gray-400 px-2 py-0.5 text-left">Test</th>
          <th className="border border-gray-400 px-2 py-0.5">Right</th>
          <th className="border border-gray-400 px-2 py-0.5">Left</th>
          <th className="border border-gray-400 px-2 py-0.5 text-left">Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr><td className="border border-gray-400 px-2 py-0.5 font-medium">Rinne</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.rinne, tf.rinne_right)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.rinne, tf.rinne_left)}</td><td className="border border-gray-400 px-2 py-0.5">{tf.rinne_notes || ''}</td></tr>
        <tr><td className="border border-gray-400 px-2 py-0.5 font-medium">Weber</td><td className="border border-gray-400 px-2 py-0.5" colSpan={2}>{pick(LABELS.weber, tf.weber)}</td><td className="border border-gray-400 px-2 py-0.5">{tf.weber_notes || ''}</td></tr>
        <tr><td className="border border-gray-400 px-2 py-0.5 font-medium">ABC</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.abc, tf.abc_right)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.abc, tf.abc_left)}</td><td className="border border-gray-400 px-2 py-0.5">{tf.abc_notes || ''}</td></tr>
        <tr><td className="border border-gray-400 px-2 py-0.5 font-medium">Bing</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.bing, tf.bing_right)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.bing, tf.bing_left)}</td><td className="border border-gray-400 px-2 py-0.5">{tf.bing_notes || ''}</td></tr>
      </tbody>
    </table>
  </div>
);

const OtoscopySection = ({ ot = {} }) => {
  const R = ot.right || {};
  const L = ot.left || {};
  return (
    <div>
      <SectionTitle>Otoscopic Examination</SectionTitle>
      <table className="w-full text-[11px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-2 py-0.5 text-left">Finding</th>
            <th className="border border-gray-400 px-2 py-0.5">Right</th>
            <th className="border border-gray-400 px-2 py-0.5">Left</th>
          </tr>
        </thead>
        <tbody>
          <tr><td className="border border-gray-400 px-2 py-0.5">Pinna</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.pinna, R.pinna)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.pinna, L.pinna)}</td></tr>
          <tr><td className="border border-gray-400 px-2 py-0.5">EAC</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.eac, R.eac)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.eac, L.eac)}</td></tr>
          <tr><td className="border border-gray-400 px-2 py-0.5">TM</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.tm, R.tm)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.tm, L.tm)}</td></tr>
          <tr><td className="border border-gray-400 px-2 py-0.5">Notes</td><td className="border border-gray-400 px-2 py-0.5">{R.notes || ''}</td><td className="border border-gray-400 px-2 py-0.5">{L.notes || ''}</td></tr>
        </tbody>
      </table>
      {(R.image_base64 || L.image_base64) && (
        <div className="flex gap-2 mt-1.5">
          <div className="flex-1">
            <div className="text-[10px] font-semibold text-red-600 mb-0.5">Right</div>
            {R.image_base64 ? <img src={R.image_base64} alt="R otoscopy" className="w-full max-h-32 object-contain border border-gray-300 rounded" /> : <div className="text-[10px] italic text-gray-400">(no image)</div>}
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-semibold text-blue-600 mb-0.5">Left</div>
            {L.image_base64 ? <img src={L.image_base64} alt="L otoscopy" className="w-full max-h-32 object-contain border border-gray-300 rounded" /> : <div className="text-[10px] italic text-gray-400">(no image)</div>}
          </div>
        </div>
      )}
    </div>
  );
};

const PlaceholderTable = ({ title, columns }) => (
  <div>
    <SectionTitle>{title}</SectionTitle>
    <table className="w-full text-[11px] border border-gray-400">
      <thead className="bg-gray-100">
        <tr>
          <th className="border border-gray-400 px-2 py-0.5"></th>
          {columns.map((c) => <th key={c} className="border border-gray-400 px-2 py-0.5">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {['Right', 'Left', 'Binaural'].map((ear) => (
          <tr key={ear}>
            <td className="border border-gray-400 px-2 py-0.5 font-semibold">{ear}</td>
            {columns.map((c) => <td key={c} className="border border-gray-400 px-2 py-0.5 text-center text-gray-400 italic">—</td>)}
          </tr>
        ))}
      </tbody>
    </table>
    <div className="text-[10px] italic text-gray-500 mt-0.5">Not assessed.</div>
  </div>
);

const NarrativeSection = ({ title, text }) => (
  <div>
    <SectionTitle>{title}</SectionTitle>
    <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap min-h-[40px]">
      {text || <span className="italic text-gray-400">(no narrative entered)</span>}
    </p>
  </div>
);

// ==================== MAIN COMPONENT ====================

const ReportsPanel = ({
  patient,
  rightEarData,
  leftEarData,
  preTestData,
  sessionId,
  audiologistName,
  clinicalImpression,
  recommendations,
  onPersist, // (partial) => save to backend
}) => {
  // Section order + visibility state
  const [sections, setSections] = useState(
    TOGGLEABLE_SECTIONS.map((s) => ({ id: s.id, label: s.label, enabled: s.defaultEnabled }))
  );
  const [resultsText, setResultsText] = useState(clinicalImpression || '');
  const [recText, setRecText] = useState((recommendations || []).join('\n'));
  const [license, setLicense] = useState('');

  // Debounced auto-save of editable fields
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!onPersist) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onPersist({
        clinical_impression: resultsText,
        recommendations: recText.split('\n').map((l) => l.trim()).filter(Boolean),
      });
    }, 800);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [resultsText, recText, onPersist]);

  const toggleSection = (id) =>
    setSections((s) => s.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)));
  const moveSection = (idx, dir) => {
    setSections((s) => {
      const next = [...s];
      const tgt = idx + dir;
      if (tgt < 0 || tgt >= next.length) return s;
      [next[idx], next[tgt]] = [next[tgt], next[idx]];
      return next;
    });
  };

  const caseHistoryNarrative = useMemo(
    () => buildCaseHistoryNarrative(patient, preTestData?.case_history || {}),
    [patient, preTestData]
  );

  const renderSection = (id) => {
    switch (id) {
      case 'case_history':
        return <CaseHistorySection key={id} narrative={caseHistoryNarrative} />;
      case 'pure_tone':
        return <PureToneSection key={id} rightEar={rightEarData} leftEar={leftEarData} />;
      case 'pta_table':
        return <PTATableSection key={id} rightEar={rightEarData} leftEar={leftEarData} />;
      case 'tuning_fork':
        return <TuningForkSection key={id} tf={preTestData?.tuning_fork} />;
      case 'otoscopy':
        return <OtoscopySection key={id} ot={preTestData?.otoscopy} />;
      case 'speech':
        return <PlaceholderTable key={id} title="Speech Audiometry" columns={['SAT', 'SRT', 'Mask', 'MCL', 'UCL', 'WR %', 'WR Level']} />;
      case 'tympanometry':
        return <PlaceholderTable key={id} title="Tympanometry" columns={['Type', 'Pressure (daPa)', 'Compliance (ml)', 'Volume (cc)']} />;
      case 'results':
        return <NarrativeSection key={id} title="Results" text={resultsText} />;
      case 'recommendations':
        return <NarrativeSection key={id} title="Recommendations" text={recText} />;
      default:
        return null;
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="flex-1 flex min-h-0 bg-gray-100 overflow-hidden">
      {/* ========== SECTION BUILDER (hidden on print) ========== */}
      <aside className="w-[280px] flex-shrink-0 bg-white border-r border-gray-300 overflow-auto no-print">
        <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-2 py-1 border-b border-gray-300 sticky top-0 z-10">
          <h3 className="text-xs font-bold text-gray-700">Report Builder</h3>
        </div>

        <div className="p-2 space-y-2">
          <button
            onClick={handlePrint}
            data-testid="report-print-btn"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-1.5 rounded flex items-center justify-center gap-1.5 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            Print / Save as PDF
          </button>

          <div>
            <div className="text-[10px] font-bold text-gray-600 mt-2 mb-1">Sections</div>
            <div className="space-y-0.5">
              {sections.map((s, idx) => (
                <div
                  key={s.id}
                  className="flex items-center gap-1 px-1.5 py-1 bg-gray-50 border border-gray-200 rounded text-[11px]"
                >
                  <input
                    type="checkbox"
                    data-testid={`report-toggle-${s.id}`}
                    checked={s.enabled}
                    onChange={() => toggleSection(s.id)}
                    className="w-3.5 h-3.5"
                  />
                  <span className={`flex-1 truncate ${s.enabled ? 'text-gray-800' : 'text-gray-400'}`}>{s.label}</span>
                  <button
                    onClick={() => moveSection(idx, -1)}
                    disabled={idx === 0}
                    data-testid={`report-up-${s.id}`}
                    className="w-5 h-5 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center text-[10px]"
                    title="Move up"
                  >▲</button>
                  <button
                    onClick={() => moveSection(idx, 1)}
                    disabled={idx === sections.length - 1}
                    data-testid={`report-down-${s.id}`}
                    className="w-5 h-5 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center text-[10px]"
                    title="Move down"
                  >▼</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold text-gray-600 mt-2 mb-1">Results (narrative)</div>
            <textarea
              data-testid="report-results"
              value={resultsText}
              onChange={(e) => setResultsText(e.target.value)}
              rows={5}
              placeholder="e.g., Patient presents with bilateral mild sloping sensorineural hearing loss…"
              className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 resize-y focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-600 mb-1">Recommendations (one per line)</div>
            <textarea
              data-testid="report-recommendations"
              value={recText}
              onChange={(e) => setRecText(e.target.value)}
              rows={5}
              placeholder="Binaural amplification trial.\nCommunication strategies counselling.\nAnnual audiometric re-evaluation."
              className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 resize-y focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-600 mb-1">Audiologist License #</div>
            <input
              type="text"
              data-testid="report-license"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="Lic. No."
              className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1"
            />
          </div>
        </div>
      </aside>

      {/* ========== LIVE PREVIEW ========== */}
      <div className="flex-1 overflow-auto bg-gray-300 p-4 print-area">
        <div
          id="report-preview"
          className="mx-auto bg-white shadow-lg report-page"
          style={{ width: '210mm', minHeight: '297mm', padding: '12mm 14mm', fontFamily: 'Arial, sans-serif', color: '#1f2937' }}
        >
          {/* ===== HEADER ===== */}
          <header className="flex items-start justify-between border-b-2 border-blue-700 pb-2">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-blue-700 text-white flex items-center justify-center font-black text-xl">A</div>
              <div>
                <div className="text-[11px] text-gray-500">{CLINIC.tagline}</div>
                <div className="text-[18px] font-extrabold text-blue-900 leading-tight">{CLINIC.name}</div>
              </div>
            </div>
            <div className="text-center flex-1 px-4">
              <h1 className="text-[20px] font-extrabold text-gray-800">Hearing Loss Assessment</h1>
            </div>
            <div className="text-[10px] text-right text-gray-700 leading-tight">
              <div>{CLINIC.address_line1}</div>
              <div>{CLINIC.city}, {CLINIC.state} {CLINIC.postal}</div>
              <div>Tel: {CLINIC.tel}</div>
              <div>Fax: {CLINIC.fax}</div>
            </div>
          </header>

          {/* ===== PATIENT INFO ===== */}
          <section className="grid grid-cols-4 gap-0 mt-3 border border-gray-400 text-[11px]">
            <div className="p-1.5 border-r border-b border-gray-400 col-span-3">
              <div className="text-[9px] text-gray-500 uppercase">Patient Name</div>
              <div className="font-semibold">{patient.name || '—'}</div>
            </div>
            <div className="p-1.5 border-b border-gray-400">
              <div className="text-[9px] text-gray-500 uppercase">Date of Birth</div>
              <div className="font-semibold">{patient.dob || '—'}</div>
            </div>
            <div className="p-1.5 border-r border-b border-gray-400 col-span-2">
              <div className="text-[9px] text-gray-500 uppercase">MRD / Patient ID</div>
              <div className="font-semibold">{patient.patient_id || '—'}</div>
            </div>
            <div className="p-1.5 border-r border-b border-gray-400">
              <div className="text-[9px] text-gray-500 uppercase">Age</div>
              <div className="font-semibold">{patient.age || '—'}</div>
            </div>
            <div className="p-1.5 border-b border-gray-400">
              <div className="text-[9px] text-gray-500 uppercase">Gender</div>
              <div className="font-semibold">{patient.gender || '—'}</div>
            </div>
            <div className="p-1.5 border-r border-gray-400 col-span-2">
              <div className="text-[9px] text-gray-500 uppercase">Audiologist</div>
              <div className="font-semibold">{audiologistName || '—'}</div>
            </div>
            <div className="p-1.5 border-r border-gray-400">
              <div className="text-[9px] text-gray-500 uppercase">Date of Service</div>
              <div className="font-semibold">{fmtDate()}</div>
            </div>
            <div className="p-1.5">
              <div className="text-[9px] text-gray-500 uppercase">Session ID</div>
              <div className="font-semibold text-[10px]">{sessionId || '—'}</div>
            </div>
          </section>

          {/* ===== CONFIGURABLE SECTIONS ===== */}
          {sections.filter((s) => s.enabled).map((s) => renderSection(s.id))}

          {/* ===== SIGNATURE ===== */}
          <footer className="mt-6 pt-3 border-t border-gray-400 grid grid-cols-3 gap-4 text-[11px]">
            <div>
              <div className="text-gray-500 mb-6">Signature</div>
              <div className="border-b border-gray-400"></div>
              <div className="mt-0.5 font-semibold">{audiologistName || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-6">License No.</div>
              <div className="border-b border-gray-400"></div>
              <div className="mt-0.5 font-semibold">{license || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-6">Date</div>
              <div className="border-b border-gray-400"></div>
              <div className="mt-0.5 font-semibold">{fmtDate()}</div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default ReportsPanel;
