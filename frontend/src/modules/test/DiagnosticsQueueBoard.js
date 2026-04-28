/**
 * Diagnostics Queue Board — replaces the "No active diagnostic session"
 * empty state. Shows today's pipeline in 4 columns (Waiting, Checked In,
 * In Progress, Completed). One click on any Waiting/Checked-In/In-Progress
 * card auto-starts (or resumes) that patient's session and navigates into
 * the test module.
 *
 * Data source: /api/diagnostics/queue — unified view across walk-in
 * tokens, today's appointments, and draft test sessions. Refreshes every
 * 20s so late arrivals appear without a manual reload.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useTestContext } from '../../TestContext';
import {
  Clock, ClipboardList, Activity, CheckCircle2, RefreshCw, AlertCircle, UserPlus,
} from 'lucide-react';
import ErrorToast, { describeError } from '../../components/ErrorToast';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const COLUMNS = [
  { key: 'waiting',     label: 'Waiting',     Icon: Clock,         tone: 'amber',   accent: 'border-amber-300 bg-amber-50' },
  { key: 'checked_in',  label: 'Checked In',  Icon: ClipboardList, tone: 'indigo',  accent: 'border-indigo-300 bg-indigo-50' },
  { key: 'in_progress', label: 'In Progress', Icon: Activity,      tone: 'violet',  accent: 'border-violet-300 bg-violet-50' },
  { key: 'completed',   label: 'Completed',   Icon: CheckCircle2,  tone: 'emerald', accent: 'border-emerald-300 bg-emerald-50' },
];

const PRIO_STYLE = {
  urgent: 'border-l-4 border-rose-500',
  vip:    'border-l-4 border-fuchsia-500',
  normal: 'border-l-4 border-slate-200',
};

export default function DiagnosticsQueueBoard() {
  const navigate = useNavigate();
  const { setActiveTest } = useTestContext();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(null);  // patient_id currently starting
  // Drag-and-drop state: which source column a card is being dragged from,
  // and which column is currently being hovered over. Powers the column
  // highlight + drop-validity gating.
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/diagnostics/queue`);
      setData(r.data);
      setErr('');
    } catch (e) {
      setErr(describeError(e, 'Failed to load queue'));
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, [load]);

  // --- Action primitives (shared by click & drag-drop) -------------------

  const startAndNavigate = async (row) => {
    setStarting(row.patient_id);
    try {
      const r = await axios.post(`${API}/diagnostics/queue/start`, {
        patient_id: row.patient_id,
        token_id: row.token_id || undefined,
        appointment_id: row.appointment_id || undefined,
        session_id: row.session_id || undefined,
      });
      setActiveTest({ patient: r.data.patient, sessionId: r.data.session_id });
      navigate('/test');
    } catch (e) {
      setErr(describeError(e, 'Could not start session'));
    } finally {
      setStarting(null);
    }
  };

  const markComplete = async (row) => {
    // Drag-to-complete from In Progress: need the session_id. From other
    // columns we do a "start-then-complete" (quick close for a
    // consultation-only visit). Both flows are already idempotent on the
    // backend — safe to chain.
    setStarting(row.patient_id);
    try {
      let sessionId = row.session_id;
      if (!sessionId) {
        const r = await axios.post(`${API}/diagnostics/queue/start`, {
          patient_id: row.patient_id,
          token_id: row.token_id || undefined,
          appointment_id: row.appointment_id || undefined,
        });
        sessionId = r.data.session_id;
      }
      await axios.post(`${API}/diagnostics/queue/complete`, { session_id: sessionId });
      await load();
    } catch (e) {
      setErr(describeError(e, 'Could not mark complete'));
    } finally {
      setStarting(null);
    }
  };

  const pickAndStart = async (row) => {
    // Completed rows open the existing report PDF in a new tab (preferred:
    // audiologists want to view/print the finished report, not re-enter the
    // test workflow). We pull the blob through axios so the JWT travels with
    // the request, then create an object URL.
    if (row.state === 'completed') {
      if (!row.session_id) {
        // Fall back to the patient's full profile → Reports tab when the
        // queue row is missing a session_id (rare — pre-session data import
        // edge case). At least the user lands somewhere with the report.
        if (row.patient_id) navigate(`/patients/${row.patient_id}`);
        return;
      }
      try {
        const r = await axios.get(`${API}/reports/${row.session_id}/pdf`, { responseType: 'blob' });
        const url = URL.createObjectURL(r.data);
        const w = window.open(url, '_blank', 'noopener');
        // Clean up the object URL after the new tab has had a chance to load.
        setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
        if (!w) {
          // Pop-up blocker — fall back to in-tab download
          const a = document.createElement('a');
          a.href = url; a.download = `report-${row.session_id}.pdf`;
          document.body.appendChild(a); a.click(); a.remove();
        }
      } catch (e) {
        // Surface a clear error rather than silently bouncing back. Most
        // common cause: report wasn't generated yet (404).
        // eslint-disable-next-line no-alert
        alert(
          e?.response?.status === 404
            ? 'No PDF report has been generated for this session yet.'
            : `Could not load report: ${e?.response?.data?.detail || e.message}`,
        );
      }
      return;
    }
    await startAndNavigate(row);
  };

  // --- Drag-and-drop -----------------------------------------------------
  //
  // Allowed transitions:
  //   waiting     → in_progress   (start session, stay on board)
  //   checked_in  → in_progress   (start session, stay on board)
  //   in_progress → completed     (close session)
  //   waiting     → completed     (consultation-only quick close)
  //   checked_in  → completed     (consultation-only quick close)
  // Anything else (e.g. completed → anywhere, same-column drop) is a
  // no-op — the row just snaps back visually.
  const canDrop = (from, to) => {
    if (!from || from === to) return false;
    if (from === 'completed') return false;
    if (to === 'in_progress') return from === 'waiting' || from === 'checked_in';
    if (to === 'completed') return from !== 'completed';
    return false;
  };

  const handleDrop = async (toCol, e) => {
    e.preventDefault();
    setDragOver(null);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (!canDrop(payload.from, toCol)) return;
      if (toCol === 'in_progress') {
        // Same shape `startAndNavigate` expects — opens the test module.
        await startAndNavigate(payload);
      } else if (toCol === 'completed') {
        // Don't navigate; the audiologist is bulk-processing the board.
        await markComplete(payload);
      }
    } catch {
      // swallow — dragdrop should never crash the UI
    } finally {
      setDragFrom(null);
    }
  };

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center p-4 bg-slate-50">
        <div className="text-xs text-slate-500">Loading today's queue…</div>
      </div>
    );
  }

  const totalPending = (data.counts.waiting || 0) + (data.counts.checked_in || 0) + (data.counts.in_progress || 0);

  return (
    <div className="h-full flex flex-col bg-slate-50" data-testid="diagnostics-queue-board">
      {/* Header strip */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-slate-800">Diagnostics Queue</h2>
          <span className="text-[11px] text-slate-500">
            {totalPending === 0
              ? 'No patients pending — you can register a walk-in or call the next one.'
              : `${totalPending} pending · ${data.counts.completed || 0} completed today · drag a card between columns or click to start`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} data-testid="dq-refresh" title="Refresh now"
            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => navigate('/frontdesk/new')} data-testid="dq-new-walkin"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded">
            <UserPlus size={11} /> New Walk-in
          </button>
          <button onClick={() => navigate('/frontdesk/returning')} data-testid="dq-returning"
            className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded">
            Returning Patient
          </button>
        </div>
      </div>

      {err && <div className="px-4 py-2 border-b border-rose-200"><ErrorToast err={err} testid="diag-queue-err" /></div>}

      {/* 4-column board */}
      <div className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 min-h-full">
          {COLUMNS.map((col) => {
            const rows = data.columns[col.key] || [];
            const Icon = col.Icon;
            const isValidTarget = canDrop(dragFrom, col.key);
            const isHovered = dragOver === col.key && isValidTarget;
            const isInvalidHover = dragOver === col.key && !isValidTarget;
            return (
              <div
                key={col.key}
                className={`rounded-lg border flex flex-col min-h-[280px] transition-all ${col.accent} ${
                  isHovered ? 'ring-2 ring-indigo-500 ring-offset-1 shadow-lg scale-[1.01]' : ''
                } ${isInvalidHover ? 'opacity-60' : ''}`}
                data-testid={`dq-col-${col.key}`}
                onDragOver={(e) => {
                  if (dragFrom) { e.preventDefault(); e.dataTransfer.dropEffect = isValidTarget ? 'move' : 'none'; }
                }}
                onDragEnter={(e) => { if (dragFrom) { e.preventDefault(); setDragOver(col.key); } }}
                onDragLeave={(e) => {
                  // Leaving is noisy during hover-over-child; only clear when we
                  // truly leave the column bounding box.
                  if (!e.currentTarget.contains(e.relatedTarget)) setDragOver((v) => (v === col.key ? null : v));
                }}
                onDrop={(e) => handleDrop(col.key, e)}
              >
                <div className="px-3 py-2 border-b border-slate-200/60 bg-white/40 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Icon size={13} className={`text-${col.tone}-700`} />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">{col.label}</span>
                  </div>
                  <span className={`text-xs font-bold text-${col.tone}-800 bg-white rounded-full px-2 py-0.5`} data-testid={`dq-count-${col.key}`}>
                    {rows.length}
                  </span>
                </div>
                <div className="flex-1 p-2 space-y-1.5 overflow-auto">
                  {rows.length === 0 ? (
                    <div className="text-[10px] text-slate-400 italic text-center py-6">
                      {isHovered ? 'Drop here' : 'No patients in this stage.'}
                    </div>
                  ) : (
                    rows.map((row) => (
                      <PatientCard
                        key={`${col.key}-${row.patient_id}-${row.token_id || row.appointment_id || row.session_id || ''}`}
                        row={row}
                        fromCol={col.key}
                        isBusy={starting === row.patient_id}
                        onPick={() => pickAndStart(row)}
                        onDragStart={(e) => {
                          setDragFrom(col.key);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('application/json', JSON.stringify({ ...row, from: col.key }));
                        }}
                        onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PatientCard({ row, fromCol, isBusy, onPick, onDragStart, onDragEnd }) {
  const ctaLabel = row.state === 'completed'
    ? 'View report →'
    : row.state === 'in_progress'
      ? 'Resume →'
      : 'Start test →';
  const draggable = fromCol !== 'completed';  // completed cards are read-only.
  return (
    <div
      draggable={draggable && !isBusy}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(); }}
      data-testid={`dq-card-${row.patient_id}`}
      className={`w-full text-left bg-white rounded p-2 shadow-sm hover:shadow-md transition-shadow ${PRIO_STYLE[row.priority || 'normal']} ${isBusy ? 'opacity-50 cursor-wait' : 'cursor-pointer'} group select-none`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-900 truncate">{row.name || '—'}</div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            {row.mrd || row.patient_id}
            {row.age ? ` · ${row.age}${(row.gender || '')[0] || ''}` : ''}
            {row.mobile ? ` · ${row.mobile}` : ''}
          </div>
        </div>
        {row.token_no != null && (
          <div className="flex-shrink-0 bg-slate-900 text-white text-[10px] font-bold rounded px-1.5 py-0.5">
            T{row.token_no}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {row.priority && row.priority !== 'normal' && (
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded ${
              row.priority === 'urgent' ? 'bg-rose-100 text-rose-700'
              : 'bg-fuchsia-100 text-fuchsia-700'
            }`}>
              {row.priority}
            </span>
          )}
          {row.service && (
            <span className="text-[9px] text-slate-500">{row.service}</span>
          )}
          {row.start_at && row.state === 'checked_in' && (
            <span className="text-[9px] text-slate-500">
              at {String(row.start_at).slice(11, 16)}
            </span>
          )}
        </div>
        <span className="text-[10px] font-semibold text-indigo-700 opacity-60 group-hover:opacity-100">
          {isBusy ? 'Opening…' : ctaLabel}
        </span>
      </div>
    </div>
  );
}
