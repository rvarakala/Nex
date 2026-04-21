import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * PatientSwitcher — top-header compact patient search combobox + session dropdown + journal button.
 *
 * props:
 *   patient: currently selected Patient object (or null)
 *   sessionId: currently selected session_id (or null)
 *   sessions: list of {session_id, test_date, status, ...} for the current patient
 *   onPickPatient(patientObj): switch to a patient (will load their sessions)
 *   onPickSession(sessionId): load a specific session into the clinical state
 *   onNewPatient(): open the PatientModal in create mode
 *   onEditPatient(): open the PatientModal in edit mode (patient prefilled)
 *   onNewSession(): create a fresh session for the current patient
 *   onOpenJournal(): open the chart-notes drawer
 */
export const PatientSwitcher = ({
  patient,
  sessionId,
  sessions = [],
  onPickPatient,
  onPickSession,
  onNewPatient,
  onEditPatient,
  onNewSession,
  onOpenJournal,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: query, limit: 20 } });
        setResults(r.data || []);
      } catch (e) {
        console.error('Patient search failed', e);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query, open]);

  const fmtSession = (s) => {
    try {
      const d = new Date(s.test_date);
      const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
      const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      return `${dateStr} · ${timeStr}${s.status && s.status !== 'draft' ? ` · ${s.status}` : ''}`;
    } catch { return s.session_id; }
  };

  return (
    <div className="flex items-center gap-2 text-xs" data-testid="patient-switcher">
      {/* Patient search / display */}
      <div ref={wrapRef} className="relative">
        <div className="flex items-center gap-1">
          <span className="text-gray-600 text-[11px]">Patient:</span>
          <div className="relative">
            <input
              type="text"
              value={open ? query : (patient ? `${patient.name} · ${patient.patient_id}` : '')}
              placeholder="Search name / mobile / MRD…"
              onFocus={() => { setOpen(true); setQuery(''); }}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              data-testid="patient-search-input"
              className="w-[260px] text-[11px] border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:border-blue-500 bg-white"
            />
            {open && (
              <div className="absolute z-30 top-full left-0 mt-0.5 w-[340px] max-h-72 overflow-auto bg-white border border-gray-300 rounded shadow-xl text-[11px]">
                {loading && <div className="px-2 py-1 text-gray-400 italic">Searching…</div>}
                {!loading && results.length === 0 && (
                  <div className="px-2 py-1.5 text-gray-400 italic">No matching patients</div>
                )}
                {results.map((p) => (
                  <button
                    key={p.patient_id}
                    type="button"
                    onClick={() => { onPickPatient?.(p); setOpen(false); setQuery(''); }}
                    data-testid={`patient-result-${p.patient_id}`}
                    className={`w-full text-left px-2 py-1 hover:bg-blue-50 border-b border-gray-100 last:border-0 ${
                      patient?.patient_id === p.patient_id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="font-medium text-gray-800">{p.name}</div>
                    <div className="text-[9px] text-gray-500">
                      {p.patient_id} · {p.age}{p.gender ? p.gender[0] : ''}
                      {p.mobile ? ` · ${p.mobile}` : (p.phone ? ` · ${p.phone}` : '')}
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setOpen(false); onNewPatient?.(); }}
                  data-testid="patient-add-new"
                  className="w-full text-left px-2 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold border-t border-blue-200"
                >
                  + New Patient
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Patient actions (only when a patient is selected) */}
      {patient && (
        <>
          <button
            onClick={onEditPatient}
            data-testid="patient-edit-btn"
            title="Edit patient details"
            className="px-1.5 py-0.5 text-[10px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700"
          >Edit</button>

          <div className="w-px h-4 bg-gray-300" />

          {/* Patient meta */}
          <span className="text-[10px] text-gray-600">
            {patient.age}{(patient.gender || '')[0] || ''}
            {patient.mobile ? ` · ${patient.mobile}` : ''}
          </span>

          <div className="w-px h-4 bg-gray-300" />

          {/* Session selector */}
          <span className="text-[11px] text-gray-600">Visit:</span>
          <select
            value={sessionId || ''}
            onChange={(e) => {
              if (e.target.value === '__new__') onNewSession?.();
              else onPickSession?.(e.target.value);
            }}
            data-testid="session-select"
            className="text-[11px] border border-gray-300 rounded px-1.5 py-0.5 bg-white max-w-[200px]"
          >
            {sessions.length === 0 && <option value="">(no visits yet)</option>}
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {fmtSession(s)}
              </option>
            ))}
            <option value="__new__" data-testid="session-new-option">+ New Visit</option>
          </select>

          <button
            onClick={onOpenJournal}
            data-testid="patient-journal-btn"
            title="Open chart notes / journal"
            className="px-1.5 py-0.5 text-[10px] border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded font-semibold"
          >Journal</button>
        </>
      )}

      {!patient && (
        <button
          onClick={onNewPatient}
          data-testid="patient-add-new-empty"
          className="px-2 py-0.5 text-[11px] bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded"
        >+ New Patient</button>
      )}
    </div>
  );
};
