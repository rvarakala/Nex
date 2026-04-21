import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SERVICES = ['Consultation', 'PTA', 'Immittance', 'OAE', 'ABR/BERA', 'ASSR', 'Vestibular Tests', 'Follow-up', 'Speech Audiometry', 'Hearing Aid Fitting'];
const ROOMS = ['Room 1', 'Room 2', 'Sound Booth'];
const DURATIONS = [15, 30, 45, 60, 90];

export default function BookAppointmentModal({ audiologists, initialDate, existing, onClose, onSaved }) {
  const isEdit = !!existing?.appointment_id;
  const today = useMemo(() => (initialDate ? initialDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)), [initialDate]);

  // Patient search
  const [patientQuery, setPatientQuery] = useState(existing?.patient_name || '');
  const [patientResults, setPatientResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(existing && existing.patient_id ? { patient_id: existing.patient_id, name: existing.patient_name } : null);
  const [patientDropdown, setPatientDropdown] = useState(false);

  // Form
  const [audiologistId, setAudiologistId] = useState(existing?.audiologist_id || (audiologists[0]?.user_id || ''));
  const [service, setService] = useState(existing?.service || 'PTA');
  const [room, setRoom] = useState(existing?.room || '');
  const [priority, setPriority] = useState(existing?.priority || 'normal');
  const [duration, setDuration] = useState(existing?.duration_minutes || 30);
  const [date, setDate] = useState(existing?.start_at ? existing.start_at.slice(0, 10) : today);
  const [time, setTime] = useState(existing?.start_at ? existing.start_at.slice(11, 16) : '10:00');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [slots, setSlots] = useState([]);

  // Patient search debounce
  useEffect(() => {
    if (selectedPatient && patientQuery === selectedPatient.name) return;
    if (!patientQuery || patientQuery.trim().length < 2) { setPatientResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: patientQuery, limit: 8 } });
        setPatientResults(r.data || []);
      } catch { setPatientResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [patientQuery, selectedPatient]);

  // Slot suggestions
  const fetchSlots = useCallback(async () => {
    if (!audiologistId || !date) return;
    try {
      const r = await axios.get(`${API}/appointments/slots`, {
        params: { audiologist_id: audiologistId, date, duration_minutes: duration },
      });
      setSlots(r.data?.slots || []);
    } catch { setSlots([]); }
  }, [audiologistId, date, duration]);
  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  const valid = selectedPatient && audiologistId && service && date && time;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const startIso = `${date}T${time}:00`;
      if (isEdit) {
        await axios.put(`${API}/appointments/${existing.appointment_id}`, {
          audiologist_id: audiologistId, service, room: room || null, priority,
          start_at: startIso, duration_minutes: duration, notes,
        });
      } else {
        await axios.post(`${API}/appointments`, {
          patient_id: selectedPatient.patient_id, audiologist_id: audiologistId,
          service, room: room || null, priority,
          start_at: startIso, duration_minutes: duration, notes,
        });
        if (existing?._waitlist_entry_id) {
          try { await axios.put(`${API}/waitlist/${existing._waitlist_entry_id}/status`, { status: 'scheduled' }); } catch {}
        }
      }
      onSaved?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (d && typeof d === 'object' && d.conflict_with) {
        setErr(`Conflict with ${d.conflict_with.patient_name} at ${new Date(d.conflict_with.start_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);
      } else {
        setErr(typeof d === 'string' ? d : (e?.message || 'Save failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
         data-testid="book-apt-modal">
      <div className="bg-white rounded-lg shadow-2xl w-[560px] max-w-full max-h-[90vh] flex flex-col">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{isEdit ? 'Edit Appointment' : 'Book Appointment'}</h3>
          <button onClick={onClose} className="w-6 h-6 text-slate-500 hover:text-red-600 text-lg">×</button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {/* Patient */}
          <div className="relative">
            <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Patient *</label>
            <input
              type="text"
              value={patientQuery}
              onChange={(e) => { setPatientQuery(e.target.value); setPatientDropdown(true); setSelectedPatient(null); }}
              onFocus={() => setPatientDropdown(true)}
              disabled={isEdit}
              placeholder="Search name / mobile / MRD…"
              autoFocus={!isEdit}
              data-testid="bk-patient-search"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
            />
            {patientDropdown && !isEdit && patientResults.length > 0 && (
              <div className="absolute z-10 mt-0.5 w-full max-h-40 overflow-auto bg-white border border-slate-300 rounded shadow-lg">
                {patientResults.map((p) => (
                  <button key={p.patient_id} type="button" onClick={() => { setSelectedPatient(p); setPatientQuery(p.name); setPatientDropdown(false); }}
                    data-testid={`bk-patient-${p.patient_id}`}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[9px] text-slate-500">{p.mrd || p.patient_id} · {p.age}{(p.gender||'')[0]}{p.mobile ? ` · ${p.mobile}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Audiologist *</label>
              <select value={audiologistId} onChange={(e) => setAudiologistId(e.target.value)} data-testid="bk-audiologist"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                {audiologists.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="bk-date"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Time *</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="bk-time"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white" />
            </div>
          </div>

          {/* Suggested slots */}
          {slots.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-1.5">
              <div className="text-[9px] font-semibold text-emerald-800 mb-1 uppercase tracking-wider">Available slots on {date}:</div>
              <div className="flex flex-wrap gap-0.5">
                {slots.slice(0, 14).map((s) => (
                  <button key={s.start_at} type="button"
                    onClick={() => setTime(s.start_at.slice(11, 16))}
                    className="text-[10px] px-1.5 py-0.5 bg-white border border-emerald-300 hover:bg-emerald-100 rounded text-emerald-800 font-mono tabular-nums"
                    data-testid={`bk-slot-${s.start_at.slice(11, 16)}`}>
                    {s.start_at.slice(11, 16)}
                  </button>
                ))}
                {slots.length > 14 && <span className="text-[9px] text-emerald-700 self-center px-1">+{slots.length - 14} more</span>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Service</label>
              <select value={service} onChange={(e) => setService(e.target.value)} data-testid="bk-service"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Duration</label>
              <select value={duration} onChange={(e) => setDuration(parseInt(e.target.value, 10))} data-testid="bk-duration"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Room</label>
              <select value={room} onChange={(e) => setRoom(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                <option value="">—</option>
                {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                <option value="normal">Normal</option><option value="urgent">Urgent</option><option value="vip">VIP</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="bk-notes"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded resize-y" />
          </div>

          {err && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1" data-testid="bk-error">{err}</div>}
        </div>

        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          <button onClick={submit} disabled={!valid || busy} data-testid="bk-save"
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold rounded">
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Book appointment')}
          </button>
        </div>
      </div>
    </div>
  );
}
