import React, { useRef, useState } from 'react';
import { DEFAULT_CLINIC, FINDINGS_TITLES, fileToResizedBase64 } from './constants';

const PrintIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9"></polyline>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
    <rect x="6" y="14" width="12" height="8"></rect>
  </svg>
);

// WhatsApp brand glyph (monochrome — coloured via parent)
const WhatsAppIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.66 4.05 1.79 5.67L2 22l4.56-1.86a9.96 9.96 0 0 0 5.48 1.62h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.86 9.86 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.2-1.15l-.3-.18-3.12 1.27 1.28-3.04-.2-.32a8.18 8.18 0 0 1-1.27-4.43c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.26.86 5.82 2.41a8.18 8.18 0 0 1 2.41 5.83c0 4.53-3.69 8.22-8.23 8.22Zm4.52-6.15c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.78.98-.15.16-.29.18-.54.06-.25-.12-1.05-.39-2-1.23a7.44 7.44 0 0 1-1.37-1.71c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43l-.48-.01c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.02 0 1.19.87 2.34 1 2.5.12.16 1.71 2.6 4.13 3.65.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.23-.18-.48-.3Z"/>
  </svg>
);

// Menu / hamburger icon (kept inline to avoid adding a lucide import to
// this legacy file that already ships tiny inline SVGs).
const MenuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const ChevronDownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

/**
 * Builds a patient-friendly WhatsApp message with a quick clinical summary.
 * Returns a string ready to be URL-encoded.
 */
const buildWhatsappMessage = ({ patient, clinic, rightEarData, leftEarData, ptFindings, recText }) => {
  const calcPta = (measurements) => {
    if (!measurements?.length) return null;
    const byF = Object.fromEntries(measurements.map((m) => [m.frequency, m]));
    const vals = [500, 1000, 2000]
      .map((f) => byF[f])
      .filter((m) => m && m.threshold_db != null && !m.no_response)
      .map((m) => m.threshold_db);
    if (vals.length < 2) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  const ptaR = calcPta(rightEarData?.ac_measurements);
  const ptaL = calcPta(leftEarData?.ac_measurements);

  const lines = [];
  lines.push(`Hello${patient?.name ? ' ' + patient.name.split(' ')[0] : ''},`);
  lines.push('');
  lines.push(`Your hearing assessment report from ${clinic?.name || 'the clinic'} is ready.`);
  lines.push('');
  if (ptaR !== null || ptaL !== null) {
    lines.push('*Quick summary (PTA 500/1k/2k Hz):*');
    if (ptaR !== null) lines.push(`• Right ear: ${ptaR} dB`);
    if (ptaL !== null) lines.push(`• Left ear:  ${ptaL} dB`);
    lines.push('');
  }
  if (ptFindings?.trim()) {
    lines.push('*Findings:*');
    lines.push(ptFindings.trim());
    lines.push('');
  }
  const recs = (recText || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  if (recs.length) {
    lines.push('*Recommendations:*');
    recs.forEach((r) => lines.push(`• ${r}`));
    lines.push('');
  }
  lines.push(`Please find the full report PDF attached to this message.`);
  lines.push('');
  lines.push(`— ${clinic?.name || 'ACS Audiology Clinic'}${clinic?.tel ? ' · ' + clinic.tel : ''}`);
  return lines.join('\n');
};

/**
 * Normalises an Indian mobile number for wa.me — digits only, leading 91 ensured.
 * Returns '' if the input cannot be normalised (user will pick contact in WhatsApp).
 */
const normaliseMobile = (raw) => {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('91') && digits.length >= 12) return digits;
  if (digits.length === 10) return '91' + digits;
  return digits;
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

const Textarea = ({ label, testid, value, onChange, rows = 3, placeholder }) => (
  <div>
    <div className="text-[10px] font-bold text-gray-600 mb-1">{label}</div>
    <textarea
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 resize-y focus:outline-none focus:border-blue-500"
    />
  </div>
);

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
  ptFindings, setPtFindings,             // legacy alias for findings.pure_tone
  immFindings, setImmFindings,           // legacy alias for findings.tympanometry
  speechFindings, setSpeechFindings,     // legacy alias for findings.speech
  findings, setFinding,                  // dynamic per-section findings map
  provisionalDiagnosis, setProvisionalDiagnosis,
  referredBy, setReferredBy,
  mrdEdit, setMrdEdit,
  recText, setRecText,
  furtherAdvice, setFurtherAdvice,
  license, setLicense,
  // WhatsApp share context
  patient, rightEarData, leftEarData,
  // Actions
  onPrint,
  // Live layout watchdog status — { pageCount, warnLevel: 'ok'|'info'|'warn'|'error' }
  layoutStatus,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleWhatsappShare = () => {
    const msg = buildWhatsappMessage({ patient, clinic, rightEarData, leftEarData, ptFindings, recText });
    const phone = normaliseMobile(patient?.mobile || patient?.phone);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // All actual builder controls — rendered inside the desktop aside AND
  // inside the mobile drawer. Kept as a nested render function so the
  // parent state (findings, sections, callbacks) closes over identically
  // in both places.
  const sidebarInner = (
    <div className="p-2 space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={onPrint}
          data-testid="report-print-btn"
          title={layoutStatus?.warnLevel && layoutStatus.warnLevel !== 'ok'
            ? `${layoutStatus.pageCount} page${layoutStatus.pageCount === 1 ? '' : 's'} · layout issues detected — click to review`
            : `${layoutStatus?.pageCount || ''} page${layoutStatus?.pageCount === 1 ? '' : 's'} · layout looks clean`}
          className="relative bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold py-1.5 rounded flex items-center justify-center gap-1 shadow-sm"
        >
          <PrintIcon />
          Print / PDF
          {layoutStatus?.warnLevel && layoutStatus.warnLevel !== 'ok' && (
            <span
              data-testid={`report-print-dot-${layoutStatus.warnLevel}`}
              aria-label={`Layout ${layoutStatus.warnLevel}`}
              className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                layoutStatus.warnLevel === 'error' ? 'bg-rose-500'
                : layoutStatus.warnLevel === 'warn' ? 'bg-amber-400'
                : 'bg-sky-400'
              } animate-pulse`}
            />
          )}
        </button>
        <button
          onClick={handleWhatsappShare}
          data-testid="report-whatsapp-btn"
          title={patient?.mobile ? `Share summary to ${patient.mobile} on WhatsApp` : 'Share summary on WhatsApp (pick recipient)'}
          className="bg-[#25D366] hover:bg-[#1ebe5a] text-white text-[11px] font-semibold py-1.5 rounded flex items-center justify-center gap-1 shadow-sm"
        >
          <WhatsAppIcon />
          WhatsApp
        </button>
      </div>
      <div className="text-[9px] text-gray-500 italic leading-tight px-0.5">
        WhatsApp opens a pre-filled message with the clinical summary. Print as PDF first and attach it to the chat for the full report.
      </div>

      {/* Clinic branding panel removed 2026-07-30 — the report now reads
          the clinic name / address / logo directly from Settings so
          there's only one source of truth. Edit branding at
          /settings/clinic. A subtle hint keeps the link discoverable
          from inside the builder without adding editable fields. */}
      <div className="border border-slate-200 bg-slate-50 rounded p-1.5 text-[9px] text-slate-500 leading-snug" data-testid="report-branding-hint">
        <span className="font-semibold text-slate-600">Clinic branding</span>
        {' '}now comes from{' '}
        <a href="/settings/clinic" className="text-indigo-600 hover:underline" data-testid="report-branding-open-settings">
          Settings → Clinic Details
        </a>
        . Any changes there update every report automatically.
      </div>

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
      />
      <Textarea
        label="Results — Immitence findings"
        testid="report-imm-findings"
        value={immFindings}
        onChange={setImmFindings}
        placeholder="Type A tympanograms bilaterally; acoustic reflexes present at normal levels…"
      />
      <Textarea
        label="Results — Speech Audiometry findings"
        testid="report-speech-findings"
        value={speechFindings}
        onChange={setSpeechFindings}
        placeholder="SRT consistent with PTA; excellent word recognition in quiet; mild deterioration in noise…"
      />
      {sections
        .filter((s) => s.enabled
          && FINDINGS_TITLES[s.id]
          && !['pure_tone', 'tympanometry', 'speech'].includes(s.id))
        .map((s) => (
          <Textarea
            key={s.id}
            label={`Results — ${FINDINGS_TITLES[s.id]}`}
            testid={`report-findings-${s.id}`}
            value={findings?.[s.id] || ''}
            onChange={(v) => setFinding?.(s.id, v)}
            placeholder="Enter findings narrative…"
          />
        ))}
      <Textarea
        label="Provisional Diagnosis"
        testid="report-provisional-diagnosis-input"
        value={provisionalDiagnosis}
        onChange={setProvisionalDiagnosis}
        rows={3}
        placeholder="e.g. Bilateral mild SNHL; right ear conductive component suspected."
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
      />
      {/* "Further Advice (ENT)" textarea removed 2026-07-30 per user
          request — the section it wrote into was retired from the report
          template. Clinicians now include any ENT referral notes inline
          within the recommendations block above. */}
      <TextInput
        label="Audiologist License #"
        testid="report-license"
        value={license}
        onChange={setLicense}
        placeholder="Lic. No."
      />
    </div>
  );

  return (
    <>
      {/* Mobile pill — visible on < md, hidden in print mode via no-print */}
      <div className="md:hidden no-print sticky top-0 z-30 bg-gray-100 border-b border-gray-300 px-2 py-1.5">
        <button
          onClick={() => setDrawerOpen(true)}
          data-testid="report-builder-mobile-menu-toggle"
          className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded text-xs font-semibold text-gray-700 hover:bg-gray-50 active:bg-gray-100 shadow-sm"
        >
          <MenuIcon />
          <span className="flex-1 text-left">Report Builder</span>
          {layoutStatus?.warnLevel && layoutStatus.warnLevel !== 'ok' && (
            <span
              aria-label={`Layout ${layoutStatus.warnLevel}`}
              className={`w-2 h-2 rounded-full ${
                layoutStatus.warnLevel === 'error' ? 'bg-rose-500'
                : layoutStatus.warnLevel === 'warn' ? 'bg-amber-400'
                : 'bg-sky-400'
              } animate-pulse`}
            />
          )}
          <ChevronDownIcon />
        </button>
      </div>

      {/* Desktop sidebar — hidden on < md */}
      <aside className="hidden md:block w-[280px] flex-shrink-0 bg-white border-r border-gray-300 overflow-auto no-print">
        <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-2 py-1 border-b border-gray-300 sticky top-0 z-10">
          <h3 className="text-xs font-bold text-gray-700">Report Builder</h3>
        </div>
        {sidebarInner}
      </aside>

      {/* Mobile drawer — full-height slide-in from the left */}
      {drawerOpen && (
        <div className="md:hidden no-print fixed inset-0 z-50 flex" data-testid="report-builder-mobile-drawer">
          <button
            aria-label="Close report builder"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-slate-900/50"
          />
          <div className="relative w-[300px] max-w-[85vw] bg-white h-full shadow-xl flex flex-col animate-in slide-in-from-left duration-150">
            <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-3 py-2 border-b border-gray-300 flex items-center justify-between shrink-0">
              <h3 className="text-xs font-bold text-gray-700">Report Builder</h3>
              <button
                onClick={() => setDrawerOpen(false)}
                data-testid="report-builder-mobile-drawer-close"
                className="p-1 hover:bg-white/60 rounded"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sidebarInner}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
