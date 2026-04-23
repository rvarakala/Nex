/**
 * Reports Module — the "Pending Reports" queue for receptionists.
 *
 * Three tabs:
 *   Pending    → sessions where audiologist clicked "Test Completed" but report not printed yet.
 *   Ready for Handover → printed, waiting on bill payment + physical handover.
 *   Completed  → handed over (terminal).
 *
 * Actions per row:
 *   • Print Report  — opens the existing PDF render for the session
 *   • Mark Handed Over — reception flips status to completed (requires invoice paid)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Printer, Handshake, Search, UserRound,
  CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../AuthContext';
import PatientDrawer from '../../components/PatientDrawer';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TABS = [
  { key: 'ready',     label: 'Ready for Handover',  icon: FileText,      testid: 'reports-tab-ready' },
  { key: 'completed', label: 'Completed',           icon: CheckCircle2,  testid: 'reports-tab-completed' },
];

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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('ready');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');
  const [drawerPatientId, setDrawerPatientId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/reports`, {
        params: { status: tab, search: search || undefined, page, per_page: perPage },
      });
      setRows(r.data?.items || []);
      setTotal(r.data?.total || 0);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }, [tab, search, page]);

  useEffect(() => { load(); }, [load]);

  // Reset pagination on tab/search change
  useEffect(() => { setPage(1); }, [tab, search]);

  const canHandover = useMemo(() =>
    ['front_desk', 'clinic_owner', 'super_admin', 'accounts', 'founder'].includes(user?.role),
  [user?.role]);

  const openPatientReport = useCallback(async (row) => {
    // Fetch the report PDF as an authenticated blob, then open it in a new tab.
    // (Direct navigation to /api/reports/{id}/pdf would 401 because the browser
    //  can't attach the Authorization header on a cross-origin URL.)
    try {
      const r = await axios.get(`${API}/reports/${row.session_id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const w = window.open(url, '_blank');
      if (!w) {
        // Popup blocked — fall back to a download
        const a = document.createElement('a');
        a.href = url;
        a.download = `report-${row.session_id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Flip status → printed in the background (idempotent on the backend)
      axios.post(`${API}/sessions/${row.session_id}/mark-printed`).catch(() => { });
      // Revoke URL after a minute so the preview has time to render
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      // Refresh the list so the row moves from Pending → Ready for Handover
      setTimeout(load, 1200);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not open the report PDF.');
    }
  }, [load]);

  const markHandedOver = async (row) => {
    if (!canHandover) return;
    const canBypass = ['super_admin', 'accounts', 'founder'].includes(user?.role);
    if (!row.bill_paid && !canBypass) {
      alert('Cannot finish consultation — the invoice is not fully paid yet.\n\nCollect payment at billing first, then click Consultation Finished again.');
      return;
    }
    const bypass = !row.bill_paid && canBypass
      ? window.confirm('The invoice is NOT fully paid. As an accounts role, you may override and close the consultation anyway. Proceed?')
      : false;
    setBusyId(row.session_id);
    try {
      await axios.post(`${API}/sessions/${row.session_id}/handover`, {
        channel: 'in_person',
        bypass_bill_check: bypass,
      });
      await load();
    } catch (e) {
      const d = e?.response?.data?.detail;
      alert((typeof d === 'object' ? d?.message : d) || 'Handover failed.');
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="h-full flex flex-col bg-slate-50" data-testid="reports-module">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center gap-3 flex-shrink-0">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <FileText size={16} className="text-emerald-600" />
            Reports
          </h1>
          <p className="text-[11px] text-slate-500">
            Track diagnostic reports from test-complete through handover to the patient.
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

      {/* Tabs */}
      <div className="px-4 bg-white border-b border-slate-200 flex items-center gap-0.5 flex-shrink-0">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={t.testid}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                active
                  ? 'border-emerald-600 text-emerald-700 bg-emerald-50/40'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon size={13} />
              {t.label}
              {active && total > 0 && (
                <span className="ml-1 text-[10px] font-mono bg-emerald-600 text-white rounded-full px-1.5">
                  {total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto p-4">
        {err && (
          <div className="mb-3 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            <AlertCircle size={13} /> {err}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-slate-400 italic text-sm">Loading reports…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-slate-400 italic text-sm" data-testid="reports-empty">
            {tab === 'pending' && 'No sessions are pending report print-out right now.'}
            {tab === 'ready' && 'No printed reports waiting for handover.'}
            {tab === 'completed' && 'No completed reports in this window.'}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <ReportRow
                key={row.session_id}
                row={row}
                tab={tab}
                canHandover={canHandover}
                busy={busyId === row.session_id}
                onOpen={() => openPatientReport(row)}
                onOpenPatient={() => setDrawerPatientId(row.patient_id)}
                onHandover={() => markHandedOver(row)}
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
    </div>
  );
}

function ReportRow({ row, tab, canHandover, busy, onOpen, onOpenPatient, onHandover }) {
  const visit = VISIT_TYPE_STYLE[row.visit_type] || VISIT_TYPE_STYLE.walkin;
  const billPill = row.invoice ? (
    row.bill_paid
      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200" data-testid={`bill-paid-${row.session_id}`}>✓ Paid</span>
      : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200" data-testid={`bill-due-${row.session_id}`}>Due ₹{Number(row.invoice.due_total || 0).toFixed(0)}</span>
  ) : (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">No invoice</span>
  );

  return (
    <div
      className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3 hover:border-emerald-300 transition-colors"
      data-testid={`report-row-${row.session_id}`}
    >
      {/* Patient */}
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
          {row.test_completed_at && tab === 'pending' && <span>Completed: <span className="text-slate-700">{fmt(row.test_completed_at)}</span></span>}
          {row.printed_at && tab === 'ready' && <span>Printed: <span className="text-slate-700">{fmt(row.printed_at)}</span></span>}
          {row.handed_over_at && tab === 'completed' && <span>Handed over: <span className="text-slate-700">{fmt(row.handed_over_at)}</span></span>}
          {row.referred_by && <span className="italic">Ref: <b>{row.referred_by}</b></span>}
        </div>
      </div>

      {/* Bill indicator + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {billPill}

        <button onClick={onOpen} data-testid={`report-print-${row.session_id}`}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 rounded">
          <Printer size={12} /> Print
        </button>

          {tab !== 'completed' && (
          <button
            onClick={onHandover}
            disabled={!canHandover || busy}
            data-testid={`report-handover-${row.session_id}`}
            title={canHandover ? 'Consultation finished — patient is leaving' : 'Requires front desk / accounts role'}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 rounded"
          >
            <Handshake size={12} /> {busy ? '…' : 'Consultation Finished'}
          </button>
          )}

        {tab === 'completed' && (
          <span className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded">
            <CheckCircle2 size={12} /> Completed
          </span>
        )}
      </div>
    </div>
  );
}
