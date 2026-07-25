/**
 * HearingReportHistoryModal — lists all saved hearing-report snapshots for
 * a patient, most-recent first. Clicking a row opens the read-only viewer.
 *
 * Props:
 *   open       : boolean
 *   patientId  : string
 *   patientName: string (for the modal header)
 *   sessionId  : string  (highlights versions saved from the CURRENT session)
 *   onClose    : ()   → void
 *
 * The list stays lightweight — the heavy `snapshot` blob is fetched only
 * when the audiologist opens a specific version.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { X, FileText, Loader2, Eye } from 'lucide-react';
import HearingReportViewerModal from './HearingReportViewerModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmtWhen = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso).slice(0, 16); }
};

export default function HearingReportHistoryModal({ open, patientId, patientName, sessionId, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [viewerId, setViewerId] = useState(null); // version_id being previewed

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/hearing-reports/patient/${encodeURIComponent(patientId)}`);
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not load history');
    } finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
        onClick={onClose}
        data-testid="hearing-report-history-modal"
      >
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-cyan-600" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">Saved Reports</h2>
                <div className="text-[11px] text-slate-500">{patientName || 'Patient'}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              data-testid="hearing-report-history-close"
              className="w-7 h-7 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-500"
            >
              <X size={16} />
            </button>
          </header>

          {/* List */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : err ? (
              <div className="p-8 text-center text-sm text-rose-600 font-semibold">{err}</div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center">
                <FileText size={28} className="mx-auto text-slate-300 mb-2" />
                <div className="text-sm font-semibold text-slate-700">No saved reports yet</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Click <b>SAVE</b> on the Reports tab to keep a version of this visit.
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <li
                    key={r.version_id}
                    data-testid={`hearing-report-history-row-${i}`}
                    className={`px-5 py-3 hover:bg-cyan-50/50 cursor-pointer flex items-center justify-between gap-3 ${r.session_id === sessionId ? 'bg-emerald-50/40' : ''}`}
                    onClick={() => setViewerId(r.version_id)}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">
                        {r.label}
                        {r.session_id === sessionId && (
                          <span className="text-[9px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                            This visit
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Saved {fmtWhen(r.saved_at)}
                        {r.saved_by_name ? ` by ${r.saved_by_name}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setViewerId(r.version_id); }}
                      data-testid={`hearing-report-history-view-${i}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 shrink-0"
                    >
                      <Eye size={11} /> View
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <footer className="px-5 py-2.5 border-t border-slate-100 text-[10px] text-slate-400">
            Snapshots are stored as JSON — the report re-renders exactly as it was saved.
          </footer>
        </div>
      </div>

      {viewerId && (
        <HearingReportViewerModal
          versionId={viewerId}
          onClose={() => setViewerId(null)}
        />
      )}
    </>
  );
}
