import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * PatientJournal — side drawer showing chronological chart notes for a patient.
 * props:
 *   patient: current patient object (must have patient_id + name)
 *   audiologist: author name for new notes
 *   open: boolean
 *   onClose()
 */
export const PatientJournal = ({ patient, audiologist, open, onClose }) => {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open || !patient?.patient_id) return;
    let cancel = false;
    axios.get(`${API}/patient-notes?patient_id=${patient.patient_id}`)
      .then((r) => { if (!cancel) setNotes(r.data || []); })
      .catch((e) => { if (!cancel) setErr(e?.message || 'Failed to load notes'); });
    return () => { cancel = true; };
  }, [open, patient?.patient_id]);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 100);
  }, [open]);

  const addNote = async () => {
    if (!draft.trim() || !patient?.patient_id) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await axios.post(`${API}/patient-notes`, {
        patient_id: patient.patient_id,
        text: draft.trim(),
        audiologist: audiologist || null,
      });
      setNotes((list) => [r.data, ...list]);
      setDraft('');
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to save note');
    } finally {
      setBusy(false);
    }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await axios.delete(`${API}/patient-notes/${noteId}`);
      setNotes((list) => list.filter((n) => n.note_id !== noteId));
    } catch (e) {
      setErr(e?.message || 'Delete failed');
    }
  };

  const fmtTs = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso || ''; }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="patient-journal-overlay"
    >
      <aside
        className="absolute right-0 top-0 bottom-0 w-[420px] max-w-[92vw] bg-white shadow-2xl flex flex-col"
        data-testid="patient-journal"
      >
        <header className="px-3 py-2 border-b border-gray-300 bg-gradient-to-r from-amber-50 to-white flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-800">Journal · Chart Notes</h3>
            <div className="text-[10px] text-gray-500">
              {patient?.name} · {patient?.patient_id}
            </div>
          </div>
          <button onClick={onClose} data-testid="journal-close" className="text-gray-500 hover:text-red-600 text-lg leading-none w-6 h-6">×</button>
        </header>

        {/* Compose */}
        <div className="p-2 border-b border-gray-200 bg-gray-50">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add chart note… (e.g., &quot;Counselled on HA trial; to return in 1 week&quot;)"
            rows={2}
            data-testid="journal-draft"
            className="w-full text-[12px] border border-gray-300 rounded px-2 py-1 resize-y focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center justify-between mt-1">
            <div className="text-[9px] text-gray-500">
              {audiologist ? `Posting as ${audiologist}` : 'Audiologist name not set'}
            </div>
            <button
              onClick={addNote}
              disabled={!draft.trim() || busy}
              data-testid="journal-add"
              className="px-2 py-0.5 text-[11px] bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded"
            >
              {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
          {err && <div className="text-[10px] text-red-600 mt-1" data-testid="journal-error">{err}</div>}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-auto p-2 space-y-1.5">
          {notes.length === 0 && (
            <div className="text-[11px] text-gray-400 italic text-center py-4">
              No notes yet — chart notes appear here chronologically.
            </div>
          )}
          {notes.map((n) => (
            <div
              key={n.note_id}
              data-testid={`journal-note-${n.note_id}`}
              className={`border rounded p-1.5 text-[11px] ${n.auto ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="text-[9px] text-gray-500">
                  {fmtTs(n.created_at)}
                  {n.audiologist && ` · ${n.audiologist}`}
                  {n.auto && <span className="ml-1 px-1 bg-blue-100 text-blue-700 rounded text-[8px] font-semibold">AUTO</span>}
                </div>
                {!n.auto && (
                  <button
                    onClick={() => deleteNote(n.note_id)}
                    className="text-[9px] text-gray-400 hover:text-red-600"
                    data-testid={`journal-del-${n.note_id}`}
                  >Delete</button>
                )}
              </div>
              <div className="whitespace-pre-wrap text-gray-800 leading-snug">{n.text}</div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
};
