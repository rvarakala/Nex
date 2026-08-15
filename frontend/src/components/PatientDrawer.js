/**
 * PatientDrawer — universal right-side slide-in drawer showing a patient's
 * historical sessions, invoices, and hearing-aid sales.
 *
 * Usage:
 *   const [openFor, setOpenFor] = useState(null);  // patient_id or null
 *   <PatientDrawer patientId={openFor} onClose={() => setOpenFor(null)} />
 *
 * Any patient name in the app can be wrapped in a button that calls
 * `setOpenFor(pid)` — the drawer fetches `/api/patients/{id}/history` once
 * per open and renders a scannable history summary. Receptionists get their
 * "30-second returning-patient check" in the form of audiogram thumbnails,
 * past bills, and past hearing-aid sales.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  X, FileText, Printer, Receipt, Headphones, ClipboardList,
  AlertCircle,
} from 'lucide-react';
import HearingReportPreviewModal from './HearingReportPreviewModal';
import { useAuth } from '../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmt = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }); }
  catch { return '—'; }
};

const DEGREE_COLOR = {
  normal: 'text-slate-500',
  mild: 'text-amber-600',
  moderate: 'text-orange-600',
  moderate_severe: 'text-rose-600',
  severe: 'text-red-700',
  profound: 'text-red-900',
};

function degreeLabel(d) {
  if (!d) return '—';
  return d.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PatientDrawer({ patientId, onClose }) {
  const { clinic } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [viewerSession, setViewerSession] = useState(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/patients/${patientId}/history`);
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not load patient history.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  // Close on Escape + lock body scroll while open
  useEffect(() => {
    if (!patientId) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [patientId, onClose]);

  const openReportPdf = (session) => {
    // Open in-app viewer modal — audiologist reviews the letterheaded
    // report first, then hits Print inside the modal to reach the
    // browser's native print dialog.
    setViewerSession(session);
  };

  if (!patientId) return null;

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="patient-drawer">
      {/* Backdrop */}
      <div
        className="flex-1 bg-slate-900/40 backdrop-blur-[1px]"
        onClick={onClose}
        data-testid="patient-drawer-backdrop"
      />
      {/* Drawer panel */}
      <aside className="w-full sm:w-[520px] bg-white shadow-2xl flex flex-col animate-[slideIn_180ms_ease-out]"
             style={{ animation: 'slideIn 180ms ease-out' }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white flex items-center gap-3">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Patient history</div>
            <div className="text-base font-bold text-slate-900" data-testid="pd-name">
              {data?.patient?.name || (loading ? 'Loading…' : 'Patient')}
            </div>
            {data?.patient && (
              <div className="text-[11px] text-slate-500 mt-0.5">
                {data.patient.mrd || data.patient.patient_id}
                {data.patient.age != null && ` · ${data.patient.age}${(data.patient.gender || '')[0] || ''}`}
                {data.patient.mobile && ` · ${data.patient.mobile}`}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
            data-testid="patient-drawer-close"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-5">
          {loading && (
            <div className="text-center py-8 text-sm text-slate-400 italic">Loading history…</div>
          )}
          {err && (
            <div className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              <AlertCircle size={13} /> {err}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Counts strip */}
              <div className="grid grid-cols-3 gap-2">
                <StatTile icon={ClipboardList} label="Sessions" value={data.counts?.sessions || 0} />
                <StatTile icon={Receipt} label="Invoices" value={data.counts?.invoices || 0} />
                <StatTile icon={Headphones} label="HA sales" value={data.ha_sales?.length || 0} />
              </div>

              {/* Sessions */}
              <section data-testid="pd-sessions">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ClipboardList size={12} /> Recent sessions
                </h3>
                {(data.sessions || []).length === 0 ? (
                  <div className="text-[12px] text-slate-400 italic">No previous sessions.</div>
                ) : (
                  <div className="space-y-1.5">
                    {data.sessions.map((s) => (
                      <div
                        key={s.session_id}
                        data-testid={`pd-session-${s.session_id}`}
                        className="group flex items-center gap-3 p-2 rounded border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
                      >
                        <div className="text-[11px] font-mono text-slate-500 w-16 flex-shrink-0">
                          {fmt(s.test_date || s.created_at)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-slate-800 truncate">
                            {s.audiologist_name || 'Unknown audiologist'}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            R: <span className={DEGREE_COLOR[s.right_ear_degree] || ''}>{degreeLabel(s.right_ear_degree)}</span>
                            {' · '}
                            L: <span className={DEGREE_COLOR[s.left_ear_degree] || ''}>{degreeLabel(s.left_ear_degree)}</span>
                            {s.report_status && (
                              <span className="ml-1.5 inline-block px-1 py-0 rounded bg-slate-100 text-slate-600 text-[9px] uppercase">
                                {s.report_status.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => openReportPdf(s)}
                          data-testid={`pd-open-${s.session_id}`}
                          className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded px-2 py-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Preview and print the report"
                        >
                          <Printer size={10} /> View
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Invoices */}
              <section data-testid="pd-invoices">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Receipt size={12} /> Recent invoices
                </h3>
                {(data.invoices || []).length === 0 ? (
                  <div className="text-[12px] text-slate-400 italic">No invoices yet.</div>
                ) : (
                  <div className="space-y-1.5">
                    {data.invoices.map((inv) => (
                      <div
                        key={inv.invoice_id}
                        className="flex items-center gap-3 p-2 rounded border border-slate-200"
                        data-testid={`pd-inv-${inv.invoice_id}`}
                      >
                        <div className="text-[11px] font-mono text-slate-500 w-16 flex-shrink-0">{fmt(inv.invoice_date)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-slate-800 truncate">{inv.invoice_no || inv.invoice_id}</div>
                          <div className="text-[10px] text-slate-500">
                            Total ₹{Number(inv.grand_total || 0).toFixed(0)}
                            {' · Paid ₹'}{Number(inv.paid_total || 0).toFixed(0)}
                          </div>
                        </div>
                        {Number(inv.due_total || 0) > 0.01 ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                            Due ₹{Number(inv.due_total).toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                            ✓ Paid
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* HA sales */}
              {data.ha_sales?.length > 0 && (
                <section data-testid="pd-ha-sales">
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Headphones size={12} /> Hearing-aid purchases
                  </h3>
                  <div className="space-y-1.5">
                    {data.ha_sales.map((sale) => (
                      <div key={sale.sale_id} className="flex items-center gap-3 p-2 rounded border border-slate-200">
                        <div className="text-[11px] font-mono text-slate-500 w-16 flex-shrink-0">{fmt(sale.sale_date)}</div>
                        <div className="flex-1 text-[12px] text-slate-800">
                          ₹{Number(sale.grand_total || 0).toFixed(0)}
                          <span className="text-[10px] text-slate-500 ml-2">{sale.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
      {viewerSession && (
        <HearingReportPreviewModal
          sessionId={viewerSession.session_id}
          title="Hearing Assessment Report"
          shareContext={{
            sessionId: viewerSession.session_id,
            patientMobile: data?.patient?.mobile,
            patientName: data?.patient?.name,
            clinicName: clinic?.name,
          }}
          onClose={() => setViewerSession(null)}
        />
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="p-2 rounded border border-slate-200 bg-slate-50 text-center">
      <Icon size={14} className="mx-auto text-slate-500" />
      <div className="text-lg font-black text-slate-900 tabular-nums leading-none mt-0.5">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
    </div>
  );
}
