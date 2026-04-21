import React from 'react';
import { CFField, CFSelect, CFSectionRow, CFFreqTable } from './ClinicalFormKit';

// Otoacoustic Emissions (OAE): DPOAE + TEOAE tables.
const DPOAE_FREQS = [1000, 1500, 2000, 3000, 4000, 6000, 8000];
const TEOAE_FREQS = [1000, 1500, 2000, 3000, 4000];
const PASS_REFER = ['Pass', 'Refer', 'Incomplete'];

const OAEPanel = ({ data, onChange }) => {
  const f = data?.fields || {};
  const setF = (k, v) => {
    const next = { ...f };
    if (v === '' || v === null || v === undefined) delete next[k];
    else next[k] = v;
    onChange({ ...(data || {}), fields: next });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3">
      <CFSectionRow tag="DPOAE" subtitle="Distortion Product OAE — f₂ frequency × response (SNR in dB)">
        <CFFreqTable
          freqs={DPOAE_FREQS}
          rowsPerEar={[
            { key: 'snr',  label: 'SNR (dB)' },
            { key: 'resp', label: 'Response' },
            { key: 'nf',   label: 'Noise floor (dB)' },
          ]}
          fields={f}
          setField={setF}
          prefix="dpoae"
          testPrefix="dpoae"
        />
        <div className="mt-2 flex gap-6 items-end flex-wrap">
          <CFSelect label="R — Overall"     labelColor="text-red-600"  testId="dpoae-r-overall" value={f.dpoae_r_overall} onChange={(v) => setF('dpoae_r_overall', v)} options={PASS_REFER} />
          <CFSelect label="L — Overall"     labelColor="text-blue-600" testId="dpoae-l-overall" value={f.dpoae_l_overall} onChange={(v) => setF('dpoae_l_overall', v)} options={PASS_REFER} />
          <CFField label="Stimulus (L1/L2)" testId="dpoae-stim" value={f.dpoae_stim} onChange={(v) => setF('dpoae_stim', v)} placeholder="65/55 dB SPL" width="w-24" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="TEOAE" subtitle="Transient Evoked OAE — broadband click, overall SNR & reproducibility">
        <CFFreqTable
          freqs={TEOAE_FREQS}
          rowsPerEar={[
            { key: 'snr',   label: 'SNR (dB)' },
            { key: 'repro', label: 'Reproducibility (%)' },
          ]}
          fields={f}
          setField={setF}
          prefix="teoae"
          testPrefix="teoae"
        />
        <div className="mt-2 flex gap-6 items-end flex-wrap">
          <CFField label="R — Overall SNR (dB)"    labelColor="text-red-600"  testId="teoae-r-snr"   value={f.teoae_r_snr}   onChange={(v) => setF('teoae_r_snr', v)} />
          <CFField label="R — Reproducibility (%)" labelColor="text-red-600"  testId="teoae-r-repro" value={f.teoae_r_repro} onChange={(v) => setF('teoae_r_repro', v)} />
          <CFField label="L — Overall SNR (dB)"    labelColor="text-blue-600" testId="teoae-l-snr"   value={f.teoae_l_snr}   onChange={(v) => setF('teoae_l_snr', v)} />
          <CFField label="L — Reproducibility (%)" labelColor="text-blue-600" testId="teoae-l-repro" value={f.teoae_l_repro} onChange={(v) => setF('teoae_l_repro', v)} />
        </div>
        <div className="mt-2 flex gap-6 items-end flex-wrap">
          <CFSelect label="R — Pass/Refer" labelColor="text-red-600"  testId="teoae-r-result" value={f.teoae_r_result} onChange={(v) => setF('teoae_r_result', v)} options={PASS_REFER} />
          <CFSelect label="L — Pass/Refer" labelColor="text-blue-600" testId="teoae-l-result" value={f.teoae_l_result} onChange={(v) => setF('teoae_l_result', v)} options={PASS_REFER} />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Impression" subtitle="OAE impression — cochlear OHC function">
        <textarea
          value={f.oae_impression ?? ''}
          onChange={(e) => setF('oae_impression', e.target.value)}
          data-testid="oae-impression"
          rows={2}
          placeholder="Robust emissions bilaterally — intact OHC function. / Emissions absent on right consistent with cochlear loss…"
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
        />
      </CFSectionRow>
    </div>
  );
};

export default OAEPanel;
