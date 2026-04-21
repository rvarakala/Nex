import React from 'react';
import { CFField, CFSelect, CFSectionRow } from './ClinicalFormKit';

// Tinnitus evaluation — psychoacoustic match + severity + masking.
const TINNITUS_TYPES = ['Pure tone', 'Narrow-band noise', 'Broadband noise', 'Ringing', 'Buzzing', 'Roaring', 'Hissing', 'Other'];
const THI_GRADES = ['Grade 1 (Slight: 0-16)', 'Grade 2 (Mild: 18-36)', 'Grade 3 (Moderate: 38-56)', 'Grade 4 (Severe: 58-76)', 'Grade 5 (Catastrophic: 78-100)'];

const TinnitusPanel = ({ data, onChange }) => {
  const f = data?.fields || {};
  const setF = (k, v) => {
    const next = { ...f };
    if (v === '' || v === null || v === undefined) delete next[k];
    else next[k] = v;
    onChange({ ...(data || {}), fields: next });
  };

  const EarBlock = ({ ear, earLabel, earColor }) => (
    <div className="flex-1 min-w-0 space-y-2">
      <div className={`text-[11px] font-bold ${earColor} pb-1 border-b border-gray-200`}>{earLabel} Ear</div>
      <div className="flex gap-3 items-end flex-wrap">
        <CFSelect label="Sound type"            testId={`tin-${ear}-type`} value={f[`tin_${ear}_type`]} onChange={(v) => setF(`tin_${ear}_type`, v)} options={TINNITUS_TYPES} />
        <CFField  label="Pitch match (Hz)"      testId={`tin-${ear}-pitch`} value={f[`tin_${ear}_pitch`]} onChange={(v) => setF(`tin_${ear}_pitch`, v)} width="w-20" />
        <CFField  label="Loudness match (dB SL)" testId={`tin-${ear}-loud`} value={f[`tin_${ear}_loud`]}  onChange={(v) => setF(`tin_${ear}_loud`, v)}  width="w-20" />
        <CFField  label="MML (dB SL)"           testId={`tin-${ear}-mml`}   value={f[`tin_${ear}_mml`]}   onChange={(v) => setF(`tin_${ear}_mml`, v)}   width="w-20" />
        <CFField  label="Residual inhibition"   testId={`tin-${ear}-ri`}    value={f[`tin_${ear}_ri`]}    onChange={(v) => setF(`tin_${ear}_ri`, v)}    width="w-24" placeholder="Complete / Partial / None" />
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3">
      <CFSectionRow tag="History" subtitle="Patient-reported tinnitus characteristics">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField  label="Duration"      testId="tin-duration" value={f.tin_duration} onChange={(v) => setF('tin_duration', v)} placeholder="2 years" width="w-24" />
          <CFField  label="Onset"         testId="tin-onset"    value={f.tin_onset}    onChange={(v) => setF('tin_onset', v)}    placeholder="Sudden / gradual" width="w-28" />
          <CFField  label="Laterality"    testId="tin-later"    value={f.tin_later}    onChange={(v) => setF('tin_later', v)}    placeholder="R / L / Both / Head" width="w-28" />
          <CFField  label="Character"     testId="tin-char"     value={f.tin_char}     onChange={(v) => setF('tin_char', v)}     placeholder="Constant / intermittent / pulsatile" width="w-40" />
          <CFField  label="Triggers"      testId="tin-trig"     value={f.tin_trig}     onChange={(v) => setF('tin_trig', v)}     placeholder="Noise, stress…" width="w-32" />
          <CFField  label="Sleep impact"  testId="tin-sleep"    value={f.tin_sleep}    onChange={(v) => setF('tin_sleep', v)}    placeholder="None / mild / severe" width="w-28" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Psychoacoustic" subtitle="Pitch & loudness match, MML, residual inhibition — per ear">
        <div className="flex gap-6">
          <EarBlock ear="right" earLabel="Right" earColor="text-red-600" />
          <EarBlock ear="left"  earLabel="Left"  earColor="text-blue-600" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="THI" subtitle="Tinnitus Handicap Inventory — 25 items, total 0–100, higher = more handicap">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField  label="Total score (0-100)" testId="thi-score" value={f.thi_score} onChange={(v) => setF('thi_score', v)} width="w-20" />
          <CFSelect label="THI grade"           testId="thi-grade" value={f.thi_grade} onChange={(v) => setF('thi_grade', v)} options={THI_GRADES} />
          <CFField  label="F subscale (1-48)"   testId="thi-f"     value={f.thi_f}     onChange={(v) => setF('thi_f', v)}     width="w-16" />
          <CFField  label="E subscale (1-36)"   testId="thi-e"     value={f.thi_e}     onChange={(v) => setF('thi_e', v)}     width="w-16" />
          <CFField  label="C subscale (1-16)"   testId="thi-c"     value={f.thi_c}     onChange={(v) => setF('thi_c', v)}     width="w-16" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Management" subtitle="Counselling / masking / sound therapy recommendations">
        <textarea
          value={f.tin_management ?? ''}
          onChange={(e) => setF('tin_management', e.target.value)}
          data-testid="tin-management"
          rows={2}
          placeholder="Directive counselling; hearing aid trial with combined sound generator; recommended TRT evaluation…"
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
        />
      </CFSectionRow>

      <CFSectionRow tag="Impression" subtitle="">
        <textarea
          value={f.tin_impression ?? ''}
          onChange={(e) => setF('tin_impression', e.target.value)}
          data-testid="tin-impression"
          rows={2}
          placeholder="Bilateral high-frequency tinnitus matched to 6 kHz narrow-band at ~5 dB SL; moderate handicap (THI 42) — candidate for sound-enrichment therapy…"
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
        />
      </CFSectionRow>
    </div>
  );
};

export default TinnitusPanel;
