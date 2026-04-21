import React from 'react';
import { CFField, CFSelect, CFSectionRow, CFFreqTable } from './ClinicalFormKit';

// Pediatric audiology — BOA / VRA / Play / Soundfield behavioural thresholds.
const PED_FREQS = [500, 1000, 2000, 4000];
const TECHNIQUES = ['BOA (Behavioural Observation)', 'VRA (Visual Reinforcement)', 'Play audiometry', 'Conditioned Play'];
const RELIABILITY = ['Good', 'Fair', 'Poor'];

const PediatricPanel = ({ data, onChange }) => {
  const f = data?.fields || {};
  const setF = (k, v) => {
    const next = { ...f };
    if (v === '' || v === null || v === undefined) delete next[k];
    else next[k] = v;
    onChange({ ...(data || {}), fields: next });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3">
      <CFSectionRow tag="Child" subtitle="Chronological and developmental information">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField label="Chronological age" testId="ped-age" value={f.ped_age} onChange={(v) => setF('ped_age', v)} width="w-24" placeholder="18 mo" />
          <CFField label="Developmental age" testId="ped-dev-age" value={f.ped_dev_age} onChange={(v) => setF('ped_dev_age', v)} width="w-24" />
          <CFSelect label="Test technique" testId="ped-technique" value={f.ped_technique} onChange={(v) => setF('ped_technique', v)} options={TECHNIQUES} />
          <CFSelect label="Reliability" testId="ped-reliability" value={f.ped_reliability} onChange={(v) => setF('ped_reliability', v)} options={RELIABILITY} />
          <CFField label="Reinforcer" testId="ped-reinforcer" value={f.ped_reinforcer} onChange={(v) => setF('ped_reinforcer', v)} placeholder="Toy / Video" width="w-24" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Behavioural thresholds" subtitle="Minimum response levels (dB HL) via selected technique">
        <CFFreqTable
          freqs={PED_FREQS}
          rowsPerEar={[
            { key: 'ac', label: 'AC' },
            { key: 'bc', label: 'BC' },
          ]}
          fields={f}
          setField={setF}
          prefix="ped"
          testPrefix="ped"
        />
      </CFSectionRow>

      <CFSectionRow tag="Soundfield" subtitle="Aided & unaided soundfield minimum response levels">
        <CFFreqTable
          freqs={PED_FREQS}
          rowsPerEar={[{ key: 'sf', label: '' }]}
          fields={f}
          setField={setF}
          prefix="ped_sf"
          testPrefix="ped-sf"
        />
        <div className="mt-2 flex gap-6 items-end flex-wrap">
          <CFField label="Ling 6 sounds (/a, /u, /i, /s, /sh, /m)" testId="ped-ling" value={f.ped_ling} onChange={(v) => setF('ped_ling', v)} width="w-72" placeholder="detected / identified" />
          <CFField label="Speech awareness (dB HL)" testId="ped-sat" value={f.ped_sat} onChange={(v) => setF('ped_sat', v)} width="w-24" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Parent report" subtitle="IT-MAIS / P.E.A.C.H. / developmental milestones">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField label="IT-MAIS score"   testId="ped-itmais" value={f.ped_itmais} onChange={(v) => setF('ped_itmais', v)} width="w-16" />
          <CFField label="P.E.A.C.H. (%)"  testId="ped-peach"  value={f.ped_peach}  onChange={(v) => setF('ped_peach', v)}  width="w-16" />
          <CFField label="Speech milestones met?" testId="ped-milestones" value={f.ped_milestones} onChange={(v) => setF('ped_milestones', v)} width="w-32" placeholder="Age-appropriate" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Impression" subtitle="">
        <textarea
          value={f.ped_impression ?? ''}
          onChange={(e) => setF('ped_impression', e.target.value)}
          data-testid="ped-impression"
          rows={2}
          placeholder="VRA responses consistent to 30 dB HL at 500–4000 Hz bilaterally; age-appropriate speech-language milestones…"
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
        />
      </CFSectionRow>
    </div>
  );
};

export default PediatricPanel;
