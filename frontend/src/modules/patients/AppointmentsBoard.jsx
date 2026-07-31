/**
 * Appointments Board — 7Health.Pro card-grid layout.
 * Cards show patient avatar + age + gender + contact + time + date + complaint
 * + status pill + kebab menu (View Profile · Attend Now · Add to Queue · Edit · Cancel).
 *
 * Loads today's appointments from /api/appointments?date=today.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Plus, Search, MoreVertical, ArrowRight, X, Edit2, ListPlus, User, LayoutGrid, List as ListIcon } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import BookAppointmentModal from '../appointments/components/BookAppointmentModal';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const offsetISO = (delta) => {
  const d = new Date(); d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
};
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; } };
const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();

const STATUS_STYLES = {
  scheduled: { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Scheduled' },
  booked:    { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Scheduled' },
  in_queue:  { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'In Queue' },
  checked_in:{ bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'In Queue' },
  attending: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Attending Now' },
  in_progress:{bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Attending Now' },
  complete:  { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Complete' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Complete' },
  cancelled: { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Cancelled' },
  no_show:   { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'No-show' },
};

const STATUS_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'in_queue',  label: 'In Queue' },
  { id: 'attending', label: 'Attending Now' },
  { id: 'complete',  label: 'Complete' },
  { id: 'cancelled', label: 'Cancelled' },
];

// Map a row's raw status to a filter bucket so synonyms collapse together
// (e.g. "in_progress" → "attending", "booked" → "scheduled").
const filterBucket = (raw) => {
  const k = String(raw || '').toLowerCase();
  if (['booked', 'scheduled'].includes(k)) return 'scheduled';
  if (['in_queue', 'checked_in'].includes(k)) return 'in_queue';
  if (['attending', 'in_progress'].includes(k)) return 'attending';
  if (['complete', 'completed'].includes(k)) return 'complete';
  if (['cancelled', 'no_show'].includes(k)) return 'cancelled';
  return k;
};

// ─── Test abbreviation mapping — used by the Tests column chips ───
// Free-form recommended_tests strings map to a compact 3-4 char label
// so the row stays readable. Colors follow the AUDINEXA v3 palette.
const TEST_ABBR = [
  { match: /pta|puretone|pure.?tone/i,        label: 'PTA',    bg: '#DBEAFE', color: '#1E40AF' },
  { match: /speech|srt|sds|wrs/i,             label: 'SPEECH', bg: '#FED7AA', color: '#9A3412' },
  { match: /tymp|imp|impedance|acoustic/i,    label: 'IA',     bg: '#EDE9FE', color: '#5B21B6' },
  { match: /oae|dpoae|teoae/i,                label: 'OAE',    bg: '#CFFAFE', color: '#155E75' },
  { match: /abr|bera|brainstem/i,             label: 'ABR',    bg: '#FFE4E6', color: '#9F1239' },
  { match: /hearing.?aid.?trial|hat|ha.?trial/i,  label: 'HAT',    bg: '#DCFCE7', color: '#166534' },
  { match: /tinn/i,                           label: 'TIN',    bg: '#FCE7F3', color: '#9D174D' },
  { match: /sound.?field|sfa|aided/i,         label: 'SFA',    bg: '#D1FAE5', color: '#065F46' },
  { match: /paed|vra|play/i,                  label: 'VRA',    bg: '#FEF3C7', color: '#854D0E' },
  { match: /vemp/i,                           label: 'VEMP',   bg: '#F3E8FF', color: '#6B21A8' },
];
const testChip = (raw = '') => {
  const match = TEST_ABBR.find((t) => t.match.test(String(raw)));
  return match || { label: String(raw).slice(0, 4).toUpperCase(), bg: '#E0E7FF', color: '#3730A3' };
};
// Returns the chip.label for a raw test — used for filter counts + match logic
const chipLabelFor = (raw) => testChip(raw).label;

// Detect appointment "mode" — telehealth vs walk-in / in-clinic — with
// sensible fallbacks since older rows won't have an explicit `mode`.
const modeOf = (a) => {
  const raw = (a.mode || a.appointment_mode || '').toLowerCase();
  if (raw === 'online' || raw === 'video' || raw === 'tele' || raw === 'telehealth') return 'Online';
  return 'Offline';
};

export default function AppointmentsBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = (user?.name || user?.email || 'there').split(/[ @]/)[0];

  const [date, setDate]   = useState(todayISO());
  const [q, setQ]         = useState('');
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]   = useState(() => localStorage.getItem('audinexa.appts.view') || 'list');
  const [status, setStatus] = useState('all');
  const [testType, setTestType] = useState('all');
  const [bookOpen, setBookOpen]   = useState(false);
  // When PatientProfilePage sends the user here via "Add Appointment",
  // the freshly-selected patient arrives on the query string. Preserve
  // the pre-selected patient across mounts so `BookAppointmentModal`
  // opens with the name locked and the search input hidden.
  const [bookPrefill, setBookPrefill] = useState(null);
  const [audiologists, setAudiologists] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();

  // Auto-open the booking modal when we arrive with ?bookForPatientId=…
  // Mirror of the same behaviour on `AppointmentsCalendarPage.jsx` so
  // "Add Appointment" from a patient profile always lands with the
  // patient pre-selected regardless of which appointments view is
  // rendered under `/patients/appointments`.
  useEffect(() => {
    const pid = searchParams.get('bookForPatientId');
    if (!pid) return;
    const pname = searchParams.get('bookForPatientName') || '';
    setBookPrefill({ patient_id: pid, patient_name: pname });
    setBookOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('bookForPatientId');
    next.delete('bookForPatientName');
    setSearchParams(next, { replace: true });
  }, []);

  // Pull staff once for the booking modal — we expose audiologist + clinic_owner roles
  // so the front desk can assign the appointment to the appropriate person.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/users`);
        const list = Array.isArray(r.data) ? r.data : (r.data?.users || []);
        if (alive) {
          setAudiologists(list
            .filter((u) => ['audiologist', 'clinic_owner', 'super_admin'].includes(u.role))
            .map((u) => ({ user_id: u.user_id, name: u.name, role: u.role })));
        }
      } catch { /* booking modal will still work without it (manual entry). */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { try { localStorage.setItem('audinexa.appts.view', view); } catch { /* ignore */ } }, [view]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Backend expects from_date/to_date — send both pinned to the same day
      // so we get exactly today's appointments and nothing else.
      const r = await axios.get(`${API}/appointments`, {
        params: { from_date: date, to_date: date, limit: 500 },
      });
      setRows(Array.isArray(r.data) ? r.data : (r.data?.items || []));
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // Cancel handler — confirm dialog + backend PATCH + optimistic UI update.
  // Called from the row-level ✗ button in ListView.
  const handleCancel = useCallback(async (appt) => {
    if (!appt?.appointment_id) return;
    if (!window.confirm(`Cancel appointment for ${appt.patient_name || 'this patient'}?`)) return;
    // Optimistic UI — mark cancelled locally before the network round-trip.
    setRows((prev) => prev.map((r) =>
      r.appointment_id === appt.appointment_id ? { ...r, status: 'cancelled' } : r
    ));
    try {
      await axios.post(`${API}/appointments/${appt.appointment_id}/cancel`, {
        reason: 'Cancelled from Appointments list',
      });
    } catch (e) {
      // rollback + surface error
      setRows((prev) => prev.map((r) =>
        r.appointment_id === appt.appointment_id ? { ...r, status: appt.status } : r
      ));
      // Surface backend error to the user via native confirm — matches existing UX in this file.
      alert(`Could not cancel appointment: ${e?.response?.data?.detail || e.message}`);
    }
  }, []);

  // Counts per status bucket — drives the chip badges
  const counts = useMemo(() => {
    const c = { all: rows.length };
    for (const r of rows) {
      const b = filterBucket(r.status);
      c[b] = (c[b] || 0) + 1;
    }
    return c;
  }, [rows]);

  // Test-type filter chips: only show types actually present in today's rows.
  // Each row's `recommended_tests` may hold free-form strings — normalize
  // each to its chip label so 'PTA at 4kHz' and 'pure-tone audiometry'
  // collapse into the same PTA bucket.
  const testTypeChips = useMemo(() => {
    const c = {};
    for (const r of rows) {
      const seen = new Set();
      for (const t of (r.recommended_tests || [])) {
        const label = chipLabelFor(t);
        if (seen.has(label)) continue;
        seen.add(label);
        c[label] = (c[label] || 0) + 1;
      }
    }
    // Preserve TEST_ABBR order + suffix any extras alphabetically
    const known = TEST_ABBR.map(t => t.label).filter(l => c[l]);
    const extras = Object.keys(c).filter(l => !known.includes(l)).sort();
    return [...known, ...extras].map(label => ({ label, count: c[label], style: testChip(label) }));
  }, [rows]);

  const filtered = useMemo(() => rows.filter((a) => {
    if (status !== 'all' && filterBucket(a.status) !== status) return false;
    if (testType !== 'all') {
      const labels = (a.recommended_tests || []).map(chipLabelFor);
      if (!labels.includes(testType)) return false;
    }
    if (q.trim()) {
      const term = q.toLowerCase();
      if (!(a.patient_name || '').toLowerCase().includes(term)
          && !(a.mobile || '').includes(term)) return false;
    }
    return true;
  }), [rows, status, testType, q]);

  const datePreset = (label, iso) => (
    <button
      key={label}
      onClick={() => setDate(iso)}
      data-testid={`appts-preset-${label.toLowerCase().replace(/\s/g, '-')}`}
      className={`text-[11px] px-2.5 py-1 rounded-md font-semibold border transition ${
        date === iso
          ? 'bg-cyan-600 text-white border-cyan-600'
          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="appointments-board">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Hey! {firstName} <span className="inline-block">👋</span></h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Here are list of all your appointments!</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="appts-date"
            className="text-[12px] px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700"
          />
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              data-testid="appts-search"
              className="text-[12px] pl-8 pr-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700 outline-none focus:border-cyan-500 w-44"
            />
          </div>
          <button
            type="button"
            onClick={() => setBookOpen(true)}
            data-testid="appts-add-btn"
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold shadow-sm shadow-cyan-600/20">
            <Plus size={13} /> Add Appointment
          </button>
        </div>
      </header>

      {/* Date presets + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {datePreset('Yesterday',  offsetISO(-1))}
          {datePreset('Today',      todayISO())}
          {datePreset('Tomorrow',   offsetISO(1))}
          {datePreset('In 7 days',  offsetISO(7))}
        </div>
        <div className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
          <button
            onClick={() => setView('board')}
            data-testid="appts-view-board"
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded ${view === 'board' ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <LayoutGrid size={12} /> Board
          </button>
          <button
            onClick={() => setView('list')}
            data-testid="appts-view-list"
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded ${view === 'list' ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <ListIcon size={12} /> List
          </button>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="appts-status-chips">
        {STATUS_FILTERS.map((f) => {
          const active = status === f.id;
          const n = counts[f.id] || 0;
          return (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              data-testid={`appts-chip-${f.id}`}
              className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold border transition ${
                active
                  ? 'bg-cyan-600 border-cyan-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              {f.label}
              <span className={`tabular-nums px-1.5 rounded-full text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* Test-type filter chips — only shown when at least one row has recommended_tests */}
      {testTypeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="appts-test-chips">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Tests</span>
          <button
            onClick={() => setTestType('all')}
            data-testid="appts-test-chip-all"
            className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold border transition ${
              testType === 'all'
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            All
          </button>
          {testTypeChips.map(({ label, count, style }) => {
            const active = testType === label;
            return (
              <button
                key={label}
                onClick={() => setTestType(active ? 'all' : label)}
                data-testid={`appts-test-chip-${label}`}
                title={active ? `Clear ${label} filter` : `Filter to ${label}`}
                className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-extrabold border transition uppercase tracking-wide ${
                  active ? 'ring-2 ring-offset-1 ring-cyan-500 shadow-sm' : 'hover:shadow-sm'
                }`}
                style={{ background: style.bg, color: style.color, borderColor: style.color + '40' }}>
                {label}
                <span className="tabular-nums text-[10px] font-bold px-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.6)', color: style.color }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center italic text-slate-400 text-sm">Loading appointments…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl py-16 text-center">
          <div className="text-sm font-semibold text-slate-700">
            No appointments {q ? 'match this filter' : (testType !== 'all' ? `require ${testType} today` : (status !== 'all' ? `with status "${status.replace(/_/g, ' ')}"` : 'on this date'))}.
          </div>
          <button
            type="button"
            onClick={() => setBookOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold">
            <Plus size={13} /> Book Appointment
          </button>
        </div>
      ) : view === 'list' ? (
        <ListView rows={filtered} onView={(pid) => navigate(`/patients/${pid}`)} onCancel={handleCancel} onChipClick={(label) => setTestType(label)} activeTest={testType} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {filtered.map((a) => (
            <ApptCard key={a.appointment_id} a={a} onView={() => navigate(`/patients/${a.patient_id}`)} />
          ))}
        </div>
      )}

      {bookOpen && (
        <BookAppointmentModal
          audiologists={audiologists}
          // Modal expects a JS Date object — `date` is the YYYY-MM-DD string
          // backing the date picker, so convert before passing.
          initialDate={new Date(date)}
          existing={bookPrefill || undefined}
          onClose={() => { setBookOpen(false); setBookPrefill(null); }}
          onSaved={() => { setBookOpen(false); setBookPrefill(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── ListView ───

function ListView({ rows, onView, onCancel, onChipClick, activeTest }) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-[0_2px_10px_-4px_rgba(15,23,42,0.06)]" data-testid="appts-list-view">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50">
            <tr className="text-cyan-700 uppercase text-[10.5px] font-extrabold tracking-[0.08em]">
              <th className="text-left px-4 py-3.5 whitespace-nowrap">Name</th>
              <th className="text-left px-3 py-3.5 whitespace-nowrap">Email</th>
              <th className="text-left px-3 py-3.5 whitespace-nowrap">Appointment</th>
              <th className="text-left px-3 py-3.5 whitespace-nowrap">Time</th>
              <th className="text-left px-3 py-3.5 whitespace-nowrap">Mode</th>
              <th className="text-left px-3 py-3.5 whitespace-nowrap">Contact</th>
              <th className="text-left px-3 py-3.5 whitespace-nowrap">Doctor</th>
              <th className="text-left px-3 py-3.5 whitespace-nowrap">Tests</th>
              <th className="text-left px-4 py-3.5 whitespace-nowrap">Recs</th>
            </tr>
          </thead>
          <tbody className="text-slate-800">
            {rows.map((a, i) => {
              const mode = modeOf(a);
              const modeBg = mode === 'Online' ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-600';
              const contact = a.mobile || a.patient_mobile || '—';
              const email = a.email || a.patient_email || '—';
              const doctor = a.doctor_name || a.assigned_to_name || a.audiologist_name || '—';
              const chips = (a.recommended_tests || []).slice(0, 4).map(testChip);
              const extraTests = Math.max(0, (a.recommended_tests || []).length - 4);
              const recs = a.recommendation || a.follow_up || a.notes || a.complaint || '';
              return (
                <tr
                  key={a.appointment_id}
                  data-testid={`appts-list-row-${a.appointment_id}`}
                  className={`border-t border-slate-100 hover:bg-cyan-50/40 transition-colors ${
                    i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                  }`}
                >
                  {/* Name + avatar */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onView(a.patient_id)}
                      className="flex items-center gap-2.5 text-left group"
                    >
                      <span className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-cyan-600 text-white flex items-center justify-center font-extrabold text-[11px] flex-shrink-0 shadow-sm">
                        {initials(a.patient_name)}
                      </span>
                      <span className="font-bold text-slate-900 group-hover:text-cyan-700 whitespace-nowrap">
                        {a.patient_name || '—'}
                      </span>
                    </button>
                  </td>
                  {/* Email */}
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{email}</td>
                  {/* Appointment date */}
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap tabular-nums">{fmtDate(a.start_at)}</td>
                  {/* Time */}
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap tabular-nums font-semibold">{fmtTime(a.start_at)}</td>
                  {/* Mode */}
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${modeBg}`}>
                      {mode}
                    </span>
                  </td>
                  {/* Contact */}
                  <td className="px-3 py-3 text-slate-700 tabular-nums whitespace-nowrap">{contact}</td>
                  {/* Doctor */}
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{doctor}</td>
                  {/* Tests — chip badges with abbreviations (clickable to filter) */}
                  <td className="px-3 py-3">
                    {chips.length === 0 ? (
                      <span className="text-slate-300 text-[11px]">—</span>
                    ) : (
                      <div className="flex items-center gap-1 flex-wrap min-w-[110px]">
                        {chips.map((c, idx) => {
                          const isActive = activeTest === c.label;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onChipClick && onChipClick(isActive ? 'all' : c.label); }}
                              data-testid={`appts-row-chip-${a.appointment_id}-${c.label}`}
                              title={isActive ? `Clear ${c.label} filter` : `Filter table to show only ${c.label} appointments`}
                              className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wide whitespace-nowrap transition cursor-pointer hover:brightness-95 ${
                                isActive ? 'ring-2 ring-offset-1 ring-cyan-500' : ''
                              }`}
                              style={{ background: c.bg, color: c.color }}
                            >
                              {c.label}
                            </button>
                          );
                        })}
                        {extraTests > 0 && (
                          <span className="text-[10px] font-bold text-slate-400">+{extraTests}</span>
                        )}
                      </div>
                    )}
                  </td>
                  {/* Recs — clinician notes + quick action buttons */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {recs && (
                        <span
                          className="text-[11.5px] text-slate-600 font-medium max-w-[160px] truncate"
                          title={recs}
                        >
                          {recs}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1.5">
                        <button
                          onClick={() => onView(a.patient_id)}
                          data-testid={`appts-list-approve-${a.appointment_id}`}
                          className="w-7 h-7 rounded-md bg-cyan-50 hover:bg-cyan-100 text-cyan-700 flex items-center justify-center border border-cyan-200"
                          title="Open patient"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        </button>
                        <button
                          onClick={() => onCancel(a)}
                          data-testid={`appts-list-cancel-${a.appointment_id}`}
                          className="w-7 h-7 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center border border-rose-200"
                          title="Cancel appointment"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApptCard({ a, onView }) {
  const s = STATUS_STYLES[String(a.status || '').toLowerCase()] || { bg: 'bg-slate-100', text: 'text-slate-700', label: a.status || '—' };
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3"
      data-testid={`appt-card-${a.appointment_id}`}>
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center font-bold text-[12px] flex-shrink-0">
          {initials(a.patient_name)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-slate-900 truncate">{a.patient_name || '—'}</div>
          <div className="text-[11px] text-slate-500 truncate">{a.age ? `${a.age} Years` : ''}{a.gender ? ` · ${a.gender}` : ''}</div>
        </div>
      </div>

      {/* Body */}
      <div className="text-[11.5px] text-slate-700 space-y-1">
        <Row k="Contact No." v={a.mobile || a.patient_mobile || '—'} />
        <Row k="Time" v={fmtTime(a.start_at)} />
        <Row k="Date" v={fmtDate(a.start_at)} />
      </div>

      {/* Note bubble */}
      <div className="bg-slate-50 border border-slate-100 rounded-md px-2.5 py-2 text-[11.5px] text-slate-700 italic min-h-[42px] line-clamp-2">
        {a.complaint || a.notes || a.service || '—'}
      </div>

      {/* Footer: status + kebab */}
      <div className="flex items-center justify-between mt-auto relative">
        <span className={`px-2.5 py-1 rounded-full text-[10.5px] font-semibold ${s.bg} ${s.text}`}>{s.label}</span>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          data-testid={`appt-menu-${a.appointment_id}`}
          className="w-7 h-7 rounded-full bg-cyan-600 hover:bg-cyan-700 text-white flex items-center justify-center">
          <MoreVertical size={13} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 bottom-9 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[150px]" data-testid={`appt-menu-open-${a.appointment_id}`}>
            <MenuItem icon={User}     label="View Profile" onClick={() => { setMenuOpen(false); onView(); }} />
            <MenuItem icon={ArrowRight} label="Attend Now"  onClick={() => { setMenuOpen(false); window.location.href = `/test`; }} />
            <MenuItem icon={ListPlus} label="Add to Queue" onClick={() => setMenuOpen(false)} />
            <MenuItem icon={Edit2}    label="Edit"         onClick={() => { setMenuOpen(false); window.location.href = `/patients/appointments`; }} />
            <MenuItem icon={X}        label="Cancel"       danger onClick={() => setMenuOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

const Row = ({ k, v }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-slate-500">{k}</span>
    <span className="font-semibold text-slate-800 truncate">{v}</span>
  </div>
);

const MenuItem = ({ icon: Icon, label, onClick, danger }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-50 ${danger ? 'text-rose-600' : 'text-slate-700'}`}>
    <Icon size={12} /> {label}
  </button>
);
