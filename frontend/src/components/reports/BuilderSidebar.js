import React, { useRef, useState } from 'react';
import axios from 'axios';
import { DEFAULT_CLINIC, fileToResizedBase64 } from './constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PrintIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9"></polyline>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
    <rect x="6" y="14" width="12" height="8"></rect>
  </svg>
);

const SparkleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"></path>
  </svg>
);

// Calls the backend and invokes setters for the returned fields.
// targets: "all" | "puretone_findings" | "immitence_findings" | "speech_findings" | "recommendations" | "further_advice"
const runAIGenerate = async ({ sessionId, target, setters, onStart, onEnd, onError, onInfo }) => {
  if (!sessionId) {
    onError?.('No active session yet — please wait a moment and try again.');
    return;
  }
  onStart?.();
  try {
    const res = await axios.post(`${API}/ai/narrative/generate`, {
      session_id: sessionId,
      target,
    }, { timeout: 60000 });
    const result = res?.data?.result || {};

    // Detect empty response (LLM told us there's no data to draft from)
    const isEmpty = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
    let emptyFields = [];
    if (target === 'all') {
      if (typeof result.puretone_findings === 'string')   setters.setPtFindings?.(result.puretone_findings);
      if (typeof result.immitence_findings === 'string')  setters.setImmFindings?.(result.immitence_findings);
      if (typeof result.speech_findings === 'string')     setters.setSpeechFindings?.(result.speech_findings);
      if (Array.isArray(result.recommendations))          setters.setRecText?.(result.recommendations.join('\n'));
      if (typeof result.further_advice === 'string')      setters.setFurtherAdvice?.(result.further_advice);
      const allBlank = isEmpty(result.puretone_findings) && isEmpty(result.immitence_findings)
        && isEmpty(result.speech_findings) && isEmpty(result.recommendations) && isEmpty(result.further_advice);
      if (allBlank) emptyFields.push('all fields');
    } else {
      if (target === 'puretone_findings'  && typeof result.puretone_findings === 'string')  setters.setPtFindings?.(result.puretone_findings);
      else if (target === 'immitence_findings' && typeof result.immitence_findings === 'string') setters.setImmFindings?.(result.immitence_findings);
      else if (target === 'speech_findings'    && typeof result.speech_findings === 'string')    setters.setSpeechFindings?.(result.speech_findings);
      else if (target === 'recommendations'    && Array.isArray(result.recommendations))         setters.setRecText?.(result.recommendations.join('\n'));
      else if (target === 'further_advice'     && typeof result.further_advice === 'string')     setters.setFurtherAdvice?.(result.further_advice);
      if (isEmpty(result[target])) emptyFields.push(target);
    }

    if (emptyFields.length > 0) {
      onInfo?.('No clinical data yet — enter audiogram / tympanometry values first, then try again.');
    }
  } catch (err) {
    console.error('AI generate failed', err);
    onError?.(err?.response?.data?.detail || err?.message || 'AI generation failed');
  } finally {
    onEnd?.();
  }
};

const ClinicBrandingPanel = ({ clinic, setClinic }) => {
  const logoFileRef = useRef(null);
  const updateClinic = (patch) => setClinic((c) => ({ ...c, ...patch }));

  const handleLogoUpload = async (file) => {
    if (!file) return;
    try {
      const b64 = await fileToResizedBase64(file, 400);
      setClinic((c) => ({ ...c, logo_base64: b64 }));
    } catch (err) {
      console.error('Logo upload failed', err);
    }
  };

  const logoPreviewClass = clinic.logo_shape === 'circle'
    ? 'w-14 h-14 rounded-full'
    : clinic.logo_shape === 'rectangle'
      ? 'w-20 h-12 rounded'
      : 'w-14 h-14 rounded';

  return (
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
                  className={`bg-white border border-gray-300 object-contain ${logoPreviewClass}`}
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
        {[
          { key: 'name', label: 'Clinic name', testid: 'clinic-name' },
          { key: 'tagline', label: 'Tagline', testid: 'clinic-tagline' },
          { key: 'address_line1', label: 'Address line 1', testid: 'clinic-address-1' },
          { key: 'address_line2', label: 'Address line 2', testid: 'clinic-address-2' },
        ].map((f) => (
          <div key={f.key}>
            <div className="text-[10px] font-semibold text-gray-600">{f.label}</div>
            <input
              type="text"
              data-testid={f.testid}
              value={clinic[f.key]}
              onChange={(e) => updateClinic({ [f.key]: e.target.value })}
              className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-0.5"
            />
          </div>
        ))}
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
  );
};

const SectionsList = ({ sections, onToggle, onMove }) => (
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
            onChange={() => onToggle(s.id)}
            className="w-3.5 h-3.5"
          />
          <span className={`flex-1 truncate ${s.enabled ? 'text-gray-800' : 'text-gray-400'}`}>{s.label}</span>
          <button
            onClick={() => onMove(idx, -1)}
            disabled={idx === 0}
            data-testid={`report-up-${s.id}`}
            className="w-5 h-5 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center text-[10px]"
            title="Move up"
          >▲</button>
          <button
            onClick={() => onMove(idx, 1)}
            disabled={idx === sections.length - 1}
            data-testid={`report-down-${s.id}`}
            className="w-5 h-5 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center text-[10px]"
            title="Move down"
          >▼</button>
        </div>
      ))}
    </div>
  </div>
);

const TuningForkExtras = ({ showABC, setShowABC, showBing, setShowBing }) => (
  <div>
    <div className="text-[10px] font-bold text-gray-600 mt-2 mb-1">Tuning Fork extras</div>
    <div className="text-[10px] text-gray-500 mb-1">
      Enable <b>Tuning Fork Tests</b> in Sections above to show Rinne + Weber on the report. ABC / Bing are opt-in extras shown in a full section with notes.
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
);

const TympPlacementToggle = ({ tympPlacement, setTympPlacement, useSeparatePage, autoSeparatePage }) => (
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
);

// Audiogram size toggle — only meaningful when the Tympanogram is on a separate page,
// because the main page has extra vertical space and the chart can grow without
// pushing the conclusion block off A4.
const AudiogramSizeToggle = ({ audiogramSize, setAudiogramSize, useSeparatePage }) => {
  const options = [
    { k: 'standard', label: 'Standard', title: '240 / 280 px — current default' },
    { k: 'large',    label: 'Large',    title: '380 / 400 px — fills the page nicely' },
    { k: 'xlarge',   label: 'Extra Large', title: '550 px — audiogram dominates page 1' },
  ];
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-600 mt-2 mb-1">Audiogram size</div>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.k}
            type="button"
            onClick={() => setAudiogramSize(opt.k)}
            data-testid={`report-audiogram-size-${opt.k}`}
            title={opt.title}
            disabled={!useSeparatePage}
            className={`flex-1 px-1 py-1 text-[10px] font-medium border rounded ${
              audiogramSize === opt.k
                ? 'bg-blue-100 border-blue-400 text-blue-700 font-bold'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
            } ${!useSeparatePage ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="text-[9px] text-gray-500 mt-0.5 italic">
        {useSeparatePage
          ? `Active (Tymp on separate page)`
          : `Applies when Tympanometry is on a separate page`}
      </div>
    </div>
  );
};

const Textarea = ({ label, testid, value, onChange, rows = 3, placeholder, aiTarget, aiCtx }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const showAI = !!aiTarget && !!aiCtx;
  const disabled = busy || (showAI && aiCtx.bulkBusy);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-bold text-gray-600">{label}</div>
        {showAI && (
          <button
            type="button"
            onClick={() => runAIGenerate({
              sessionId: aiCtx.sessionId,
              target: aiTarget,
              setters: aiCtx.setters,
              onStart: () => { setBusy(true); setErr(null); setInfo(null); },
              onEnd:   () => setBusy(false),
              onError: (m) => setErr(m),
              onInfo:  (m) => setInfo(m),
            })}
            disabled={disabled}
            data-testid={`ai-generate-${aiTarget}`}
            title="Draft this field with AI using the current session data"
            className={`inline-flex items-center gap-0.5 px-1.5 py-[1px] text-[9px] font-semibold rounded border transition-colors ${
              disabled
                ? 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
                : 'bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100'
            }`}
          >
            {busy ? (
              <span className="animate-pulse">Drafting…</span>
            ) : (
              <><SparkleIcon /><span>AI</span></>
            )}
          </button>
        )}
      </div>
      <textarea
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 resize-y focus:outline-none focus:border-blue-500"
      />
      {err && (
        <div className="text-[9px] text-red-600 mt-0.5" data-testid={`ai-error-${aiTarget}`}>{err}</div>
      )}
      {info && !err && (
        <div className="text-[9px] text-amber-700 mt-0.5 bg-amber-50 border border-amber-200 rounded px-1 py-0.5" data-testid={`ai-info-${aiTarget}`}>
          {info}
        </div>
      )}
    </div>
  );
};

const TextInput = ({ label, testid, value, onChange, placeholder }) => (
  <div>
    <div className="text-[10px] font-bold text-gray-600 mb-1">{label}</div>
    <input
      type="text"
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1"
    />
  </div>
);

export const BuilderSidebar = ({
  // Section config
  sections, onToggleSection, onMoveSection,
  // Clinic branding
  clinic, setClinic,
  // Tuning Fork
  showABC, setShowABC, showBing, setShowBing,
  // Tymp placement
  tympPlacement, setTympPlacement, useSeparatePage, autoSeparatePage,
  // Audiogram size (effective only when useSeparatePage)
  audiogramSize, setAudiogramSize,
  // Editable textareas / inputs
  ptFindings, setPtFindings,
  immFindings, setImmFindings,
  speechFindings, setSpeechFindings,
  referredBy, setReferredBy,
  mrdEdit, setMrdEdit,
  recText, setRecText,
  furtherAdvice, setFurtherAdvice,
  license, setLicense,
  // AI
  sessionId,
  // Actions
  onPrint,
}) => {
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState(null);
  const [bulkInfo, setBulkInfo] = useState(null);

  const aiCtx = {
    sessionId,
    bulkBusy,
    setters: { setPtFindings, setImmFindings, setSpeechFindings, setRecText, setFurtherAdvice },
  };

  const handleGenerateAll = () => runAIGenerate({
    sessionId,
    target: 'all',
    setters: aiCtx.setters,
    onStart: () => { setBulkBusy(true); setBulkErr(null); setBulkInfo(null); },
    onEnd:   () => setBulkBusy(false),
    onError: (m) => setBulkErr(m),
    onInfo:  (m) => setBulkInfo(m),
  });

  return (
  <aside className="w-[280px] flex-shrink-0 bg-white border-r border-gray-300 overflow-auto no-print">
    <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-2 py-1 border-b border-gray-300 sticky top-0 z-10">
      <h3 className="text-xs font-bold text-gray-700">Report Builder</h3>
    </div>

    <div className="p-2 space-y-2">
      <button
        onClick={onPrint}
        data-testid="report-print-btn"
        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-1.5 rounded flex items-center justify-center gap-1.5 shadow-sm"
      >
        <PrintIcon />
        Print / Save as PDF
      </button>

      {/* Bulk AI narrative */}
      <div className="border border-violet-300 bg-gradient-to-r from-violet-50 to-fuchsia-50 rounded p-1.5">
        <button
          onClick={handleGenerateAll}
          disabled={bulkBusy || !sessionId}
          data-testid="ai-generate-all"
          title="Let AI draft Puretone, Immitence, Speech findings + Recommendations + Further Advice in one go."
          className={`w-full flex items-center justify-center gap-1 text-[11px] font-bold py-1 rounded transition-colors ${
            bulkBusy || !sessionId
              ? 'bg-violet-200 text-violet-500 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'
          }`}
        >
          {bulkBusy ? (
            <span className="animate-pulse">Drafting full narrative…</span>
          ) : (
            <><SparkleIcon /><span>Generate full narrative with AI</span></>
          )}
        </button>
        <div className="text-[9px] text-violet-700 mt-0.5 leading-tight">
          Uses test data (PTA, tympanometry, speech, reflexes) to draft findings + recommendations. Review before signing.
        </div>
        {bulkErr && (
          <div className="text-[9px] text-red-600 mt-0.5" data-testid="ai-bulk-error">{bulkErr}</div>
        )}
        {bulkInfo && !bulkErr && (
          <div className="text-[9px] text-amber-700 mt-1 bg-amber-50 border border-amber-200 rounded px-1 py-0.5" data-testid="ai-bulk-info">
            {bulkInfo}
          </div>
        )}
      </div>

      <ClinicBrandingPanel clinic={clinic} setClinic={setClinic} />

      <SectionsList sections={sections} onToggle={onToggleSection} onMove={onMoveSection} />

      <TuningForkExtras
        showABC={showABC} setShowABC={setShowABC}
        showBing={showBing} setShowBing={setShowBing}
      />

      <TympPlacementToggle
        tympPlacement={tympPlacement}
        setTympPlacement={setTympPlacement}
        useSeparatePage={useSeparatePage}
        autoSeparatePage={autoSeparatePage}
      />

      <AudiogramSizeToggle
        audiogramSize={audiogramSize}
        setAudiogramSize={setAudiogramSize}
        useSeparatePage={useSeparatePage}
      />

      <Textarea
        label="Results — Puretone findings"
        testid="report-pt-findings"
        value={ptFindings}
        onChange={setPtFindings}
        placeholder="Bilateral mild sloping SNHL…"
        aiTarget="puretone_findings"
        aiCtx={aiCtx}
      />
      <Textarea
        label="Results — Immitence findings"
        testid="report-imm-findings"
        value={immFindings}
        onChange={setImmFindings}
        placeholder="Type A tympanograms bilaterally; acoustic reflexes present at normal levels…"
        aiTarget="immitence_findings"
        aiCtx={aiCtx}
      />
      <Textarea
        label="Results — Speech Audiometry findings"
        testid="report-speech-findings"
        value={speechFindings}
        onChange={setSpeechFindings}
        placeholder="SRT consistent with PTA; excellent word recognition in quiet; mild deterioration in noise…"
        aiTarget="speech_findings"
        aiCtx={aiCtx}
      />
      <TextInput
        label="Referred by"
        testid="report-referred-by"
        value={referredBy}
        onChange={setReferredBy}
        placeholder="Dr. / Self / Clinic"
      />
      <TextInput
        label="MRD / Patient ID"
        testid="report-mrd"
        value={mrdEdit}
        onChange={setMrdEdit}
      />
      <Textarea
        label="Recommendations (one per line)"
        testid="report-recommendations"
        value={recText}
        onChange={setRecText}
        rows={5}
        placeholder={'Binaural amplification trial.\nCommunication strategies counselling.\nAnnual audiometric re-evaluation.'}
        aiTarget="recommendations"
        aiCtx={aiCtx}
      />
      <Textarea
        label="Further Advice (ENT)"
        testid="report-further-advice"
        value={furtherAdvice}
        onChange={setFurtherAdvice}
        placeholder="ENT consultation for…"
        aiTarget="further_advice"
        aiCtx={aiCtx}
      />
      <TextInput
        label="Audiologist License #"
        testid="report-license"
        value={license}
        onChange={setLicense}
        placeholder="Lic. No."
      />
    </div>
  </aside>
  );
};
