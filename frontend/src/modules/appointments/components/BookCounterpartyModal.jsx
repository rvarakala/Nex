import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { X, Search } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TYPE_LABELS = {
  vendor: 'Vendor',
  sales_rep: 'Sales Rep',
  tech_staff: 'Tech Staff',
  internal: 'Internal',
  other: 'Other',
};

const DURATIONS = [15, 30, 45, 60, 90, 120];
const CATEGORIES = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'demo',    label: 'Demo' },
  { value: 'fitting', label: 'Fitting' },
  { value: 'other',   label: 'Other' },
];

/**
 * BookCounterpartyModal — slim form for non-patient bookings.
 *
 * Props:
 *   counterpartyType : 'vendor' | 'sales_rep' | 'tech_staff' | 'internal' | 'other'
 *   staff            : Array<{user_id, name, role, color}>
 *   initialDate      : Date
 *   initialTime      : 'HH:MM' string
 *   existing         : full appointment row when editing
 *   onClose, onSaved
 */
export default function BookCounterpartyModal({
  counterpartyType,
  staff,
  initialDate,
  initialTime,
  existing,
  onClose,
  onSaved,
}) {
  const isEdit = !!existing?.appointment_id;
  const type = existing?.counterparty_type || counterpartyType;
  const supportsAutocomplete = type === 'vendor' || type === 'tech_staff';
  const typeLabel = TYPE_LABELS[type] || 'Counterparty';

  const today = useMemo(
    () => (initialDate ? initialDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)),
    [initialDate],
  );

  // Counterparty fields
  const [cpQuery, setCpQuery] = useState(existing?.counterparty_name || '');
  const [cpId, setCpId] = useState(existing?.counterparty_id || null);
  const [cpPhone, setCpPhone] = useState(existing?.counterparty_phone || '');
  const [cpCompany, setCpCompany] = useState(existing?.counterparty_company || '');
  const [cpResults, setCpResults] = useState([]);
  const [cpDropdown, setCpDropdown] = useState(false);

  // Slot + resource
  const [staffId, setStaffId] = useState(existing?.staff_id || existing?.audiologist_id || staff[0]?.user_id || '');
  const [date, setDate] = useState(existing?.start_at ? existing.start_at.slice(0, 10) : today);
  const [time, setTime] = useState(
    existing?.start_at ? existing.start_at.slice(11, 16) : (initialTime || '10:00'),
  );
  const [duration, setDuration] = useState(existing?.duration_minutes || 60);
  const [category, setCategory] = useState(existing?.category || (type === 'vendor' || type === 'sales_rep' ? 'meeting' : 'meeting'));
  const [room, setRoom] = useState(existing?.room || '');
  const [notes, setNotes] = useState(existing?.notes || '');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // ---- Counterparty autocomplete (vendor / tech_staff only) ---------------
  useEffect(() => {
    if (!supportsAutocomplete) return;
    if (cpQuery.trim().length < 1) { setCpResults([]); return; }
    if (cpId) return; // user has already picked
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/appointments/counterparties`, {
          params: { type, q: cpQuery, limit: 8 },
        });
        setCpResults(r.data || []);
      } catch {
        setCpResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [cpQuery, type, cpId, supportsAutocomplete]);

  const pickCp = (row) => {
    setCpId(row.id);
    setCpQuery(row.name);
    setCpPhone(row.phone || '');
    setCpCompany(row.company || '');
    setCpDropdown(false);
  };

  const clearCp = () => {
    setCpId(null);
    setCpQuery('');
    setCpPhone('');
    setCpCompany('');
  };

  const submit = useCallback(async () => {
    setErr(null);
    if (!cpQuery.trim()) { setErr(`${typeLabel} name is required`); return; }
    if (!staffId) { setErr('Pick a staff member'); return; }
    setBusy(true);
    try {
      const startIso = `${date}T${time}:00`;
      if (isEdit) {
        await axios.put(`${API}/appointments/${existing.appointment_id}`, {
          staff_id: staffId,
          counterparty_type: type,
          counterparty_id: cpId || null,
          counterparty_name: cpQuery.trim(),
          counterparty_phone: cpPhone || null,
          counterparty_company: cpCompany || null,
          category,
          room: room || null,
          start_at: startIso,
          duration_minutes: duration,
          notes,
        });
      } else {
        await axios.post(`${API}/appointments`, {
          staff_id: staffId,
          counterparty_type: type,
          counterparty_id: cpId || null,
          counterparty_name: cpQuery.trim(),
          counterparty_phone: cpPhone || null,
          counterparty_company: cpCompany || null,
          category,
          room: room || null,
          start_at: startIso,
          duration_minutes: duration,
          notes,
        });
      }
      onSaved?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (d && typeof d === 'object' && d.conflict_with) {
        const t = new Date(d.conflict_with.start_at).toLocaleTimeString('en-IN', {
          hour: '2-digit', minute: '2-digit',
        });
        setErr(`Conflict: ${d.conflict_with.patient_name} at ${t}`);
      } else {
        setErr(typeof d === 'string' ? d : (e?.message || 'Save failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [cpId, cpQuery, cpPhone, cpCompany, staffId, type, category, room, date, time, duration, notes, isEdit, existing, typeLabel, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="apt-cp-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">
              {isEdit ? 'Edit' : 'Book'} {typeLabel} appointment
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {supportsAutocomplete
                ? `Pick from existing ${typeLabel.toLowerCase()}s or type a new one.`
                : 'Free-text counterparty — anyone outside the clinic.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center justify-center"
            data-testid="apt-cp-close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {/* Counterparty name + autocomplete */}
          <div className="relative">
            <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">
              {typeLabel} name *
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={cpQuery}
                onChange={(e) => { setCpQuery(e.target.value); setCpId(null); setCpDropdown(true); }}
                onFocus={() => setCpDropdown(true)}
                placeholder={supportsAutocomplete ? `Search ${typeLabel.toLowerCase()}…` : `e.g. ${type === 'sales_rep' ? 'Rajeev (Phonak)' : type === 'internal' ? 'Monthly review' : 'Name'}`}
                autoFocus
                data-testid="apt-cp-name"
                className="w-full pl-8 pr-7 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
              />
              {cpQuery && (
                <button
                  type="button"
                  onClick={clearCp}
                  className="absolute right-2 top-1.5 text-slate-400 hover:text-rose-600 text-sm"
                  aria-label="Clear"
                >
                  ×
                </button>
              )}
            </div>
            {/* Dropdown */}
            {supportsAutocomplete && cpDropdown && cpResults.length > 0 && !cpId && (
              <div
                className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg z-10 max-h-56 overflow-auto"
                data-testid="apt-cp-dropdown"
              >
                {cpResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pickCp(r)}
                    className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0"
                    data-testid={`apt-cp-result-${r.id}`}
                  >
                    <div className="text-[12px] font-semibold text-slate-900">{r.name}</div>
                    {(r.subtitle || r.phone) && (
                      <div className="text-[10px] text-slate-500">{r.subtitle || r.phone}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Phone + Company (free text) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={cpPhone}
                onChange={(e) => setCpPhone(e.target.value)}
                placeholder="Optional"
                data-testid="apt-cp-phone"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">
                {type === 'sales_rep' || type === 'vendor' ? 'Company / Brand' : 'Organisation'}
              </label>
              <input
                type="text"
                value={cpCompany}
                onChange={(e) => setCpCompany(e.target.value)}
                placeholder="Optional"
                data-testid="apt-cp-company"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Staff resource */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">
              Owner *
            </label>
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              data-testid="apt-cp-staff"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 bg-white"
            >
              {staff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.name} — {(s.role || '').replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Date + Time + Duration */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="apt-cp-date"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Time *</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                data-testid="apt-cp-time"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                data-testid="apt-cp-duration"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 bg-white"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category + Room */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid="apt-cp-category"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Room</label>
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Optional"
                data-testid="apt-cp-room"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What's the agenda?"
              rows={2}
              data-testid="apt-cp-notes"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {err && (
            <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5" data-testid="apt-cp-error">
              {err}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 rounded"
            data-testid="apt-cp-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            data-testid="apt-cp-submit"
            className="px-4 py-1.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : `Book ${typeLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
