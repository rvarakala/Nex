import React from 'react';
import { CFField, CFSelect, CFSectionRow, CFFreqTable } from './ClinicalFormKit';

// ABR / ASSR — waveform latencies, inter-peak intervals, and threshold estimation.
const ASSR_FREQS = [500, 1000, 2000, 4000];
const PRESENT_ABSENT = ['Present', 'Absent', 'Equivocal', 'Delayed'];

const ABRPanel = ({ data, onChange }) => {
  const f = data?.fields || {};
  const setF = (k, v) => {
    const next = { ...f };
    if (v === '' || v === null || v === undefined) delete next[k];
    else next[k] = v;
    onChange({ ...(data || {}), fields: next });
  };

  const WaveRow = ({ ear, earLabel, earColor }) => (
    <div className="mb-2">
      <div className={`text-[11px] font-bold ${earColor} mb-1`}>{earLabel} Ear</div>
      <div className="flex gap-3 items-end flex-wrap">
        <CFField label="I (ms)"       testId={`abr-${ear}-wi`}   value={f[`abr_${ear}_wi`]}   onChange={(v) => setF(`abr_${ear}_wi`, v)} width="w-16" />
        <CFField label="III (ms)"     testId={`abr-${ear}-wiii`} value={f[`abr_${ear}_wiii`]} onChange={(v) => setF(`abr_${ear}_wiii`, v)} width="w-16" />
        <CFField label="V (ms)"       testId={`abr-${ear}-wv`}   value={f[`abr_${ear}_wv`]}   onChange={(v) => setF(`abr_${ear}_wv`, v)} width="w-16" />
        <CFField label="I-III (ms)"   testId={`abr-${ear}-ip13`} value={f[`abr_${ear}_ip13`]} onChange={(v) => setF(`abr_${ear}_ip13`, v)} width="w-16" />
        <CFField label="III-V (ms)"   testId={`abr-${ear}-ip35`} value={f[`abr_${ear}_ip35`]} onChange={(v) => setF(`abr_${ear}_ip35`, v)} width="w-16" />
        <CFField label="I-V (ms)"     testId={`abr-${ear}-ip15`} value={f[`abr_${ear}_ip15`]} onChange={(v) => setF(`abr_${ear}_ip15`, v)} width="w-16" />
        <CFSelect label="Morphology" testId={`abr-${ear}-morph`}  value={f[`abr_${ear}_morph`]} onChange={(v) => setF(`abr_${ear}_morph`, v)} options={PRESENT_ABSENT} />
        <CFField label="Threshold (dB nHL)" testId={`abr-${ear}-thresh`} value={f[`abr_${ear}_thresh`]} onChange={(v) => setF(`abr_${ear}_thresh`, v)} width="w-20" />
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3">
      <CFSectionRow tag="Setup" subtitle="Stimulus parameters">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField label="Stimulus" testId="abr-stim" value={f.abr_stim} onChange={(v) => setF('abr_stim', v)} placeholder="Click 100 μs / TB 500 Hz" width="w-32" />
          <CFField label="Rate (/sec)" testId="abr-rate" value={f.abr_rate} onChange={(v) => setF('abr_rate', v)} width="w-16" />
          <CFField label="Polarity" testId="abr-pol" value={f.abr_pol} onChange={(v) => setF('abr_pol', v)} placeholder="Alternating" width="w-24" />
          <CFField label="Filter" testId="abr-filter" value={f.abr_filter} onChange={(v) => setF('abr_filter', v)} placeholder="100-3000 Hz" width="w-24" />
          <CFField label="Sweeps" testId="abr-sweeps" value={f.abr_sweeps} onChange={(v) => setF('abr_sweeps', v)} width="w-16" />
          <CFField label="Transducer" testId="abr-trans" value={f.abr_trans} onChange={(v) => setF('abr_trans', v)} placeholder="Insert / Bone" width="w-24" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="ABR Waveforms" subtitle="Wave latencies and inter-peak intervals at supra-threshold (e.g., 80 dB nHL)">
        <WaveRow ear="right" earLabel="Right" earColor="text-red-600" />
        <WaveRow ear="left"  earLabel="Left"  earColor="text-blue-600" />
      </CFSectionRow>

      <CFSectionRow tag="ASSR" subtitle="Auditory Steady-State Response — estimated threshold (dB HL)">
        <CFFreqTable
          freqs={ASSR_FREQS}
          rowsPerEar={[{ key: '', label: '' }]}
          fields={f}
          setField={setF}
          prefix="assr"
          testPrefix="assr"
        />
      </CFSectionRow>

      <CFSectionRow tag="Impression" subtitle="Neural integrity / estimated audiogram narrative">
        <textarea
          value={f.abr_impression ?? ''}
          onChange={(e) => setF('abr_impression', e.target.value)}
          data-testid="abr-impression"
          rows={2}
          placeholder="Normal ABR morphology with repeatable Wave V at 20 dB nHL bilaterally; inter-peak intervals within normal limits — no retrocochlear indication…"
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
        />
      </CFSectionRow>
    </div>
  );
};

export default ABRPanel;
