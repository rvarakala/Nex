/**
 * Reports Module — simple archive of completed diagnostic reports.
 *
 * Lifecycle (post Feb 2026 v2): `draft` → `completed` (flipped when audiologist
 * clicks "Save & Print Report" in Diagnostics → Reports). The saved PDF is the
 * exact DOM that was printed — no separate handover step.
 *
 * Actions per row:
 *   • Open Patient — slides in PatientDrawer with full visit/invoice history
 *   • Reprint Report — re-opens the stored PDF in a new tab
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  FileText, Printer, Search, UserRound, CheckCircle2, AlertCircle,
} from 'lucide-react';
import PatientDrawer from '../../components/PatientDrawer';
import LandscapePrompt from '../../components/LandscapePrompt';
import ReportViewerModal from '../../components/ReportViewerModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TEST_LABEL = {
  pta: 'PTA', impedance: 'Impedance', speech: 'Speech', oae: 'OAE',
  abr: 'ABR', soundfield: 'Sound Field', special: 'Special', tinnitus: 'Tinnitus', pediatric: 'Pediatric',
};
const VISIT_TYPE_STYLE = {
  referral:     { label: 'Referral',     cls: 'bg-sky-100 text-sky-800 border-sky-200' },
  walkin:       { label: 'Walk-in',      cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  consultation: { label: 'Consultation', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
};

const fmt = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

export default function ReportsModule() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [drawerPatientId, setDrawerPatientId] = useState(null);
  const [viewerRow, setViewerRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/reports`, {
        params: { status: 'completed', search: search || undefined, page, per_page: perPage },
      });
      setRows(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search]);

  const openPatientReport = useCallback((row) => {
    // In-app popup — user reviews report, then hits Print inside modal
    // for browser's native print dialog (Save as PDF or physical printer).
    setViewerRow(row);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="h-full flex flex-col bg-slate-50" data-testid="reports-module">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center gap-3 flex-shrink-0">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <FileText size={16} className="text-emerald-600" />
            Completed Reports
          </h1>
          <p className="text-[11px] text-slate-500">
            Archive of every signed & printed diagnostic report. Click a patient to see full history.
          </p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient / MRD / mobile"
            data-testid="reports-search"
            className="pl-7 pr-3 py-1.5 text-xs border border-slate-300 rounded w-64 focus:outline-none focus:border-emerald-400"
          />
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto p-4">
        <LandscapePrompt
          featureKey="reports_list"
          message="Rotate to landscape to see every column of each report row."
          testid="reports-landscape"
        />
        {err && (
          <div className="mb-3 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            <AlertCircle size={13} /> {err}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-slate-400 italic text-sm">Loading reports…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-slate-400 italic text-sm" data-testid="reports-empty">
            No completed reports yet. Ask an audiologist to click <b>Save &amp; Print Report</b> in Diagnostics.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <ReportRow
                key={row.session_id}
                row={row}
                onOpen={() => openPatientReport(row)}
                onOpenPatient={() => setDrawerPatientId(row.patient_id)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > perPage && (
          <div className="mt-4 flex items-center justify-between text-xs" data-testid="reports-pagination">
            <div className="text-slate-500">
              {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                data-testid="reports-prev"
                className="px-2 py-1 text-slate-700 bg-white border border-slate-300 disabled:opacity-40 rounded">← Prev</button>
              <span className="px-2 font-mono">{page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                data-testid="reports-next"
                className="px-2 py-1 text-slate-700 bg-white border border-slate-300 disabled:opacity-40 rounded">Next →</button>
            </div>
          </div>
        )}
      </div>

      <PatientDrawer
        patientId={drawerPatientId}
        onClose={() => setDrawerPatientId(null)}
      />

      {viewerRow && (
        <ReportViewerModal
          endpoint={`/reports/${viewerRow.session_id}/pdf`}
          filename={`report-${viewerRow.session_id}.pdf`}
          title="Hearing Assessment Report"
          subtitle={`${viewerRow.patient_name || 'Patient'}${viewerRow.mrd ? ` · ${viewerRow.mrd}` : ''}`}
          onClose={() => setViewerRow(null)}
        />
      )}
    </div>
  );
}

function ReportRow({ row, onOpen, onOpenPatient }) {
  const visit = VISIT_TYPE_STYLE[row.visit_type] || VISIT_TYPE_STYLE.walkin;
  const billPill = row.invoice ? (
    row.bill_paid
      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200" data-testid={`bill-paid-${row.session_id}`}>✓ Paid</span>
      : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200" data-testid={`bill-due-${row.session_id}`}>Due ₹{Number(row.invoice.due_total || 0).toFixed(0)}</span>
  ) : null;

  return (
    <div
      className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3 hover:border-emerald-300 transition-colors"
      data-testid={`report-row-${row.session_id}`}
    >
      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
        <UserRound size={16} className="text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onOpenPatient} className="font-bold text-sm text-slate-900 hover:text-emerald-700 truncate" data-testid={`report-open-${row.session_id}`} title="Open patient history">
            {row.patient_name || 'Unknown'}
          </button>
          <span className="text-[10px] font-mono text-slate-500">{row.mrd || row.patient_id}</span>
          {row.age != null && (
            <span className="text-[10px] text-slate-500">{row.age}{(row.gender || '')[0] || ''}</span>
          )}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${visit.cls}`}>
            {visit.label}
          </span>
          {row.has_uploaded_pdf && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200" title="Saved using the exact audiogram PDF the audiologist printed">
              As-printed
            </span>
          )}
          {row.recommended_tests?.length > 0 && (
            <div className="flex items-center gap-0.5 flex-wrap">
              {row.recommended_tests.slice(0, 4).map((t) => (
                <span key={t} className="text-[9px] px-1 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded">
                  {TEST_LABEL[t] || t}
                </span>
              ))}
              {row.recommended_tests.length > 4 && (
                <span className="text-[9px] text-slate-500">+{row.recommended_tests.length - 4}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
          <span>Test: <span className="text-slate-700">{fmt(row.test_date)}</span></span>
          {row.audiologist_name && <span>Audiologist: <span className="text-slate-700">{row.audiologist_name}</span></span>}
          {row.printed_at && <span>Printed: <span className="text-slate-700">{fmt(row.printed_at)}</span></span>}
          {row.referred_by && <span className="italic">Ref: <b>{row.referred_by}</b></span>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {billPill}
        <button onClick={onOpen} data-testid={`report-print-${row.session_id}`}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 rounded">
          <Printer size={12} /> Reprint
        </button>
        <span className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded">
          <CheckCircle2 size={12} /> Completed
        </span>
      </div>
    </div>
  );
}
