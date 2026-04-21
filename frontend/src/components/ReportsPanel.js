import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReportAudiogram from './ReportAudiogram';
import TympanogramCanvas from './TympanogramCanvas';
import { autoClassifyJerger } from './ImpedancePanel';

// ==================== CLINIC BRANDING (user-customisable, persisted to localStorage) ====================
const CLINIC_STORAGE_KEY = 'acs_clinic_branding_v1';

const DEFAULT_CLINIC = {
  name: 'ACS Audiology Clinic',
  tagline: 'Hearing & Balance Centre',
  address_line1: '123 Medical Plaza, MG Road',
  address_line2: 'Bangalore, Karnataka 560001',
  tel: '+91 80 1234 5678',
  email: 'info@acsaudiology.com',
  logo_base64: null,          // data URL or null
  logo_shape: 'circle',       // 'circle' | 'square' | 'rectangle'
};

const loadClinic = () => {
  try {
    const raw = localStorage.getItem(CLINIC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CLINIC };
    return { ...DEFAULT_CLINIC, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CLINIC };
  }
};

// Client-side resize + base64 (used for logo upload)
const fileToResizedBase64 = (file, maxSize = 400) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// ==================== SECTION CATALOGUE ====================
// `fixed` sections always appear (header/patient/signature).
// Remaining sections are toggleable & reorderable.
// PTA summary is embedded inside Pure Tone section (not separately toggleable).
const TOGGLEABLE_SECTIONS = [
  { id: 'case_history',   label: 'Case History (summary)',   defaultEnabled: true },
  { id: 'pure_tone',      label: 'Pure Tone Audiometry',     defaultEnabled: true },
  { id: 'tuning_fork',    label: 'Tuning Fork Tests',        defaultEnabled: true },
  { id: 'otoscopy',       label: 'Otoscopic Examination',    defaultEnabled: false },
  { id: 'speech',         label: 'Speech Audiometry',        defaultEnabled: false },
  { id: 'tympanometry',   label: 'Tympanometry / Impedance', defaultEnabled: true },
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
const ptaAvg = (data, which, freqs = [500, 1000, 2000]) => {
  if (!data) return null;
  const arr = (data[which] || []).filter(
    (m) =>
      freqs.includes(m.frequency) &&
      m.threshold_db !== null &&
      m.threshold_db !== undefined &&
      !m.no_response
  );
  if (arr.length < freqs.length) return null;
  return Math.round(arr.reduce((a, m) => a + m.threshold_db, 0) / arr.length);
};

// ==================== Tympanometry render helpers ====================

const effectiveJerger = (ear) =>
  ear?.jerger_type || autoClassifyJerger({
    me_pressure: ear?.me_pressure,
    compliance: ear?.compliance,
    volume: ear?.volume,
  });

const TympanometrySummaryTable = ({ impedance }) => {
  const R = impedance?.tympanometry?.right || {};
  const L = impedance?.tympanometry?.left || {};
  const row = (ear, label, colour) => (
    <tr>
      <td className={`border border-gray-400 px-2 py-0.5 font-semibold ${colour}`}>{label}</td>
      <td className="border border-gray-400 px-2 py-0.5 text-center">{effectiveJerger(ear) || '—'}</td>
      <td className="border border-gray-400 px-2 py-0.5 text-center">{ear.me_pressure ?? '—'}</td>
      <td className="border border-gray-400 px-2 py-0.5 text-center">{ear.compliance ?? '—'}</td>
      <td className="border border-gray-400 px-2 py-0.5 text-center">{ear.volume ?? '—'}</td>
    </tr>
  );
  return (
    <table className="w-full text-[11px] border border-gray-400">
      <thead className="bg-gray-100">
        <tr>
          <th className="border border-gray-400 px-2 py-0.5 text-left">Ear</th>
          <th className="border border-gray-400 px-2 py-0.5">Type</th>
          <th className="border border-gray-400 px-2 py-0.5">Pressure (daPa)</th>
          <th className="border border-gray-400 px-2 py-0.5">Compliance (mL)</th>
          <th className="border border-gray-400 px-2 py-0.5">Volume (cc)</th>
        </tr>
      </thead>
      <tbody>
        {row(R, 'Right', 'text-red-600')}
        {row(L, 'Left', 'text-blue-600')}
      </tbody>
    </table>
  );
};

const ReflexTable = ({ title, reflex, freqs }) => {
  const row = (earLabel, earData, side, sideLabel, colour) => (
    <tr>
      <td className={`border border-gray-400 px-1 py-0.5 font-semibold ${colour}`}>{earLabel}</td>
      <td className="border border-gray-400 px-1 py-0.5">{sideLabel}</td>
      {freqs.map((f) => {
        const cell = earData?.[side]?.freqs?.[f] || {};
        return (
          <td key={f} className="border border-gray-400 px-1 py-0.5 text-center">
            {cell.level ?? '—'}
          </td>
        );
      })}
    </tr>
  );
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-700 mt-1 mb-0.5">{title} — Threshold level (dB HL)</div>
      <table className="w-full text-[10px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-1 py-0.5">Ear</th>
            <th className="border border-gray-400 px-1 py-0.5">Probe</th>
            {freqs.map((f) => (
              <th key={f} className="border border-gray-400 px-1 py-0.5">
                {parseInt(f) >= 1000 ? `${parseInt(f) / 1000}K` : f} Hz
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('Right', reflex?.right, 'ipsi', 'Ipsi', 'text-red-600')}
          {row('Right', reflex?.right, 'contra', 'Contra', 'text-red-600')}
          {row('Left',  reflex?.left,  'ipsi', 'Ipsi', 'text-blue-600')}
          {row('Left',  reflex?.left,  'contra', 'Contra', 'text-blue-600')}
        </tbody>
      </table>
    </div>
  );
};

const ETTable = ({ et }) => {
  const earCol = (earLabel, earData, colour) => (
    <tr>
      <td className={`border border-gray-400 px-1 py-0.5 font-semibold ${colour}`}>{earLabel}</td>
      {['toynbee', 'valsalva', 'pressure_app'].map((m) => {
        const v = earData?.[m] || {};
        return (
          <td key={m} className="border border-gray-400 px-1 py-0.5">
            <div className="text-[10px]">
              <div>Before: {v.pressure_before ?? '—'} · After: {v.pressure_after ?? '—'}</div>
              <div className="font-semibold capitalize">{v.interpretation || '—'}</div>
              {v.notes && <div className="italic text-gray-500">{v.notes}</div>}
            </div>
          </td>
        );
      })}
    </tr>
  );
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-700 mt-1 mb-0.5">Eustachian Tube Dysfunction</div>
      <table className="w-full text-[10px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-1 py-0.5">Ear</th>
            <th className="border border-gray-400 px-1 py-0.5">Toynbee</th>
            <th className="border border-gray-400 px-1 py-0.5">Valsalva</th>
            <th className="border border-gray-400 px-1 py-0.5">Pressure App.</th>
          </tr>
        </thead>
        <tbody>
          {earCol('Right', et?.right, 'text-red-600')}
          {earCol('Left',  et?.left,  'text-blue-600')}
        </tbody>
      </table>
    </div>
  );
};

// Compact tympanometry section (inline on PTA page)
const TympanometryInlineSection = ({ impedance }) => {
  const R = impedance?.tympanometry?.right || {};
  const L = impedance?.tympanometry?.left || {};
  return (
    <div>
      <SectionTitle>Tympanometry</SectionTitle>
      <div className="flex gap-2">
        <div className="flex-1 h-[180px] border border-gray-300 rounded">
          <TympanogramCanvas
            jergerType={effectiveJerger(R)}
            mePressure={R.me_pressure}
            compliance={R.compliance}
            volume={R.volume}
            earSide="right"
          />
        </div>
        <div className="flex-1 h-[180px] border border-gray-300 rounded">
          <TympanogramCanvas
            jergerType={effectiveJerger(L)}
            mePressure={L.me_pressure}
            compliance={L.compliance}
            volume={L.volume}
            earSide="left"
          />
        </div>
      </div>
      <div className="mt-2">
        <TympanometrySummaryTable impedance={impedance} />
      </div>
      {impedance?.acoustic_reflex?.enabled && (
        <ReflexTable title="Acoustic Reflex" reflex={impedance.acoustic_reflex} freqs={['250', '500', '1000', '2000', '4000']} />
      )}
    </div>
  );
};

// Full-page tympanometry section (with page break)
const TympanometryFullPage = ({ impedance }) => {
  const R = impedance?.tympanometry?.right || {};
  const L = impedance?.tympanometry?.left || {};
  return (
    <div className="page-break-before">
      <SectionTitle>Tympanometry & Immittance</SectionTitle>
      <div className="flex gap-3">
        <div className="flex-1">
          <div className="text-[11px] font-bold text-red-600 mb-1">Right Ear</div>
          <div className="h-[260px] border border-gray-300 rounded">
            <TympanogramCanvas
              jergerType={effectiveJerger(R)}
              mePressure={R.me_pressure}
              compliance={R.compliance}
              volume={R.volume}
              earSide="right"
            />
          </div>
        </div>
        <div className="flex-1">
          <div className="text-[11px] font-bold text-blue-600 mb-1">Left Ear</div>
          <div className="h-[260px] border border-gray-300 rounded">
            <TympanogramCanvas
              jergerType={effectiveJerger(L)}
              mePressure={L.me_pressure}
              compliance={L.compliance}
              volume={L.volume}
              earSide="left"
            />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <TympanometrySummaryTable impedance={impedance} />
      </div>
      {impedance?.acoustic_reflex?.enabled && (
        <ReflexTable title="Acoustic Reflex" reflex={impedance.acoustic_reflex} freqs={['250', '500', '1000', '2000', '4000']} />
      )}
      {impedance?.reflex_decay?.enabled && (
        <ReflexTable title="Reflex Decay" reflex={impedance.reflex_decay} freqs={['500', '1000']} />
      )}
      {impedance?.et_dysfunction?.enabled && <ETTable et={impedance.et_dysfunction} />}
    </div>
  );
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

const PureToneSection = ({ rightEar, leftEar, mode = 'combined', tuningFork, showTuningForkMini = false }) => {
  if (mode === 'separate') {
    return (
      <div>
        <SectionTitle>Puretone Audiometry</SectionTitle>
        <div className="flex gap-2">
          <div className="flex-1 h-[300px]">
            <ReportAudiogram rightEarData={rightEar} leftEarData={null} title="Right Ear" />
          </div>
          <div className="flex-1 h-[300px]">
            <ReportAudiogram rightEarData={null} leftEarData={leftEar} title="Left Ear" />
          </div>
        </div>
        <div className="flex gap-3 mt-2 items-start">
          <div className="flex-1 text-[10px] text-gray-600 flex flex-wrap gap-x-4 gap-y-0.5 pt-1">
            <span><span className="text-red-600 font-bold">O</span> Right AC · <span className="text-red-600 font-bold">&lt;</span> Right BC</span>
            <span><span className="text-blue-600 font-bold">X</span> Left AC · <span className="text-blue-600 font-bold">&gt;</span> Left BC</span>
            <span>↙↘ No Response</span>
          </div>
          <div className="w-[220px] flex-shrink-0 flex flex-col gap-2">
            <PTAMiniTable rightEar={rightEar} leftEar={leftEar} />
            {showTuningForkMini && <TuningForkMiniTable tf={tuningFork} />}
          </div>
        </div>
      </div>
    );
  }
  // combined (default) — PTA mini-table (and optional Tuning Fork mini) in the right sidebar
  return (
    <div>
      <SectionTitle>Puretone Audiometry</SectionTitle>
      <div className="flex gap-3">
        <div className="flex-1 h-[320px]">
          <ReportAudiogram rightEarData={rightEar} leftEarData={leftEar} />
        </div>
        <div className="w-[200px] flex flex-col gap-2 text-[10px] text-gray-700">
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
          <PTAMiniTable rightEar={rightEar} leftEar={leftEar} />
          {showTuningForkMini && <TuningForkMiniTable tf={tuningFork} />}
        </div>
      </div>
    </div>
  );
};

// Compact PTA table placed below the legend (or below charts in separate mode).
// PTA 1 = avg of 500, 1K, 2K Hz (AC); PTA 2 = avg of 1K, 2K, 4K Hz (AC)
const PTAMiniTable = ({ rightEar, leftEar }) => {
  const rP1 = ptaAvg(rightEar, 'ac_measurements', [500, 1000, 2000]);
  const rP2 = ptaAvg(rightEar, 'ac_measurements', [1000, 2000, 4000]);
  const lP1 = ptaAvg(leftEar,  'ac_measurements', [500, 1000, 2000]);
  const lP2 = ptaAvg(leftEar,  'ac_measurements', [1000, 2000, 4000]);
  // BC PTA 1 averages (for AB Gap calculation)
  const rB1 = ptaAvg(rightEar, 'bc_measurements', [500, 1000, 2000]);
  const lB1 = ptaAvg(leftEar,  'bc_measurements', [500, 1000, 2000]);
  const rABG = rP1 !== null && rB1 !== null ? rP1 - rB1 : null;
  const lABG = lP1 !== null && lB1 !== null ? lP1 - lB1 : null;
  return (
    <div className="border border-gray-300 rounded bg-white">
      <div className="text-[10px] font-bold text-gray-700 bg-gray-100 text-center py-0.5 border-b border-gray-300">
        PTA Summary (dB HL)
      </div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="px-1.5 py-0.5 text-left font-semibold text-gray-600">Ear</th>
            <th className="px-1.5 py-0.5 font-semibold text-gray-700" title="Average of 500, 1000, 2000 Hz">PTA 1</th>
            <th className="px-1.5 py-0.5 font-semibold text-gray-700" title="Average of 1000, 2000, 4000 Hz">PTA 2</th>
            <th className="px-1.5 py-0.5 font-semibold text-gray-700" title="AC PTA1 − BC PTA1 (500·1K·2K Hz)">AB Gap</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-100">
            <td className="px-1.5 py-0.5 font-semibold text-red-600">R</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{rP1 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{rP2 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{rABG ?? '—'}</td>
          </tr>
          <tr>
            <td className="px-1.5 py-0.5 font-semibold text-blue-600">L</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{lP1 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{lP2 ?? '—'}</td>
            <td className="px-1.5 py-0.5 text-center font-mono">{lABG ?? '—'}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[8px] text-gray-500 px-1.5 py-0.5 border-t border-gray-200 leading-tight">
        PTA 1: 500·1K·2K · PTA 2: 1K·2K·4K · AB Gap: AC−BC @ PTA 1
      </div>
    </div>
  );
};

const TuningForkSection = ({ tf = {}, showABC = false, showBing = false }) => {
  const rows = [];
  rows.push({ id: 'rinne', label: 'Rinne', r: pick(LABELS.rinne, tf.rinne_right), l: pick(LABELS.rinne, tf.rinne_left), notes: tf.rinne_notes || '' });
  rows.push({ id: 'weber', label: 'Weber', both: pick(LABELS.weber, tf.weber), notes: tf.weber_notes || '' });
  if (showABC) rows.push({ id: 'abc', label: 'ABC', r: pick(LABELS.abc, tf.abc_right), l: pick(LABELS.abc, tf.abc_left), notes: tf.abc_notes || '' });
  if (showBing) rows.push({ id: 'bing', label: 'Bing', r: pick(LABELS.bing, tf.bing_right), l: pick(LABELS.bing, tf.bing_left), notes: tf.bing_notes || '' });
  return (
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
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="border border-gray-400 px-2 py-0.5 font-medium">{r.label}</td>
              {r.both ? (
                <td className="border border-gray-400 px-2 py-0.5" colSpan={2}>{r.both}</td>
              ) : (
                <>
                  <td className="border border-gray-400 px-2 py-0.5">{r.r}</td>
                  <td className="border border-gray-400 px-2 py-0.5">{r.l}</td>
                </>
              )}
              <td className="border border-gray-400 px-2 py-0.5">{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Compact Rinne + Weber micro-table (lives inside PTA sidebar when ABC/Bing are OFF)
const TuningForkMiniTable = ({ tf = {} }) => (
  <div className="border border-gray-300 rounded bg-white">
    <div className="text-[10px] font-bold text-gray-700 bg-gray-100 text-center py-0.5 border-b border-gray-300">
      Tuning Fork ({tf.frequency_hz || 512} Hz)
    </div>
    <table className="w-full text-[10px]">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="px-1.5 py-0.5 text-left font-semibold text-gray-600">Test</th>
          <th className="px-1.5 py-0.5 font-semibold text-gray-700">R</th>
          <th className="px-1.5 py-0.5 font-semibold text-gray-700">L</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-gray-100">
          <td className="px-1.5 py-0.5 font-medium">Rinne</td>
          <td className="px-1.5 py-0.5 text-center">{pick(LABELS.rinne, tf.rinne_right)}</td>
          <td className="px-1.5 py-0.5 text-center">{pick(LABELS.rinne, tf.rinne_left)}</td>
        </tr>
        <tr>
          <td className="px-1.5 py-0.5 font-medium">Weber</td>
          <td className="px-1.5 py-0.5 text-center" colSpan={2}>{pick(LABELS.weber, tf.weber)}</td>
        </tr>
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
  impedanceData,
  sessionId,
  audiologistName,
  clinicalImpression,
  recommendations,
  audiogramMode = 'combined',
  onPersist, // (partial) => save to backend
}) => {
  // Section order + visibility state
  const [sections, setSections] = useState(
    TOGGLEABLE_SECTIONS.map((s) => ({ id: s.id, label: s.label, enabled: s.defaultEnabled }))
  );
  const [resultsText, setResultsText] = useState(clinicalImpression || '');
  const [recText, setRecText] = useState((recommendations || []).join('\n'));
  const [license, setLicense] = useState('');
  // Tympanometry placement: auto | inline | separate
  const [tympPlacement, setTympPlacement] = useState('auto');
  // Tuning fork — Rinne + Weber always. ABC / Bing opt-in.
  const [showABC, setShowABC] = useState(false);
  const [showBing, setShowBing] = useState(false);
  const tuningForkFull = showABC || showBing;
  // Clinic branding (persisted to localStorage)
  const [clinic, setClinic] = useState(loadClinic);
  const logoFileRef = useRef(null);

  // Persist branding whenever changed
  useEffect(() => {
    try {
      localStorage.setItem(CLINIC_STORAGE_KEY, JSON.stringify(clinic));
    } catch { /* ignore quota errors */ }
  }, [clinic]);

  const handleLogoUpload = async (file) => {
    if (!file) return;
    try {
      const b64 = await fileToResizedBase64(file, 400);
      setClinic((c) => ({ ...c, logo_base64: b64 }));
    } catch (err) {
      console.error('Logo upload failed', err);
    }
  };
  const updateClinic = (patch) => setClinic((c) => ({ ...c, ...patch }));

  // Auto rule: if Reflex Decay or ET Dysfunction are enabled, default to separate page
  const autoSeparatePage = !!(
    impedanceData?.reflex_decay?.enabled || impedanceData?.et_dysfunction?.enabled
  );
  const useSeparatePage =
    tympPlacement === 'separate' ||
    (tympPlacement === 'auto' && autoSeparatePage);

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
        return (
          <PureToneSection
            key={id}
            rightEar={rightEarData}
            leftEar={leftEarData}
            mode={audiogramMode}
            tuningFork={preTestData?.tuning_fork}
            showTuningForkMini={!tuningForkFull}
          />
        );
      case 'tuning_fork':
        // If no ABC or Bing requested, skip main-body section (data is shown inline in PTA sidebar)
        return tuningForkFull
          ? <TuningForkSection key={id} tf={preTestData?.tuning_fork} showABC={showABC} showBing={showBing} />
          : null;
      case 'otoscopy':
        return <OtoscopySection key={id} ot={preTestData?.otoscopy} />;
      case 'speech':
        return <PlaceholderTable key={id} title="Speech Audiometry" columns={['SAT', 'SRT', 'Mask', 'MCL', 'UCL', 'WR %', 'WR Level']} />;
      case 'tympanometry':
        // Inline render at this slot ONLY if not using separate page
        return useSeparatePage ? null : <TympanometryInlineSection key={id} impedance={impedanceData} />;
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

          {/* ========== Clinic Branding ========== */}
          <details className="bg-gray-50 border border-gray-200 rounded overflow-hidden" data-testid="clinic-branding-details">
            <summary className="cursor-pointer px-2 py-1 text-[11px] font-bold text-gray-700 bg-gray-100 hover:bg-gray-200">
              Clinic Branding
            </summary>
            <div className="p-2 space-y-1.5">
              {/* Logo */}
              <div>
                <div className="text-[10px] font-semibold text-gray-600 mb-1">Logo</div>
                <div className="flex items-start gap-2">
                  {clinic.logo_base64 ? (
                    <div className="relative group flex-shrink-0">
                      <img
                        src={clinic.logo_base64}
                        alt="Clinic logo"
                        data-testid="clinic-logo-preview"
                        className={`bg-white border border-gray-300 object-contain ${
                          clinic.logo_shape === 'circle'
                            ? 'w-14 h-14 rounded-full'
                            : clinic.logo_shape === 'rectangle'
                            ? 'w-20 h-12 rounded'
                            : 'w-14 h-14 rounded'
                        }`}
                      />
                      <button
                        onClick={() => updateClinic({ logo_base64: null })}
                        data-testid="clinic-logo-remove"
                        className="absolute -top-1 -right-1 bg-white text-red-600 text-[9px] font-bold px-1 rounded-full border border-red-300 opacity-0 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => logoFileRef.current?.click()}
                      data-testid="clinic-logo-upload"
                      className="w-14 h-14 border-2 border-dashed border-gray-300 rounded flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 bg-white text-[9px]"
                    >
                      Upload
                    </button>
                  )}
                  <div className="flex-1 flex flex-col gap-1">
                    <button
                      onClick={() => logoFileRef.current?.click()}
                      data-testid="clinic-logo-change"
                      className="px-1.5 py-0.5 text-[10px] border border-gray-300 rounded hover:bg-gray-100"
                    >
                      {clinic.logo_base64 ? 'Change' : 'Pick file'}
                    </button>
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                      className="hidden"
                    />
                    <div className="flex gap-0.5" data-testid="clinic-logo-shape">
                      {[
                        { k: 'circle', label: '●' },
                        { k: 'square', label: '■' },
                        { k: 'rectangle', label: '▭' },
                      ].map((s) => (
                        <button
                          key={s.k}
                          onClick={() => updateClinic({ logo_shape: s.k })}
                          data-testid={`clinic-logo-shape-${s.k}`}
                          title={s.k}
                          className={`flex-1 px-1 py-0.5 text-[11px] border rounded ${
                            clinic.logo_shape === s.k
                              ? 'bg-blue-100 border-blue-400 text-blue-700 font-bold'
                              : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Text fields */}
              <div>
                <div className="text-[10px] font-semibold text-gray-600">Clinic name</div>
                <input
                  type="text"
                  data-testid="clinic-name"
                  value={clinic.name}
                  onChange={(e) => updateClinic({ name: e.target.value })}
                  className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5"
                />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-600">Tagline</div>
                <input
                  type="text"
                  data-testid="clinic-tagline"
                  value={clinic.tagline}
                  onChange={(e) => updateClinic({ tagline: e.target.value })}
                  className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5"
                />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-600">Address line 1</div>
                <input
                  type="text"
                  data-testid="clinic-address-1"
                  value={clinic.address_line1}
                  onChange={(e) => updateClinic({ address_line1: e.target.value })}
                  className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5"
                />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-600">Address line 2</div>
                <input
                  type="text"
                  data-testid="clinic-address-2"
                  value={clinic.address_line2}
                  onChange={(e) => updateClinic({ address_line2: e.target.value })}
                  className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <div className="text-[10px] font-semibold text-gray-600">Phone</div>
                  <input
                    type="text"
                    data-testid="clinic-tel"
                    value={clinic.tel}
                    onChange={(e) => updateClinic({ tel: e.target.value })}
                    className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-gray-600">Email</div>
                  <input
                    type="text"
                    data-testid="clinic-email"
                    value={clinic.email}
                    onChange={(e) => updateClinic({ email: e.target.value })}
                    className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5"
                  />
                </div>
              </div>
              <button
                onClick={() => setClinic(DEFAULT_CLINIC)}
                data-testid="clinic-reset"
                className="w-full mt-1 text-[10px] text-gray-500 hover:text-red-600 underline"
              >
                Reset to defaults
              </button>
            </div>
          </details>

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
            <div className="text-[10px] font-bold text-gray-600 mt-2 mb-1">Tuning Fork extras</div>
            <div className="text-[10px] text-gray-500 mb-1">
              Rinne + Weber show inline below PTA by default. Enable below to add a full-section with notes.
            </div>
            <div className="grid grid-cols-2 gap-1">
              <label className={`flex items-center gap-1 px-2 py-1 text-[11px] border rounded cursor-pointer ${showABC ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-300'}`}>
                <input
                  type="checkbox"
                  checked={showABC}
                  onChange={(e) => setShowABC(e.target.checked)}
                  data-testid="report-show-abc"
                  className="w-3.5 h-3.5"
                />
                <span className="font-medium">Show ABC</span>
              </label>
              <label className={`flex items-center gap-1 px-2 py-1 text-[11px] border rounded cursor-pointer ${showBing ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-300'}`}>
                <input
                  type="checkbox"
                  checked={showBing}
                  onChange={(e) => setShowBing(e.target.checked)}
                  data-testid="report-show-bing"
                  className="w-3.5 h-3.5"
                />
                <span className="font-medium">Show Bing</span>
              </label>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold text-gray-600 mt-2 mb-1">Tympanometry placement</div>
            <div className="flex gap-1">
              {[
                { k: 'auto', label: 'Auto', title: 'Separate page if Decay or ET enabled, else inline' },
                { k: 'inline', label: 'Inline', title: 'Always on main page' },
                { k: 'separate', label: 'New page', title: 'Always on a dedicated page' },
              ].map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setTympPlacement(opt.k)}
                  data-testid={`report-tymp-placement-${opt.k}`}
                  title={opt.title}
                  className={`flex-1 px-1 py-1 text-[10px] font-medium border rounded ${
                    tympPlacement === opt.k
                      ? 'bg-blue-100 border-blue-400 text-blue-700 font-bold'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-gray-500 mt-0.5 italic">
              Currently: {useSeparatePage ? 'Separate page' : 'Inline on main page'}
              {tympPlacement === 'auto' && autoSeparatePage ? ' (auto — Decay/ET enabled)' : ''}
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
          {/* ===== HEADER (logo + clinic info on row 1, title on row 2) ===== */}
          <header className="border-b-2 border-blue-700 pb-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {clinic.logo_base64 ? (
                  <img
                    src={clinic.logo_base64}
                    alt={`${clinic.name} logo`}
                    className={`bg-white border border-gray-200 object-contain flex-shrink-0 ${
                      clinic.logo_shape === 'circle'
                        ? 'w-16 h-16 rounded-full'
                        : clinic.logo_shape === 'rectangle'
                        ? 'w-24 h-14 rounded'
                        : 'w-16 h-16 rounded'
                    }`}
                  />
                ) : (
                  <div className={`bg-blue-700 text-white flex items-center justify-center font-black text-xl flex-shrink-0 ${
                    clinic.logo_shape === 'circle'
                      ? 'w-16 h-16 rounded-full'
                      : clinic.logo_shape === 'rectangle'
                      ? 'w-24 h-14 rounded'
                      : 'w-16 h-16 rounded'
                  }`}>
                    {(clinic.name || 'C').trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-500 truncate">{clinic.tagline}</div>
                  <div className="text-[18px] font-extrabold text-blue-900 leading-tight truncate">{clinic.name}</div>
                </div>
              </div>
              <div className="text-[10px] text-right text-gray-700 leading-tight flex-shrink-0">
                {clinic.address_line1 && <div>{clinic.address_line1}</div>}
                {clinic.address_line2 && <div>{clinic.address_line2}</div>}
                {clinic.tel && <div>Tel: {clinic.tel}</div>}
                {clinic.email && <div>{clinic.email}</div>}
              </div>
            </div>
            {/* Title one step below */}
            <div className="text-center mt-2">
              <h1 className="text-[20px] font-extrabold text-gray-800 tracking-wide">Hearing Assessment</h1>
            </div>
          </header>

          {/* ===== PATIENT INFO (compact single-row strip) ===== */}
          <section className="mt-2 border border-gray-400 text-[11px] flex flex-wrap items-stretch">
            {[
              { label: 'Patient', value: patient.name || '—', flex: 'min-w-[180px] flex-[2]' },
              { label: 'MRD',     value: patient.patient_id || '—', flex: 'min-w-[120px] flex-1' },
              { label: 'DOB',     value: patient.dob || '—',        flex: 'min-w-[90px]' },
              { label: 'Age',     value: String(patient.age ?? '—'), flex: 'min-w-[60px]' },
              { label: 'Gender',  value: patient.gender || '—',     flex: 'min-w-[80px]' },
              { label: 'Audiologist', value: audiologistName || '—', flex: 'min-w-[130px] flex-1' },
              { label: 'Date',    value: fmtDate(),                  flex: 'min-w-[90px]' },
              { label: 'Session', value: sessionId || '—',           flex: 'min-w-[150px]' },
            ].map((c, i, arr) => (
              <div
                key={c.label}
                className={`${c.flex} px-2 py-0.5 ${i < arr.length - 1 ? 'border-r border-gray-300' : ''}`}
              >
                <span className="text-[9px] uppercase text-gray-500 mr-1">{c.label}:</span>
                <span className="font-semibold text-[11px]">{c.value}</span>
              </div>
            ))}
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

          {/* Tympanometry (separate page) */}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsPanel;
