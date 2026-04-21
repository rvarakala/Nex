import React from 'react';
import { CFField, CFSelect, CFSectionRow } from './ClinicalFormKit';

// Special Tests — Diagnostic site-of-lesion & pseudo-hypacusis battery.
// All values are captured as free-form strings via `data.fields` dict.
const BEKESY_TYPES = ['Type I', 'Type II', 'Type III', 'Type IV', 'Type V'];
const POS_NEG = ['Positive', 'Negative', 'Equivocal'];
const REC_NONREC = ['Recruitment', 'No recruitment', 'Decruitment'];

const SpecialTestsPanel = ({ data, onChange }) => {
  const f = data?.fields || {};
  const setF = (k, v) => {
    const next = { ...f };
    if (v === '' || v === null || v === undefined) delete next[k];
    else next[k] = v;
    onChange({ ...(data || {}), fields: next });
  };

  const EarRow = ({ testPrefix, testId }) => (
    <div className="flex gap-6 items-end">
      <CFField label="R" labelColor="text-red-600"  testId={`${testId}-r`} value={f[`${testPrefix}_r`]} onChange={(v) => setF(`${testPrefix}_r`, v)} />
      <CFField label="L" labelColor="text-blue-600" testId={`${testId}-l`} value={f[`${testPrefix}_l`]} onChange={(v) => setF(`${testPrefix}_l`, v)} />
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3">
      <CFSectionRow tag="SISI" subtitle="Short Increment Sensitivity Index (@ 2kHz, 20 dB SL, 1-dB increments) — score in %">
        <EarRow testPrefix="sisi" testId="sisi" />
      </CFSectionRow>

      <CFSectionRow tag="TDT" subtitle="Tone Decay Test (500 Hz / 2000 Hz, duration in seconds at threshold)">
        <div className="space-y-2">
          {[500, 2000].map((hz) => (
            <div key={hz} className="flex gap-6 items-end">
              <div className="text-[10px] font-semibold text-gray-600 w-12">{hz} Hz</div>
              <CFField label="R" labelColor="text-red-600"  testId={`tdt-${hz}-r`} value={f[`tdt_${hz}_r`]} onChange={(v) => setF(`tdt_${hz}_r`, v)} />
              <CFField label="L" labelColor="text-blue-600" testId={`tdt-${hz}-l`} value={f[`tdt_${hz}_l`]} onChange={(v) => setF(`tdt_${hz}_l`, v)} />
            </div>
          ))}
        </div>
      </CFSectionRow>

      <CFSectionRow tag="ABLB" subtitle="Alternate Binaural Loudness Balance — indicate recruitment">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField label="Test frequency (Hz)" testId="ablb-freq" value={f.ablb_freq} onChange={(v) => setF('ablb_freq', v)} width="w-24" />
          <CFSelect label="Result" testId="ablb-result" value={f.ablb_result} onChange={(v) => setF('ablb_result', v)} options={REC_NONREC} />
          <CFField label="Notes" testId="ablb-notes" value={f.ablb_notes} onChange={(v) => setF('ablb_notes', v)} width="w-48" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="MLB" subtitle="Monaural Loudness Balance — for unilateral loss at test frequency">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField label="Test frequency (Hz)" testId="mlb-freq" value={f.mlb_freq} onChange={(v) => setF('mlb_freq', v)} width="w-24" />
          <CFField label="Reference freq (Hz)" testId="mlb-ref-freq" value={f.mlb_ref_freq} onChange={(v) => setF('mlb_ref_freq', v)} width="w-24" />
          <CFSelect label="Result" testId="mlb-result" value={f.mlb_result} onChange={(v) => setF('mlb_result', v)} options={REC_NONREC} />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Stenger" subtitle="Pure Tone Stenger — for suspected pseudo-hypacusis">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField label="Test frequency (Hz)" testId="stenger-freq" value={f.stenger_freq} onChange={(v) => setF('stenger_freq', v)} width="w-24" />
          <CFSelect label="Result"              testId="stenger-result" value={f.stenger_result} onChange={(v) => setF('stenger_result', v)} options={POS_NEG} />
          <CFField label="Notes" testId="stenger-notes" value={f.stenger_notes} onChange={(v) => setF('stenger_notes', v)} width="w-48" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Bekesy" subtitle="Continuous vs. pulsed tracing pattern">
        <div className="flex gap-6 items-end flex-wrap">
          <CFSelect label="R — Type" labelColor="text-red-600"  testId="bekesy-r" value={f.bekesy_r} onChange={(v) => setF('bekesy_r', v)} options={BEKESY_TYPES} />
          <CFSelect label="L — Type" labelColor="text-blue-600" testId="bekesy-l" value={f.bekesy_l} onChange={(v) => setF('bekesy_l', v)} options={BEKESY_TYPES} />
          <CFField label="Notes" testId="bekesy-notes" value={f.bekesy_notes} onChange={(v) => setF('bekesy_notes', v)} width="w-60" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Impression" subtitle="Overall site-of-lesion / diagnostic impression from the special tests battery">
        <textarea
          value={f.st_impression ?? ''}
          onChange={(e) => setF('st_impression', e.target.value)}
          data-testid="st-impression"
          rows={2}
          placeholder="Findings consistent with cochlear lesion / retrocochlear suspicion / pseudo-hypacusis suspected…"
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
        />
      </CFSectionRow>
    </div>
  );
};

export default SpecialTestsPanel;
