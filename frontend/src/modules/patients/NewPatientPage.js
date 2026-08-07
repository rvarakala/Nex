import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { useTestContext } from '../../TestContext';
import ErrorToast, { describeError } from '../../components/ErrorToast';
import { ReferringDoctorPicker } from '../../components/patient/ReferringDoctorPicker';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Field = ({ label, required, children, full, testid, hint }) => (
  <div className={full ? 'col-span-full' : ''} data-testid={testid}>
    <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {children}
    {hint && <div className="text-[9px] text-slate-400 mt-0.5">{hint}</div>}
  </div>
);

const Input = (props) => (
  <input
    {...props}
    className={`w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white ${props.className || ''}`}
  />
);

const Select = ({ options, children, ...rest }) => (
  <select
    {...rest}
    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
  >
    {children || options.map((o) => (typeof o === 'string'
      ? <option key={o} value={o}>{o}</option>
      : <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

const SectionHeader = ({ children }) => (
  <div className="col-span-full mt-3 mb-1 text-[11px] font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-1">
    {children}
  </div>
);

const INITIAL = {
  name: '', age: '', gender: 'Male', dob: '', anniversary_date: '', occupation: '',
  mobile: '', alternate_mobile: '', email: '',
  whatsapp_consent: false,
  address: '', city: '', state: '', pincode: '',
  aadhaar_last4: '',
  chief_complaint: '', complaint_duration: '', ear_side: '',
  referring_physician: '', referring_doctor_id: null, referral_source: 'Walk-in',
  insurance_scheme: 'Cash', insurance_card_number: '', insurance_validity: '', insurance_beneficiary: '',
  notes: '',
};

const REFERRAL_SOURCES = ['Walk-in', 'Doctor Referral', 'Online', 'Camp / Outreach', 'Family / Friend', 'Insurance', 'Repeat Visit', 'Other'];
const INSURANCE_SCHEMES = ['Cash', 'CGHS', 'ECHS', 'ESIC', 'Ayushman Bharat', 'Private Insurance', 'Corporate', 'Other'];
const EAR_SIDES = ['', 'Left', 'Right', 'Bilateral'];

export default function NewPatientPage() {
  const navigate = useNavigate();
  const { patientId } = useParams();
  const isEdit = !!patientId;
  const { setActiveTest } = useTestContext();
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dupMatches, setDupMatches] = useState([]);
  const [loadingPatient, setLoadingPatient] = useState(isEdit);
  // Duplicate-phone confirm modal state. When the backend rejects a
  // POST /patients with 409 { code: 'duplicate_phone', matches: […] },
  // we stash the payload here and pop the choose-existing-or-override
  // dialog. Retrying with `allow_duplicate_phone=true` records the
  // audit trail so shared-family entries stay traceable.
  const [dupBlock, setDupBlock] = useState(null); // { matches, action } | null
  const debounceRef = useRef(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Edit mode: hydrate the form with the existing patient on mount. We pull
  // only the fields the form actually edits — extras (like patient_id, mrd)
  // are intentionally NOT placed on `form` so they can never be smuggled
  // into the PUT body and silently overwrite server-managed values.
  //
  // IMPORTANT: we do NOT fall back to `INITIAL` defaults for fields where
  // the patient's stored value is null/undefined. Doing so would silently
  // overwrite "unset gender" → "Male", "unset insurance" → "Cash", etc.,
  // on the very next save — a sneaky data-corruption bug. Text fields
  // coerce null → "" so the controlled <input> doesn't warn; everything
  // else preserves whatever was stored.
  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/patients/${patientId}`);
        if (!alive) return;
        const p = r.data || {};
        const next = { ...INITIAL };
        for (const k of Object.keys(INITIAL)) {
          const v = p[k];
          if (v === undefined || v === null) {
            // Text inputs need controlled empty strings; the boolean
            // `whatsapp_consent` falls back to false (its INITIAL value).
            if (typeof INITIAL[k] === 'boolean') next[k] = false;
            else next[k] = '';
          } else {
            next[k] = v;
          }
        }
        // Coerce numeric age into a string for the controlled <input>.
        if (p.age === 0 || p.age) next.age = String(p.age);
        next.whatsapp_consent = !!p.whatsapp_consent;
        setForm(next);
      } catch (e) {
        setErr(describeError(e, 'Could not load patient for editing'));
      } finally {
        if (alive) setLoadingPatient(false);
      }
    })();
    return () => { alive = false; };
  }, [isEdit, patientId]);

  // Auto-calc age from DOB
  useEffect(() => {
    if (!form.dob) return;
    const diff = Date.now() - new Date(form.dob).getTime();
    const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
    if (age >= 0 && age < 150) set({ age: String(age) });
  }, [form.dob]);

  // Duplicate detection (debounced) — triggers on 3+ chars name or 4+ digits in mobile.
  // SKIPPED in edit mode: we'd inevitably "match" the patient we're editing
  // (same mobile / same name), which would surface a confusing "possible
  // duplicate of this same patient" banner.
  useEffect(() => {
    if (isEdit) { setDupMatches([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const mobileDigits = (form.mobile || '').replace(/\D/g, '');
    const nameTrimmed = (form.name || '').trim();
    if (mobileDigits.length < 4 && nameTrimmed.length < 3) { setDupMatches([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const params = {};
        if (mobileDigits.length >= 4) params.mobile = mobileDigits;
        if (nameTrimmed.length >= 3) params.name = nameTrimmed;
        const r = await axios.get(`${API}/patients/check-duplicate`, { params });
        setDupMatches(r.data?.matches || []);
      } catch { /* ignore */ }
    }, 400);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [form.mobile, form.name, isEdit]);

  const valid = form.name.trim() && form.age !== '' && !isNaN(parseInt(form.age, 10));

  const submit = async (action, opts = {}) => {
    if (!valid) { setErr('Name and Age are required.'); return; }
    setBusy(true); setErr(null);
    try {
      const payload = { ...form, age: parseInt(form.age, 10) };
      // Clean empty strings → null for optional fields
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === null) delete payload[k];
      });

      // EDIT MODE — PUT to the existing patient and bounce back to their
      // profile so the user sees the updates take effect immediately. None
      // of the "issue a token / start diagnostics" branches apply here —
      // those are walk-in registration actions, not edit actions.
      if (isEdit) {
        await axios.put(`${API}/patients/${patientId}`, payload);
        navigate(`/patients/${patientId}`);
        return;
      }

      // NEW mode. Attach the override flag(s) if the user just confirmed
      // the duplicate-contact dialog.
      const params = {};
      if (opts.allowDuplicatePhone) params.allow_duplicate_phone = 'true';
      if (opts.allowDuplicateEmail) params.allow_duplicate_email = 'true';
      const config = Object.keys(params).length ? { params } : undefined;
      let r;
      try {
        r = await axios.post(`${API}/patients`, payload, config);
      } catch (e) {
        // Backend duplicate-phone/email guards fire as 409. Surface a
        // friendly modal so front-desk can either open the existing
        // patient or (rare) create a legitimate duplicate for a family
        // sharing one phone / email address.
        const code = e?.response?.data?.detail?.code;
        if (e?.response?.status === 409 && (code === 'duplicate_phone' || code === 'duplicate_email')) {
          setBusy(false);
          setDupBlock({
            kind: code === 'duplicate_email' ? 'email' : 'phone',
            matches: e.response.data.detail.matches || [],
            action,
            message: e.response.data.detail.message,
            // Preserve any earlier override so the "create anyway" click
            // for email doesn't blow past a still-unresolved phone dupe.
            allowPhone: !!opts.allowDuplicatePhone,
            allowEmail: !!opts.allowDuplicateEmail,
          });
          return;
        }
        throw e;
      }
      const patient = r.data;

      // If the user chose to link the new patient as a family member
      // (via the DuplicateContactModal's "Also link as family" toggle),
      // wire the link right after creation. Best-effort — even if the
      // link call errors we don't roll back the patient creation because
      // the user can always link later from the Profile page.
      if (opts.linkFamilyTo) {
        try {
          await axios.post(`${API}/patients/${patient.patient_id}/family/link`, {
            other_patient_id: opts.linkFamilyTo,
            relationship: opts.linkFamilyRelationship || null,
          });
        } catch {
          /* soft-fail — profile page will show empty family strip and
             owner can retry from there. */
        }
      }

      // NEW: skip the token/session dance for the "book appointment"
      // action — instead, hand off to the Appointments calendar with the
      // freshly-created patient pre-selected in the modal (Phase B #2).
      if (action === 'book_appointment') {
        const qs = new URLSearchParams({
          bookForPatientId: patient.patient_id,
          bookForPatientName: patient.name || '',
        });
        navigate(`/appointments?${qs.toString()}`);
        return;
      }

      // Issue token
      const tk = await axios.post(`${API}/tokens`, {
        patient_id: patient.patient_id,
        service: action === 'start_diagnostics' ? 'PTA' : 'Registration',
      });
      const token = tk.data;

      // Action dispatch
      if (action === 'start_diagnostics') {
        // Create session + set active test context, handoff to M02
        const session = await axios.post(`${API}/sessions`, {
          patient_id: patient.patient_id,
          audiologist_name: 'Audiologist',
          test_reliability: 'good',
          test_methods: ['headphones'],
        });
        setActiveTest({
          patient,
          sessionId: session.data.session_id,
          token,
        });
        navigate('/test');
      } else if (action === 'print') {
        navigate(`/token/${token.token_id}`);
      } else {
        // "Register patient" — go to dashboard, show success
        navigate('/patients');
      }
    } catch (e) {
      setErr(describeError(e, isEdit ? 'Save failed' : 'Registration failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto" data-testid={isEdit ? 'edit-patient-page' : 'new-patient-page'}>
      {dupBlock && (
        <DuplicateContactModal
          kind={dupBlock.kind}
          matches={dupBlock.matches}
          message={dupBlock.message}
          onOpenExisting={(pid) => { setDupBlock(null); navigate(`/patients/${pid}`); }}
          onCreateAnyway={async ({ linkFamilyTo, linkFamilyRelationship } = {}) => {
            const act = dupBlock.action;
            const prevPhone = dupBlock.allowPhone;
            const prevEmail = dupBlock.allowEmail;
            const opts = {
              allowDuplicatePhone: prevPhone || dupBlock.kind === 'phone',
              allowDuplicateEmail: prevEmail || dupBlock.kind === 'email',
              linkFamilyTo,
              linkFamilyRelationship,
            };
            setDupBlock(null);
            await submit(act, opts);
          }}
          onCancel={() => setDupBlock(null)}
        />
      )}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        <div className="px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-800">
              {isEdit ? 'Edit Patient Details' : 'New Patient Walk-in'}
            </h2>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {isEdit
                ? `Updating record · ${patientId}`
                : 'UC-01 · MRD will be auto-generated on registration'}
            </p>
          </div>
          {!isEdit && dupMatches.length > 0 && (
            <div className="text-[10px] bg-amber-50 border border-amber-300 rounded px-2 py-1 text-amber-800" data-testid="dup-banner">
              <b>{dupMatches.length}</b> possible match{dupMatches.length > 1 ? 'es' : ''} — check before creating
            </div>
          )}
        </div>

        <div className="p-4">
          {/* Loading state on initial fetch in edit mode */}
          {loadingPatient && (
            <div className="text-[12px] text-slate-500 py-4 text-center" data-testid="edit-patient-loading">
              Loading patient details…
            </div>
          )}

          {/* Duplicate match cards — create flow only */}
          {!isEdit && dupMatches.length > 0 && (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded p-2" data-testid="dup-matches">
              <div className="text-[10px] font-bold text-amber-800 mb-1">Potential duplicate records:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {dupMatches.slice(0, 4).map((m) => (
                  <button
                    key={m.patient_id}
                    type="button"
                    onClick={() => navigate(`/patients/${m.patient_id}`)}
                    data-testid={`dup-${m.patient_id}`}
                    className="text-left text-[10px] bg-white border border-amber-200 hover:border-amber-400 rounded px-2 py-1"
                  >
                    <div className="font-semibold text-slate-800">{m.name} <span className="text-slate-400">· {m.age}{m.gender?.[0]}</span></div>
                    <div className="text-slate-500">{m.mrd || m.patient_id}{m.mobile ? ` · ${m.mobile}` : ''}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <SectionHeader>Demographics</SectionHeader>
            <Field label="Full Name" required full testid="f-name">
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} data-testid="in-name" autoFocus />
            </Field>
            <Field label="DOB" testid="f-dob">
              <Input type="date" value={form.dob} onChange={(e) => set({ dob: e.target.value })} data-testid="in-dob" />
            </Field>
            <Field label="Anniversary" testid="f-anniversary" hint="Optional · used for auto-greetings">
              <Input type="date" value={form.anniversary_date} onChange={(e) => set({ anniversary_date: e.target.value })} data-testid="in-anniversary" />
            </Field>
            <Field label="Age" required testid="f-age" hint="Auto from DOB">
              <Input type="number" min="0" max="120" value={form.age} onChange={(e) => set({ age: e.target.value })} data-testid="in-age" />
            </Field>
            <Field label="Gender" required testid="f-gender">
              <Select value={form.gender} onChange={(e) => set({ gender: e.target.value })} options={['Male', 'Female', 'Other']} data-testid="in-gender" />
            </Field>
            <Field label="Occupation" testid="f-occupation">
              <Input value={form.occupation} onChange={(e) => set({ occupation: e.target.value })} data-testid="in-occupation" />
            </Field>

            <SectionHeader>Contact</SectionHeader>
            <Field label="Mobile" required testid="f-mobile" hint="Primary identifier">
              <Input type="tel" value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} placeholder="+91-98765 43210" data-testid="in-mobile" />
            </Field>
            <Field label="Alternate Mobile" testid="f-alt-mobile">
              <Input type="tel" value={form.alternate_mobile} onChange={(e) => set({ alternate_mobile: e.target.value })} data-testid="in-alt-mobile" />
            </Field>
            <Field label="Email" testid="f-email">
              <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} data-testid="in-email" />
            </Field>
            <Field label="WhatsApp updates" full testid="f-whatsapp-consent" hint="DPDP Act 2023 — patient must explicitly opt in">
              <label className="flex items-start gap-2 text-[12px] text-slate-700 leading-snug px-2 py-1.5 rounded border border-slate-200 bg-emerald-50/30 hover:bg-emerald-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.whatsapp_consent}
                  onChange={(e) => set({ whatsapp_consent: e.target.checked })}
                  data-testid="in-whatsapp-consent"
                  className="mt-0.5"
                />
                <span>
                  Patient agrees to receive appointment reminders, invoices and reports
                  on WhatsApp at the mobile number above. They can withdraw this
                  consent any time from their patient profile.
                </span>
              </label>
            </Field>
            <Field label="Aadhaar last 4" testid="f-aadhaar" hint="Optional — privacy">
              <Input inputMode="numeric" maxLength={4}
                value={form.aadhaar_last4}
                onChange={(e) => set({ aadhaar_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                placeholder="XXXX"
                data-testid="in-aadhaar"
              />
            </Field>
            <Field label="Address" full testid="f-address">
              <Input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Street, Area" data-testid="in-address" />
            </Field>
            <Field label="City" testid="f-city">
              <Input value={form.city} onChange={(e) => set({ city: e.target.value })} data-testid="in-city" />
            </Field>
            <Field label="State" testid="f-state">
              <Input value={form.state} onChange={(e) => set({ state: e.target.value })} data-testid="in-state" />
            </Field>
            <Field label="Pincode" testid="f-pincode">
              <Input inputMode="numeric" maxLength={6}
                value={form.pincode}
                onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                data-testid="in-pincode"
              />
            </Field>

            <SectionHeader>Chief Complaint (Triage)</SectionHeader>
            <Field label="Chief Complaint" full testid="f-cc" hint="Brief — detailed case history is captured by audiologist in Diagnostics">
              <Input value={form.chief_complaint} onChange={(e) => set({ chief_complaint: e.target.value })} placeholder="e.g., Reduced hearing in both ears since 6 months" data-testid="in-cc" />
            </Field>
            <Field label="Duration" testid="f-duration">
              <Input value={form.complaint_duration} onChange={(e) => set({ complaint_duration: e.target.value })} placeholder="e.g., 6 months" data-testid="in-duration" />
            </Field>
            <Field label="Ear Side" testid="f-ear">
              <Select value={form.ear_side} onChange={(e) => set({ ear_side: e.target.value })} options={EAR_SIDES.map(x => ({ value: x, label: x || '—' }))} data-testid="in-ear" />
            </Field>

            <SectionHeader>Referral</SectionHeader>
            <Field label="Referred By Doctor" testid="f-refdoc" full>
              <ReferringDoctorPicker
                value={form.referring_doctor_id}
                onChange={(id, doc) => set({
                  referring_doctor_id: id,
                  // Keep the legacy free-text field in sync so old reports still work
                  referring_physician: doc ? `${doc.name}${doc.clinic ? ` (${doc.clinic})` : ''}` : '',
                  // Auto-toggle referral_source to Doctor when a doctor is selected
                  referral_source: id ? 'Doctor Referral' : form.referral_source,
                })}
                testid="in-refdoc"
              />
            </Field>
            <Field label="Referral Source" testid="f-refsrc">
              <Select value={form.referral_source} onChange={(e) => set({ referral_source: e.target.value })} options={REFERRAL_SOURCES} data-testid="in-refsrc" />
            </Field>

            <SectionHeader>Insurance / Scheme</SectionHeader>
            <Field label="Scheme" testid="f-scheme">
              <Select value={form.insurance_scheme} onChange={(e) => set({ insurance_scheme: e.target.value })} options={INSURANCE_SCHEMES} data-testid="in-scheme" />
            </Field>
            <Field label="Card / Beneficiary No." testid="f-card">
              <Input value={form.insurance_card_number} onChange={(e) => set({ insurance_card_number: e.target.value })} data-testid="in-card" />
            </Field>
            <Field label="Valid Till" testid="f-validity">
              <Input type="date" value={form.insurance_validity} onChange={(e) => set({ insurance_validity: e.target.value })} data-testid="in-validity" />
            </Field>
            <Field label="Beneficiary" testid="f-benef">
              <Input value={form.insurance_beneficiary} onChange={(e) => set({ insurance_beneficiary: e.target.value })} placeholder="Self / Spouse / Dependant" data-testid="in-benef" />
            </Field>

            <SectionHeader>Notes</SectionHeader>
            <Field label="Internal Notes" full testid="f-notes">
              <textarea
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
                rows={2}
                data-testid="in-notes"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 resize-y"
              />
            </Field>
          </div>

          {err && <div className="mt-3"><ErrorToast err={err} testid="form-error" /></div>}
        </div>

        {/* Sticky action bar */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 sticky bottom-0">
          {isEdit ? (
            <>
              <button
                type="button"
                onClick={() => navigate(`/patients/${patientId}`)}
                data-testid="btn-cancel-edit"
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
              >Cancel</button>
              <button
                type="button"
                onClick={() => submit('save')}
                disabled={!valid || busy || loadingPatient}
                data-testid="btn-save-edit"
                className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded disabled:opacity-50 shadow-sm"
              >{busy ? 'Saving…' : 'Save Changes'}</button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setForm(INITIAL)}
                data-testid="btn-reset"
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
              >Reset</button>
              <button
                type="button"
                onClick={() => submit('register')}
                disabled={!valid || busy}
                data-testid="btn-register"
                className="px-3 py-1.5 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded disabled:opacity-50"
              >{busy ? 'Saving…' : 'Register Patient'}</button>
              <button
                type="button"
                onClick={() => submit('print')}
                disabled={!valid || busy}
                data-testid="btn-register-print"
                className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded disabled:opacity-50"
              >Register + Print Token</button>
              <button
                type="button"
                onClick={() => submit('book_appointment')}
                disabled={!valid || busy}
                data-testid="btn-register-book-apt"
                title="Save the patient and jump straight into booking an appointment for them."
                className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded disabled:opacity-50 shadow-sm"
              >Register + Book Appointment →</button>
              <button
                type="button"
                onClick={() => submit('start_diagnostics')}
                disabled={!valid || busy}
                data-testid="btn-register-diagnostics"
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded disabled:opacity-50 shadow-sm"
              >Register + Start Diagnostics →</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


/* ============================================================================
   DuplicateContactModal — surfaces when the backend rejects a POST /patients
   with 409 { code: 'duplicate_phone' | 'duplicate_email', matches }.
   Reported by a production user (2026-08-07): "when I create a
   registration, it is accepting multiple times when I give the same
   phone number and it is not showing as the patient with the same
   phone number already exists".

   UX: 3 explicit outcomes, no ambiguity.
     • "Open patient <name>"  → route to the matching profile
     • "Create as new anyway" → allow the duplicate (family sharing phone).
       Retried POST includes ?allow_duplicate_phone=true (or email) so
       the backend accepts it AND stamps the override flag on the audit
       log for future forensic tracing.
     • "Cancel"               → close the modal and let the user edit
       the phone / email.

   The `kind` prop switches copy between phone and email variants while
   sharing the same match-card + footer treatment.
   ========================================================================== */
function DuplicateContactModal({ kind, matches, message, onOpenExisting, onCreateAnyway, onCancel }) {
  const isEmail = kind === 'email';
  const heading = isEmail ? 'Duplicate email detected' : 'Duplicate phone number detected';
  const fallbackMsg = isEmail
    ? 'A patient with this email already exists in your clinic.'
    : 'A patient with this phone already exists in your clinic.';
  // Auto-link-as-family state — the checkbox is only useful when the
  // user KNOWS the new person is a family member of one of the matches
  // (spouse / parent / child sharing a phone). Front-desk picks the
  // relationship from a small pill row.
  const [linkTo, setLinkTo] = React.useState(matches?.[0]?.patient_id || '');
  const [relationship, setRelationship] = React.useState('spouse');
  const [linkFamily, setLinkFamily] = React.useState(true);
  const relOptions = ['spouse', 'parent', 'child', 'sibling', 'other'];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 pb-24 md:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
      data-testid={isEmail ? 'dup-email-modal' : 'dup-phone-modal'}
    >
      <div className="bg-white rounded-lg shadow-2xl w-[520px] max-w-full max-h-[calc(100dvh-96px)] sm:max-h-[85vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <span className="text-amber-600 text-base leading-none">⚠</span>
            {heading}
          </h3>
          <p className="text-[11.5px] text-slate-500 mt-0.5">
            {message || fallbackMsg}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {matches.map((m) => (
            <button
              key={m.patient_id}
              type="button"
              onClick={() => onOpenExisting(m.patient_id)}
              data-testid={`dup-match-${m.patient_id}`}
              className="w-full text-left border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-md p-3 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900 truncate">{m.name}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    MRD <span className="font-mono">{m.mrd}</span>
                    {m.mobile && <> · 📱 {m.mobile}</>}
                    {m.email && <> · ✉ {m.email}</>}
                    {m.age && <> · {m.age}y</>}
                    {m.gender && <> · {m.gender}</>}
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  Open →
                </span>
              </div>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="text-[11.5px] text-slate-500 italic py-4 text-center">
              No matching patient details available.
            </div>
          )}
          <div className="text-[10.5px] text-slate-500 italic pt-2">
            💡 Tip — clinic owners can also open a matching record and use
            the <b>Merge</b> button to combine two already-created duplicates.
          </div>

          {/* Auto-link-as-family — only show when we have a match to
              link to. Common flow for spouses/parents/children who
              legitimately share a phone. Front-desk toggles this off
              only if the collision was genuinely unrelated. */}
          {matches.length > 0 && (
            <div className="border border-emerald-200 bg-emerald-50/60 rounded-md p-3" data-testid="family-link-block">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={linkFamily}
                  onChange={(e) => setLinkFamily(e.target.checked)}
                  data-testid="family-link-toggle"
                  className="mt-0.5 accent-emerald-600"
                />
                <div className="text-[11.5px] text-slate-800">
                  <b>Link as family member</b> — keep both records separate but connected so history opens from either profile without merging.
                </div>
              </label>
              {linkFamily && (
                <div className="mt-2 space-y-1.5 pl-6">
                  {matches.length > 1 && (
                    <select
                      value={linkTo}
                      onChange={(e) => setLinkTo(e.target.value)}
                      data-testid="family-link-target"
                      className="w-full text-[11.5px] border border-slate-300 rounded-md px-2 py-1.5"
                    >
                      {matches.map((m) => (
                        <option key={m.patient_id} value={m.patient_id}>
                          Link to {m.name} (MRD {m.mrd})
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {relOptions.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRelationship(r)}
                        data-testid={`family-rel-${r}`}
                        className={`px-2.5 py-0.5 rounded-full border text-[10.5px] font-semibold capitalize transition ${
                          relationship === r
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-emerald-400'
                        }`}
                      >{r}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-wrap flex-shrink-0">
          <button
            type="button"
            onClick={onCancel}
            data-testid="dup-cancel"
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded"
          >
            Cancel & edit
          </button>
          <button
            type="button"
            onClick={() => onCreateAnyway(
              linkFamily && matches.length > 0
                ? { linkFamilyTo: linkTo || matches[0].patient_id, linkFamilyRelationship: relationship }
                : {}
            )}
            data-testid="dup-create-anyway"
            className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded"
          >
            {linkFamily && matches.length > 0 ? 'Create + link as family' : 'Create as new anyway'}
          </button>
        </footer>
      </div>
    </div>
  );
}
