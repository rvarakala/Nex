/**
 * Diagnostics Queue Board (Hearing Tests) — v3-aligned redesign
 * (2026-07-01, aligned with the AUDINEXA dashboard v3 theme).
 *
 * Adopts the layout from `/mockups/hearing-tests-v2.html`:
 *   • Big page title + "N pending · M completed today · <day>" strip
 *   • 4-column Kanban with saturated colored headers (amber / violet /
 *     purple / emerald) and larger, rounded patient cards
 *   • Each card shows Name + Token ID + demographic line + recommended-
 *     test chips (PTA / SPEECH / IMP / OAE / ABR …)
 *   • LIVE pulse badge on the row that's currently in-progress
 *   • RPT badge on repeat/revisit patients in the Completed column
 *   • "Available Tests" launcher grid below the board (informational
 *     tile shortcut list, matches the mockup's tile design)
 *
 * All existing functionality is preserved:
 *   • Drag-and-drop between Waiting/Checked-In → In-Progress or Completed
 *   • Click-to-start / click-to-resume / click-to-open-report
 *   • 20-second auto-refresh
 *   • Walk-in + Returning-Patient shortcuts
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useTestContext } from '../../TestContext';
import {
  Clock, ClipboardList, Activity, CheckCircle2, RefreshCw, UserPlus, Users,
  Ear, Mic, CircleDot, Waves, Zap, Music, Baby, Sparkles, FileText, Radio,
  ChevronRight,
} from 'lucide-react';
import ErrorToast, { describeError } from '../../components/ErrorToast';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ────────────────────────── Column config ──────────────────────────
const COLUMNS = [
  {
    key: 'waiting', label: 'Waiting', Icon: Clock,
    headerBg: 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
    accentBorder: '#F59E0B',
  },
  {
    key: 'checked_in', label: 'Checked In', Icon: ClipboardList,
    headerBg: 'linear-gradient(135deg,#818CF8 0%,#6366F1 100%)',
    accentBorder: '#6366F1',
  },
  {
    key: 'in_progress', label: 'In Progress', Icon: Activity,
    headerBg: 'linear-gradient(135deg,#A855F7 0%,#7C3AED 100%)',
    accentBorder: '#7C3AED',
  },
  {
    key: 'completed', label: 'Completed', Icon: CheckCircle2,
    headerBg: 'linear-gradient(135deg,#34D399 0%,#059669 100%)',
    accentBorder: '#059669',
  },
];

// Priority → left-border tint
const PRIO_LEFT = {
  urgent: '#F43F5E',
  vip: '#D946EF',
  normal: '#E2E8F0',
};

// Recommended-test canonical set → chip color palette
const TEST_CHIP = {
  PTA:     { bg: '#DBEAFE', color: '#1E40AF' },
  SPEECH:  { bg: '#FED7AA', color: '#9A3412' },
  IMP:     { bg: '#EDE9FE', color: '#5B21B6' },
  OAE:     { bg: '#CFFAFE', color: '#155E75' },
  ABR:     { bg: '#FFE4E6', color: '#9F1239' },
  TINN:    { bg: '#FCE7F3', color: '#9D174D' },
  SFA:     { bg: '#DCFCE7', color: '#166534' },
  VRA:     { bg: '#FEF3C7', color: '#854D0E' },
  VEMP:    { bg: '#F3E8FF', color: '#6B21A8' },
  SPECIAL: { bg: '#E0E7FF', color: '#3730A3' },
};

// Common abbreviation lookup so free-form recommended_tests strings still
// map to a chip color.
const chipFor = (raw = '') => {
  const s = String(raw).toUpperCase().replace(/[^A-Z]/g, '');
  if (s.startsWith('PTA') || s.includes('PURETONE')) return { label: 'PTA', ...TEST_CHIP.PTA };
  if (s.startsWith('SPEECH') || s === 'SRT' || s === 'SDS' || s === 'WRS') return { label: 'SPEECH', ...TEST_CHIP.SPEECH };
  if (s.startsWith('IMP') || s.startsWith('TYMP') || s === 'ACOUSTIC') return { label: 'IMP', ...TEST_CHIP.IMP };
  if (s.startsWith('OAE') || s === 'DPOAE' || s === 'TEOAE') return { label: 'OAE', ...TEST_CHIP.OAE };
  if (s.startsWith('ABR') || s.startsWith('BERA')) return { label: 'ABR', ...TEST_CHIP.ABR };
  if (s.startsWith('TINN')) return { label: 'TINN', ...TEST_CHIP.TINN };
  if (s.startsWith('SOUND') || s === 'SFA' || s.startsWith('AIDED')) return { label: 'SFA', ...TEST_CHIP.SFA };
  if (s.startsWith('PED') || s === 'VRA' || s.startsWith('PAED')) return { label: 'VRA', ...TEST_CHIP.VRA };
  if (s.startsWith('VEMP')) return { label: 'VEMP', ...TEST_CHIP.VEMP };
  return { label: raw.slice(0, 6).toUpperCase(), ...TEST_CHIP.SPECIAL };
};

// Available-tests launcher tiles — informational shortcut row below the
// Kanban. Each tile shows count-of-patients-with-this-test-recommended
// today so the audiologist can see the diagnostic mix at a glance.
// Map LAUNCHER_TILES.key → the corresponding `activeTab` value used by
// TestProceduresModule so a click deep-links straight into that panel
// for the currently active patient (issue #5, 2026-07-30). VRA has no
// dedicated tab yet — routes to "pediatric" which is the closest fit.
// VEMP lacks a panel too, so it opens the "special" tab where the
// audiologist can note vestibular results manually.
const LAUNCHER_TAB_KEY = {
  PTA: 'pure_tone',
  SPEECH: 'speech',
  IMP: 'impedance',
  OAE: 'oae',
  ABR: 'abr',
  TINN: 'tinnitus',
  SFA: 'soundfield',
  VRA: 'pediatric',
  VEMP: 'special',
  SPECIAL: 'special',
};

const LAUNCHER_TILES = [
  { key: 'PTA',     title: 'Pure-Tone Audiometry', sub: 'Air + bone thresholds', Icon: Activity,   iconBg: '#DBEAFE', iconColor: '#2563EB', accent: '#3B82F6' },
  { key: 'SPEECH',  title: 'Speech Audiometry',    sub: 'SRT + SDS',             Icon: Mic,        iconBg: '#FED7AA', iconColor: '#EA580C', accent: '#F97316' },
  { key: 'IMP',     title: 'Impedance',            sub: 'Tympanometry + reflexes', Icon: CircleDot, iconBg: '#EDE9FE', iconColor: '#7C3AED', accent: '#8B5CF6' },
  { key: 'OAE',     title: 'OAE',                  sub: 'DPOAE / TEOAE',         Icon: Waves,      iconBg: '#CFFAFE', iconColor: '#0891B2', accent: '#06B6D4' },
  { key: 'ABR',     title: 'ABR / BERA',           sub: 'Brainstem evoked',      Icon: Zap,        iconBg: '#FFE4E6', iconColor: '#E11D48', accent: '#F43F5E' },
  { key: 'TINN',    title: 'Tinnitus Match',       sub: 'Pitch + loudness',      Icon: Music,      iconBg: '#FCE7F3', iconColor: '#BE185D', accent: '#EC4899' },
  { key: 'SFA',     title: 'Soundfield',           sub: 'Aided threshold',       Icon: Radio,      iconBg: '#DCFCE7', iconColor: '#059669', accent: '#10B981' },
  { key: 'VRA',     title: 'Paediatric',           sub: 'VRA / play audio',      Icon: Baby,       iconBg: '#FEF3C7', iconColor: '#B45309', accent: '#F59E0B' },
  { key: 'VEMP',    title: 'VEMP',                 sub: 'Vestibular evoked',     Icon: Sparkles,   iconBg: '#F3E8FF', iconColor: '#7E22CE', accent: '#A855F7' },
  { key: 'SPECIAL', title: 'Special Tests',        sub: 'SISI · ABLB · TDT',     Icon: FileText,   iconBg: '#E0E7FF', iconColor: '#4338CA', accent: '#6366F1' },
];

// ────────────────────────── Helpers ──────────────────────────
const initials = (n = '') =>
  (n || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase();
const initialsBg = (n = '') => {
  const p = ['bg-rose-50 text-rose-700', 'bg-blue-50 text-blue-700', 'bg-violet-50 text-violet-700',
             'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700', 'bg-sky-50 text-sky-700'];
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return p[h % p.length];
};
const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : null);
const todayHuman = () => new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// ────────────────────────── Main component ──────────────────────────
export default function DiagnosticsQueueBoard() {
  const navigate = useNavigate();
  const { setActiveTest } = useTestContext();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(null);
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

  // ── Action primitives (unchanged from previous version) ─────────
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
    if (row.state === 'completed') {
      if (!row.session_id) {
        if (row.patient_id) navigate(`/patients/${row.patient_id}`);
        return;
      }
      try {
        const r = await axios.get(`${API}/reports/${row.session_id}/pdf`, { responseType: 'blob' });
        const url = URL.createObjectURL(r.data);
        const w = window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
        if (!w) {
          const a = document.createElement('a');
          a.href = url; a.download = `report-${row.session_id}.pdf`;
          document.body.appendChild(a); a.click(); a.remove();
        }
      } catch (e) {
        alert(e?.response?.status === 404
          ? 'No PDF report has been generated for this session yet.'
          : `Could not load report: ${e?.response?.data?.detail || e.message}`);
      }
      return;
    }
    await startAndNavigate(row);
  };

  // ── Drag & drop (same allowed transitions as before) ────────────
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
      if (toCol === 'in_progress')  await startAndNavigate(payload);
      else if (toCol === 'completed') await markComplete(payload);
    } catch { /* swallow */ } finally {
      setDragFrom(null);
    }
  };

  // ── Launcher tile counts — how many pending patients have each
  //    test in their `recommended_tests` list. Purely informational.
  const launcherCounts = useMemo(() => {
    if (!data) return {};
    const counts = {};
    const pending = [
      ...(data.columns.waiting     || []),
      ...(data.columns.checked_in  || []),
      ...(data.columns.in_progress || []),
    ];
    for (const row of pending) {
      for (const t of row.recommended_tests || []) {
        const c = chipFor(t);
        counts[c.label] = (counts[c.label] || 0) + 1;
      }
    }
    return counts;
  }, [data]);

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center p-4" style={{ background: '#EEF1FA' }}>
        <div className="text-sm text-slate-500">Loading today&apos;s queue…</div>
      </div>
    );
  }

  const totalPending = (data.counts.waiting || 0) + (data.counts.checked_in || 0) + (data.counts.in_progress || 0);
  const completedCount = data.counts.completed || 0;

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1600px] mx-auto" data-testid="diagnostics-queue-board" style={{ background: '#EEF1FA' }}>

      {/* ============ Header ============ */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[24px] sm:text-[28px] font-extrabold text-slate-900 tracking-tight">Hearing Tests</h1>
          <div className="text-[13px] text-slate-500 font-medium mt-1">
            <span className="font-bold text-slate-900">{totalPending}</span> pending ·{' '}
            <span className="font-bold text-emerald-700">{completedCount} completed</span> today · {todayHuman()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 bg-white text-slate-700 text-[12px] font-semibold px-3 py-2 rounded-full shadow-sm">
            <Clock size={14} className="text-slate-400" /> Today
          </span>
          <button
            onClick={load}
            data-testid="dq-refresh"
            title="Refresh now"
            className="w-10 h-10 rounded-full bg-white shadow-sm text-slate-600 hover:text-slate-900 hover:shadow flex items-center justify-center"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => navigate('/patients')}
            data-testid="dq-returning"
            className="hidden sm:inline-flex items-center gap-1.5 bg-white text-slate-700 hover:bg-slate-50 text-[13px] font-bold px-4 py-2 rounded-full shadow-sm border border-slate-200"
          >
            <Users size={14} /> Returning
          </button>
          <button
            onClick={() => navigate('/patients?new=1')}
            data-testid="dq-new-walkin"
            className="inline-flex items-center gap-1.5 text-white text-[13px] font-bold px-4 py-2 rounded-full shadow-md hover:shadow-lg transition-shadow"
            style={{ background: 'linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%)' }}
          >
            <UserPlus size={14} /> Walk-in Test
          </button>
        </div>
      </div>

      {err && <ErrorToast err={err} testid="diag-queue-err" />}

      {/* ============ 4-column Kanban ============ */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const rows = data.columns[col.key] || [];
          const isValidTarget = canDrop(dragFrom, col.key);
          const isHovered = dragOver === col.key && isValidTarget;
          const isInvalidHover = dragOver === col.key && !isValidTarget;
          return (
            <div
              key={col.key}
              data-testid={`dq-col-${col.key}`}
              className={`flex flex-col rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.06)] min-h-[280px] overflow-hidden transition-all ${
                isHovered ? 'ring-2 ring-offset-2 ring-cyan-400 shadow-xl scale-[1.005]' : ''
              } ${isInvalidHover ? 'opacity-70' : ''}`}
              onDragOver={(e) => {
                if (dragFrom) { e.preventDefault(); e.dataTransfer.dropEffect = isValidTarget ? 'move' : 'none'; }
              }}
              onDragEnter={(e) => { if (dragFrom) { e.preventDefault(); setDragOver(col.key); } }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOver((v) => (v === col.key ? null : v));
              }}
              onDrop={(e) => handleDrop(col.key, e)}
            >
              {/* Colored gradient header */}
              <div
                className="flex items-center justify-between px-4 py-2.5 text-white flex-shrink-0"
                style={{ background: col.headerBg }}
              >
                <div className="flex items-center gap-2">
                  <col.Icon size={16} strokeWidth={2.4} />
                  <span className="text-[12px] font-extrabold uppercase tracking-widest">{col.label}</span>
                </div>
                <span
                  data-testid={`dq-count-${col.key}`}
                  className="text-[13px] font-extrabold bg-white/25 backdrop-blur-sm rounded-full px-2.5 py-0.5"
                >
                  {rows.length}
                </span>
              </div>

              {/* Rows */}
              <div className="flex-1 p-3 space-y-2.5 overflow-auto">
                {rows.length === 0 ? (
                  <div className={`h-full min-h-[120px] flex items-center justify-center text-center rounded-xl border-2 border-dashed ${
                    isHovered ? 'border-cyan-400 bg-cyan-50/50' : 'border-slate-200 bg-slate-50/60'
                  }`}>
                    <span className="text-[12px] text-slate-400 font-medium px-4">
                      {isHovered ? 'Drop patient here to start' : 'No patients in this stage.'}
                    </span>
                  </div>
                ) : rows.map((row) => (
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
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ============ Available Tests launcher ============ */}
      <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.06)] p-5" data-testid="dq-launcher">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Ear size={16} />
            </div>
            <h3 className="text-[16px] sm:text-[17px] font-extrabold text-slate-900 tracking-tight">Available Tests</h3>
          </div>
          <span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest">
            {LAUNCHER_TILES.length} categories
          </span>
        </div>
        <p className="text-[12.5px] text-slate-500 font-medium mb-4">
          Badges show today&apos;s queue count · click a tile to launch that test for the currently active patient.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {LAUNCHER_TILES.map((tile) => {
            const count = launcherCounts[tile.key] || 0;
            return (
              <button
                key={tile.key}
                data-testid={`dq-launch-${tile.key.toLowerCase()}`}
                onClick={() => {
                  const tab = LAUNCHER_TAB_KEY[tile.key];
                  navigate(tab ? `/test?tab=${tab}` : '/test');
                }}
                className="relative bg-white rounded-2xl border border-slate-100 hover:shadow-[0_10px_24px_-8px_rgba(15,29,58,0.18)] hover:-translate-y-0.5 transition-all p-4 text-left group"
                style={{ borderTop: `4px solid ${tile.accent}` }}
              >
                {count > 0 && (
                  <span
                    className="absolute top-2.5 right-2.5 text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white shadow-sm"
                    style={{ background: tile.accent }}
                  >
                    {count} DUE
                  </span>
                )}
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: tile.iconBg, color: tile.iconColor }}
                >
                  <tile.Icon size={20} strokeWidth={2.2} />
                </div>
                <div className="text-[13.5px] font-extrabold text-slate-900 leading-tight tracking-tight">{tile.title}</div>
                <div className="text-[11.5px] text-slate-500 font-medium mt-0.5 truncate">{tile.sub}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────── Patient Card ──────────────────────────
function PatientCard({ row, fromCol, isBusy, onPick, onDragStart, onDragEnd }) {
  const draggable = fromCol !== 'completed';
  const isInProgress = row.state === 'in_progress';
  const isCompleted  = row.state === 'completed';
  const isRepeat     = ['revisit', 'follow_up', 'followup', 'repeat'].includes((row.visit_type || '').toLowerCase());
  const chips = (row.recommended_tests || []).slice(0, 4).map(chipFor);
  const ctaLabel = isCompleted ? 'View report' : isInProgress ? 'Resume' : 'Start test';
  const tokenLabel = row.token_no != null
    ? `T-${String(row.token_no).padStart(2, '0')}`
    : row.appointment_id
      ? `A-${String(row.appointment_id).slice(-4).toUpperCase()}`
      : null;

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
      className={`relative w-full text-left bg-white rounded-xl p-3 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer select-none border border-slate-100 ${isBusy ? 'opacity-50 cursor-wait' : ''} ${isInProgress ? 'ring-2 ring-violet-500/60' : ''}`}
      style={{ borderLeft: `4px solid ${PRIO_LEFT[row.priority || 'normal']}` }}
    >
      {/* Top row — name + token */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="text-[14.5px] font-extrabold text-slate-900 tracking-tight truncate">{row.name || '—'}</div>
            {isInProgress && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-extrabold uppercase text-white bg-red-500 px-1.5 py-0.5 rounded-full">
                <span className="w-1 h-1 rounded-full bg-white animate-pulse" /> LIVE
              </span>
            )}
            {isCompleted && isRepeat && (
              <span className="text-[9px] font-extrabold uppercase text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                ✓ RPT
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-slate-500 font-medium mt-0.5 truncate">
            {[
              row.age && `${row.age}${(row.gender || '')[0] || ''}`,
              row.service,
              hhmm(row.start_at || row.arrived_at),
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {tokenLabel && (
          <div className="flex-shrink-0 border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-slate-700 tabular-nums">
            {tokenLabel}
          </div>
        )}
      </div>

      {/* Recommended test chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-1.5">
          {chips.map((c, i) => (
            <span
              key={i}
              className="text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{ background: c.bg, color: c.color }}
            >
              {c.label}
            </span>
          ))}
          {(row.recommended_tests || []).length > 4 && (
            <span className="text-[9.5px] font-bold text-slate-400">+{row.recommended_tests.length - 4}</span>
          )}
        </div>
      )}

      {/* Bottom action row */}
      <div className="flex items-center justify-end mt-2 text-[11px] font-semibold text-cyan-700 gap-1 group-hover:text-cyan-800">
        {isBusy ? 'Opening…' : ctaLabel}
        <ChevronRight size={12} strokeWidth={2.6} />
      </div>
    </div>
  );
}
