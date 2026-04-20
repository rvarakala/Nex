import React, { useState } from 'react';

// ---------- tiny shared UI helpers (kept inside for easy extraction) ----------

const Select = ({ value, onChange, options, placeholder, testId, size = 'md' }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value || null)}
    data-testid={testId}
    className={`text-xs border border-gray-300 rounded px-1.5 ${size === 'sm' ? 'py-0' : 'py-0.5'} bg-white w-full focus:outline-none focus:border-blue-500`}
  >
    <option value="">{placeholder || '—'}</option>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

const TextInput = (props) => (
  <input
    type="text"
    {...props}
    className={`w-full text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500 ${props.className || ''}`}
  />
);

const TextArea = (props) => (
  <textarea
    {...props}
    rows={props.rows || 2}
    className={`w-full text-xs border border-gray-300 rounded px-1.5 py-1 resize-none focus:outline-none focus:border-blue-500 ${props.className || ''}`}
  />
);

const Row = ({ label, children, className = '' }) => (
  <div className={`flex items-center gap-2 py-0.5 ${className}`}>
    <div className="text-[10px] font-medium text-gray-600 w-24 flex-shrink-0">{label}</div>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

const Check = ({ label, checked, onChange, testId }) => (
  <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
    <input
      type="checkbox"
      data-testid={testId}
      checked={!!checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-3.5 h-3.5"
    />
    {label}
  </label>
);

const Accordion = ({ title, open, onToggle, children, testId }) => (
  <div className="border-t border-gray-200">
    <button
      type="button"
      onClick={onToggle}
      data-testid={testId}
      className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-bold text-gray-700 bg-gray-50 hover:bg-gray-100"
    >
      <span>{title}</span>
      <span className="text-gray-500">{open ? '▾' : '▸'}</span>
    </button>
    {open && <div className="px-2 py-1.5 space-y-1 bg-white">{children}</div>}
  </div>
);

// ---------- option sets ----------

const YN = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const YNSure = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'not_sure', label: 'Not sure' },
];
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
const BETTER_EAR_OPTIONS = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'same', label: 'Both same' },
];
const PROGRESSION_OPTIONS = [
  { value: 'fluctuating', label: 'Fluctuating' },
  { value: 'gradual', label: 'Gradually changing' },
  { value: 'rapid', label: 'Rapidly changing' },
  { value: 'sudden', label: 'Sudden loss' },
];
const AURAL_EAR = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'both', label: 'Both' },
];
const TIN_FREQ = [
  { value: 'constant', label: 'Constant' },
  { value: 'intermittent', label: 'Intermittent' },
  { value: 'occasional', label: 'Occasional' },
];
const TIN_BOTHER = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'sometimes', label: 'Sometimes' },
];
const DIZZY_ASSOC = [
  { id: 'nausea', label: 'Nausea' },
  { id: 'tinnitus', label: 'Tinnitus' },
  { id: 'hearing_loss', label: 'Hearing loss' },
  { id: 'vision_changes', label: 'Vision changes' },
  { id: 'other', label: 'Other' },
];
const MEDICAL_CONDITIONS = [
  { id: 'diabetes', label: 'Diabetes' },
  { id: 'hypertension', label: 'Hypertension' },
  { id: 'stroke_tia', label: 'Stroke / TIA' },
  { id: 'meningitis', label: 'Meningitis' },
  { id: 'mumps', label: 'Mumps' },
  { id: 'measles', label: 'Measles' },
  { id: 'multiple_sclerosis', label: 'Multiple Sclerosis' },
  { id: 'bells_palsy', label: "Bell's Palsy" },
  { id: 'high_fevers', label: 'High fevers (hx)' },
  { id: 'concussion', label: 'Concussion / skull fracture' },
  { id: 'cancer', label: 'Cancer (& chemo)' },
  { id: 'seizures', label: 'Seizures' },
];
const COMM_SITUATIONS = [
  { id: 'tv', label: 'Watching TV' },
  { id: 'phone', label: 'Telephone' },
  { id: 'restaurant', label: 'Restaurants' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'theatre', label: 'Theatre / movies' },
  { id: 'worship', label: 'Worship services' },
];
const PHONE_EAR = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'switch', label: 'Switch between ears' },
];

// ---------- main component ----------

const CaseHistorySection = ({ data, onChange }) => {
  const [open, setOpen] = useState({
    A: true, B: false, C: false, D: false, E: false, F: false, G: false, H: false,
  });
  const toggle = (k) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  // Shortcuts
  const hs = data.hearing_specifics || {};
  const td = data.tinnitus_detail || {};
  const dd = data.dizziness_detail || {};
  const ne = data.noise_exposure || {};
  const fh = data.family_history || {};
  const mh = data.medical_history || {};
  const ha = data.hearing_aid_history || {};
  const cn = data.communication_needs || {};

  const setCore = (patch) => onChange({ ...data, ...patch });
  const setSec = (key, patch) => onChange({ ...data, [key]: { ...(data[key] || {}), ...patch } });

  const toggleInList = (list, id) =>
    (list || []).includes(id) ? list.filter((x) => x !== id) : [...(list || []), id];

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white border border-gray-300 rounded shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-2 py-1 border-b border-gray-300 flex-shrink-0">
        <h3 className="text-xs font-bold text-gray-700">Case History</h3>
      </div>

      <div className="flex-1 overflow-auto">
        {/* ========== Core (always visible) ========== */}
        <div className="p-2 space-y-1 bg-white border-b border-gray-200">
          <Row label="Complaint">
            <TextInput
              data-testid="ch-complaint"
              value={data.chief_complaint || ''}
              onChange={(e) => setCore({ chief_complaint: e.target.value })}
              placeholder="Chief complaint…"
            />
          </Row>
          <Row label="Duration">
            <TextInput
              data-testid="ch-duration"
              value={data.duration || ''}
              onChange={(e) => setCore({ duration: e.target.value })}
              placeholder="e.g., 3 months"
            />
          </Row>
          <Row label="Onset">
            <Select
              testId="ch-onset"
              value={data.onset}
              onChange={(v) => setCore({ onset: v })}
              options={ONSET_OPTIONS}
            />
          </Row>
          <Row label="Affected ear">
            <Select
              testId="ch-affected-ear"
              value={data.affected_ear}
              onChange={(v) => setCore({ affected_ear: v })}
              options={EAR_OPTIONS}
            />
          </Row>
          <div className="text-[10px] font-semibold text-gray-600 pt-1">Associated symptoms</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <Check label="Tinnitus" checked={data.tinnitus} onChange={(v) => setCore({ tinnitus: v })} testId="ch-sym-tinnitus" />
            <Check label="Vertigo" checked={data.vertigo} onChange={(v) => setCore({ vertigo: v })} testId="ch-sym-vertigo" />
            <Check label="Otalgia" checked={data.otalgia} onChange={(v) => setCore({ otalgia: v })} testId="ch-sym-otalgia" />
            <Check label="Otorrhea" checked={data.otorrhea} onChange={(v) => setCore({ otorrhea: v })} testId="ch-sym-otorrhea" />
          </div>
          <Row label="Notes">
            <TextArea
              data-testid="ch-notes"
              value={data.notes || ''}
              onChange={(e) => setCore({ notes: e.target.value })}
              placeholder="General notes…"
              rows={2}
            />
          </Row>
        </div>

        {/* ========== A. Hearing Specifics ========== */}
        <Accordion title="A · Hearing Specifics" open={open.A} onToggle={() => toggle('A')} testId="acc-hs">
          <Row label="Suspect HL?">
            <Select testId="hs-suspect" value={hs.suspect_hearing_loss} onChange={(v) => setSec('hearing_specifics', { suspect_hearing_loss: v })} options={YNSure} />
          </Row>
          <Row label="Better ear">
            <Select testId="hs-better" value={hs.better_ear} onChange={(v) => setSec('hearing_specifics', { better_ear: v })} options={BETTER_EAR_OPTIONS} />
          </Row>
          <Row label="Progression">
            <Select testId="hs-progression" value={hs.progression} onChange={(v) => setSec('hearing_specifics', { progression: v })} options={PROGRESSION_OPTIONS} />
          </Row>
          <Check label="Prior hearing test" checked={hs.prior_test} onChange={(v) => setSec('hearing_specifics', { prior_test: v })} testId="hs-prior-test" />
          {hs.prior_test && (
            <Row label="When/result">
              <TextInput data-testid="hs-prior-details" value={hs.prior_test_details || ''} onChange={(e) => setSec('hearing_specifics', { prior_test_details: e.target.value })} />
            </Row>
          )}
          <Check label="Seen physician for hearing" checked={hs.seen_physician} onChange={(v) => setSec('hearing_specifics', { seen_physician: v })} testId="hs-phys" />
          {hs.seen_physician && (
            <Row label="When/where">
              <TextInput data-testid="hs-phys-details" value={hs.physician_details || ''} onChange={(e) => setSec('hearing_specifics', { physician_details: e.target.value })} />
            </Row>
          )}
          <Check label="Earache / drainage (last 3 mo)" checked={hs.earache_drainage_3mo} onChange={(v) => setSec('hearing_specifics', { earache_drainage_3mo: v })} testId="hs-earache" />
          <Check label="Aural fullness / stuffiness" checked={hs.aural_fullness} onChange={(v) => setSec('hearing_specifics', { aural_fullness: v })} testId="hs-fullness" />
          {hs.aural_fullness && (
            <>
              <Row label="Which ear">
                <Select testId="hs-fullness-ear" value={hs.aural_fullness_ear} onChange={(v) => setSec('hearing_specifics', { aural_fullness_ear: v })} options={AURAL_EAR} />
              </Row>
              <Row label="How often">
                <TextInput data-testid="hs-fullness-freq" value={hs.aural_fullness_frequency || ''} onChange={(e) => setSec('hearing_specifics', { aural_fullness_frequency: e.target.value })} />
              </Row>
            </>
          )}
        </Accordion>

        {/* ========== B. Tinnitus detail ========== */}
        <Accordion title="B · Tinnitus Detail" open={open.B} onToggle={() => toggle('B')} testId="acc-tin">
          <Row label="Ear"><Select testId="td-ear" value={td.ear} onChange={(v) => setSec('tinnitus_detail', { ear: v })} options={AURAL_EAR} /></Row>
          <Row label="Frequency"><Select testId="td-freq" value={td.frequency} onChange={(v) => setSec('tinnitus_detail', { frequency: v })} options={TIN_FREQ} /></Row>
          <Row label="Bothersome"><Select testId="td-bother" value={td.bothersome} onChange={(v) => setSec('tinnitus_detail', { bothersome: v })} options={TIN_BOTHER} /></Row>
          <Row label="Sound"><TextInput data-testid="td-sound" value={td.sound_description || ''} onChange={(e) => setSec('tinnitus_detail', { sound_description: e.target.value })} placeholder="ringing / buzzing / roaring…" /></Row>
        </Accordion>

        {/* ========== C. Dizziness / Falls ========== */}
        <Accordion title="C · Dizziness & Falls" open={open.C} onToggle={() => toggle('C')} testId="acc-dz">
          <Check label="Dizzy today" checked={dd.dizzy_today} onChange={(v) => setSec('dizziness_detail', { dizzy_today: v })} testId="dd-today" />
          <div className="text-[10px] font-semibold text-gray-600 pt-1">Associated symptoms</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {DIZZY_ASSOC.map((s) => (
              <Check
                key={s.id}
                label={s.label}
                checked={(dd.associated_symptoms || []).includes(s.id)}
                onChange={() => setSec('dizziness_detail', { associated_symptoms: toggleInList(dd.associated_symptoms, s.id) })}
                testId={`dd-assoc-${s.id}`}
              />
            ))}
          </div>
          <Row label="Frequency"><TextInput data-testid="dd-freq" value={dd.frequency || ''} onChange={(e) => setSec('dizziness_detail', { frequency: e.target.value })} /></Row>
          <Check label="Falls in last 12 mo" checked={dd.falls_12mo} onChange={(v) => setSec('dizziness_detail', { falls_12mo: v })} testId="dd-falls" />
          {dd.falls_12mo && (
            <>
              <Row label="# of falls">
                <TextInput
                  data-testid="dd-falls-count"
                  value={dd.falls_count ?? ''}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setSec('dizziness_detail', { falls_count: Number.isNaN(n) ? null : n });
                  }}
                />
              </Row>
              <Check label="Injured during fall" checked={dd.falls_injured} onChange={(v) => setSec('dizziness_detail', { falls_injured: v })} testId="dd-falls-injured" />
              {dd.falls_injured && (
                <Row label="Injury">
                  <TextInput data-testid="dd-falls-injury" value={dd.falls_injury_details || ''} onChange={(e) => setSec('dizziness_detail', { falls_injury_details: e.target.value })} />
                </Row>
              )}
            </>
          )}
        </Accordion>

        {/* ========== D. Noise Exposure ========== */}
        <Accordion title="D · Noise Exposure" open={open.D} onToggle={() => toggle('D')} testId="acc-ne">
          <Check label="Occupational / recreational noise exposure" checked={ne.exposed} onChange={(v) => setSec('noise_exposure', { exposed: v })} testId="ne-exposed" />
          {ne.exposed && (
            <Row label="Description">
              <TextArea data-testid="ne-desc" value={ne.description || ''} onChange={(e) => setSec('noise_exposure', { description: e.target.value })} placeholder="Source, duration, hearing protection…" rows={2} />
            </Row>
          )}
        </Accordion>

        {/* ========== E. Family History ========== */}
        <Accordion title="E · Family History" open={open.E} onToggle={() => toggle('E')} testId="acc-fh">
          <Row label="HL in family">
            <Select testId="fh-hl" value={fh.hearing_loss_in_family} onChange={(v) => setSec('family_history', { hearing_loss_in_family: v })} options={YNSure} />
          </Row>
          {fh.hearing_loss_in_family === 'yes' && (
            <Row label="Description"><TextInput data-testid="fh-desc" value={fh.description || ''} onChange={(e) => setSec('family_history', { description: e.target.value })} placeholder="Relation, type, onset age…" /></Row>
          )}
        </Accordion>

        {/* ========== F. Medical History ========== */}
        <Accordion title="F · Medical History" open={open.F} onToggle={() => toggle('F')} testId="acc-mh">
          <Check label="Prior head / neck / ear / throat surgery" checked={mh.prior_head_neck_surgery} onChange={(v) => setSec('medical_history', { prior_head_neck_surgery: v })} testId="mh-surgery" />
          {mh.prior_head_neck_surgery && (
            <Row label="Describe"><TextInput data-testid="mh-surgery-desc" value={mh.prior_head_neck_surgery_details || ''} onChange={(e) => setSec('medical_history', { prior_head_neck_surgery_details: e.target.value })} /></Row>
          )}
          <Check label="Head trauma" checked={mh.head_trauma} onChange={(v) => setSec('medical_history', { head_trauma: v })} testId="mh-trauma" />
          {mh.head_trauma && (
            <Row label="Describe"><TextInput data-testid="mh-trauma-desc" value={mh.head_trauma_details || ''} onChange={(e) => setSec('medical_history', { head_trauma_details: e.target.value })} /></Row>
          )}
          <Row label="Medications">
            <TextArea data-testid="mh-meds" value={mh.medications || ''} onChange={(e) => setSec('medical_history', { medications: e.target.value })} placeholder="Current & ototoxic meds…" rows={2} />
          </Row>
          <div className="text-[10px] font-semibold text-gray-600 pt-1">Significant conditions</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {MEDICAL_CONDITIONS.map((c) => (
              <Check
                key={c.id}
                label={c.label}
                checked={(mh.conditions || []).includes(c.id)}
                onChange={() => setSec('medical_history', { conditions: toggleInList(mh.conditions, c.id) })}
                testId={`mh-cond-${c.id}`}
              />
            ))}
          </div>
        </Accordion>

        {/* ========== G. Hearing Aid History ========== */}
        <Accordion title="G · Hearing Aid History" open={open.G} onToggle={() => toggle('G')} testId="acc-ha">
          <Check label="Ever used a hearing aid" checked={ha.ever_used} onChange={(v) => setSec('hearing_aid_history', { ever_used: v })} testId="ha-ever" />
          <Check label="Currently using" checked={ha.currently_using} onChange={(v) => setSec('hearing_aid_history', { currently_using: v })} testId="ha-current" />
          {(ha.ever_used || ha.currently_using) && (
            <>
              <Row label="Ear"><Select testId="ha-ear" value={ha.ear} onChange={(v) => setSec('hearing_aid_history', { ear: v })} options={AURAL_EAR} /></Row>
              <Row label="Years of use"><TextInput data-testid="ha-years" value={ha.years_of_use || ''} onChange={(e) => setSec('hearing_aid_history', { years_of_use: e.target.value })} /></Row>
              <Row label="Regular wear"><Select testId="ha-regular" value={ha.regular_wear === true ? 'yes' : ha.regular_wear === false ? 'no' : ''} onChange={(v) => setSec('hearing_aid_history', { regular_wear: v === 'yes' ? true : v === 'no' ? false : null })} options={YN} /></Row>
              <Row label="Benefit"><Select testId="ha-benefit" value={ha.benefit === true ? 'yes' : ha.benefit === false ? 'no' : ''} onChange={(v) => setSec('hearing_aid_history', { benefit: v === 'yes' ? true : v === 'no' ? false : null })} options={YN} /></Row>
              <Row label="Problems"><TextArea data-testid="ha-problems" value={ha.problems || ''} onChange={(e) => setSec('hearing_aid_history', { problems: e.target.value })} rows={2} /></Row>
            </>
          )}
        </Accordion>

        {/* ========== H. Communication Needs ========== */}
        <Accordion title="H · Communication Needs" open={open.H} onToggle={() => toggle('H')} testId="acc-cn">
          <div className="text-[10px] font-semibold text-gray-600">Difficult listening situations</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {COMM_SITUATIONS.map((s) => (
              <Check
                key={s.id}
                label={s.label}
                checked={(cn.difficult_situations || []).includes(s.id)}
                onChange={() => setSec('communication_needs', { difficult_situations: toggleInList(cn.difficult_situations, s.id) })}
                testId={`cn-sit-${s.id}`}
              />
            ))}
          </div>
          <div className="text-[10px] font-semibold text-gray-600 pt-1">Top 3 problem areas</div>
          {[0, 1, 2].map((i) => (
            <Row key={i} label={`#${i + 1}`}>
              <TextInput
                data-testid={`cn-top-${i}`}
                value={(cn.top_problem_areas || [])[i] || ''}
                onChange={(e) => {
                  const arr = [...(cn.top_problem_areas || ['', '', ''])];
                  while (arr.length < 3) arr.push('');
                  arr[i] = e.target.value;
                  setSec('communication_needs', { top_problem_areas: arr });
                }}
              />
            </Row>
          ))}
          <Row label="Phone ear"><Select testId="cn-phone-ear" value={cn.phone_ear} onChange={(v) => setSec('communication_needs', { phone_ear: v })} options={PHONE_EAR} /></Row>
        </Accordion>
      </div>
    </div>
  );
};

export default CaseHistorySection;
