import React from 'react';
import { CFField, CFSelect, CFSectionRow, CFFreqTable } from './ClinicalFormKit';
import SoundFieldMiniAudiogram from './SoundFieldMiniAudiogram';

// Sound Field / Aided Audiometry — warble tones, speech, noise thresholds
// plus aided-vs-unaided benefit comparison.
const SF_FREQS = [250, 500, 1000, 2000, 4000, 8000];
const STIMULI = ['Warble tone', 'Narrow-band noise', 'Speech'];

const SoundFieldPanel = ({ data, onChange }) => {
  const f = data?.fields || {};
  const setF = (k, v) => {
    const next = { ...f };
    if (v === '' || v === null || v === undefined) delete next[k];
    else next[k] = v;
    onChange({ ...(data || {}), fields: next });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-auto p-3">
      <CFSectionRow tag="Audiogram" subtitle="Aided vs Unaided soundfield thresholds — auto-plotted from the tables below">
        <div className="bg-white border border-gray-300 rounded">
          <SoundFieldMiniAudiogram fields={f} height={220} />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Setup" subtitle="Sound field configuration">
        <div className="flex gap-6 items-end flex-wrap">
          <CFSelect label="Stimulus" testId="sf-stimulus" value={f.sf_stimulus} onChange={(v) => setF('sf_stimulus', v)} options={STIMULI} />
          <CFField label="Speaker azimuth (deg)" testId="sf-azimuth" value={f.sf_azimuth} onChange={(v) => setF('sf_azimuth', v)} placeholder="0° / 45°" width="w-24" />
          <CFField label="Distance (m)" testId="sf-distance" value={f.sf_distance} onChange={(v) => setF('sf_distance', v)} width="w-16" />
          <CFField label="Calibrated to" testId="sf-cal" value={f.sf_cal} onChange={(v) => setF('sf_cal', v)} placeholder="dB HL / dB SPL" width="w-28" />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Unaided" subtitle="Unaided warble-tone thresholds (dB HL) in sound field">
        <CFFreqTable
          freqs={SF_FREQS}
          rowsPerEar={[{ key: '', label: '' }]}
          fields={f}
          setField={setF}
          prefix="sf_unaided"
          testPrefix="sf-unaided"
        />
      </CFSectionRow>

      <CFSectionRow tag="Aided" subtitle="Aided warble-tone thresholds (dB HL) with hearing aid in situ">
        <CFFreqTable
          freqs={SF_FREQS}
          rowsPerEar={[{ key: '', label: '' }]}
          fields={f}
          setField={setF}
          prefix="sf_aided"
          testPrefix="sf-aided"
        />
      </CFSectionRow>

      <CFSectionRow tag="Speech" subtitle="Aided vs. unaided speech scores in sound field">
        <div className="flex gap-6 items-end flex-wrap">
          <CFField label="SRT Unaided (dB)"  testId="sf-srt-unaided" value={f.sf_srt_unaided} onChange={(v) => setF('sf_srt_unaided', v)} />
          <CFField label="SRT Aided (dB)"    testId="sf-srt-aided"   value={f.sf_srt_aided}   onChange={(v) => setF('sf_srt_aided', v)} />
          <CFField label="WRS Unaided (%)"   testId="sf-wrs-unaided" value={f.sf_wrs_unaided} onChange={(v) => setF('sf_wrs_unaided', v)} />
          <CFField label="WRS Aided (%)"     testId="sf-wrs-aided"   value={f.sf_wrs_aided}   onChange={(v) => setF('sf_wrs_aided', v)} />
          <CFField label="Presentation (dB)" testId="sf-level"       value={f.sf_level}       onChange={(v) => setF('sf_level', v)} />
        </div>
      </CFSectionRow>

      <CFSectionRow tag="Impression" subtitle="">
        <textarea
          value={f.sf_impression ?? ''}
          onChange={(e) => setF('sf_impression', e.target.value)}
          data-testid="sf-impression"
          rows={2}
          placeholder="Functional gain of ~25 dB across 500-4000 Hz; aided performance within normal range at conversational levels…"
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
        />
      </CFSectionRow>
    </div>
  );
};

export default SoundFieldPanel;
