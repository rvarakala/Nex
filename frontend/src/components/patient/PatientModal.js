import React, { useState, useEffect } from 'react';
import { ReferringDoctorPicker } from './ReferringDoctorPicker';

/**
 * PatientModal — create or edit a patient record. India-tuned field set.
 * props:
 *   mode: 'create' | 'edit'
 *   initial: existing patient object (for edit) or null
 *   onClose()
 *   onSave(patientPayload)  -- caller handles axios + state update
 */
export const PatientModal = ({ mode = 'create', initial = null, onClose, onSave }) => {
  const [form, setForm] = useState({
    name: '',
    age: '',
    gender: 'Male',
    dob: '',
    mobile: '',
    aadhaar_last4: '',
    address: '',
    email: '',
    referring_doctor_id: null,
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name || '',
        age: initial.age ?? '',
        gender: initial.gender || 'Male',
        dob: initial.dob || '',
        mobile: initial.mobile || initial.phone || '',
        aadhaar_last4: initial.aadhaar_last4 || '',
        address: initial.address || '',
        email: initial.email || '',
        referring_doctor_id: initial.referring_doctor_id || null,
        notes: initial.notes || '',
      });
    }
  }, [initial]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const valid = form.name.trim() && form.age !== '' && !isNaN(parseInt(form.age, 10));

  const handleSave = async () => {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name: form.name.trim(),
        age: parseInt(form.age, 10),
        gender: form.gender,
        dob: form.dob || null,
        mobile: form.mobile || null,
        aadhaar_last4: form.aadhaar_last4 ? form.aadhaar_last4.slice(-4) : null,
        address: form.address || null,
        email: form.email || null,
        referring_doctor_id: form.referring_doctor_id || null,
        notes: form.notes || null,
      };
      await onSave?.(payload);
      onClose?.();
    } catch (e) {
      console.error('Save patient failed', e);
      setErr(e?.response?.data?.detail || e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="patient-modal"
    >
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-w-[92vw] max-h-[90vh] flex flex-col">
        <div className="px-3 py-2 border-b border-gray-300 bg-gradient-to-r from-gray-100 to-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">
            {mode === 'edit' ? 'Edit Patient' : 'New Patient'}
          </h3>
          <button
            onClick={onClose}
            data-testid="patient-modal-close"
            className="w-6 h-6 text-gray-500 hover:text-red-600 text-lg leading-none"
          >×</button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Full name *" testid="pf-name">
              <input
                type="text"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                autoFocus
                data-testid="patient-field-name"
                className="w-full text-[12px] border border-gray-300 rounded px-2 py-1"
              />
            </Field>
            <Field label="Mobile (primary)" testid="pf-mobile">
              <input
                type="tel"
                value={form.mobile}
                onChange={(e) => set({ mobile: e.target.value })}
                placeholder="+91-98765 43210"
                data-testid="patient-field-mobile"
                className="w-full text-[12px] border border-gray-300 rounded px-2 py-1"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Age *" testid="pf-age">
              <input
                type="number"
                min="0"
                max="120"
                value={form.age}
                onChange={(e) => set({ age: e.target.value })}
                data-testid="patient-field-age"
                className="w-full text-[12px] border border-gray-300 rounded px-2 py-1"
              />
            </Field>
            <Field label="Gender *" testid="pf-gender">
              <select
                value={form.gender}
                onChange={(e) => set({ gender: e.target.value })}
                data-testid="patient-field-gender"
                className="w-full text-[12px] border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field label="DOB" testid="pf-dob">
              <input
                type="date"
                value={form.dob}
                onChange={(e) => set({ dob: e.target.value })}
                data-testid="patient-field-dob"
                className="w-full text-[12px] border border-gray-300 rounded px-2 py-1"
              />
            </Field>
          </div>

          <Field label="Address" testid="pf-address">
            <input
              type="text"
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="Street, City, State, Pincode"
              data-testid="patient-field-address"
              className="w-full text-[12px] border border-gray-300 rounded px-2 py-1"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Email" testid="pf-email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                data-testid="patient-field-email"
                className="w-full text-[12px] border border-gray-300 rounded px-2 py-1"
              />
            </Field>
            <Field label="Aadhaar last 4 (optional)" testid="pf-aadhaar">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={form.aadhaar_last4}
                onChange={(e) => set({ aadhaar_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                placeholder="XXXX"
                data-testid="patient-field-aadhaar"
                className="w-full text-[12px] border border-gray-300 rounded px-2 py-1"
              />
            </Field>
          </div>

          <ReferringDoctorPicker
            value={form.referring_doctor_id}
            onChange={(id) => set({ referring_doctor_id: id })}
            testid="patient-field-refdoc"
          />

          <Field label="Notes" testid="pf-notes">
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              data-testid="patient-field-notes"
              className="w-full text-[12px] border border-gray-300 rounded px-2 py-1 resize-y"
            />
          </Field>

          {err && (
            <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1" data-testid="patient-modal-error">
              {err}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-gray-300 bg-gray-50 flex justify-end gap-2">
          <button
            onClick={onClose}
            data-testid="patient-modal-cancel"
            className="px-3 py-1 text-[12px] border border-gray-300 rounded hover:bg-gray-100"
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={!valid || busy}
            data-testid="patient-modal-save"
            className="px-3 py-1 text-[12px] bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded"
          >
            {busy ? 'Saving…' : (mode === 'edit' ? 'Save changes' : 'Create patient')}
          </button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <div>
    <div className="text-[10px] font-semibold text-gray-600 mb-0.5">{label}</div>
    {children}
  </div>
);
