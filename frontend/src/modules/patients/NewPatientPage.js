import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useTestContext } from '../../TestContext';
import ErrorToast, { describeError } from '../../components/ErrorToast';

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
  referring_physician: '', referral_source: 'Walk-in',
  insurance_scheme: 'Cash', insurance_card_number: '', insurance_validity: '', insurance_beneficiary: '',
  notes: '',
};

const REFERRAL_SOURCES = ['Walk-in', 'Doctor Referral', 'Online', 'Camp / Outreach', 'Family / Friend', 'Insurance', 'Repeat Visit', 'Other'];
const INSURANCE_SCHEMES = ['Cash', 'CGHS', 'ECHS', 'ESIC', 'Ayushman Bharat', 'Private Insurance', 'Corporate', 'Other'];
const EAR_SIDES = ['', 'Left', 'Right', 'Bilateral'];

export default function NewPatientPage() {
  const navigate = useNavigate();
  const { setActiveTest } = useTestContext();
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dupMatches, setDupMatches] = useState([]);
  const debounceRef = useRef(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Auto-calc age from DOB
  useEffect(() => {
    if (!form.dob) return;
    const diff = Date.now() - new Date(form.dob).getTime();
    const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
    if (age >= 0 && age < 150) set({ age: String(age) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dob]);

  // Duplicate detection (debounced) — triggers on 3+ chars name or 4+ digits in mobile
  useEffect(() => {
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
  }, [form.mobile, form.name]);

  const valid = form.name.trim() && form.age !== '' && !isNaN(parseInt(form.age, 10));

  const submit = async (action) => {
    if (!valid) { setErr('Name and Age are required.'); return; }
    setBusy(true); setErr(null);
    try {
      const payload = { ...form, age: parseInt(form.age, 10) };
      // Clean empty strings → null for optional fields
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '' || payload[k] === null) delete payload[k];
      });
      const r = await axios.post(`${API}/patients`, payload);
      const patient = r.data;

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
      setErr(describeError(e, 'Registration failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto" data-testid="new-patient-page">
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        <div className="px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-800">New Patient Walk-in</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">UC-01 · MRD will be auto-generated on registration</p>
          </div>
          {dupMatches.length > 0 && (
            <div className="text-[10px] bg-amber-50 border border-amber-300 rounded px-2 py-1 text-amber-800" data-testid="dup-banner">
              <b>{dupMatches.length}</b> possible match{dupMatches.length > 1 ? 'es' : ''} — check before creating
            </div>
          )}
        </div>

        <div className="p-4">
          {/* Duplicate match cards */}
          {dupMatches.length > 0 && (
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
            <Field label="Referred By Doctor" testid="f-refdoc">
              <Input value={form.referring_physician} onChange={(e) => set({ referring_physician: e.target.value })} placeholder="Dr. name / clinic" data-testid="in-refdoc" />
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
            onClick={() => submit('start_diagnostics')}
            disabled={!valid || busy}
            data-testid="btn-register-diagnostics"
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded disabled:opacity-50 shadow-sm"
          >Register + Start Diagnostics →</button>
        </div>
      </div>
    </div>
  );
}
