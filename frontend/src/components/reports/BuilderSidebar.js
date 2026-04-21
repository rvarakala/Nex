import React, { useRef } from 'react';
import { DEFAULT_CLINIC, fileToResizedBase64 } from './constants';

const PrintIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9"></polyline>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
    <rect x="6" y="14" width="12" height="8"></rect>
  </svg>
);

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
  // Editable textareas / inputs
  ptFindings, setPtFindings,
  immFindings, setImmFindings,
  referredBy, setReferredBy,
  mrdEdit, setMrdEdit,
  recText, setRecText,
  furtherAdvice, setFurtherAdvice,
  license, setLicense,
  // Actions
  onPrint,
}) => (
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
      <Textarea
        label="Further Advice (ENT)"
        testid="report-further-advice"
        value={furtherAdvice}
        onChange={setFurtherAdvice}
        placeholder="ENT consultation for…"
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
