import React, { useRef } from 'react';
import CaseHistorySection from './CaseHistorySection';

/**
 * Compact select dropdown matching the NOAH-dense clinical aesthetic.
 */
const Select = ({ value, onChange, options, placeholder, testId }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value || null)}
    data-testid={testId}
    className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white w-full focus:outline-none focus:border-blue-500"
  >
    <option value="">{placeholder || '—'}</option>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

/**
 * Small labelled row — left label, right input. NOAH-style.
 */
const Row = ({ label, children }) => (
  <div className="flex items-center gap-2 py-0.5">
    <div className="text-[10px] font-medium text-gray-600 w-20 flex-shrink-0">{label}</div>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

/**
 * Section card header.
 */
const SectionHeader = ({ title }) => (
  <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-2 py-1 border-b border-gray-300">
    <h3 className="text-xs font-bold text-gray-700">{title}</h3>
  </div>
);

// --- Option sets (clinical presets) -----------------------------------------

const ONSET_OPTIONS = [
  { value: 'sudden', label: 'Sudden' },
  { value: 'gradual', label: 'Gradual' },
  { value: 'unknown', label: 'Unknown' },
];
const EAR_OPTIONS = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'both', label: 'Both' },
  { value: 'unknown', label: 'Unknown' },
];
const TF_FREQ_OPTIONS = [
  { value: 256, label: '256 Hz' },
  { value: 512, label: '512 Hz' },
  { value: 1024, label: '1024 Hz' },
  { value: 2048, label: '2048 Hz' },
];
const RINNE_OPTIONS = [
  { value: 'positive', label: 'Positive (AC > BC)' },
  { value: 'negative', label: 'Negative (BC > AC)' },
  { value: 'equal', label: 'Equal (AC = BC)' },
];
const WEBER_OPTIONS = [
  { value: 'midline', label: 'Midline (not lateralised)' },
  { value: 'right', label: 'Lateralised → Right' },
  { value: 'left', label: 'Lateralised → Left' },
  { value: 'not_lateralized', label: 'Not perceived' },
];
const ABC_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'reduced', label: 'Reduced' },
];
const BING_OPTIONS = [
  { value: 'positive', label: 'Positive (occlusion effect present)' },
  { value: 'negative', label: 'Negative (no change)' },
];
const PINNA_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'abnormal', label: 'Abnormal' },
];
const EAC_OPTIONS = [
  { value: 'clear', label: 'Clear' },
  { value: 'wax', label: 'Wax / cerumen' },
  { value: 'debris', label: 'Debris' },
  { value: 'inflamed', label: 'Inflamed' },
  { value: 'foreign_body', label: 'Foreign body' },
  { value: 'other', label: 'Other' },
];
const TM_OPTIONS = [
  { value: 'intact_normal', label: 'Intact, normal' },
  { value: 'retracted', label: 'Retracted' },
  { value: 'bulging', label: 'Bulging' },
  { value: 'perforated', label: 'Perforated' },
  { value: 'dull', label: 'Dull' },
  { value: 'erythematous', label: 'Erythematous' },
  { value: 'effusion', label: 'Effusion / fluid' },
  { value: 'scarred', label: 'Scarred' },
  { value: 'other', label: 'Other' },
];

// Client-side resize + base64 encode
const fileToResizedBase64 = (file, maxSize = 800) =>
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
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// --- Otoscopy ear panel (with image upload placeholder) ---------------------

const OtoscopyEar = ({ earLabel, earSide, value, onChange }) => {
  const fileInputRef = useRef(null);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await fileToResizedBase64(file, 800);
      onChange({ ...value, image_base64: b64 });
    } catch (err) {
      console.error('Image upload failed', err);
    }
  };

  const clearImage = () => onChange({ ...value, image_base64: null });

  const earAccent = earSide === 'right' ? 'text-red-600' : 'text-blue-600';

  return (
    <div className="border border-gray-300 rounded bg-white">
      <div className="px-2 py-1 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <span className={`text-[11px] font-bold ${earAccent}`}>{earLabel}</span>
      </div>
      <div className="p-2 space-y-1">
        <Row label="Pinna">
          <Select
            testId={`otoscopy-${earSide}-pinna`}
            value={value.pinna}
            onChange={(v) => onChange({ ...value, pinna: v })}
            options={PINNA_OPTIONS}
          />
        </Row>
        <Row label="EAC">
          <Select
            testId={`otoscopy-${earSide}-eac`}
            value={value.eac}
            onChange={(v) => onChange({ ...value, eac: v })}
            options={EAC_OPTIONS}
          />
        </Row>
        <Row label="TM">
          <Select
            testId={`otoscopy-${earSide}-tm`}
            value={value.tm}
            onChange={(v) => onChange({ ...value, tm: v })}
            options={TM_OPTIONS}
          />
        </Row>
        <Row label="Notes">
          <textarea
            data-testid={`otoscopy-${earSide}-notes`}
            value={value.notes || ''}
            onChange={(e) => onChange({ ...value, notes: e.target.value })}
            placeholder="Free-text observation…"
            rows={2}
            className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 resize-none focus:outline-none focus:border-blue-500"
          />
        </Row>

        {/* Image upload placeholder */}
        <div className="mt-1.5">
          <div className="text-[10px] font-medium text-gray-600 mb-1">Otoscopic Image</div>
          {value.image_base64 ? (
            <div className="relative group">
              <img
                src={value.image_base64}
                alt={`${earLabel} otoscopy`}
                className="w-full h-24 object-cover rounded border border-gray-300"
                data-testid={`otoscopy-${earSide}-image-preview`}
              />
              <button
                onClick={clearImage}
                data-testid={`otoscopy-${earSide}-image-remove`}
                className="absolute top-1 right-1 bg-white/90 text-red-600 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              data-testid={`otoscopy-${earSide}-image-upload`}
              className="w-full h-24 border-2 border-dashed border-gray-300 rounded flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 bg-gray-50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span className="text-[10px] mt-1">Upload {earLabel} image</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
};

// --- Main Pre-Test panel (3-column split) -----------------------------------

const PreTestPanel = ({ data, onChange }) => {
  const tf = data.tuning_fork;
  const ot = data.otoscopy;

  const updateTF = (patch) =>
    onChange({ ...data, tuning_fork: { ...tf, ...patch } });
  const updateOt = (patch) =>
    onChange({ ...data, otoscopy: { ...ot, ...patch } });

  return (
    <div className="flex-1 flex min-h-0 bg-gray-100 overflow-hidden">
      <div className="flex-1 flex gap-2 p-2 overflow-hidden">
        {/* ========== Column 1: Case History (expanded) ========== */}
        <CaseHistorySection
          data={data.case_history}
          onChange={(next) => onChange({ ...data, case_history: next })}
        />

        {/* ========== Column 2: Tuning Fork Tests ========== */}
        <div className="flex-1 min-w-0 flex flex-col bg-white border border-gray-300 rounded shadow-sm overflow-hidden">
          <SectionHeader title="Tuning Fork Tests" />
          <div className="flex-1 p-2 space-y-2 overflow-auto">
            <Row label="Frequency">
              <Select
                testId="tf-frequency"
                value={tf.frequency_hz}
                onChange={(v) => updateTF({ frequency_hz: Number(v) })}
                options={TF_FREQ_OPTIONS}
              />
            </Row>

            {/* Rinne */}
            <div className="border-t border-gray-200 pt-1.5">
              <div className="text-[10px] font-bold text-gray-700 mb-1">Rinne</div>
              <Row label="Right">
                <Select
                  testId="tf-rinne-right"
                  value={tf.rinne_right}
                  onChange={(v) => updateTF({ rinne_right: v })}
                  options={RINNE_OPTIONS}
                />
              </Row>
              <Row label="Left">
                <Select
                  testId="tf-rinne-left"
                  value={tf.rinne_left}
                  onChange={(v) => updateTF({ rinne_left: v })}
                  options={RINNE_OPTIONS}
                />
              </Row>
              <Row label="Notes">
                <input
                  type="text"
                  data-testid="tf-rinne-notes"
                  value={tf.rinne_notes || ''}
                  onChange={(e) => updateTF({ rinne_notes: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500"
                />
              </Row>
            </div>

            {/* Weber */}
            <div className="border-t border-gray-200 pt-1.5">
              <div className="text-[10px] font-bold text-gray-700 mb-1">Weber</div>
              <Row label="Result">
                <Select
                  testId="tf-weber"
                  value={tf.weber}
                  onChange={(v) => updateTF({ weber: v })}
                  options={WEBER_OPTIONS}
                />
              </Row>
              <Row label="Notes">
                <input
                  type="text"
                  data-testid="tf-weber-notes"
                  value={tf.weber_notes || ''}
                  onChange={(e) => updateTF({ weber_notes: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500"
                />
              </Row>
            </div>

            {/* ABC */}
            <div className="border-t border-gray-200 pt-1.5">
              <div className="text-[10px] font-bold text-gray-700 mb-1">
                ABC (Absolute Bone Conduction)
              </div>
              <Row label="Right">
                <Select
                  testId="tf-abc-right"
                  value={tf.abc_right}
                  onChange={(v) => updateTF({ abc_right: v })}
                  options={ABC_OPTIONS}
                />
              </Row>
              <Row label="Left">
                <Select
                  testId="tf-abc-left"
                  value={tf.abc_left}
                  onChange={(v) => updateTF({ abc_left: v })}
                  options={ABC_OPTIONS}
                />
              </Row>
              <Row label="Notes">
                <input
                  type="text"
                  data-testid="tf-abc-notes"
                  value={tf.abc_notes || ''}
                  onChange={(e) => updateTF({ abc_notes: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500"
                />
              </Row>
            </div>

            {/* Bing */}
            <div className="border-t border-gray-200 pt-1.5">
              <div className="text-[10px] font-bold text-gray-700 mb-1">Bing</div>
              <Row label="Right">
                <Select
                  testId="tf-bing-right"
                  value={tf.bing_right}
                  onChange={(v) => updateTF({ bing_right: v })}
                  options={BING_OPTIONS}
                />
              </Row>
              <Row label="Left">
                <Select
                  testId="tf-bing-left"
                  value={tf.bing_left}
                  onChange={(v) => updateTF({ bing_left: v })}
                  options={BING_OPTIONS}
                />
              </Row>
              <Row label="Notes">
                <input
                  type="text"
                  data-testid="tf-bing-notes"
                  value={tf.bing_notes || ''}
                  onChange={(e) => updateTF({ bing_notes: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500"
                />
              </Row>
            </div>
          </div>
        </div>

        {/* ========== Column 3: Otoscopic Examination ========== */}
        <div className="flex-1 min-w-0 flex flex-col bg-white border border-gray-300 rounded shadow-sm overflow-hidden">
          <SectionHeader title="Otoscopic Examination" />
          <div className="flex-1 p-2 grid grid-cols-2 gap-2 overflow-auto">
            <OtoscopyEar
              earLabel="Right"
              earSide="right"
              value={ot.right}
              onChange={(next) => updateOt({ right: next })}
            />
            <OtoscopyEar
              earLabel="Left"
              earSide="left"
              value={ot.left}
              onChange={(next) => updateOt({ left: next })}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreTestPanel;
