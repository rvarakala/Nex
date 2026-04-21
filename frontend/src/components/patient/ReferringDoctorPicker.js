import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * ReferringDoctorPicker — combobox with autocomplete + inline "add new doctor".
 * value: doctorId or null.
 * onChange(doctorId | null, doctorObj | null)
 */
export const ReferringDoctorPicker = ({ value, onChange, label = 'Referring Doctor', testid = 'doc-picker' }) => {
  const [query, setQuery] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newDoc, setNewDoc] = useState({ name: '', specialty: 'ENT', clinic: '', phone: '' });
  const wrapRef = useRef(null);

  // Load full list once on mount + whenever value changes (to hydrate display)
  useEffect(() => {
    let cancel = false;
    axios.get(`${API}/referring-doctors`).then((r) => { if (!cancel) setDoctors(r.data || []); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = doctors.find((d) => d.doctor_id === value) || null;
  const filtered = query.trim()
    ? doctors.filter((d) => {
        const q = query.toLowerCase();
        return (d.name || '').toLowerCase().includes(q)
            || (d.specialty || '').toLowerCase().includes(q)
            || (d.clinic || '').toLowerCase().includes(q)
            || (d.phone || '').toLowerCase().includes(q);
      })
    : doctors;

  const saveNewDoc = async () => {
    if (!newDoc.name.trim()) return;
    try {
      const r = await axios.post(`${API}/referring-doctors`, newDoc);
      const doc = r.data;
      setDoctors((d) => [doc, ...d]);
      onChange?.(doc.doctor_id, doc);
      setAdding(false);
      setNewDoc({ name: '', specialty: 'ENT', clinic: '', phone: '' });
      setOpen(false);
    } catch (err) {
      console.error('Create doctor failed', err);
    }
  };

  return (
    <div ref={wrapRef} className="relative" data-testid={testid}>
      {label && <div className="text-[10px] font-semibold text-gray-600 mb-0.5">{label}</div>}
      <div className="flex gap-1">
        <input
          type="text"
          value={open ? query : (selected ? `${selected.name}${selected.specialty ? ' · ' + selected.specialty : ''}` : '')}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          placeholder="Search or add ENT / physician…"
          data-testid={`${testid}-input`}
          className="flex-1 text-[11px] border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500"
        />
        {selected && (
          <button
            type="button"
            onClick={() => onChange?.(null, null)}
            data-testid={`${testid}-clear`}
            title="Clear referral"
            className="px-1.5 text-[10px] text-gray-500 hover:text-red-600 border border-gray-300 rounded"
          >×</button>
        )}
      </div>

      {open && !adding && (
        <div className="absolute z-20 mt-0.5 w-full max-h-60 overflow-auto bg-white border border-gray-300 rounded shadow-lg text-[11px]">
          {filtered.length === 0 && (
            <div className="px-2 py-1.5 text-gray-400 italic">No matches</div>
          )}
          {filtered.map((d) => (
            <button
              key={d.doctor_id}
              type="button"
              onClick={() => { onChange?.(d.doctor_id, d); setOpen(false); setQuery(''); }}
              data-testid={`${testid}-option-${d.doctor_id}`}
              className="w-full text-left px-2 py-1 hover:bg-blue-50 border-b border-gray-100 last:border-0"
            >
              <div className="font-medium">{d.name}</div>
              <div className="text-[9px] text-gray-500">
                {[d.specialty, d.clinic, d.phone].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setAdding(true); setNewDoc({ ...newDoc, name: query }); }}
            data-testid={`${testid}-add-new`}
            className="w-full text-left px-2 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold border-t border-blue-200"
          >
            + Add new doctor{query.trim() ? `: "${query.trim()}"` : ''}
          </button>
        </div>
      )}

      {open && adding && (
        <div className="absolute z-20 mt-0.5 w-full bg-white border border-blue-300 rounded shadow-lg p-2 space-y-1">
          <div className="text-[10px] font-bold text-blue-700">New Referring Doctor</div>
          <input
            type="text"
            value={newDoc.name}
            onChange={(e) => setNewDoc({ ...newDoc, name: e.target.value })}
            placeholder="Name *"
            autoFocus
            data-testid={`${testid}-new-name`}
            className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1"
          />
          <div className="grid grid-cols-2 gap-1">
            <input
              type="text"
              value={newDoc.specialty}
              onChange={(e) => setNewDoc({ ...newDoc, specialty: e.target.value })}
              placeholder="Specialty (ENT)"
              data-testid={`${testid}-new-specialty`}
              className="text-[11px] border border-gray-300 rounded px-1.5 py-1"
            />
            <input
              type="text"
              value={newDoc.phone}
              onChange={(e) => setNewDoc({ ...newDoc, phone: e.target.value })}
              placeholder="Phone"
              data-testid={`${testid}-new-phone`}
              className="text-[11px] border border-gray-300 rounded px-1.5 py-1"
            />
          </div>
          <input
            type="text"
            value={newDoc.clinic}
            onChange={(e) => setNewDoc({ ...newDoc, clinic: e.target.value })}
            placeholder="Clinic / Hospital"
            data-testid={`${testid}-new-clinic`}
            className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1"
          />
          <div className="flex gap-1 pt-0.5">
            <button
              type="button"
              onClick={saveNewDoc}
              disabled={!newDoc.name.trim()}
              data-testid={`${testid}-new-save`}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-[11px] font-semibold py-1 rounded"
            >Save</button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              data-testid={`${testid}-new-cancel`}
              className="px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100"
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};
