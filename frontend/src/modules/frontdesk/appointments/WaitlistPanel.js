import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function WaitlistPanel({ audiologists, onClose, onBook }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [service, setService] = useState('');
  const [audId, setAudId] = useState('');
  const [prefDate, setPrefDate] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/waitlist`); setEntries(r.data || []); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selectedPatient && patientQuery === selectedPatient.name) return;
    if (!patientQuery || patientQuery.trim().length < 2) { setPatientResults([]); return; }
    const t = setTimeout(async () => {
      const r = await axios.get(`${API}/patients`, { params: { search: patientQuery, limit: 6 } });
      setPatientResults(r.data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [patientQuery, selectedPatient]);

  const addEntry = async () => {
    if (!selectedPatient) return;
    setAdding(true);
    try {
      await axios.post(`${API}/waitlist`, {
        patient_id: selectedPatient.patient_id,
        preferred_service: service || null,
        preferred_audiologist_id: audId || null,
        preferred_date: prefDate || null,
      });
      setSelectedPatient(null); setPatientQuery(''); setService(''); setAudId(''); setPrefDate('');
      load();
    } finally { setAdding(false); }
  };

  const cancel = async (entry_id) => {
    await axios.put(`${API}/waitlist/${entry_id}/status`, { status: 'cancelled' });
    load();
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <aside className="absolute right-0 top-0 bottom-0 w-[460px] max-w-[92vw] bg-white shadow-2xl flex flex-col" data-testid="waitlist-panel">
        <header className="px-3 py-2 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">Waitlist</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-red-600 text-lg w-6 h-6">×</button>
        </header>

        {/* Add new */}
        <div className="p-2.5 border-b border-slate-200 bg-slate-50 space-y-1.5">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Add to waitlist</div>
          <div className="relative">
            <input type="text" value={patientQuery}
              onChange={(e) => { setPatientQuery(e.target.value); setSelectedPatient(null); }}
              placeholder="Search patient by name / mobile / MRD…"
              data-testid="wl-patient-search"
              className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
            />
            {patientResults.length > 0 && !selectedPatient && (
              <div className="absolute z-10 mt-0.5 w-full max-h-36 overflow-auto bg-white border border-slate-300 rounded shadow-lg">
                {patientResults.map((p) => (
                  <button key={p.patient_id} type="button" onClick={() => { setSelectedPatient(p); setPatientQuery(p.name); setPatientResults([]); }}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[9px] text-slate-500">{p.mrd || p.patient_id}{p.mobile ? ` · ${p.mobile}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <select value={service} onChange={(e) => setService(e.target.value)} className="text-[11px] border border-slate-300 rounded px-1 py-1 bg-white">
              <option value="">Any service</option>
              {['PTA','Consultation','OAE','ABR/BERA','Follow-up','Hearing Aid Fitting'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={audId} onChange={(e) => setAudId(e.target.value)} className="text-[11px] border border-slate-300 rounded px-1 py-1 bg-white">
              <option value="">Any audiologist</option>
              {audiologists.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
            </select>
            <input type="date" value={prefDate} onChange={(e) => setPrefDate(e.target.value)} className="text-[11px] border border-slate-300 rounded px-1 py-1 bg-white" placeholder="Preferred date" />
          </div>
          <button disabled={!selectedPatient || adding} onClick={addEntry} data-testid="wl-add"
            className="w-full py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold rounded">
            {adding ? 'Adding…' : '+ Add to waitlist'}
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {loading ? <div className="text-[11px] text-slate-400 italic text-center py-4">Loading…</div> :
           entries.length === 0 ? <div className="text-[11px] text-slate-400 italic text-center py-4">Waitlist empty</div> :
           entries.map((w) => (
            <div key={w.entry_id} data-testid={`wl-entry-${w.entry_id}`} className="border border-slate-200 rounded p-1.5 bg-white">
              <div className="flex items-center justify-between mb-0.5">
                <div className="font-semibold text-[12px] text-slate-800">{w.patient_name}</div>
                <div className="flex gap-1">
                  <button onClick={() => onBook?.(w)} data-testid={`wl-book-${w.entry_id}`} className="text-[9px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded">Book</button>
                  <button onClick={() => cancel(w.entry_id)} className="text-[9px] px-1.5 py-0.5 border border-red-300 text-red-600 hover:bg-red-50 font-semibold rounded">✕</button>
                </div>
              </div>
              <div className="text-[10px] text-slate-500">
                {w.mrd || ''}{w.patient_mobile ? ` · ${w.patient_mobile}` : ''}
                {w.preferred_service ? ` · ${w.preferred_service}` : ''}
                {w.preferred_date ? ` · ${w.preferred_date}` : ''}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
