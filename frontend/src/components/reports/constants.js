// Clinic branding, toggleable sections, labels, and misc helpers for the Reports module.

export const CLINIC_STORAGE_KEY = 'acs_clinic_branding_v1';

export const DEFAULT_CLINIC = {
  name: 'ACS Audiology Clinic',
  tagline: 'Hearing & Balance Centre',
  address_line1: '123 Medical Plaza, MG Road',
  address_line2: 'Bangalore, Karnataka 560001',
  tel: '+91 80 1234 5678',
  email: 'info@acsaudiology.com',
  logo_base64: null,          // data URL or null
  logo_shape: 'circle',       // 'circle' | 'square' | 'rectangle'
};

export const loadClinic = () => {
  try {
    const raw = localStorage.getItem(CLINIC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CLINIC };
    return { ...DEFAULT_CLINIC, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CLINIC };
  }
};

// Client-side resize + base64 (used for clinic logo upload)
export const fileToResizedBase64 = (file, maxSize = 400) =>
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
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// Toggleable & reorderable report sections. Header/patient strip/signature are fixed.
export const TOGGLEABLE_SECTIONS = [
  { id: 'case_history',    label: 'Case History (summary)',    defaultEnabled: true },
  { id: 'pure_tone',       label: 'Pure Tone Audiometry',      defaultEnabled: true },
  { id: 'tuning_fork',     label: 'Tuning Fork Tests',         defaultEnabled: false },
  { id: 'otoscopy',        label: 'Otoscopic Examination',     defaultEnabled: false },
  { id: 'speech',          label: 'Speech Audiometry',         defaultEnabled: false },
  { id: 'tympanometry',    label: 'Tympanometry / Impedance',  defaultEnabled: true },
  { id: 'special_tests',   label: 'Special Tests',             defaultEnabled: false },
  { id: 'oae',             label: 'Otoacoustic Emissions',     defaultEnabled: false },
  { id: 'soundfield',      label: 'Sound Field / Aided',       defaultEnabled: false },
  { id: 'abr',             label: 'ABR / ASSR',                defaultEnabled: false },
  { id: 'pediatric',       label: 'Pediatric Audiometry',      defaultEnabled: false },
  { id: 'tinnitus',        label: 'Tinnitus Assessment',       defaultEnabled: false },
  { id: 'results',         label: 'Results (narrative)',       defaultEnabled: true },
  { id: 'recommendations', label: 'Recommendations',           defaultEnabled: true },
];

export const fmtDate = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const LABELS = {
  onset: { sudden: 'Sudden', gradual: 'Gradual', unknown: 'Unknown' },
  ear:   { right: 'Right', left: 'Left', both: 'Both ears', unknown: 'Unknown' },
  progression: { fluctuating: 'fluctuating', gradual: 'gradually progressive', rapid: 'rapidly progressive', sudden: 'sudden-onset' },
  ysn: { yes: 'Yes', no: 'No', not_sure: 'Not sure' },
  rinne: { positive: 'Positive (AC>BC)', negative: 'Negative (BC>AC)', equal: 'Equal' },
  weber: { midline: 'Midline / Not lateralised', right: 'Lateralised → Right', left: 'Lateralised → Left', not_lateralized: 'Not perceived' },
  abc:   { normal: 'Normal', reduced: 'Reduced' },
  bing:  { positive: 'Positive', negative: 'Negative' },
  pinna: { normal: 'Normal', abnormal: 'Abnormal' },
  eac:   { clear: 'Clear', wax: 'Wax / cerumen', debris: 'Debris', inflamed: 'Inflamed', foreign_body: 'Foreign body', other: 'Other' },
  tm:    { intact_normal: 'Intact, normal', retracted: 'Retracted', bulging: 'Bulging', perforated: 'Perforated', dull: 'Dull', erythematous: 'Erythematous', effusion: 'Effusion / fluid', scarred: 'Scarred', other: 'Other' },
  cond:  { diabetes: 'Diabetes', hypertension: 'Hypertension', stroke_tia: 'Stroke/TIA', meningitis: 'Meningitis', mumps: 'Mumps', measles: 'Measles', multiple_sclerosis: 'Multiple Sclerosis', bells_palsy: "Bell's Palsy", high_fevers: 'High fevers (hx)', concussion: 'Concussion/skull fx', cancer: 'Cancer', seizures: 'Seizures' },
};

export const pick = (map, v) => (v && map[v]) || '—';
